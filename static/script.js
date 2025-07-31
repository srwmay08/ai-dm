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

    let locationsData = [];
    let npcsData = [];
    let partyNpcIds = new Set();
    const placeholderText = 'Your generated scene will appear here...';

    // --- Helper Function to Append to Scene ---
    const appendToGeneratedScene = (htmlContent) => {
        if (generationResult.innerHTML.includes(placeholderText)) {
            generationResult.innerHTML = ''; // Clear placeholder on first addition
        }
        generationResult.innerHTML += htmlContent;
        generationResult.scrollTop = generationResult.scrollHeight; // Auto-scroll to bottom
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
            option.value = location._id;
            option.textContent = location.name;
            locationSelect.appendChild(option);
        });
    };

    const populateRooms = (locationId) => {
        const location = locationsData.find(loc => loc._id === locationId);
        roomSelect.innerHTML = '<option value="">-- Select a Room --</option>';
        npcSelect.innerHTML = '';
        descriptionResult.innerHTML = '<h2>Description</h2><p>Select a room to see a description.</p>';
        generationResult.innerHTML = placeholderText; // Reset scene on room change
        npcCardContainer.innerHTML = '';

        if (location && location.rooms) {
            location.rooms.forEach(room => {
                const option = document.createElement('option');
                option.value = room.name;
                option.textContent = room.name;
                roomSelect.appendChild(option);
            });
        }
    };

    const updateRoomDetails = (locationId, roomName) => {
        const location = locationsData.find(loc => loc._id === locationId);
        if (!location) return;

        const room = location.rooms.find(r => r.name === roomName);
        generationResult.innerHTML = placeholderText;
        npcSelect.innerHTML = '';
        npcCardContainer.innerHTML = '';

        if (room) {
            // --- FIX: Logic to display narrative/description above cards ---
            let narrativeHTML = `<h2>${location.name} - ${room.name}</h2>`;
            let cardContainerHTML = '';
            
            // 1. Handle Narrative Block
            if (typeof room.description === 'object' && room.description !== null) {
                // Iterate through all key/value pairs in the description object and display them
                for (const key in room.description) {
                   narrativeHTML += `<p>${room.description[key]}</p>`;
                }
            } else if (room.description) {
                // Handle case where description is just a simple string
                narrativeHTML += `<p>${room.description}</p>`;
            }

            // 2. Build Location Feature Cards
            const cardData = {
                "Traps": room.traps,
                "Treasure": room.treasure,
                "Doors": room.doors,
                "Secret Doors": room.secret_doors,
                "Furniture": room.furniture,
                "Secret Entrances": room.secret_entrances
            };

            let cards = '';
            for (const title in cardData) {
                const items = cardData[title];
                if (items && items.length > 0) {
                    cards += `<div class="location-card"><h3>${title}</h3><ul>`;
                    items.forEach(item => {
                        if (typeof item === 'object' && item !== null) {
                            cards += `<li><strong>${item.name || ''}</strong>: ${item.desc || ''}</li>`;
                        } else {
                            cards += `<li>${item}</li>`;
                        }
                    });
                    cards += `</ul></div>`;
                }
            }
            
            if (cards) {
                cardContainerHTML = `<div id="location-card-container">${cards}</div>`;
            }

            descriptionResult.innerHTML = narrativeHTML + cardContainerHTML;


            // --- NPC Population Logic (Unchanged) ---
            const npcIdsInRoom = new Set();
            const npcsToDisplay = [];

            partyNpcIds.forEach(npcId => {
                const npc = npcsData.find(n => n._id === npcId);
                if (npc) {
                    npcsToDisplay.push(npc);
                    npcIdsInRoom.add(npcId);
                }
            });

            if (room.npcs) {
                room.npcs.forEach(npcName => {
                    const npc = npcsData.find(n => n.name === npcName);
                    if (npc && !npcIdsInRoom.has(npc._id)) {
                        npcsToDisplay.push(npc);
                        npcIdsInRoom.add(npc._id);
                    }
                });
            }

            npcsToDisplay.forEach(npc => {
                const option = document.createElement('option');
                option.value = npc._id;
                const isPartyMember = partyNpcIds.has(npc._id);
                option.textContent = npc.name + (isPartyMember ? ' (Party)' : '');
                option.selected = true;
                npcSelect.appendChild(option);
                
                if (!isPartyMember && npc.canned_conversations && npc.canned_conversations.introduction) {
                    const introDialogue = `<p><strong>${npc.name}:</strong> <em>"${npc.canned_conversations.introduction}"</em></p>`;
                    appendToGeneratedScene(introDialogue);
                }
            });

            renderNpcCards();
        }
    };

    const renderNpcCards = () => {
        npcCardContainer.innerHTML = '';
        const selectedNpcOptions = Array.from(npcSelect.selectedOptions);
        selectedNpcOptions.forEach(option => {
            const npc = npcsData.find(n => n._id === option.value);
            if (npc) {
                const card = document.createElement('div');
                card.className = 'npc-card';
                let cardHTML = `<h3>${npc.name}</h3><p>${npc.description}</p>`;
                if (npc.canned_conversations) {
                    cardHTML += `<h4>Conversation Starters:</h4>`;
                    for (const prompt in npc.canned_conversations) {
                        if (prompt.toLowerCase() !== 'introduction') {
                            cardHTML += `<a class="canned-conversation-prompt" data-speaker="${npc.name}" data-dialogue="${npc.canned_conversations[prompt]}">${prompt.replace(/_/g, ' ')}</a>`;
                        }
                    }
                }
                card.innerHTML = cardHTML;
                npcCardContainer.appendChild(card);
            }
        });

        document.querySelectorAll('.canned-conversation-prompt').forEach(promptElement => {
            promptElement.addEventListener('click', () => {
                const speaker = promptElement.getAttribute('data-speaker');
                const dialogue = promptElement.getAttribute('data-dialogue');
                displayCannedConversation(speaker, dialogue);
            });
        });
    };

    const displayCannedConversation = (speaker, dialogue) => {
        const dialogueHtml = `<p><strong>${speaker}:</strong> "${dialogue}"</p>`;
        appendToGeneratedScene(dialogueHtml);
    };

    // --- API Interaction ---
    const handleGenerate = async () => {
        const locationId = locationSelect.value;
        const roomName = roomSelect.value;
        const promptText = userPrompt.value;
        const npcIds = Array.from(npcSelect.selectedOptions).map(opt => opt.value);

        if (!locationId || !roomName || !promptText) {
            alert("Please select a location, room, and enter a prompt.");
            return;
        }
        
        const playerActionHtml = `<p><strong>Player:</strong> "${promptText}"</p>`;
        appendToGeneratedScene(playerActionHtml);
        userPrompt.value = ''; // Clear prompt box
        generateBtn.disabled = true;

        try {
            const response = await fetch(`${apiBaseUrl}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // FIX: Send the promptText variable, not the userPrompt element
                body: JSON.stringify({ location_id: locationId, room: roomName, npc_ids: npcIds, user_prompt: promptText })
            });
            if (!response.ok) throw new Error((await response.json()).error || 'Server error');
            const data = await response.json();
            
            if (data.scene_changes) {
                 const sceneChangeHtml = `<hr><p><em>${data.scene_changes}</em></p>`;
                 appendToGeneratedScene(sceneChangeHtml);
            }

            if (data.dialogue && data.dialogue.length > 0) {
                data.dialogue.forEach(d => {
                    const dialogueHtml = `<p><strong>${d.speaker}:</strong> "${d.line}"</p>`;
                    appendToGeneratedScene(dialogueHtml);
                });
            }
        } catch (error) {
            console.error('Generation Error:', error);
            appendToGeneratedScene(`<p><em>Error generating scene: ${error.message}</em></p>`);
        } finally {
            generateBtn.disabled = false;
        }
    };

    // --- Event Listeners ---
    locationSelect.addEventListener('change', () => populateRooms(locationSelect.value));
    roomSelect.addEventListener('change', () => updateRoomDetails(locationSelect.value, roomSelect.value));
    npcSelect.addEventListener('change', renderNpcCards);
    generateBtn.addEventListener('click', handleGenerate);
    
    setPartyBtn.addEventListener('click', () => {
        partyNpcIds = new Set(Array.from(npcSelect.selectedOptions).map(opt => opt.value));
        alert('Persistent party set!');
        updateRoomDetails(locationSelect.value, roomSelect.value);
    });

    clearPartyBtn.addEventListener('click', () => {
        partyNpcIds.clear();
        alert('Persistent party cleared!');
        updateRoomDetails(locationSelect.value, roomSelect.value);
    });

    // --- Initial Load ---
    fetchInitialData();
});