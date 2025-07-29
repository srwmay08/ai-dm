document.addEventListener('DOMContentLoaded', () => {
    const apiBaseUrl = 'http://127.0.0.1:5000';

    // --- Element Selectors from index.html ---
    const locationSelect = document.getElementById('location-select');
    const roomSelect = document.getElementById('room-select');
    const npcSelect = document.getElementById('npc-select');
    const descriptionResult = document.getElementById('description-result');
    const generationResult = document.getElementById('generation-result');
    const generateBtn = document.getElementById('generate-btn');
    const userPrompt = document.getElementById('user-prompt');
    const npcCardContainer = document.getElementById('npc-card-container');

    let locationsData = [];
    let npcsData = [];

    // --- Data Loading and Initialization ---
    const fetchInitialData = async () => {
        try {
            // Fetch locations and NPCs at the same time
            const [locationsResponse, npcsResponse] = await Promise.all([
                fetch(`${apiBaseUrl}/locations`),
                fetch(`${apiBaseUrl}/npcs`)
            ]);

            if (!locationsResponse.ok || !npcsResponse.ok) {
                throw new Error('Failed to fetch initial data from the server.');
            }

            locationsData = await locationsResponse.json();
            npcsData = await npcsResponse.json();
            
            populateLocations();
        } catch (error) {
            console.error("Initialization Error:", error);
            descriptionResult.textContent = "Error: Could not load initial data from the server. Is the Python backend running?";
        }
    };

    // --- UI Population Functions ---
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
        npcSelect.innerHTML = ''; // Clear NPC list
        descriptionResult.textContent = 'Select a room to see a description.';
        generationResult.innerHTML = 'Your generated scene will appear here...'; // Reset scene
        npcCardContainer.innerHTML = ''; // Clear NPC cards

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
        npcSelect.innerHTML = ''; // Clear previous NPCs
        npcCardContainer.innerHTML = ''; // Clear NPC cards

        if (room) {
            descriptionResult.textContent = room.description;
            // No longer fetching a greeting, we are handling it with canned conversations
            // fetchGreeting(locationId, roomName, room.description);

            if (room.npcs && room.npcs.length > 0) {
                room.npcs.forEach(npcName => {
                    const npc = npcsData.find(n => n.name === npcName);
                    if (npc) {
                        const option = document.createElement('option');
                        option.value = npc._id; // Use the database ID as the value
                        option.textContent = npc.name;
                        option.selected = true; // Auto-select them by default
                        npcSelect.appendChild(option);

                        if (npc.canned_conversations) {
                            // Display introduction in the generation result
                            generationResult.innerHTML = `<p><em>${npc.canned_conversations.INTRODUCTION}</em></p>`;
                            
                            // Create NPC card
                            const card = document.createElement('div');
                            card.className = 'npc-card';
                            
                            let cardHTML = `<h3>${npc.name}</h3><p>${npc.description}</p><h4>Conversation Starters:</h4>`;
                            
                            for (const prompt in npc.canned_conversations) {
                                if (prompt !== 'INTRODUCTION') {
                                    cardHTML += `<a class="canned-conversation-prompt" data-dialogue="${npc.canned_conversations[prompt]}">${prompt}</a>`;
                                }
                            }
                            
                            card.innerHTML = cardHTML;
                            npcCardContainer.appendChild(card);
                        }
                    }
                });
                 // Add event listeners to the new prompts
                 document.querySelectorAll('.canned-conversation-prompt').forEach(promptElement => {
                    promptElement.addEventListener('click', () => {
                        const dialogue = promptElement.getAttribute('data-dialogue');
                        displayCannedConversation(dialogue);
                    });
                });

            } else {
                npcSelect.innerHTML = '<option disabled>No NPCs in this room</option>';
            }
        }
    };
    
    const displayCannedConversation = (dialogue) => {
        generationResult.innerHTML = `<p>${dialogue}</p>`;
    };


    // --- API Interaction Functions ---
    const fetchGreeting = async (locationId, roomName, baseDescription) => {
        try {
            const response = await fetch(`${apiBaseUrl}/greet`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ location_id: locationId, room_name: roomName })
            });
            if (!response.ok) throw new Error('Greeting request failed.');
            
            const data = await response.json();
            // Display the AI-generated greeting above the static room description
            descriptionResult.innerHTML = `<p><em>${data.greeting}</em></p><p>${baseDescription}</p>`;
        } catch (error) {
            console.error("Greeting Error:", error);
            descriptionResult.textContent = baseDescription; // Fallback to basic description
        }
    };

    const handleGenerate = async () => {
        const locationId = locationSelect.value;
        const roomName = roomSelect.value;
        const promptText = userPrompt.value;
        const selectedNpcOptions = Array.from(npcSelect.selectedOptions);
        const npcIds = selectedNpcOptions.map(option => option.value);

        if (!locationId || !roomName || !promptText) {
            alert("Please select a location, room, and enter a prompt.");
            return;
        }

        generationResult.textContent = 'Generating scene, please wait...';
        generateBtn.disabled = true;

        try {
            const response = await fetch(`${apiBaseUrl}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    location_id: locationId,
                    room: roomName,
                    npc_ids: npcIds,
                    user_prompt: promptText
                })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'The server returned an error.');
            }

            const data = await response.json();
            
            // --- THIS IS THE MODIFIED SECTION ---
            // Handle Scene Changes by overwriting the description div
            if (data.scene_changes) {
                descriptionResult.innerHTML = `<p>${data.scene_changes}</p>`;
            }

            // Handle Dialogue by populating the generation result div
            let dialogueHtml = '';
            if (data.dialogue && data.dialogue.length > 0) {
                dialogueHtml += '<h3>Dialogue</h3>';
                data.dialogue.forEach(d => {
                    dialogueHtml += `<p><strong>${d.speaker}:</strong> "${d.line}"</p>`;
                });
            } else {
                dialogueHtml = 'Your generated scene will appear here...';
            }
            generationResult.innerHTML = dialogueHtml;
            // --- END OF MODIFIED SECTION ---

        } catch (error) {
            console.error('Generation Error:', error);
            generationResult.textContent = `Error generating scene: ${error.message}`;
        } finally {
            generateBtn.disabled = false;
        }
    };

    // --- Event Listeners ---
    locationSelect.addEventListener('change', () => {
        populateRooms(locationSelect.value);
    });

    roomSelect.addEventListener('change', () => {
        if (roomSelect.value) {
            updateRoomDetails(locationSelect.value, roomSelect.value);
        }
    });

    generateBtn.addEventListener('click', handleGenerate);

    // --- Initial Load ---
    fetchInitialData();
});