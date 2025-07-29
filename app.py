import os
import json
import logging
import configparser
from bson import ObjectId
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient
import google.generativeai as genai

# --- Configuration & Logging Setup ---
# Load configuration from config.ini
config = configparser.ConfigParser()
config.read('config.ini')
log_config = config['Logging']

# Set up serious logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# --- Flask App Initialization ---
app = Flask(__name__)
CORS(app) 

# --- Database Setup ---
client = MongoClient('mongodb://localhost:27017/')
db = client['ai_dm_database']
npc_collection = db['npcs']
location_collection = db['locations']

# --- AI Setup ---
try:
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    ai_model = genai.GenerativeModel('gemini-1.5-flash')
except KeyError:
    logging.fatal("FATAL: GEMINI_API_KEY environment variable not set.")
    exit()

# --- Helper Function ---
def serialize_doc(doc):
    if doc and '_id' in doc:
        doc['_id'] = str(doc['_id'])
    return doc

# --- Frontend & Core Routes ---
@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

@app.route('/generate', methods=['POST'])
def generate_scene():
    if log_config.getboolean('log_requests'):
        logging.info(f"Received /generate request with data: {request.json}")

    try:
        data = request.json
        npc_ids = data.get('npc_ids', [])
        location_id = data.get('location_id')

        npcs = [serialize_doc(npc) for npc in npc_collection.find({'_id': {'$in': [ObjectId(id) for id in npc_ids]}})]
        location = serialize_doc(location_collection.find_one({'_id': ObjectId(location_id)}))

        if log_config.getboolean('log_database_fetches'):
            logging.info(f"Fetched {len(npcs)} NPCs from DB.")
            logging.info(f"Fetched Location: {location.get('name') if location else 'None'}")
        
        # ... (The rest of the function for building the prompt)
        location_name = location.get('name', 'Unknown Location')
        location_desc = location.get('description', 'No description available.')
        location_atmo = location.get('atmosphere', 'No atmosphere defined.')

        npc_profiles = []
        for npc in npcs:
            npc_name = npc.get('name', 'Unknown NPC')
            npc_desc = npc.get('description', 'No description.')
            npc_motive = npc.get('motivation', 'No motivation specified.')
            npc_profiles.append(f"- {npc_name}: {npc_desc} (Motivation: {npc_motive})")
        
        prompt = f"""
        You are a Dungeon Master AI. Your task is to generate narrative content based on the provided context.
        Your response must be a valid JSON object with two keys: "dialogue" and "scene_changes".
        The "dialogue" key should contain an array of objects, where each object has a "speaker" and "line".
        The "scene_changes" key should contain a descriptive string.

        **Context:** ...

        **Player's Action/Prompt:** "{data.get('user_prompt')}"

        Generate the response now.
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

# --- Data Management Routes (unchanged) ---
@app.route('/npcs', methods=['GET'])
def get_npcs():
    npcs = [serialize_doc(npc) for npc in npc_collection.find()]
    return jsonify(npcs)

@app.route('/locations', methods=['GET'])
def get_locations():
    locations = [serialize_doc(loc) for loc in location_collection.find()]
    return jsonify(locations)

if __name__ == '__main__':
    app.run(debug=True, port=5000)