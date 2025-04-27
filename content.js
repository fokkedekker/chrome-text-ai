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
                     <label>Proposed Changes (Select changes to apply):</label>
                     <div class="ai-editor-diff-view" id="ai-diff-view"></div>
                </div>
                
                <div class="ai-editor-status" id="ai-editor-status"></div>
                
                <div class="ai-editor-buttons">
                    <button id="ai-editor-submit" class="ai-editor-submit">Get Suggestions</button>
                    <button id="ai-editor-follow-up" class="ai-editor-follow-up" style="display: none;">Send Follow-up</button>
                    <button id="ai-editor-apply" class="ai-editor-apply" style="display: none;">Apply Selected Changes</button>
                    <button id="ai-editor-cancel" class="ai-editor-cancel">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.editorModal = modal;

        // Add event listeners
        this.addModalEventListeners();
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

    handleEditorOpen() {
        this.selectedContext = this.getSelectionContext(); // Get fresh context on open
        if (!this.selectedContext) {
            alert('Please select some text first.');
            return;
        }

        if (!this.editorModal) {
            this.createEditorModal();
        } else {
            // Reset modal state if re-opening
            this.resetModalUI();
        }

        this.editorModal.style.display = 'flex';
        this.editorModal.querySelector('#ai-editor-prompt-input').focus();
        this.showStatus('Selected: "' + this.selectedContext.text.substring(0, 50) + '..." Please provide instructions.', 'info');
    }

    closeModal() {
        if (this.editorModal) {
            this.editorModal.style.display = 'none';
            this.resetModalUI();
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
        // Keep apply button enabled during loading? Maybe disable too.
        applyButton.disabled = isLoading;

        if (isLoading) {
            this.showStatus('Processing with AI...', 'info');
        } else {
            // Clear loading status or let subsequent actions set it
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
        this.currentDiffSegments = diffSegments; // Store for later use

        let segmentIndex = 0;
        diffSegments.forEach(segment => {
            const span = document.createElement('span');
            span.textContent = segment.text;
            span.classList.add(`diff-${segment.type}`);

            if (segment.type === 'insert' || segment.type === 'delete') {
                span.classList.add('diff-change');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = true; // Default to accepted
                checkbox.dataset.segmentIndex = segmentIndex;
                span.insertBefore(checkbox, span.firstChild);
            }
            diffView.appendChild(span);
            segmentIndex++;
        });

        // Show diff view and relevant buttons
        this.editorModal.querySelector('#ai-editor-diff-container').style.display = 'block';
        this.editorModal.querySelector('#ai-editor-submit').style.display = 'none'; // Hide initial submit
        this.editorModal.querySelector('#ai-editor-follow-up').style.display = 'inline-block';
        this.editorModal.querySelector('#ai-editor-apply').style.display = 'inline-block';
        this.showStatus('Review the changes and select which to apply.', 'info');
    }

    getAcceptedDiffText() {
        if (!this.editorModal || !this.currentDiffSegments) return '';

        let final_text = '';
        const checkboxes = this.editorModal.querySelectorAll('.diff-change input[type="checkbox"]');
        const acceptedIndices = new Set();
        checkboxes.forEach(cb => {
            if (cb.checked) {
                acceptedIndices.add(parseInt(cb.dataset.segmentIndex, 10));
            }
        });

        this.currentDiffSegments.forEach((segment, index) => {
            if (segment.type === 'equal') {
                final_text += segment.text;
            } else if (segment.type === 'insert') {
                if (acceptedIndices.has(index)) {
                    final_text += segment.text; // Add accepted insertion
                }
            } else if (segment.type === 'delete') {
                if (!acceptedIndices.has(index)) {
                    final_text += segment.text; // Add text back if deletion was rejected
                }
            }
        });
        return final_text;
    }

    // --- Event Handlers for Buttons ---

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
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'process-text',
                text: this.selectedContext.text, // Send original selected text
                prompt: prompt
            });

            if (response.success && response.diffData && response.diffData.diff_segments) {
                this.renderDiff(response.diffData.diff_segments);
            } else {
                this.showStatus(`Error: ${response.error || 'Failed to get suggestions.'}`, 'error');
            }
        } catch (error) {
            console.error('Error sending message to background:', error);
            this.showStatus(`Error: ${error.message}`, 'error');
        } finally {
            this.setLoadingState(false);
        }
    }

    async handleFollowUpSubmit() {
        const promptInput = this.editorModal.querySelector('#ai-editor-prompt-input');
        const followUpPrompt = promptInput.value.trim();
        if (!followUpPrompt) {
            this.showStatus('Please enter follow-up instructions.', 'error');
            return;
        }

        // Get the current text based on accepted changes so far
        const currentTextInEditor = this.getAcceptedDiffText();

        this.setLoadingState(true);
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'process-follow-up',
                text: currentTextInEditor, // Send text reflecting current accepted state
                prompt: followUpPrompt
            });

            if (response.success && response.diffData && response.diffData.diff_segments) {
                this.renderDiff(response.diffData.diff_segments); // Re-render with new diff
                promptInput.value = ''; // Clear prompt after follow-up
            } else {
                this.showStatus(`Error: ${response.error || 'Failed to get follow-up suggestions.'}`, 'error');
            }
        } catch (error) {
            console.error('Error sending follow-up message:', error);
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

        // Generate a single replacement object covering the original selection
        const replacement = {
            start: 0, // Start of the original selection (relative)
            end: this.selectedContext.text.length, // End of the original selection (relative)
            text: finalText
        };

        try {
            // Directly call applyReplacements with the single calculated change
            this.applyReplacements([replacement]);
            this.closeModal();
        } catch (error) {
            // applyReplacements should handle its own errors/status
            console.error("Error during final application:", error);
            // Optionally show status here too
            this.showStatus('Failed to apply changes. Check console.', 'error');
        }
    }

    // --- Text Selection and Replacement Logic (Modified) ---

    getSelectionContext() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;

        const activeElement = document.activeElement;
        const tagName = activeElement ? activeElement.tagName.toUpperCase() : null;

        let context = null;

        // --- Handle Input / Textarea Selection --- 
        if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
            const text = activeElement.value.substring(activeElement.selectionStart, activeElement.selectionEnd);
            // Only return context if there is actually selected text
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

        // --- Handle Standard DOM Selection (if not in input/textarea or no text selected in input) --- 
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

            // We need start/end relative to the element for replacement
            // Calculate start/end relative to the parentElement textContent if possible
            // This simple calculation might be inaccurate for complex structures
            let selectionStart = 0;
            let selectionEnd = 0;
            try {
                const tempRange = document.createRange();
                tempRange.selectNodeContents(parentElement);
                tempRange.setEnd(range.startContainer, range.startOffset);
                selectionStart = tempRange.toString().length;
                selectionEnd = selectionStart + text.length; // Approximate end based on selected text length
            } catch (e) {
                console.warn("Could not accurately calculate selection offsets relative to parent.", e);
                // Fallback using potentially unreliable offsets
                selectionStart = range.startOffset;
                selectionEnd = range.endOffset;
            }

            context = {
                text,
                fullText: parentElement.textContent, // Get text content of the block
                selectionStart: selectionStart, // Offset relative to parentElement.textContent
                selectionEnd: selectionEnd,   // Offset relative to parentElement.textContent
                element: parentElement,
                range: range.cloneRange(), // Keep original range for reference if needed
                isInput: false
            };
        }

        return context;
    }

    applyReplacements(replacements) {
        // This function now receives a list of replacements (often just one)
        // calculated by the modal logic, relative to the original selection.
        if (!this.selectedContext) {
            console.error("ApplyReplacements called without selection context.");
            // Maybe show status? If modal is closed, not possible.
            return;
        }

        const isInput = this.selectedContext.isInput;
        const targetElement = this.selectedContext.element;
        const originalSelectionStart = this.selectedContext.selectionStart; // Start within the element
        const originalSelectionEnd = this.selectedContext.selectionEnd;   // End within the element

        try {
            // Sort replacements in reverse order (though likely only one)
            replacements.sort((a, b) => b.start - a.start);

            if (isInput) {
                // --- Handle Textarea/Input using .value --- 
                let currentValue = targetElement.value;
                for (const replacement of replacements) {
                    // Indices from replacement are relative to the original *selection*.
                    // Convert them to be relative to the start of the element's value.
                    const absoluteStart = originalSelectionStart + replacement.start;
                    const absoluteEnd = originalSelectionStart + replacement.end;

                    // Validate absolute indices
                    if (absoluteStart < 0 || absoluteEnd < 0 || absoluteStart > currentValue.length || absoluteEnd > currentValue.length || absoluteStart > absoluteEnd) {
                        console.warn("Skipping invalid replacement indices for input/textarea:", replacement, "->", { absoluteStart, absoluteEnd }, "for value length:", currentValue.length);
                        continue;
                    }
                    // Apply replacement using adjusted absolute indices
                    currentValue = currentValue.slice(0, absoluteStart) + replacement.text + currentValue.slice(absoluteEnd);
                }
                targetElement.value = currentValue;
                // Optionally, try to re-select the modified text
                targetElement.setSelectionRange(originalSelectionStart, originalSelectionStart + replacements.reduce((len, r) => len + r.text.length, 0));

            } else {
                // --- Handle ContentEditable / Standard Elements using Range --- 
                // We have ONE replacement covering the whole original selection. 
                // Need to re-establish the range for the original selection.
                if (!this.selectedContext.range) {
                    throw new Error("Cannot apply replacement: Original range missing.")
                }

                const originalRange = this.selectedContext.range.cloneRange();

                // Assume only one replacement is passed for non-input elements
                if (replacements.length === 1 && replacements[0].start === 0) {
                    const replacementText = replacements[0].text;
                    originalRange.deleteContents();
                    if (replacementText) {
                        const newTextNode = document.createTextNode(replacementText);
                        originalRange.insertNode(newTextNode);
                        // Select the newly inserted text
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
            // Selection context is cleared by the calling function (handleApplyChanges) or closeModal

        } catch (error) {
            console.error('Error applying final replacements:', error);
            // Re-throw error so the calling function can handle status updates
            throw error;
        }
    }
}

// Initialize the editor
const aiEditor = new AIEditor(); 