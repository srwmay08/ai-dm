# Import necessary libraries.
import os  # Used to access environment variables.
import json  # Used for working with JSON data.
import logging  # Used for logging application events.
import configparser  # Used to read configuration files.
from bson import ObjectId  # Used to work with MongoDB's unique IDs.
from flask import Flask, jsonify, request, render_template  # Core Flask components.
from flask_cors import CORS  # Handles Cross-Origin Resource Sharing to allow the frontend to communicate with this backend.
from pymongo import MongoClient  # The driver for connecting to a MongoDB database.
import google.generativeai as genai  # The Google Generative AI library.

# --- Configuration & Logging Setup ---
# Initialize the configparser to read the 'config.ini' file.
config = configparser.ConfigParser()
config.read('config.ini')
# Get the 'Logging' section from the config file to control log output.
log_config = config['Logging']

# Configure the basic logging settings for the application.
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Flask App Initialization ---
# Create an instance of the Flask application.
# It's configured to look for HTML templates in the 'templates' folder and static files (CSS, JS) in the 'static' folder.
app = Flask(__name__, template_folder='templates', static_folder='static')

# --- CORS Configuration ---
# Configure CORS to allow requests from the frontend's origin (http://127.0.0.1:3000).
# This is a security measure required for web browsers.
CORS(app, resources={r"/*": {"origins": "http://127.0.0.1:3000"}})

# --- Database Setup ---
# Establish a connection to the local MongoDB server.
client = MongoClient('mongodb://localhost:27017/')
# Select the database named 'ai_dm_database'.
db = client['ai_dm_database']
# Get references to the collections that will store the data.
npc_collection = db['npcs']
location_collection = db['locations']
lore_collection = db['lore']


# --- AI Setup ---
# This block initializes the connection to the Google Generative AI.
try:
    # Retrieve the API key from an environment variable for security.
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        # If the key is not found, raise an error.
        raise KeyError("GEMINI_API_KEY environment variable not set.")
    # Configure the library with the API key.
    genai.configure(api_key=api_key)
    # Create an instance of the generative model. 'gemini-1.5-flash' is a fast and efficient model.
    ai_model = genai.GenerativeModel('gemini-1.5-flash')
except KeyError as e:
    # If the environment variable is missing, log a fatal error and exit the application.
    logging.fatal(f"FATAL: {e}")
    exit()

# --- Helper Function ---
def serialize_doc(doc):
    """
    Converts a MongoDB document's ObjectId to a string.
    This is necessary because the default ObjectId format is not directly convertible to JSON.
    """
    if doc and '_id' in doc:
        doc['_id'] = str(doc['_id'])
    return doc

# --- Data Loading Function ---
def load_json_directory(directory_path, collection):
    """
    Loads all JSON files from a specified directory into a MongoDB collection.
    This function is used at startup to populate the database from your data files.
    """
    # Check if the provided directory path is valid.
    if not os.path.isdir(directory_path):
        logging.error(f"Data directory not found: {directory_path}")
        return
    
    # Clear the collection before loading new data to prevent duplicates.
    collection.delete_many({})
    loaded_files = 0
    # Loop through each file in the directory.
    for filename in os.listdir(directory_path):
        if filename.endswith('.json'):
            filepath = os.path.join(directory_path, filename)
            try:
                # Open and read the JSON file.
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # The data can be a single object or a list of objects.
                    if isinstance(data, list):
                        if data:
                            # If it's a list, add a unique ID to each item and insert them all.
                            for item in data: item.setdefault('_id', ObjectId())
                            collection.insert_many(data)
                    else:
                        # If it's a single object, add an ID and insert it.
                        data.setdefault('_id', ObjectId())
                        collection.insert_one(data)
                loaded_files += 1
            except Exception as e:
                logging.error(f"Error loading {filepath}: {e}")
    logging.info(f"Loaded {loaded_files} files from {directory_path} into {collection.name}.")


# --- Frontend & Core Routes ---
@app.route('/')
def serve_index():
    """
    This is the main route. It serves the 'index.html' file to the user's browser.
    """
    return render_template('index.html')

