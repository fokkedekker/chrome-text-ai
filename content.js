class AIEditor {
    constructor() {
        this.selectedContext = null;
        this.editorModal = null;
        this.currentDiffSegments = []; // Store the latest diff segments from AI
        this.init();
    }

    init() {
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

        // Inject CSS
        this.injectCSS('content.css');

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

    injectCSS(cssFile) {
        const link = document.createElement('link');
        link.href = chrome.runtime.getURL(cssFile);
        link.type = 'text/css';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
    }

    // --- Modal Creation and Management ---

    createEditorModal() {
        const modal = document.createElement('div');
        modal.className = 'ai-editor-modal';
        modal.innerHTML = `
            <div class="ai-editor-content">
                <h3>AI Editor</h3>
                
                <div class="ai-editor-prompt-area">
                    <label for="ai-editor-prompt-input">Your Instructions:</label>
                    <textarea id="ai-editor-prompt-input" class="ai-editor-prompt" placeholder="Enter your editing instructions..."></textarea>
                </div>

                <div id="ai-editor-diff-container" style="display: none;">
                     <label>Proposed Changes (Use buttons to accept/reject):</label>
                     <div class="ai-editor-diff-view" id="ai-diff-view"></div>
                </div>
                
                <div class="ai-editor-status" id="ai-editor-status"></div>
                
                <div class="ai-editor-buttons">
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

        submitButton.addEventListener('click', () => this.handleInitialSubmit());
        followUpButton.addEventListener('click', () => this.handleFollowUpSubmit());
        applyButton.addEventListener('click', () => this.handleApplyChanges());
        cancelButton.addEventListener('click', () => this.closeModal());
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
        if (!this.editorModal) return;
        const diffView = this.editorModal.querySelector('#ai-diff-view');
        diffView.innerHTML = ''; // Clear previous diff

        // Store segments with initial accepted state and link pairs
        this.currentDiffSegments = diffSegments.map((segment, index) => ({
            ...segment,
            originalIndex: index, // Keep track of original index before processing
            accepted: true,
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

        const acceptButton = document.createElement('button');
        acceptButton.innerHTML = acceptSVG;
        acceptButton.title = isPair ? 'Accept replacement' : 'Accept change';
        acceptButton.classList.add('diff-action-button', 'accept');
        acceptButton.dataset.segmentIndex = segmentIndex;
        acceptButton.dataset.action = 'accept';
        acceptButton.style.display = 'none'; // Initially hidden (since default is accepted)

        const rejectButton = document.createElement('button');
        rejectButton.innerHTML = rejectSVG;
        rejectButton.title = isPair ? 'Reject replacement' : 'Reject change';
        rejectButton.classList.add('diff-action-button', 'reject');
        rejectButton.dataset.segmentIndex = segmentIndex;
        rejectButton.dataset.action = 'reject';
        // rejectButton starts visible by default

        controls.appendChild(acceptButton);
        controls.appendChild(rejectButton);
        wrapper.appendChild(controls);
    }

    handleDiffAction(segmentIndex, action) {
        const segment = this.currentDiffSegments[segmentIndex];
        if (!segment || (segment.type !== 'insert' && segment.type !== 'delete')) return;

        const isAccepted = (action === 'accept');
        const linkedSegmentIndex = segment.linkedSegmentIndex;

        // Update state for the primary segment
        segment.accepted = isAccepted;
        const segmentWrapper = this.editorModal.querySelector(`.diff-segment-wrapper[data-segment-index="${segmentIndex}"]`);
        if (!segmentWrapper) return;

        // Update state for the linked segment if it exists
        if (segment.isChangePair && linkedSegmentIndex !== -1 && this.currentDiffSegments[linkedSegmentIndex]) {
            this.currentDiffSegments[linkedSegmentIndex].accepted = isAccepted;
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

    getAcceptedDiffText() {
        if (!this.currentDiffSegments) return '';
        let final_text = '';
        this.currentDiffSegments.forEach((segment) => {
            if (segment.type === 'equal') {
                final_text += segment.text;
            } else if (segment.type === 'insert') {
                if (segment.accepted) { // Include accepted insertions
                    final_text += segment.text;
                }
            } else if (segment.type === 'delete') {
                if (!segment.accepted) { // Include text of rejected deletions
                    final_text += segment.text;
                }
            }
        });
        return final_text;
    }

    // --- Event Handlers for Buttons (handleInitialSubmit, handleFollowUpSubmit, handleApplyChanges) ---
    // These remain mostly the same, relying on the updated getAcceptedDiffText
    async handleInitialSubmit() {
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
            const response = await chrome.runtime.sendMessage({
                action: 'process-text',
                text: this.selectedContext.text, // Send original selected text
                prompt: prompt
            });

            // Updated check for the new response structure
            if (response.success && response.diff) {
                this.renderDiff(response.diff); // Use response.diff directly
                this.showStatus('Suggestions received. Review the changes.', 'info');
                // Show Follow-up and Apply buttons, hide initial submit
                this.editorModal.querySelector('#ai-editor-submit').style.display = 'none';
                this.editorModal.querySelector('#ai-editor-follow-up').style.display = 'inline-block';
                this.editorModal.querySelector('#ai-editor-apply').style.display = 'inline-block';
                this.editorModal.querySelector('#ai-editor-diff-container').style.display = 'block'; // Show diff view
            } else {
                // If error or no diff, show error and revert button states
                this.showStatus(`Error: ${response.error || 'Failed to get suggestions.'}`, 'error');
                this.editorModal.querySelector('#ai-editor-submit').style.display = 'inline-block';
                this.editorModal.querySelector('#ai-editor-follow-up').style.display = 'none';
                this.editorModal.querySelector('#ai-editor-apply').style.display = 'none';
                this.editorModal.querySelector('#ai-editor-diff-container').style.display = 'none';
            }
        } catch (error) {
            console.error('Error sending message to background:', error);
            this.showStatus(`Error: ${error.message}`, 'error');
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
                this.renderDiff(response.diff);
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
        if (!this.selectedContext) {
            this.showStatus('Error: Original selection context lost.', 'error');
            return;
        }

        const finalText = this.getAcceptedDiffText();

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
}

// Initialize the editor
const aiEditor = new AIEditor(); 