# Import necessary libraries.
import os  # Used to access environment variables.
import json  # Used for working with JSON data.
import logging  # Used for logging application events.
import configparser  # Used to read configuration files.
import re  # Used for regular expressions.
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
monster_collection = db['monsters'] # New collection for monsters
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
    if log_config.getboolean('log_requests'): logging.info(f"Request: {request.json}")

    try:
        data = request.json
        character_names = data.get('npc_names', [])
        location_name_from_req = data.get('location_name')

        npcs_in_scene = [serialize_doc(npc) for npc in npc_collection.find({'name': {'$in': character_names}})]
        monsters_in_scene = [serialize_doc(monster) for monster in monster_collection.find({'name': {'$in': character_names}})]
        all_characters_in_scene = npcs_in_scene + monsters_in_scene
        
        location = serialize_doc(location_collection.find_one({'name': location_name_from_req}))
        if not location:
            return jsonify({"error": f"Location '{location_name_from_req}' not found."}), 404

        selected_room = next((r for r in location.get('rooms', []) if r['name'] == data.get('room')), None)

        # --- MODIFIED PROMPT CONSTRUCTION ---
        
        # 1. PUBLIC KNOWLEDGE (Everyone knows this)
        public_knowledge_text = f"""
        - **Location**: {location.get('name', 'Unknown')} - {selected_room.get('name', 'Unknown Room')}
        - **Room Description**: {selected_room.get('description')}
        - **Characters Physically Present**: {", ".join([c['name'] for c in all_characters_in_scene])}
        - **Player's Action**: The player's input is: \"{data.get('user_prompt')}\" targeting {data.get('primary_target', 'everyone')}.
        """

        # 2. PRIVATE KNOWLEDGE (Character-specific dossiers)
        private_knowledge_dossiers = []
        for char in all_characters_in_scene:
            # Fetch lore SPECIFIC to this character
            lore_ids = char.get('lore_id', [])
            character_specific_lore = ""
            if lore_ids:
                lore_entries = lore_collection.find({'lore_id': {'$in': lore_ids}})
                lore_details = [f"- {lore.get('title', '')}: {lore.get('content', '')}" for lore in lore_entries]
                if lore_details:
                    character_specific_lore = "\\n\\n".join(lore_details)

            dossier = f"""
            <Dossier for="{char['name']}">
            - **Name**: {char['name']}
            - **Character Type**: {char.get('character_type', 'Character')}
            - **Profile**: {char.get('description', '')}
            - **Motivations**: {', '.join(char.get('motivation', []))}
            - **Personality**: {', '.join(char.get('personality_traits', []))}
            - **Private Knowledge & Lore**: {character_specific_lore if character_specific_lore else "This character has no special knowledge of the current topic."}
            </Dossier>
            """
            private_knowledge_dossiers.append(dossier)

        private_knowledge_text = "\\n".join(private_knowledge_dossiers)

        # 3. FINAL PROMPT (With strict new rules)
        prompt = f"""
        You are a Dungeon Master AI. Your task is to generate a narrative response.
        Your response MUST be a valid JSON object.

        **CRITICAL RULE**: When generating a response for a character, you may ONLY use information from the 'Public Knowledge' section and that character's specific `<Dossier>`. DO NOT use knowledge from one character's dossier to inform another character's dialogue or actions.

        ---
        ## Public Knowledge (Visible to all)
        {public_knowledge_text}
        ---
        ## Private Knowledge Dossiers
        {private_knowledge_text}
        ---

        ## AI Response Instructions
        Based on the player's action, generate a response following these rules:
        1.  **Dialogue**: Any character who would plausibly speak should be included in the `dialogue` array. Their speech must only reflect their own knowledge from their dossier.
        2.  **Reactions**: Other characters can react non-verbally in the `scene_changes` based on the public knowledge.
        3.  **New Options**: Provide new `dialogue_options` for the player, focusing on the character most likely to be addressed next.

        ## JSON Structure
        - `dialogue`: Array of objects with "speaker" and "line".
        - `scene_changes`: String describing actions and environmental changes.
        - `new_dialogue_options`: Object with "npc_name" and a list of "options".

        Generate the JSON response now.
        """

        if log_config.getboolean('log_ai_prompt'): logging.info(f"--- PROMPT ---\\n{prompt}\\n----------")
        
        response = ai_model.generate_content(prompt)

        # --- FIX FOR JSONDecodeError ---
        # This regex removes unescaped control characters like newlines within the JSON strings.
        clean_response = re.sub(r'[\x00-\x1F\x7F-\x9F]', '', response.text)
        clean_response = clean_response.strip().lstrip('```json').rstrip('```')
        
        if log_config.getboolean('log_ai_response'): logging.info(f"--- RESPONSE ---\\n{clean_response}\\n----------")
            
        return jsonify(json.loads(clean_response)), 200

    except Exception as e:
        logging.error(f"!!! An error occurred in /generate: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500

# --- Data Management Routes ---
# These routes are simple GET endpoints for the frontend to fetch initial data.
@app.route('/npcs', methods=['GET'])
def get_npcs():
    """Returns a list of all NPCs in the database."""
    return jsonify([serialize_doc(npc) for npc in npc_collection.find()])

# --- MODIFICATION START ---
@app.route('/monsters', methods=['GET'])
def get_monsters():
    """Returns a list of all monsters in the database."""
    return jsonify([serialize_doc(monster) for monster in monster_collection.find()])
# --- MODIFICATION END ---

@app.route('/locations', methods=['GET'])
def get_locations():
    """Returns a list of all locations in the database."""
    return jsonify([serialize_doc(loc) for loc in location_collection.find()])

# --- Main Execution Block ---
if __name__ == '__main__':
    # This block runs only when the script is executed directly (not imported).
    
    # Load all the JSON data into the MongoDB database on startup.
    load_json_directory('data/npcs', npc_collection)
    load_json_directory('data/monsters', monster_collection) # Load monster data
    load_json_directory('data/locations', location_collection)
    load_json_directory('data/lore', lore_collection)
    
    # Configure Flask's auto-reloader to watch for changes in data and template files.
    # This is very useful for development, as the server will restart automatically
    # when you change a file.
    extra_dirs = ['data/npcs/', 'data/monsters/', 'data/locations/', 'data/lore/', 'templates/', 'static/']
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