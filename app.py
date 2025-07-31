import os
import json
import logging
import configparser
from bson import ObjectId
# Import render_template from Flask
from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
from pymongo import MongoClient
import google.generativeai as genai

# --- Configuration & Logging Setup ---
config = configparser.ConfigParser()
config.read('config.ini')
log_config = config['Logging']

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Flask App Initialization ---
# Add template_folder to tell Flask where to find HTML files
app = Flask(__name__, template_folder='templates', static_folder='static')

# --- CORS Configuration ---
# Explicitly allow the frontend origin for robust CORS handling
CORS(app, resources={r"/*": {"origins": "http://127.0.0.1:3000"}})

# --- Database Setup ---
client = MongoClient('mongodb://localhost:27017/')
db = client['ai_dm_database']
npc_collection = db['npcs']
location_collection = db['locations']

# --- AI Setup ---
try:
    # It's recommended to load the API key safely, e.g., from environment variables
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise KeyError("GEMINI_API_KEY environment variable not set.")
    genai.configure(api_key=api_key)
    ai_model = genai.GenerativeModel('gemini-1.5-flash')
except KeyError as e:
    logging.fatal(f"FATAL: {e}")
    # In a real app, you might want to handle this more gracefully
    exit()

# --- Helper Function ---
def serialize_doc(doc):
    """Converts a MongoDB document's ObjectId to a string."""
    if doc and '_id' in doc:
        doc['_id'] = str(doc['_id'])
    return doc

