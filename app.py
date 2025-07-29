import os
import json
from bson import ObjectId
# UPDATED IMPORT
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient
import google.generativeai as genai

# --- Configuration ---
app = Flask(__name__)
CORS(app) 

# --- Database Setup ---
client = MongoClient('mongodb://localhost:27017/')
db = client['ai_dm_database']
npc_collection = db['npcs']
location_collection = db['locations']

# --- AI Setup ---
# Your code uses "GEMINI_API_KEY". Make sure you've set this exact environment variable!
try:
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    ai_model = genai.GenerativeModel('gemini-1.5-flash')
except KeyError:
    print("FATAL: GEMINI_API_KEY environment variable not set.")
    exit()

# --- Helper Function ---
def serialize_doc(doc):
    """Converts a MongoDB doc to a JSON-serializable format."""
    doc['_id'] = str(doc['_id'])
    return doc

# --- ADDED: Serve Frontend ---
@app.route('/')
def serve_index():
    """Serves the index.html file to the browser."""
    return send_from_directory('.', 'index.html')

# --- API Endpoints ---

@app.route('/import_data', methods=['POST'])
def import_data():
    """One-time import of JSON files into the database."""
    try:
        npc_collection.delete_many({})
        location_collection.delete_many({})
        
        # This will now find the npcs.json file you created
        with open('npcs.json', 'r') as f:
            npc_data = json.load(f)
            npc_collection.insert_many(npc_data)
            
        with open('locations.json', 'r') as f:
            location_data = json.load(f)
            location_collection.insert_many(location_data)
            
        return jsonify({"message": "Data imported successfully!"}), 201
    except FileNotFoundError as e:
        return jsonify({"error": f"Import failed. Make sure {e.filename} exists."}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# (The rest of your app.py file remains the same)
@app.route('/npcs', methods=['GET'])
def get_npcs():
    """Fetch all NPCs."""
    npcs = [serialize_doc(npc) for npc in npc_collection.find()]
    return jsonify(npcs)

@app.route('/locations', methods=['GET'])
def get_locations():
    """Fetch all locations."""
    locations = [serialize_doc(loc) for loc in location_collection.find()]
    return jsonify(locations)

@app.route('/npcs/<npc_id>', methods=['PUT'])
def update_npc(npc_id):
    """Update an NPC's details."""
    data = request.json
    npc_collection.update_one({'_id': ObjectId(npc_id)}, {'$set': data})
    return jsonify({"message": "NPC updated successfully!"})

@app.route('/generate', methods=['POST'])
def generate_scene():
    """Generate dialogue and scene changes using the AI."""
    data = request.json
    user_prompt = data.get('user_prompt')
    npc_ids = data.get('npc_ids', [])
    location_id = data.get('location_id')

    npcs = [serialize_doc(npc) for npc in npc_collection.find({'_id': {'$in': [ObjectId(id) for id in npc_ids]}})]
    location = serialize_doc(location_collection.find_one({'_id': ObjectId(location_id)}))

    if not location or not npcs:
        return jsonify({"error": "Invalid NPC or Location ID"}), 404

    prompt = f"""
    You are a Dungeon Master AI. Your task is to generate narrative content based on the provided context.
    Your response should be a JSON object with two keys: "dialogue" and "scene_changes".

    **Context:**
    - **Location:** {location['name']} ({location['description']}. Atmosphere: {location['atmosphere']})
    - **NPCs Present:** {', '.join([npc['name'] for npc in npcs])}
    
    **NPC Profiles:**
    {''.join([f"- {npc['name']}: {npc['description']} (Motivation: {npc['motivation']})\\n" for npc in npcs])}

    **Player's Action/Prompt:**
    "{user_prompt}"

    Generate the response now. The 'dialogue' should be what the NPCs say. The 'scene_changes' should describe how the environment or character postures react.
    """
    
    try:
        response = ai_model.generate_content(prompt)
        clean_response = response.text.strip().replace('```json', '').replace('```', '')
        return jsonify(json.loads(clean_response)), 200
    except Exception as e:
        return jsonify({"error": f"AI generation failed: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)