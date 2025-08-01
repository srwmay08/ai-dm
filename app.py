import os
import json
import logging
import configparser
from bson import ObjectId
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
app = Flask(__name__, template_folder='templates', static_folder='static')

# --- CORS Configuration ---
CORS(app, resources={r"/*": {"origins": "http://127.0.0.1:3000"}})

# --- Database Setup ---
client = MongoClient('mongodb://localhost:27017/')
db = client['ai_dm_database']
npc_collection = db['npcs']
location_collection = db['locations']
lore_collection = db['lore']


# --- AI Setup ---
try:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise KeyError("GEMINI_API_KEY environment variable not set.")
    genai.configure(api_key=api_key)
    ai_model = genai.GenerativeModel('gemini-1.5-flash')
except KeyError as e:
    logging.fatal(f"FATAL: {e}")
    exit()

# --- Helper Function ---
def serialize_doc(doc):
    if doc and '_id' in doc:
        doc['_id'] = str(doc['_id'])
    return doc

# --- Data Loading Function ---
def load_json_directory(directory_path, collection):
    if not os.path.isdir(directory_path):
        logging.error(f"Data directory not found: {directory_path}")
        return
    
    collection.delete_many({})
    loaded_files = 0
    for filename in os.listdir(directory_path):
        if filename.endswith('.json'):
            filepath = os.path.join(directory_path, filename)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        if data:
                            for item in data: item.setdefault('_id', ObjectId())
                            collection.insert_many(data)
                    else:
                        data.setdefault('_id', ObjectId())
                        collection.insert_one(data)
                loaded_files += 1
            except Exception as e:
                logging.error(f"Error loading {filepath}: {e}")
    logging.info(f"Loaded {loaded_files} files from {directory_path} into {collection.name}.")


# --- Frontend & Core Routes ---
@app.route('/')
def serve_index():
    return render_template('index.html')

@app.route('/generate', methods=['POST'])
def generate_scene():
    if log_config.getboolean('log_requests'): logging.info(f"Request: {request.json}")

    try:
        data = request.json
        npc_names = data.get('npc_names', [])
        location_name_from_req = data.get('location_name')

        npcs_in_scene = [serialize_doc(npc) for npc in npc_collection.find({'name': {'$in': npc_names}})]
        primary_npc = npcs_in_scene[0] if npcs_in_scene else None
        
        # --- FIX: Find location by name instead of ObjectId ---
        location = serialize_doc(location_collection.find_one({'name': location_name_from_req}))
        
        # --- FIX: Added a check to ensure location was found ---
        if not location:
            return jsonify({"error": f"Location '{location_name_from_req}' not found."}), 404

        selected_room = next((r for r in location.get('rooms', []) if r['name'] == data.get('room')), None)

        all_lore_ids = []
        npc_profiles_list = []
        for n in npcs_in_scene:
            details = [f"- **{n['name']}**: {n.get('description', '')}"]
            if n.get('motivation'): details.append(f"  - **Motivation**: {', '.join(n.get('motivation',[]))}")
            npc_profiles_list.append('\n'.join(details))
            if n.get('lore_id'): all_lore_ids.extend(n.get('lore_id', []))

        lore_text = "No specific lore known."
        if all_lore_ids:
            lore_details = []
            lore_entries = lore_collection.find({'lore_id': {'$in': all_lore_ids}})
            for lore in lore_entries:
                lore_details.append(f"- {lore.get('title', '')}: {lore.get('content', '')}")
            if lore_details: lore_text = "\n\n".join(lore_details)
        
        npc_profiles_text = "\n\n".join(npc_profiles_list)
        npc_names_present = ", ".join([n['name'] for n in npcs_in_scene])


        prompt_type = data.get('prompt_type', 'dialogue')
        if prompt_type == 'skill_check':
            action_description = f"The player prompts **{primary_npc['name']}** to use their **{data.get('user_prompt')}** skill to interact with the room or its contents."
        else:
            action_description = f"The player says to {primary_npc['name']}: \"{data.get('user_prompt')}\""

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

        if log_config.getboolean('log_ai_prompt'): logging.info(f"--- PROMPT ---\n{prompt}\n----------")
        
        response = ai_model.generate_content(prompt)
        clean_response = response.text.strip().lstrip('```json').rstrip('```')
        
        if log_config.getboolean('log_ai_response'): logging.info(f"--- RESPONSE ---\n{clean_response}\n----------")
            
        return jsonify(json.loads(clean_response)), 200

    except Exception as e:
        logging.error(f"!!! An error occurred in /generate: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500
    
# --- Data Management Routes ---
@app.route('/npcs', methods=['GET'])
def get_npcs():
    return jsonify([serialize_doc(npc) for npc in npc_collection.find()])

@app.route('/locations', methods=['GET'])
def get_locations():
    return jsonify([serialize_doc(loc) for loc in location_collection.find()])

if __name__ == '__main__':
    load_json_directory('data/npcs', npc_collection)
    load_json_directory('data/locations', location_collection)
    load_json_directory('data/lore', lore_collection)
    
    extra_dirs = ['data/npcs/', 'data/locations/', 'data/lore/', 'templates/', 'static/']
    extra_files = extra_dirs[:]
    for extra_dir in extra_dirs:
        for dirname, _, filenames in os.walk(extra_dir):
            for filename in filenames:
                if os.path.isfile(os.path.join(dirname, filename)):
                    extra_files.append(os.path.join(dirname, filename))

    app.run(debug=True, port=5000, extra_files=extra_files)