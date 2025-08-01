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

    let locationsData = [];
    let npcsData = [];
    let partyNpcIds = new Set();
    const placeholderText = 'Your generated scene will appear here...';

    // --- Robust Resizer Logic ---
    function resize(e) {
        // We are resizing the left column, so we just need to set its width
        const newLeftWidth = e.clientX;
        // Apply constraints to prevent columns from becoming too small
        if (newLeftWidth > 280 && newLeftWidth < (window.innerWidth - 300)) {
            leftColumn.style.width = `${newLeftWidth}px`;
        }
    }

    resizer.addEventListener('mousedown', (e) => {
        // Prevent default dragging behavior (like text selection)
        e.preventDefault();
        
        // Add listeners to the window to capture mouse moves anywhere on the page
        window.addEventListener('mousemove', resize);
        window.addEventListener('mouseup', () => {
            window.removeEventListener('mousemove', resize);
        }, { once: true }); // Automatically remove listener after one click
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
            npc.dialogue_options.forEach(promptText => {
                dialogueHTML += `<button class="action-btn" data-type="dialogue" data-prompt="${promptText}">${promptText}</button>`;
            });
        }

        let skillsHTML = '';
        if (npc.skill_checks) {
            for (const ability in npc.skill_checks) {
                npc.skill_checks[ability].forEach(skill => {
                    skillsHTML += `<button class="action-btn" data-type="skill_check" data-prompt="${skill}">${skill}</button>`;
                });
            }
        }

        card.innerHTML = `
            <h3>${npc.name}</h3>
            <p>${npc.description}</p>
            <div class="actions-container">
                <div class="dialogue-column">
                    <h4>Dialogue Options</h4>
                    ${dialogueHTML}
                </div>
                <div class="skills-column">
                    <h4>Skill Checks</h4>
                    ${skillsHTML}
                </div>
            </div>
        `;
        npcCardContainer.appendChild(card);
    };
    
    // --- Main Action Handler ---
    const handleAction = async (type, npcName, promptText) => {
        const locationName = locationSelect.value;
        
        let playerActionHtml = `<hr><p><strong>Player -> ${npcName}:</strong> ${promptText}</p>`;
        appendToGeneratedScene(playerActionHtml);

        try {
            const response = await fetch(`${apiBaseUrl}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    location_name: locationName,
                    room: roomSelect.value,
                    npc_names: [npcName],
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
                 const sceneChangeHtml = `<p><em>${data.scene_changes}</em></p>`;
                 appendToGeneratedScene(sceneChangeHtml);
            }

            if (data.dialogue && data.dialogue.length > 0) {
                data.dialogue.forEach(d => {
                    const dialogueHtml = `<p><strong>${d.speaker}:</strong> "${d.line}"</p>`;
                    appendToGeneratedScene(dialogueHtml);
                });
            }

            if(data.new_dialogue_options) {
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
    
    // --- Event Listeners ---
    locationSelect.addEventListener('change', (e) => populateRooms(e.target.value));
    roomSelect.addEventListener('change', updateCurrentNpcs);
    
    npcCardContainer.addEventListener('click', (e) => {
        if (e.target.matches('.action-btn')) {
            const button = e.target;
            const type = button.dataset.type;
            const prompt = button.dataset.prompt;
            const npcName = button.closest('.npc-card').dataset.npcName;
            handleAction(type, npcName, prompt);
        }
    });

    generateBtn.addEventListener('click', () => {
        const promptText = userPrompt.value;
        const selectedNpcNames = Array.from(npcSelect.selectedOptions).map(opt => opt.value);
        if (!promptText || selectedNpcNames.length === 0) {
            alert("Please enter a prompt and select an NPC.");
            return;
        }
        handleAction('dialogue', selectedNpcNames[0], promptText);
        userPrompt.value = '';
    });
    
    setPartyBtn.addEventListener('click', () => {
        const selectedNpcNames = Array.from(npcSelect.selectedOptions).map(opt => opt.value);
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