class AIEditor {
    constructor() {
        this.editorModal = null;
        this.selectedContext = null;
        this.currentDiffSegments = []; // Still used for interaction on the LATEST version
        this.editHistory = []; // Array to store arrays of diff segments
        this.currentVersionIndex = -1; // Index of the currently viewed version in editHistory
        this.init();
    }

    init() {
        // Reset history on init
        this.editHistory = [];
        this.currentVersionIndex = -1;
        // Listen for messages from popup and background
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            try {
                switch (request.action) {
                    case 'open-editor':
                        this.handleEditorOpen();
                        break;
                    // Note: getSelectedText is removed as context is fetched on open
                    // Note: replaceText is removed, replaced by Apply Changes logic
                    default:
                        console.warn('Unknown action received:', request.action);
                        sendResponse({ error: 'Unknown action' });
                }
            } catch (error) {
                console.error('Error in message handler:', error);
                sendResponse({ error: error.message });
            }
            return true; // Keep message channel open for async response
        });

        // Track text selection (simplistic, only captures on mouseup outside modal)
        document.addEventListener('mouseup', (event) => {
            // Only update selection if the event didn't happen inside the modal
            if (!this.editorModal || !this.editorModal.contains(event.target)) {
                const selection = this.getSelectionContext();
                if (selection) {
                    this.selectedContext = selection;
                    console.log("Selection updated:", this.selectedContext);
                }
            }
        });
    }

    // Inject CSS - REMOVED as manifest handles injection
    // this.injectCSS('content.css');

    // --- Modal Creation and Management ---

    createEditorModal() {
        const modal = document.createElement('div');
        modal.className = 'ai-editor-modal';
        modal.innerHTML = `
            <div class="ai-editor-content">
                <button id="ai-editor-options-link" class="ai-editor-options-button" title="Open Settings">
                    <i class="fas fa-cog"></i>
                </button>
                <h3>AI Editor</h3>
                
                <div class="ai-editor-prompt-area">
                    <label for="ai-editor-prompt-input">Your Instructions:</label>
                    <textarea id="ai-editor-prompt-input" class="ai-editor-prompt" placeholder="Enter your editing instructions..."></textarea>
                </div>

                <div id="ai-editor-diff-container" style="display: none;">
                     <label>Proposed Changes (Use buttons to accept/reject):</label>
                     <div class="ai-editor-diff-view" id="ai-diff-view"></div>
                    <!-- Version Navigation -->
                    <div class="ai-editor-version-nav" id="ai-version-nav" style="display: none;">
                        <button id="ai-editor-prev-version" class="ai-editor-nav-button" title="Previous Version">&#x25C0;</button> 
                        <span id="ai-editor-version-display">Version X of Y</span>
                        <button id="ai-editor-next-version" class="ai-editor-nav-button" title="Next Version">&#x25B6;</button>
                    </div>
                </div>
                
                <div class="ai-editor-status" id="ai-editor-status"></div>
                
                <div class="ai-editor-buttons">
                    <div id="ai-custom-buttons" class="ai-custom-buttons-container"></div> <!-- Container for custom buttons -->
                    <button id="ai-editor-submit" class="ai-editor-submit">Get Suggestions</button>
                    <button id="ai-editor-follow-up" class="ai-editor-follow-up" style="display: none;">Send Follow-up</button>
                    <button id="ai-editor-apply" class="ai-editor-apply" style="display: none;">Apply Accepted Changes</button>
                    <button id="ai-editor-cancel" class="ai-editor-cancel">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.editorModal = modal;
        this.addModalEventListeners();
        this.addDiffViewEventListeners(); // Add listener for diff buttons
    }

    addModalEventListeners() {
        const submitButton = this.editorModal.querySelector('#ai-editor-submit');
        const followUpButton = this.editorModal.querySelector('#ai-editor-follow-up');
        const applyButton = this.editorModal.querySelector('#ai-editor-apply');
        const cancelButton = this.editorModal.querySelector('#ai-editor-cancel');
        const promptInput = this.editorModal.querySelector('#ai-editor-prompt-input');
        const prevButton = this.editorModal.querySelector('#ai-editor-prev-version');
        const nextButton = this.editorModal.querySelector('#ai-editor-next-version');
        const optionsButton = this.editorModal.querySelector('#ai-editor-options-link');

        submitButton.addEventListener('click', () => {
            console.log("Submit button clicked, calling handleInitialSubmit...");
            this.handleInitialSubmit();
        });
        followUpButton.addEventListener('click', () => this.handleFollowUpSubmit());
        applyButton.addEventListener('click', () => this.handleApplyChanges());
        cancelButton.addEventListener('click', () => this.closeModal());

        // Add listeners for version navigation
        prevButton.addEventListener('click', () => this.navigateVersion(-1));
        nextButton.addEventListener('click', () => this.navigateVersion(1));

        // Listener for the options button
        if (optionsButton) {
            optionsButton.addEventListener('click', () => {
                console.log("Options button clicked! Sending message to background...");
                // Content script cannot call openOptionsPage directly.
                // Send a message to the background script instead.
                chrome.runtime.sendMessage({ action: "openOptionsPage" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Error sending openOptionsPage message:", chrome.runtime.lastError);
                        this.showStatus(`Error opening settings: ${chrome.runtime.lastError.message}`, 'error');
                    } else if (response && response.error) {
                        console.error("Background script reported error:", response.error);
                        this.showStatus(`Error opening settings: ${response.error}`, 'error');
                    } else {
                        console.log("Message sent to open options page.");
                    }
                });
            });
        } else {
            console.warn("Could not find options button element to attach listener.");
        }
    }

    addDiffViewEventListeners() {
        const diffView = this.editorModal.querySelector('#ai-diff-view');
        diffView.addEventListener('click', (event) => {
            const button = event.target.closest('.diff-action-button');
            if (button) {
                const segmentIndex = parseInt(button.dataset.segmentIndex, 10);
                const action = button.dataset.action; // 'accept' or 'reject'
                this.handleDiffAction(segmentIndex, action);
            }
        });
    }

    handleEditorOpen() {
        this.selectedContext = this.getSelectionContext(); // Get fresh context on open
        if (!this.selectedContext) {
            alert('Please select some text first.');
            return;
        }

        if (!this.editorModal) {
            this.createEditorModal();
        } else {
            this.resetModalUI();
        }

        this.editorModal.style.display = 'flex'; // Ensure display is set correctly before transition

        // Fetch settings and render custom buttons
        chrome.storage.sync.get([
            'customButton1Label', 'customButton1Prompt',
            'customButton2Label', 'customButton2Prompt',
            'customButton3Label', 'customButton3Prompt'
        ], (settings) => {
            if (chrome.runtime.lastError) {
                console.error("Error fetching custom button settings:", chrome.runtime.lastError);
                return;
            }
            this.renderCustomButtons(settings);
        });

        // Use class for visibility to trigger transition
        requestAnimationFrame(() => { // Ensure modal is in DOM before adding class
            this.editorModal.classList.add('visible');
        });

        this.editorModal.querySelector('#ai-editor-prompt-input').focus();
        this.showStatus('Selected: "' + this.selectedContext.text.substring(0, 50) + '..." Please provide instructions.', 'info');
    }

    closeModal() {
        if (this.editorModal) {
            this.editorModal.classList.remove('visible'); // Remove class for fade out
            // Optionally wait for transition before resetting/hiding completely
            setTimeout(() => {
                this.resetModalUI();
                // Ensure display: none is set after transition
                this.editorModal.style.display = 'none';
            }, 300); // Match transition duration
        }
    }

    resetModalUI() {
        if (!this.editorModal) return;
        this.editorModal.querySelector('#ai-editor-prompt-input').value = '';
        this.editorModal.querySelector('#ai-diff-view').innerHTML = '';
        this.editorModal.querySelector('#ai-editor-diff-container').style.display = 'none';
        this.editorModal.querySelector('#ai-editor-status').style.display = 'none';
        this.editorModal.querySelector('#ai-editor-submit').style.display = 'inline-block';
        this.editorModal.querySelector('#ai-editor-submit').disabled = false;
        this.editorModal.querySelector('#ai-editor-follow-up').style.display = 'none';
        this.editorModal.querySelector('#ai-editor-apply').style.display = 'none';
        this.currentDiffSegments = [];
    }

    showStatus(message, type = 'info') {
        if (!this.editorModal) return;
        const statusDiv = this.editorModal.querySelector('#ai-editor-status');
        statusDiv.textContent = message;
        statusDiv.className = `ai-editor-status ${type}`; // Set class for styling
        statusDiv.style.display = 'block';
    }

    setLoadingState(isLoading) {
        if (!this.editorModal) return;
        const submitButton = this.editorModal.querySelector('#ai-editor-submit');
        const followUpButton = this.editorModal.querySelector('#ai-editor-follow-up');
        const applyButton = this.editorModal.querySelector('#ai-editor-apply');

        submitButton.disabled = isLoading;
        followUpButton.disabled = isLoading;
        applyButton.disabled = isLoading;

        if (isLoading) {
            this.showStatus('Processing with AI...', 'info');
        } else {
            const statusDiv = this.editorModal.querySelector('#ai-editor-status');
            if (statusDiv.textContent === 'Processing with AI...') {
                statusDiv.style.display = 'none';
            }
        }
    }

    // --- Diff Rendering and Interaction ---

    renderDiff(diffSegments) {
        console.log(`renderDiff called with ${diffSegments ? diffSegments.length : 0} segments. First segment:`, diffSegments ? JSON.stringify(diffSegments[0]) : 'N/A'); // Log entry
        if (!this.editorModal) return;
        const diffView = this.editorModal.querySelector('#ai-diff-view');
        diffView.innerHTML = ''; // Clear previous diff

        // Store segments with initial accepted state and link pairs
        this.currentDiffSegments = diffSegments.map((segment, index) => ({
            ...segment,
            originalIndex: index, // Keep track of original index before processing
            accepted: segment.accepted,
            isChangePair: false,
            linkedSegmentIndex: -1
        }));

        let i = 0;
        while (i < this.currentDiffSegments.length) {
            const segment = this.currentDiffSegments[i];
            let nextSegment = (i + 1 < this.currentDiffSegments.length) ? this.currentDiffSegments[i + 1] : null;

            // Check for adjacent delete/insert pair
            if (segment.type === 'delete' && nextSegment && nextSegment.type === 'insert') {
                // Mark segments as part of a pair and link them
                segment.isChangePair = true;
                nextSegment.isChangePair = true;
                segment.linkedSegmentIndex = i + 1;
                nextSegment.linkedSegmentIndex = i;

                const pairWrapper = document.createElement('div');
                pairWrapper.classList.add('diff-segment-wrapper', 'diff-pair', 'accepted');
                pairWrapper.dataset.segmentIndex = i; // Use first segment index for controls

                // Render delete part
                const deleteSpan = document.createElement('span');
                deleteSpan.textContent = segment.text;
                deleteSpan.classList.add('diff-delete');
                pairWrapper.appendChild(deleteSpan);

                // Render insert part
                const insertSpan = document.createElement('span');
                insertSpan.textContent = nextSegment.text;
                insertSpan.classList.add('diff-insert');
                pairWrapper.appendChild(insertSpan);

                // Add shared controls
                this.addDiffControls(pairWrapper, i, true); // isPair = true

                diffView.appendChild(pairWrapper);
                i += 2; // Skip the next segment as it was processed
            } else {
                // Handle standalone segments (equal, or unpaired insert/delete)
                const segmentWrapper = document.createElement('div');
                segmentWrapper.classList.add('diff-segment-wrapper');
                if (segment.type !== 'equal') {
                    segmentWrapper.classList.add('diff-change', 'accepted');
                }
                segmentWrapper.dataset.segmentIndex = i;

                const textSpan = document.createElement('span');
                textSpan.textContent = segment.text;
                textSpan.classList.add(`diff-${segment.type}`);
                segmentWrapper.appendChild(textSpan);

                // Add controls only if it's a changeable segment
                if (segment.type === 'insert' || segment.type === 'delete') {
                    this.addDiffControls(segmentWrapper, i, false); // isPair = false
                }

                diffView.appendChild(segmentWrapper);
                i += 1;
            }
        }

        // Show diff view and relevant buttons
        this.editorModal.querySelector('#ai-editor-diff-container').style.display = 'block';
        this.editorModal.querySelector('#ai-editor-submit').style.display = 'none';
        this.editorModal.querySelector('#ai-editor-follow-up').style.display = 'inline-block';
        this.editorModal.querySelector('#ai-editor-apply').style.display = 'inline-block';
        this.showStatus('Review the changes. Use ✓/✗ buttons to accept/reject.', 'info');
    }

    // Helper to add Accept/Reject controls (Updated to toggle visibility)
    addDiffControls(wrapper, segmentIndex, isPair) {
        const controls = document.createElement('div');
        controls.classList.add('diff-controls');

        const acceptSVG = `<svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"></path></svg>`;
        const rejectSVG = `<svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"></path></svg>`;

        const segmentData = this.editHistory[this.currentVersionIndex]?.[segmentIndex];
        const isInitiallyAccepted = segmentData ? segmentData.accepted : true; // Default to true if not found, though it should be

        const acceptButton = document.createElement('button');
        acceptButton.innerHTML = acceptSVG;
        acceptButton.title = isPair ? 'Accept replacement' : 'Accept change';
        acceptButton.classList.add('diff-action-button', 'accept');
        acceptButton.dataset.segmentIndex = segmentIndex;
        acceptButton.dataset.action = 'accept';
        // Show Accept button only if the segment is currently REJECTED
        acceptButton.style.display = isInitiallyAccepted ? 'none' : 'inline-flex';

        const rejectButton = document.createElement('button');
        rejectButton.innerHTML = rejectSVG;
        rejectButton.title = isPair ? 'Reject replacement' : 'Reject change';
        rejectButton.classList.add('diff-action-button', 'reject');
        rejectButton.dataset.segmentIndex = segmentIndex;
        rejectButton.dataset.action = 'reject';
        // Show Reject button only if the segment is currently ACCEPTED
        rejectButton.style.display = isInitiallyAccepted ? 'inline-flex' : 'none';

        controls.appendChild(acceptButton);
        controls.appendChild(rejectButton);
        wrapper.appendChild(controls);
    }

    handleDiffAction(segmentIndex, action) {
        // Only allow actions on the latest version
        if (this.currentVersionIndex !== this.editHistory.length - 1) {
            console.log("Diff actions only allowed on the latest version.");
            return;
        }

        const diffSegments = this.editHistory[this.currentVersionIndex]; // Use history
        const segment = diffSegments[segmentIndex]; // Get segment from history
        if (!segment || (segment.type !== 'insert' && segment.type === 'delete')) return;

        const isAccepted = (action === 'accept');
        const linkedSegmentIndex = segment.linkedSegmentIndex;

        // Update state for the primary segment IN HISTORY
        segment.accepted = isAccepted;
        const segmentWrapper = this.editorModal.querySelector(`.diff-segment-wrapper[data-segment-index="${segmentIndex}"]`);
        if (!segmentWrapper) return;

        // Update state for the linked segment if it exists IN HISTORY
        if (segment.isChangePair && linkedSegmentIndex !== -1 && diffSegments[linkedSegmentIndex]) {
            diffSegments[linkedSegmentIndex].accepted = isAccepted;
        }

        // Update visuals for the wrapper and toggle button visibility
        const acceptButton = segmentWrapper.querySelector('.diff-action-button.accept');
        const rejectButton = segmentWrapper.querySelector('.diff-action-button.reject');

        if (isAccepted) {
            segmentWrapper.classList.remove('rejected');
            segmentWrapper.classList.add('accepted');
            acceptButton.style.display = 'none'; // Hide Accept button
            rejectButton.style.display = 'inline-flex'; // Show Reject button
        } else { // reject
            segmentWrapper.classList.remove('accepted');
            segmentWrapper.classList.add('rejected');
            acceptButton.style.display = 'inline-flex'; // Show Accept button
            rejectButton.style.display = 'none'; // Hide Reject button
        }
    }

    getAcceptedDiffText(versionIndex) { // Accepts versionIndex
        const versionData = this.editHistory[versionIndex];
        if (!versionData || !Array.isArray(versionData.diff)) {
            console.error("getAcceptedDiffText: Invalid version data or diff array for index", versionIndex, versionData);
            return ''; // Return empty string if data is invalid
        }
        const segmentsToUse = versionData.diff; // Access the diff array
        let final_text = '';
        segmentsToUse.forEach((segment) => {
            if (segment.type === 'equal') {
                final_text += segment.text;
            } else if (segment.type === 'insert') {
                if (segment.accepted) { // Include accepted insertions
                    final_text += segment.text;
                }
            } else if (segment.type === 'delete') {
                // For deletions, we include the text ONLY if the deletion was REJECTED
                if (!segment.accepted) {
                    final_text += segment.text;
                }
            }
        });
        return final_text;
    }

    // --- Event Handlers for Buttons (handleInitialSubmit, handleFollowUpSubmit, handleApplyChanges) ---
    // These remain mostly the same, relying on the updated getAcceptedDiffText
    async handleInitialSubmit() {
        console.log("handleInitialSubmit triggered.");
        if (!this.selectedContext) {
            this.showStatus('Error: No text selected.', 'error');
            return;
        }
        const promptInput = this.editorModal.querySelector('#ai-editor-prompt-input');
        const prompt = promptInput.value.trim();
        if (!prompt) {
            this.showStatus('Please enter your instructions.', 'error');
            return;
        }

        this.setLoadingState(true);
        this.editorModal.querySelector('#ai-editor-submit').style.display = 'none'; // Hide initial submit
        this.editorModal.querySelector('#ai-editor-follow-up').style.display = 'none'; // Ensure follow-up is hidden initially
        this.editorModal.querySelector('#ai-editor-apply').style.display = 'none'; // Ensure apply is hidden initially
        this.editorModal.querySelector('#ai-editor-diff-container').style.display = 'none'; // Hide diff view

        try {
            const messagePayload = {
                action: 'ai-request',
                text: this.selectedContext.text,
                instructions: prompt
            };
            console.log("Sending message from content.js:", messagePayload);
            const response = await chrome.runtime.sendMessage(messagePayload);

            this.processAIResponse(response, this.selectedContext.text);
        } catch (error) {
            console.error('Caught error in handleInitialSubmit (content.js):', error);
            // Display the error message from the caught error
            this.showStatus(`Error: ${error.message || 'Unknown error during message send'}`, 'error');
            // Ensure correct button states on catch
            this.editorModal.querySelector('#ai-editor-submit').style.display = 'inline-block';
            this.editorModal.querySelector('#ai-editor-follow-up').style.display = 'none';
            this.editorModal.querySelector('#ai-editor-apply').style.display = 'none';
            this.editorModal.querySelector('#ai-editor-diff-container').style.display = 'none';
        } finally {
            this.setLoadingState(false);
        }
    }

    async handleFollowUpSubmit() {
        if (!this.editorModal || !this.selectedContext) return;

        const promptInput = this.editorModal.querySelector('#ai-editor-prompt-input');
        const newPrompt = promptInput.value.trim();

        if (!newPrompt) {
            this.showStatus('Please enter follow-up instructions.', 'error');
            return;
        }

        // Prepare the history of changes
        // Only include segments that represent changes (delete/insert)
        const diffHistory = this.currentDiffSegments
            .filter(seg => seg.type === 'delete' || seg.type === 'insert')
            .map(seg => ({
                type: seg.type,
                text: seg.text,
                accepted: seg.accepted // Include the accepted/rejected state
            }));

        this.setLoadingState(true);
        this.showStatus('Processing follow-up with AI...', 'info');

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'request-ai-edit',
                originalText: this.selectedContext.text,
                diffHistory: diffHistory, // Send the processed history
                prompt: newPrompt // Send the new prompt
            });

            if (response.error) {
                throw new Error(response.error);
            }

            console.log("Received follow-up diff data:", response.diff);

            if (response.diff) {
                console.log("Received success response with diff data (follow-up):", JSON.stringify(response.diff)); // Log received data
                // Initialize accepted state for the follow-up version
                const followUpSegments = response.diff.map(seg => ({ ...seg, accepted: true }));
                this.editHistory.push(followUpSegments); // Add initialized segments to history
                this.currentVersionIndex = this.editHistory.length - 1;
                this.updateVersionView(this.currentVersionIndex); // Render the new version
                this.showStatus('Follow-up suggestions received. Review the changes.', 'info');
                // Keep Follow-up and Apply buttons visible
            } else {
                this.showStatus('No changes suggested for the follow-up.', 'info');
            }

        } catch (error) {
            console.error('Error getting follow-up suggestions:', error);
            this.showStatus(`Error: ${error.message}`, 'error');
        } finally {
            this.setLoadingState(false);
        }
    }

    handleApplyChanges() {
        // Remove the check restricting application to only the latest version
        if (!this.selectedContext /*|| this.currentVersionIndex !== this.editHistory.length - 1*/) {
            // Update error message slightly
            this.showStatus('Error: Original selection context lost or no version selected.', 'error');
            return;
        }

        // Use the currently viewed version index (already correct)
        const finalText = this.getAcceptedDiffText(this.currentVersionIndex);

        const replacement = {
            start: 0,
            end: this.selectedContext.text.length,
            text: finalText
        };

        try {
            this.applyReplacements([replacement]);
            this.closeModal();
        } catch (error) {
            console.error("Error during final application:", error);
            this.showStatus('Failed to apply changes. Check console.', 'error');
        }
    }

    // --- Text Selection and Replacement Logic (getSelectionContext, applyReplacements) ---
    // Keep these as they were in the previous step
    getSelectionContext() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;

        const activeElement = document.activeElement;
        const tagName = activeElement ? activeElement.tagName.toUpperCase() : null;

        let context = null;

        if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
            const text = activeElement.value.substring(activeElement.selectionStart, activeElement.selectionEnd);
            if (text) {
                context = {
                    text,
                    fullText: activeElement.value,
                    selectionStart: activeElement.selectionStart,
                    selectionEnd: activeElement.selectionEnd,
                    element: activeElement,
                    range: null,
                    isInput: true
                };
            }
        }

        if (!context) {
            const text = selection.toString().trim();
            if (!text) return null;

            const range = selection.getRangeAt(0);
            const container = range.commonAncestorContainer;
            let parentElement = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
            while (parentElement && window.getComputedStyle(parentElement).display.includes('inline')) {
                parentElement = parentElement.parentElement;
            }
            parentElement = parentElement || (container.nodeType === Node.TEXT_NODE ? container.parentElement : container);

            let selectionStart = 0;
            let selectionEnd = 0;
            try {
                const tempRange = document.createRange();
                tempRange.selectNodeContents(parentElement);
                tempRange.setEnd(range.startContainer, range.startOffset);
                selectionStart = tempRange.toString().length;
                selectionEnd = selectionStart + text.length;
            } catch (e) {
                console.warn("Could not accurately calculate selection offsets relative to parent.", e);
                selectionStart = range.startOffset;
                selectionEnd = range.endOffset;
            }

            context = {
                text,
                fullText: parentElement.textContent,
                selectionStart: selectionStart,
                selectionEnd: selectionEnd,
                element: parentElement,
                range: range.cloneRange(),
                isInput: false
            };
        }

        return context;
    }

    applyReplacements(replacements) {
        if (!this.selectedContext) {
            console.error("ApplyReplacements called without selection context.");
            return;
        }

        const isInput = this.selectedContext.isInput;
        const targetElement = this.selectedContext.element;
        const originalSelectionStart = this.selectedContext.selectionStart;
        const originalSelectionEnd = this.selectedContext.selectionEnd;

        try {
            replacements.sort((a, b) => b.start - a.start);

            if (isInput) {
                let currentValue = targetElement.value;
                for (const replacement of replacements) {
                    const absoluteStart = originalSelectionStart + replacement.start;
                    const absoluteEnd = originalSelectionStart + replacement.end;

                    if (absoluteStart < 0 || absoluteEnd < 0 || absoluteStart > currentValue.length || absoluteEnd > currentValue.length || absoluteStart > absoluteEnd) {
                        console.warn("Skipping invalid replacement indices for input/textarea:", replacement, "->", { absoluteStart, absoluteEnd }, "for value length:", currentValue.length);
                        continue;
                    }
                    currentValue = currentValue.slice(0, absoluteStart) + replacement.text + currentValue.slice(absoluteEnd);
                }
                targetElement.value = currentValue;
                targetElement.setSelectionRange(originalSelectionStart, originalSelectionStart + replacements.reduce((len, r) => len + r.text.length, 0));

            } else {
                if (!this.selectedContext.range) {
                    throw new Error("Cannot apply replacement: Original range missing.")
                }

                const originalRange = this.selectedContext.range.cloneRange();

                if (replacements.length === 1 && replacements[0].start === 0) {
                    const replacementText = replacements[0].text;
                    originalRange.deleteContents();
                    if (replacementText) {
                        const newTextNode = document.createTextNode(replacementText);
                        originalRange.insertNode(newTextNode);
                        originalRange.selectNode(newTextNode);
                        window.getSelection().removeAllRanges();
                        window.getSelection().addRange(originalRange);
                    }
                } else {
                    console.warn("ApplyReplacements for non-input elements expects a single replacement object covering the original selection. Found:", replacements);
                    throw new Error("Complex replacements for non-input elements not implemented in this flow.");
                }
            }

            targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

        } catch (error) {
            console.error('Error applying final replacements:', error);
            throw error;
        }
    }

    navigateVersion(direction) {
        if (!this.editHistory || this.editHistory.length === 0) return;
        const newIndex = this.currentVersionIndex + direction;
        if (newIndex >= 0 && newIndex < this.editHistory.length) {
            this.updateVersionView(newIndex);
        }
    }

    updateVersionView(index) {
        console.log(`updateVersionView called for index: ${index}`); // Log entry
        if (index < 0 || index >= this.editHistory.length) {
            console.error("Invalid version index:", index);
            return;
        }
        this.currentVersionIndex = index;
        const diffSegments = this.editHistory[this.currentVersionIndex];
        console.log(`Rendering version ${this.currentVersionIndex + 1}. Segments:`, JSON.stringify(diffSegments)); // Log segments being rendered

        // Render the diff for the selected version
        this.renderDiff(diffSegments);

        // Call the dedicated function to update nav display
        this.updateVersionNavDisplay();

        // Enable/disable interaction controls based on version
        const isLatestVersion = this.currentVersionIndex === this.editHistory.length - 1;
        const applyButton = this.editorModal.querySelector('#ai-editor-apply');
        // Always show the apply button if history exists, regardless of version
        applyButton.style.display = (this.editHistory.length > 0) ? 'inline-block' : 'none';

        // Add/remove class to diff view container to disable interactions via CSS
        const diffViewContainer = this.editorModal.querySelector('#ai-editor-diff-view');
        if (isLatestVersion) {
            diffViewContainer.classList.remove('read-only-diff');
        } else {
            diffViewContainer.classList.add('read-only-diff');
            // Optional: Provide feedback that interactions are disabled
            // this.showStatus(`Viewing older version ${this.currentVersionIndex + 1}. Controls disabled.`, 'info'); 
        }
    }

    // Dedicated function to update the Version Nav display elements
    updateVersionNavDisplay() {
        const versionNav = this.editorModal.querySelector('#ai-version-nav');
        const versionDisplay = this.editorModal.querySelector('#ai-editor-version-display');
        const prevButton = this.editorModal.querySelector('#ai-editor-prev-version');
        const nextButton = this.editorModal.querySelector('#ai-editor-next-version');

        if (this.editHistory.length > 1) {
            console.log(`updateVersionView: History length is ${this.editHistory.length} (> 1). Should show nav.`); // Log if block
            if (versionNav) {
                versionNav.style.display = 'flex';
                console.log(`updateVersionView: Set versionNav display to flex.`);
            } else {
                console.error("updateVersionView: Could not find #ai-version-nav element!");
            }
            versionDisplay.textContent = `Version ${this.currentVersionIndex + 1} of ${this.editHistory.length}`;
            prevButton.disabled = this.currentVersionIndex === 0;
            nextButton.disabled = this.currentVersionIndex === this.editHistory.length - 1;
        } else {
            console.log(`updateVersionView: History length is ${this.editHistory.length} (<= 1). Should hide nav.`); // Log else block
            if (versionNav) {
                versionNav.style.display = 'none';
                console.log(`updateVersionView: Set versionNav display to none.`);
            } else {
                console.error("updateVersionView: Could not find #ai-version-nav element!");
            }
        }
    }

    // --- Custom Button Rendering and Handling ---
    renderCustomButtons(settings) {
        const container = this.editorModal.querySelector('#ai-custom-buttons');
        container.innerHTML = ''; // Clear previous buttons

        for (let i = 1; i <= 3; i++) {
            const label = settings[`customButton${i}Label`];
            const prompt = settings[`customButton${i}Prompt`];

            if (label && prompt) { // Only render if both label and prompt are set
                const button = document.createElement('button');
                button.textContent = label;
                button.classList.add('ai-editor-button', 'ai-custom-button'); // Add general and specific classes
                button.dataset.prompt = prompt; // Store prompt in data attribute

                button.addEventListener('click', (event) => {
                    const clickedPrompt = event.target.dataset.prompt;
                    this.handleCustomButtonClick(clickedPrompt);
                });

                container.appendChild(button);
            }
        }
    }

    async handleCustomButtonClick(prompt) {
        if (!this.selectedContext || !this.selectedContext.text) {
            this.showStatus('Error: No text selected or context lost.', 'error');
            return;
        }
        if (!prompt) {
            this.showStatus('Error: Custom button prompt is empty.', 'error');
            return;
        }

        console.log("Custom button clicked. Prompt:", prompt, "Selected Text:", this.selectedContext.text);
        this.setLoadingState(true);

        try {
            // Send request to background script (similar to handleInitialSubmit)
            const response = await chrome.runtime.sendMessage({
                action: 'ai-request',
                text: this.selectedContext.text, // Use the currently stored selected text
                instructions: prompt, // Use the custom button's prompt
                contextElementInfo: this.selectedContext.elementInfo, // Send element info
                originalText: this.selectedContext.text // Send original text for diffing history
            });

            console.log("Response from background script (custom button):", response);
            this.processAIResponse(response, this.selectedContext.text); // Reuse existing response handler
        } catch (error) {
            console.error('Error sending AI request (custom button):', error);
            this.showStatus(`Error: ${error.message}`, 'error');
            this.setLoadingState(false);
        }
    }

    // Centralized AI Response Processor
    processAIResponse(response, originalText) {
        this.setLoadingState(false);

        // --- FIX: Check if response is undefined --- 
        if (response === undefined) {
            console.error("Error: Received undefined response from background script.");
            this.showStatus('Error: No response from background script. Check background logs.', 'error');
            return;
        }
        // --- END FIX ---

        if (response.error) {
            console.error("AI Error:", response.error);
            this.showStatus(`AI Error: ${response.error}`, 'error');
            return;
        }
        if (!response.diff) {
            console.error("No diff received from AI");
            this.showStatus('Error: No changes suggested by AI.', 'error');
            return;
        }

        // --- FIX: Initialize accepted state for the new diff segments --- 
        const initializedDiff = response.diff.map(seg => ({ ...seg, accepted: true }));
        // --- END FIX ---

        // Store this edit version
        const newVersion = {
            originalText: originalText,
            // --- FIX: Use the initialized diff --- 
            diff: initializedDiff,
            // --- END FIX ---
            // We might want to store the prompt used as well later
        };
        // Add to history and reset index to the latest
        this.editHistory.push(newVersion);
        this.currentVersionIndex = this.editHistory.length - 1;

        console.log("Processing AI response. New history length:", this.editHistory.length, "Current index:", this.currentVersionIndex);

        this.renderDiff(response.diff); // Render the diff for the LATEST version
        this.updateVersionNavDisplay(); // Update version display (e.g., "Version 2 of 2")

        this.editorModal.querySelector('#ai-editor-diff-container').style.display = 'block';
        this.editorModal.querySelector('#ai-editor-submit').style.display = 'none'; // Hide initial submit
        this.editorModal.querySelector('#ai-editor-follow-up').style.display = 'inline-block'; // Show follow-up
        this.editorModal.querySelector('#ai-editor-apply').style.display = 'inline-block'; // Show apply
        this.showStatus('Review the proposed changes below.', 'info');
    }
}

// Initialize the editor
const aiEditor = new AIEditor(); 