@app.route('/generate', methods=['POST'])
def generate_scene():
    """
    This is the most critical route. It receives player actions from the frontend,
    constructs a detailed prompt, sends it to the Google AI, and returns the
    AI-generated response.
    """
    # Log the incoming request if enabled in the config.
    if log_config.getboolean('log_requests'): logging.info(f"Request: {request.json}")

    try:
        # Get the JSON data sent from the frontend.
        data = request.json
        npc_names = data.get('npc_names', [])
        location_name_from_req = data.get('location_name')

        # Fetch the full profiles for all NPCs currently in the scene from the database.
        npcs_in_scene = [serialize_doc(npc) for npc in npc_collection.find({'name': {'$in': npc_names}})]
        primary_npc = npcs_in_scene[0] if npcs_in_scene else None
        
        # Fetch the location data from the database.
        location = serialize_doc(location_collection.find_one({'name': location_name_from_req}))
        
        # Ensure the location was actually found in the database.
        if not location:
            return jsonify({"error": f"Location '{location_name_from_req}' not found."}), 404

        # Find the specific room within the location's data.
        selected_room = next((r for r in location.get('rooms', []) if r['name'] == data.get('room')), None)

        # --- CONSTRUCT THE AI PROMPT ---
        # This section gathers all necessary context to send to the AI.
        
        # Collect all lore IDs associated with the NPCs in the scene.
        all_lore_ids = []
        npc_profiles_list = []
        for n in npcs_in_scene:
            # Build a detailed profile for each NPC.
            details = [f"- **{n['name']}**: {n.get('description', '')}"]
            if n.get('motivation'): details.append(f"  - **Motivation**: {', '.join(n.get('motivation',[]))}")
            npc_profiles_list.append('\n'.join(details))
            if n.get('lore_id'): all_lore_ids.extend(n.get('lore_id', []))

        # Fetch the relevant lore documents from the database based on the collected IDs.
        lore_text = "No specific lore known."
        if all_lore_ids:
            lore_details = []
            lore_entries = lore_collection.find({'lore_id': {'$in': all_lore_ids}})
            for lore in lore_entries:
                lore_details.append(f"- {lore.get('title', '')}: {lore.get('content', '')}")
            if lore_details: lore_text = "\n\n".join(lore_details)
        
        # Combine the NPC profiles and names into strings.
        npc_profiles_text = "\n\n".join(npc_profiles_list)
        npc_names_present = ", ".join([n['name'] for n in npcs_in_scene])

        # Create a description of the player's action based on the prompt type.
        prompt_type = data.get('prompt_type', 'dialogue')
        if prompt_type == 'skill_check':
            action_description = f"The player prompts **{primary_npc['name']}** to use their **{data.get('user_prompt')}** skill to interact with the room or its contents."
        else: # Default to dialogue
            action_description = f"The player says to {primary_npc['name']}: \"{data.get('user_prompt')}\""

        # This is the final prompt template sent to the AI. It provides all the context
        # and strict instructions on how the AI should format its JSON response.
        prompt = f"""
        You are a Dungeon Master AI. Your task is to generate a narrative response and predict the player's next actions.
        Your response MUST be a valid JSON object.

        **CRITICAL RULE:** Only characters listed as 'CHARACTERS PRESENT' can speak or take actions. Do NOT invent dialogue or actions for characters not in the scene, even if they are mentioned in the lore.

        **JSON Structure Requirements:**
        1.  `dialogue`: An array of objects, each with "speaker" and "line". Speakers MUST be from the 'CHARACTERS PRESENT' list.
        2.  `scene_changes`: A string describing actions and environmental changes.
        3.  `new_dialogue_options`: An object with two keys:
            - `npc_name`: The name of the NPC who is the focus of the action (e.g., "{primary_npc['name']}").
            - `options`: A list of 3-5 short, plausible dialogue prompts that a player might say next.

        **CONTEXT:**
        - Location: {location.get('name', 'Unknown')} - {selected_room.get('name', 'Unknown Room')}
        - Room Description: {selected_room.get('description')}
        - CHARACTERS PRESENT: {npc_names_present}
        - Character Profiles: {npc_profiles_text}
        - Relevant Lore: {lore_text}

        **PLAYER'S ACTION:** {action_description}

        Generate the JSON response now.
        """

        # Log the full prompt if enabled.
        if log_config.getboolean('log_ai_prompt'): logging.info(f"--- PROMPT ---\n{prompt}\n----------")
        
        # Send the prompt to the generative AI model.
        response = ai_model.generate_content(prompt)
        # Clean up the response text, removing potential markdown formatting.
        clean_response = response.text.strip().lstrip('```json').rstrip('```')
        
        # Log the AI's response if enabled.
        if log_config.getboolean('log_ai_response'): logging.info(f"--- RESPONSE ---\n{clean_response}\n----------")
            
        # Return the cleaned, valid JSON response to the frontend.
        return jsonify(json.loads(clean_response)), 200

    except Exception as e:
        # Generic error handling to catch any unexpected issues.
        logging.error(f"!!! An error occurred in /generate: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500
    
# --- Data Management Routes ---
# These routes are simple GET endpoints for the frontend to fetch initial data.
@app.route('/npcs', methods=['GET'])
def get_npcs():
    """Returns a list of all NPCs in the database."""
    return jsonify([serialize_doc(npc) for npc in npc_collection.find()])

@app.route('/locations', methods=['GET'])
def get_locations():
    """Returns a list of all locations in the database."""
    return jsonify([serialize_doc(loc) for loc in location_collection.find()])

# --- Main Execution Block ---
if __name__ == '__main__':
    # This block runs only when the script is executed directly (not imported).
    
    # Load all the JSON data into the MongoDB database on startup.
    load_json_directory('data/npcs', npc_collection)
    load_json_directory('data/locations', location_collection)
    load_json_directory('data/lore', lore_collection)
    
    # Configure Flask's auto-reloader to watch for changes in data and template files.
    # This is very useful for development, as the server will restart automatically
    # when you change a file.
    extra_dirs = ['data/npcs/', 'data/locations/', 'data/lore/', 'templates/', 'static/']
    extra_files = extra_dirs[:]
    for extra_dir in extra_dirs:
        for dirname, _, filenames in os.walk(extra_dir):
            for filename in filenames:
                if os.path.isfile(os.path.join(dirname, filename)):
                    extra_files.append(os.path.join(dirname, filename))

    # Start the Flask development server.
    # debug=True enables detailed error pages and auto-reloading.
    # port=5000 is the standard port for Flask development.
    app.run(debug=True, port=5000, extra_files=extra_files)