# --- Data Loading Function ---
def load_json_data(filepath, collection):
    """Loads data from a JSON file into a MongoDB collection."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            collection.delete_many({})
            if data:
                # Ensure each item has an ObjectId
                for item in data:
                    item.setdefault('_id', ObjectId())
                collection.insert_many(data)
        logging.info(f"Successfully loaded and inserted data from {filepath}")
    except FileNotFoundError:
        logging.error(f"Error: Data file not found at {filepath}.")
    except json.JSONDecodeError:
        logging.error(f"Error: Could not decode JSON from {filepath}.")
    except Exception as e:
        logging.error(f"An unexpected error occurred loading {filepath}: {e}")

# --- Frontend & Core Routes ---
@app.route('/')
def serve_index():
    """Serves the main HTML page using render_template."""
    return render_template('index.html')

@app.route('/greet', methods=['POST'])
def greet_player():
    """Generates an atmospheric greeting when players enter a room."""
    try:
        data = request.json
        location_id = data.get('location_id')
        room_name = data.get('room_name')

        location = location_collection.find_one({'_id': ObjectId(location_id)})
        if not location:
            return jsonify({"greeting": "You enter the room."}), 200

        selected_room = next((room for room in location.get('rooms', []) if room['name'] == room_name), None)
        if not selected_room or not selected_room.get('npcs'):
            return jsonify({"greeting": "The room is quiet. You see nothing of note."}), 200

        npc_names = selected_room['npcs']
        npcs = [serialize_doc(npc) for npc in npc_collection.find({'name': {'$in': npc_names}})]

        if not npcs:
            return jsonify({"greeting": "You see figures in the room, but they don't seem to notice you."}), 200

        npc_profiles = [f"- {n['name']}: {n['description']}" for n in npcs]
        prompt = f"""
        You are a Dungeon Master AI. The players have just entered a room.
        Describe the scene, focusing on what the characters below are doing.
        Provide a short, atmospheric description and perhaps a line of dialogue or a key action from one of them as a greeting.
        Keep the total response to 2-4 sentences.

        **Room:** {selected_room['name']} - {selected_room['description']}
        **Characters Present:**
        {chr(10).join(npc_profiles)}

        Generate the greeting now.
        """
        response = ai_model.generate_content(prompt)
        return jsonify({"greeting": response.text})

    except Exception as e:
        logging.error(f"!!! An error occurred in /greet: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred on the server: {e}"}), 500


@app.route('/generate', methods=['POST'])
def generate_scene():
    """Generates the main NPC dialogue and scene changes based on user prompt."""
    if log_config.getboolean('log_requests'):
        logging.info(f"Received /generate request with data: {request.json}")

    try:
        data = request.json
        npc_ids = data.get('npc_ids', [])
        location_id = data.get('location_id')
        room_name = data.get('room')

        npcs = [serialize_doc(npc) for npc in npc_collection.find({'_id': {'$in': [ObjectId(id) for id in npc_ids]}})]
        location_doc = location_collection.find_one({'_id': ObjectId(location_id)})
        location = serialize_doc(location_doc)
        
        selected_room = next((r for r in location.get('rooms', []) if r['name'] == room_name), None)

        if log_config.getboolean('log_database_fetches'):
            logging.info(f"Fetched {len(npcs)} NPCs from DB.")
            logging.info(f"Fetched Location: {location.get('name') if location else 'None'}")
            logging.info(f"Fetched Room: {selected_room.get('name') if selected_room else 'None'}")
        
        location_name = location.get('name', 'Unknown Location')
        # Ensure room_desc is a string for the prompt, even if it's an object in the DB
        room_desc_obj = selected_room.get('description', {}) if selected_room else {}
        if isinstance(room_desc_obj, dict):
            room_desc = json.dumps(room_desc_obj)
        else:
            room_desc = str(room_desc_obj)

        # --- MODIFICATION START: Create more detailed NPC profiles ---
        profile_details = []
        for n in npcs:
            details = [f"- **{n['name']}**: {n.get('description', 'No description.')}"]
            if n.get('motivation'):
                details.append(f"  - **Motivation**: {n.get('motivation')}")
            if n.get('behavior'):
                details.append(f"  - **Behavior**: {n.get('behavior')}")
            if n.get('languages'):
                details.append(f"  - **Languages**: {', '.join(n.get('languages'))}")
            profile_details.append('\n'.join(details))
        
        npc_profiles_text = "\n\n".join(profile_details)
        # --- MODIFICATION END ---

        prompt = f"""
        You are a Dungeon Master AI. Your task is to generate narrative content based on the provided context.
        Your response MUST be a valid JSON object with two keys: "dialogue" and "scene_changes".

        **CRITICAL INSTRUCTIONS ON HOW TO PORTRAY CHARACTERS:**
        1.  **Non-Verbal Characters**: If a character's **Behavior** profile explicitly says it does not speak, **DO NOT** give it a line in the "dialogue" array. Instead, describe its actions in the "scene_changes" string.
        2.  **Specific Languages**: If a character's **Languages** profile lists languages other than Common (like Ignan or Auran), its dialogue lines should reflect that. You can write the dialogue in that language or describe the sounds it makes (e.g., "A series of sharp, crackling pops").
        3.  **Standard NPCs**: Characters without specific behavior or language restrictions can speak normally.
        4.  The "dialogue" array should contain an array of objects, where each object has a "speaker" and a "line".
        5.  The "scene_changes" key should contain a descriptive string of actions and environmental changes.

        **CONTEXT:**
        The scene is in **{location_name}**, specifically in the room **{room_name}**.
        **Room Description**: {room_desc}
        
        **CHARACTERS PRESENT:**
        {npc_profiles_text}

        **PLAYER'S ACTION/PROMPT:** "{data.get('user_prompt')}"

        Generate the JSON response now.
        """

        if log_config.getboolean('log_ai_prompt'):
            logging.info(f"--- PROMPT SENT TO AI ---\n{prompt}\n-------------------------")
        
        response = ai_model.generate_content(prompt)
        clean_response = response.text.strip().lstrip('```json').rstrip('```')
        
        if log_config.getboolean('log_ai_response'):
            logging.info(f"--- RESPONSE FROM AI ---\n{clean_response}\n-------------------------")
            
        return jsonify(json.loads(clean_response)), 200

    except Exception as e:
        logging.error(f"!!! An error occurred in /generate: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred on the server: {e}"}), 500
    
# --- Data Management Routes ---
@app.route('/npcs', methods=['GET'])
def get_npcs():
    """Returns a list of all NPCs."""
    npcs = [serialize_doc(npc) for npc in npc_collection.find()]
    return jsonify(npcs)

@app.route('/locations', methods=['GET'])
def get_locations():
    """Returns a list of all locations."""
    locations = [serialize_doc(loc) for loc in location_collection.find()]
    return jsonify(locations)

if __name__ == '__main__':
    # Load initial data on startup
    load_json_data('npcs.json', npc_collection)
    load_json_data('locations.json', location_collection)
    
    # Run the app with auto-reloading for the specified JSON files
    app.run(debug=True, port=5000, extra_files=['npcs.json', 'locations.json'])