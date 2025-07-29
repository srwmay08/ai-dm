document.addEventListener('DOMContentLoaded', () => {
    const apiBaseUrl = 'http://127.0.0.1:5000';

    const importBtn = document.getElementById('import-btn');
    const generateBtn = document.getElementById('generate-btn');
    const resultDiv = document.getElementById('result');
    const npcListDiv = document.getElementById('npc-list');
    const locationDropdown = document.getElementById('location-dropdown');
    const userPromptTextarea = document.getElementById('user-prompt');

    // --- Function to Load Profiles ---
    const loadProfiles = async () => {
        try {
            const response = await fetch(`${apiBaseUrl}/profiles`);
            const data = await response.json();

            // Populate NPCs
            npc