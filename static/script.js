// This event listener ensures that the script runs only after the entire HTML document has been loaded and parsed.
document.addEventListener('DOMContentLoaded', () => {
    // The base URL for your Python Flask backend.
    const apiBaseUrl = 'http://127.0.0.1:5000';

    // --- Element Selectors ---
    // Get references to all the important HTML elements to interact with them later.
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
    // These variables will store data fetched from the server and user selections.
    let locationsData = []; // To store all location data.
    let npcsData = [];      // To store all NPC data.
    let partyNpcIds = new Set(); // A Set to store the unique IDs of persistent party members.
    const placeholderText = 'Your generated scene will appear here...'; // Default text for the scene display.

    // --- Column Resizer Logic ---
    // This function handles the resizing of the left column.
    function resize(e) {
        // Calculate the new width of the left column based on the mouse's horizontal position.
        const newLeftWidth = e.clientX;
        // Apply constraints to prevent the columns from becoming too narrow or too wide.
        if (newLeftWidth > 280 && newLeftWidth < (window.innerWidth - 300)) {
            leftColumn.style.width = `${newLeftWidth}px`;
        }
    }

    // Add an event listener for when the user clicks down on the resizer handle.
    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent default browser actions like text selection.
        
        // Add listeners to the entire window to track mouse movement, allowing resizing from anywhere on the screen.
        window.addEventListener('mousemove', resize);
        // Add a 'mouseup' listener that removes the 'mousemove' listener, stopping the resize action.
        window.addEventListener('mouseup', () => {
            window.removeEventListener('mousemove', resize);
        }, { once: true }); // 'once: true' automatically removes this listener after it fires once.
    });


    // --- Helper Function to Append to Scene ---
    const appendToGeneratedScene = (htmlContent) => {
        // If the placeholder text is visible, clear it before adding new content.
        if (generationResult.innerHTML.includes(placeholderText)) {
            generationResult.innerHTML = '';
        }
        // Add the new HTML content to the scene display.
        generationResult.innerHTML += htmlContent;
        // Automatically scroll to the bottom to show the latest content.
        generationResult.scrollTop = generationResult.scrollHeight;
    };

    // --- Data Loading ---
    const fetchInitialData = async () => {
        /**
         * Fetches all necessary data (locations and NPCs) from the backend when the page first loads.
         * It uses Promise.all to fetch both sets of data concurrently for better performance.
         */
        try {
            const [locationsResponse, npcsResponse] = await Promise.all([
                fetch(`${apiBaseUrl}/locations`), // Fetch location data.
                fetch(`${apiBaseUrl}/npcs`)      // Fetch NPC data.
            ]);
            // Check if both requests were successful.
            if (!locationsResponse.ok || !npcsResponse.ok) throw new Error('Failed to fetch initial data.');
            // Parse the JSON responses and store the data in our state variables.
            locationsData = await locationsResponse.json();
            npcsData = await npcsResponse.json();
            // Once data is loaded, populate the location dropdown.
            populateLocations();
        } catch (error) {
            console.error("Initialization Error:", error);
            descriptionResult.textContent = "Error: Could not load initial data from the server. Is the Python backend running?";
        }
    };

    // --- UI Population Functions ---
    const populateLocations = () => {
        /**
         * Fills the location dropdown menu with the locations fetched from the server.
         */
        locationSelect.innerHTML = '<option value="">-- Select a Location --</option>'; // Add a default option.
        locationsData.forEach(location => {
            const option = document.createElement('option');
            option.value = location.name;
            option.textContent = location.name;
            locationSelect.appendChild(option);
        });
    };

    const populateRooms = (locationName) => {
        /**
         * Fills the room dropdown based on the selected location.
         */
        // Find the full data for the selected location.
        const location = locationsData.find(loc => loc.name === locationName);
        roomSelect.innerHTML = '<option value="">-- Select a Room --</option>'; // Add default option.
        if (location && location.rooms) {
            // Populate the dropdown with rooms from the location data.
            location.rooms.forEach(room => {
                const option = document.createElement('option');
                option.value = room.name;
                option.textContent = room.name;
                roomSelect.appendChild(option);
            });
        }
        // Clear subsequent selections and displays.
        npcSelect.innerHTML = '';
        descriptionResult.innerHTML = '<h2>Description</h2><p>Select a room to see a description.</p>';
        generationResult.innerHTML = placeholderText;
        npcCardContainer.innerHTML = '';
    };

    const updateCurrentNpcs = () => {
        /**
         * This function is called whenever the room changes or the party is updated.
         * It determines which NPCs should be in the scene (room NPCs + party NPCs)
         * and updates the NPC selection list and renders their info cards.
         */
        const locationName = locationSelect.value;
        const roomName = roomSelect.value;
        const location = locationsData.find(loc => loc.name === locationName);
        if (!location) return;
        const room = location.rooms.find(r => r.name === roomName);
        if(!room) return;

        // Display the description of the selected room.
        descriptionResult.innerHTML = `<h2>${location.name} - ${room.name}</h2><p>${room.description || ''}</p>`;
        
        // --- Determine which NPCs are in the scene ---
        // Get the full data for any persistent party members.
        const partyNpcs = npcsData.filter(n => partyNpcIds.has(n._id));
        // Get the names of NPCs native to the selected room.
        const roomNpcNames = new Set(room.npcs || []);
        // Get the full data for those room NPCs.
        const roomNpcs = npcsData.filter(n => roomNpcNames.has(n.name));
        
        // Combine party and room NPCs, ensuring no duplicates.
        const allNpcsInScene = [...partyNpcs];
        roomNpcs.forEach(npc => {
            if (!allNpcsInScene.some(p => p._id === npc._id)) {
                allNpcsInScene.push(npc);
            }
        });
        
        // --- Update the UI ---
        npcSelect.innerHTML = '';
        npcCardContainer.innerHTML = '';
        // For each NPC in the scene, add them to the selection list and render their card.
        allNpcsInScene.forEach(npc => {
            const option = document.createElement('option');
            option.value = npc.name;
            const isPartyMember = partyNpcIds.has(npc._id);
            option.textContent = npc.name + (isPartyMember ? ' (Party)' : ''); // Label party members.
            option.selected = true; // Pre-select all NPCs in the scene.
            npcSelect.appendChild(option);
            renderNpcCard(npc); // Create the info card for the NPC.
        });
    }

    const renderNpcCard = (npc) => {
        /**
         * Creates an HTML card for a single NPC, displaying their description
         * and pre-defined action buttons (dialogue and skills).
         */
        const card = document.createElement('div');
        card.className = 'npc-card';
        card.dataset.npcName = npc.name; // Store the name in a data attribute for easy access.
        
        // Create buttons for each dialogue option.
        let dialogueHTML = '';
        if (npc.dialogue_options) {
            npc.dialogue_options.forEach(promptText => {
                dialogueHTML += `<button class="action-btn" data-type="dialogue" data-prompt="${promptText}">${promptText}</button>`;
            });
        }

        // Create buttons for each skill check.
        let skillsHTML = '';
        if (npc.skill_checks) {
            for (const ability in npc.skill_checks) {
                npc.skill_checks[ability].forEach(skill => {
                    skillsHTML += `<button class="action-btn" data-type="skill_check" data-prompt="${skill}">${skill}</button>`;
                });
            }
        }

        // The HTML structure for the card.
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
        // Add the newly created card to the container.
        npcCardContainer.appendChild(card);
    };
    
    // --- Main Action Handler ---
    const handleAction = async (type, npcName, promptText) => {
        /**
         * This is the core function for interacting with the AI.
         * It sends the user's action (dialogue or skill check) to the backend's /generate endpoint.
         */
        const locationName = locationSelect.value;
        
        // Display the player's action in the scene immediately for a responsive feel.
        let playerActionHtml = `<div class="player-action"><p><strong>Player ➔ ${npcName}:</strong> ${promptText}</p></div>`;
        appendToGeneratedScene(playerActionHtml);

        try {
            // Send the request to the Flask backend.
            const response = await fetch(`${apiBaseUrl}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // The body contains all the context the backend needs to build the AI prompt.
                body: JSON.stringify({
                    location_name: locationName,
                    room: roomSelect.value,
                    npc_names: [npcName],
                    user_prompt: promptText,
                    prompt_type: type
                })
            });

            // Handle potential errors from the server.
            if (!response.ok) {
                 const err = await response.json();
                 throw new Error(err.error || 'Server error');
            }
                       // Parse the JSON response from the AI.
            const data = await response.json();
            
            // --- MODIFICATION START ---

            // If there are scene changes, wrap them in a styled description box.
            if (data.scene_changes) {
                 const sceneChangeHtml = `<div class="scene-description">${data.scene_changes}</div>`;
                 appendToGeneratedScene(sceneChangeHtml);
            }

            // If there is dialogue, format it with a speaker token.
            if (data.dialogue && data.dialogue.length > 0) {
                data.dialogue.forEach(d => {
                    // Get the first letter of the speaker's name for the token.
                    const speakerInitial = d.speaker.charAt(0).toUpperCase();
                    // Create a new HTML structure for the dialogue line.
                    const dialogueHtml = `<div class="dialogue-line"><span class="speaker-token">${speakerInitial}</span><p><strong>${d.speaker}:</strong> "${d.line}"</p></div>`;
                    appendToGeneratedScene(dialogueHtml);
                });
            }

            // If the AI generated new dialogue options, update the NPC's data and re-render the cards.
            if(data.new_dialogue_options) {
                const { npc_name, options } = data.new_dialogue_options;
                const npcToUpdate = npcsData.find(n => n.name === npc_name);
                if (npcToUpdate) {
                    npcToUpdate.dialogue_options = options;
                    updateCurrentNpcs(); // This will redraw the cards with the new buttons.
                }
            }

        } catch (error) {
            console.error('Generation Error:', error);
            appendToGeneratedScene(`<p style="color:red;"><em>Error generating scene: ${error.message}</em></p>`);
        }
    };
    
    // --- Event Listeners ---
    // These listeners connect user actions (like clicks and changes) to the appropriate functions.
    
    locationSelect.addEventListener('change', (e) => populateRooms(e.target.value));
    roomSelect.addEventListener('change', updateCurrentNpcs);
    
    // This uses event delegation. The listener is on the container, but it checks if the click was on an action button.
    // This is more efficient than adding a listener to every single button.
    npcCardContainer.addEventListener('click', (e) => {
        if (e.target.matches('.action-btn')) {
            const button = e.target;
            const type = button.dataset.type; // "dialogue" or "skill_check"
            const prompt = button.dataset.prompt; // The text on the button
            const npcName = button.closest('.npc-card').dataset.npcName; // Find the parent card to get the NPC's name
            handleAction(type, npcName, prompt);
        }
    });

    // Handles the custom text prompt submission.
    generateBtn.addEventListener('click', () => {
        const promptText = userPrompt.value;
        const selectedNpcNames = Array.from(npcSelect.selectedOptions).map(opt => opt.value);
        if (!promptText || selectedNpcNames.length === 0) {
            alert("Please enter a prompt and select an NPC.");
            return;
        }
        // It sends the action to the first selected NPC.
        handleAction('dialogue', selectedNpcNames[0], promptText);
        userPrompt.value = ''; // Clear the input field.
    });
    
    // Sets the currently selected NPCs as a persistent party.
    setPartyBtn.addEventListener('click', () => {
        const selectedNpcNames = Array.from(npcSelect.selectedOptions).map(opt => opt.value);
        // It stores their unique MongoDB IDs in the `partyNpcIds` Set.
        partyNpcIds = new Set(npcsData.filter(n => selectedNpcNames.includes(n.name)).map(n => n._id));
        alert('Persistent party set!');
        updateCurrentNpcs(); // Update the UI to reflect the party status.
    });

    // Clears the persistent party.
    clearPartyBtn.addEventListener('click', () => {
        partyNpcIds.clear();
        alert('Persistent party cleared!');
        updateCurrentNpcs(); // Update the UI.
    });

    // --- Initial Load ---
    // This kicks everything off when the page loads.
    fetchInitialData();
});