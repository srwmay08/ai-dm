// static/script.js

document.addEventListener('DOMContentLoaded', () => {
    const apiBaseUrl = 'http://127.0.0.1:5000';

    // --- Element Selectors ---
    const locationSelect = document.getElementById('location-select');
    const roomSelect = document.getElementById('room-select');
    const npcSelect = document.getElementById('npc-select');
    const descriptionResult = document.getElementById('description-result');
    const generationResult = document.getElementById('generation-result');
    const generateBtn = document.getElementById('generate-btn');
    const userPrompt = document.getElementById('user-prompt');
    const npcCardContainer = document.getElementById('npc-card-container');
    const setPartyBtn = document.getElementById('set-party-btn');
    const clearPartyBtn = document.getElementById('clear-party-btn');
    const resizer = document.getElementById('resizer');
    const leftColumn = document.getElementById('left-column');

    // --- State Variables ---
    let locationsData = [];
    let npcsData = [];
    let partyNpcIds = new Set();
    const placeholderText = 'Your generated scene will appear here...';

    // --- Robust Resizer Logic ---
    function resize(e) {
        const newLeftWidth = e.clientX;
        if (newLeftWidth > 280 && newLeftWidth < (window.innerWidth - 300)) {
            leftColumn.style.width = `${newLeftWidth}px`;
        }
    }
    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        window.addEventListener('mousemove', resize);
        window.addEventListener('mouseup', () => {
            window.removeEventListener('mousemove', resize);
        }, { once: true });
    });

    // --- Helper Function to Append to Scene ---
    const appendToGeneratedScene = (htmlContent) => {
        if (generationResult.innerHTML.includes(placeholderText)) {
            generationResult.innerHTML = '';
        }
        generationResult.innerHTML += htmlContent;
        generationResult.scrollTop = generationResult.scrollHeight;
    };

    // --- Data Loading ---
    const fetchInitialData = async () => {
        try {
            const [locationsResponse, npcsResponse] = await Promise.all([
                fetch(`${apiBaseUrl}/locations`),
                fetch(`${apiBaseUrl}/npcs`)
            ]);
            if (!locationsResponse.ok || !npcsResponse.ok) throw new Error('Failed to fetch initial data.');
            locationsData = await locationsResponse.json();
            npcsData = await npcsResponse.json();
            populateLocations();
        } catch (error) {
            console.error("Initialization Error:", error);
            descriptionResult.textContent = "Error: Could not load initial data from the server. Is the Python backend running?";
        }
    };

    // --- UI Population ---
    const populateLocations = () => {
        locationSelect.innerHTML = '<option value="">-- Select a Location --</option>';
        locationsData.forEach(location => {
            const option = document.createElement('option');
            option.value = location.name;
            option.textContent = location.name;
            locationSelect.appendChild(option);
        });
    };

    const populateRooms = (locationName) => {
        const location = locationsData.find(loc => loc.name === locationName);
        roomSelect.innerHTML = '<option value="">-- Select a Room --</option>';
        if (location && location.rooms) {
            location.rooms.forEach(room => {
                const option = document.createElement('option');
                option.value = room.name;
                option.textContent = room.name;
                roomSelect.appendChild(option);
            });
        }
        npcSelect.innerHTML = '';
        descriptionResult.innerHTML = '<h2>Description</h2><p>Select a room to see a description.</p>';
        generationResult.innerHTML = placeholderText;
        npcCardContainer.innerHTML = '';
    };

    const updateCurrentNpcs = () => {
        const locationName = locationSelect.value;
        const roomName = roomSelect.value;
        const location = locationsData.find(loc => loc.name === locationName);
        if (!location) return;
        const room = location.rooms.find(r => r.name === roomName);
        if(!room) return;

        descriptionResult.innerHTML = `<h2>${location.name} - ${room.name}</h2><p>${room.description || ''}</p>`;
        
        const partyNpcs = npcsData.filter(n => partyNpcIds.has(n._id));
        const roomNpcNames = new Set(room.npcs || []);
        const roomNpcs = npcsData.filter(n => roomNpcNames.has(n.name));
        
        const allNpcsInScene = [...partyNpcs];
        roomNpcs.forEach(npc => {
            if (!allNpcsInScene.some(p => p._id === npc._id)) {
                allNpcsInScene.push(npc);
            }
        });
        
        npcSelect.innerHTML = '';
        npcCardContainer.innerHTML = '';
        allNpcsInScene.forEach(npc => {
            const option = document.createElement('option');
            option.value = npc.name;
            const isPartyMember = partyNpcIds.has(npc._id);
            option.textContent = npc.name + (isPartyMember ? ' (Party)' : '');
            option.selected = true;
            npcSelect.appendChild(option);
            renderNpcCard(npc);
        });
    }

    const renderNpcCard = (npc) => {
        const card = document.createElement('div');
        card.className = 'npc-card';
        card.dataset.npcName = npc.name;
        
        let dialogueHTML = '';
        if (npc.dialogue_options) {
            dialogueHTML = npc.dialogue_options.map(promptText => 
                `<button class="action-btn" data-type="dialogue" data-prompt="${promptText}">${promptText}</button>`
            ).join('');
        }

        let skillsHTML = '';
        if (npc.skill_checks) {
            for (const ability in npc.skill_checks) {
                skillsHTML += npc.skill_checks[ability].map(skill => 
                    `<button class="action-btn" data-type="skill_check" data-prompt="${skill}">${skill}</button>`
                ).join('');
            }
        }

        card.innerHTML = `<div class="npc-card-content"><h3>${npc.name}</h3><p>${npc.description}</p></div><div class="actions-container"><div class="dialogue-column"><h4>Dialogue Options</h4>${dialogueHTML}</div><div class="skills-column"><h4>Skill Checks</h4>${skillsHTML}</div></div>`;
        npcCardContainer.appendChild(card);
    };
    
    // --- Main Action Handler ---
    const handleAction = async (type, promptText, primaryTargets = []) => {
        const locationName = locationSelect.value;
        const roomName = roomSelect.value;
        const allNpcsInScene = Array.from(npcSelect.options).map(opt => opt.value.replace(' (Party)', ''));

        if (allNpcsInScene.length === 0) {
            alert("There are no NPCs in the scene to interact with.");
            return;
        }

        let playerActionHtml = '';
        if (type === 'skill_check') {
            const targetName = primaryTargets[0] || 'an NPC';
            playerActionHtml = `<div class="player-action"><p><strong>The party has asked ${targetName} to make a ${promptText.toUpperCase()} skill check in ${locationName} - ${roomName}:</strong></p></div>`;
        } else {
            playerActionHtml = `<div class="player-action"><p><strong>Player:</strong> ${promptText}</p></div>`;
        }
        appendToGeneratedScene(playerActionHtml);

        try {
            const response = await fetch(`${apiBaseUrl}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    location_name: locationName,
                    room: roomName,
                    npc_names: allNpcsInScene,
                    user_prompt: promptText,
                    prompt_type: type
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Server error');
            }
            const data = await response.json();
            
            if (data.scene_changes) {
                // By trimming the response, we remove extraneous leading/trailing whitespace (like newlines)
                // that the AI model might add, which were being rendered due to the 'white-space: pre-wrap' CSS rule.
                appendToGeneratedScene(`<div class="scene-description">${data.scene_changes.trim()}</div>`);
            }

            if (data.dialogue && data.dialogue.length > 0) {
                data.dialogue.forEach(d => {
                    const speakerInitial = d.speaker.charAt(0).toUpperCase();
                    // Trimming the dialogue line as well for robustness.
                    appendToGeneratedScene(`<div class="dialogue-line"><span class="speaker-token">${speakerInitial}</span><p><strong>${d.speaker}:</strong> "${d.line.trim()}"</p></div>`);
                });
            }

            if (data.new_dialogue_options) {
                const { npc_name, options } = data.new_dialogue_options;
                const npcToUpdate = npcsData.find(n => n.name === npc_name);
                if (npcToUpdate) {
                    npcToUpdate.dialogue_options = options;
                    updateCurrentNpcs();
                }
            }
        } catch (error) {
            console.error('Generation Error:', error);
            appendToGeneratedScene(`<p style="color:red;"><em>Error generating scene: ${error.message}</em></p>`);
        }
    };
    
    // --- Event Listeners (Defined only ONCE) ---
    locationSelect.addEventListener('change', (e) => populateRooms(e.target.value));
    roomSelect.addEventListener('change', updateCurrentNpcs);
    
    generateBtn.addEventListener('click', () => {
        const promptText = userPrompt.value;
        const targets = Array.from(npcSelect.selectedOptions).map(opt => opt.value.replace(' (Party)', ''));
        if (!promptText) {
            alert("Please enter a prompt.");
            return;
        }
        if (targets.length === 0) {
            alert("Please select at least one target NPC from the list for your custom prompt.");
            return;
        }
        handleAction('dialogue', promptText, targets);
        userPrompt.value = '';
    });

    npcCardContainer.addEventListener('click', (e) => {
        if (e.target.matches('.action-btn')) {
            const button = e.target;
            const type = button.dataset.type;
            const prompt = button.dataset.prompt;
            const npcName = button.closest('.npc-card').dataset.npcName;
            handleAction(type, prompt, [npcName]);
        }
    });
    
    setPartyBtn.addEventListener('click', () => {
        const selectedNpcNames = Array.from(npcSelect.selectedOptions).map(opt => opt.value.replace(' (Party)', ''));
        partyNpcIds = new Set(npcsData.filter(n => selectedNpcNames.includes(n.name)).map(n => n._id));
        alert('Persistent party set!');
        updateCurrentNpcs();
    });

    clearPartyBtn.addEventListener('click', () => {
        partyNpcIds.clear();
        alert('Persistent party cleared!');
        updateCurrentNpcs();
    });

    // --- Initial Load ---
    fetchInitialData();
});