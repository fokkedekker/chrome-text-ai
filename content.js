class AIEditor {
    constructor() {
        this.selectedText = '';
        this.selectedElement = null;
        this.selectedRange = null;
        this.editorModal = null;
        this.originalContext = null;  // Store complete selection context
        this.init();
    }

    init() {
        // Listen for the keyboard shortcut message from background script
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'open-editor') {
                this.handleEditorOpen();
            }
        });

        // Track text selection
        document.addEventListener('mouseup', () => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            if (selectedText && !this.isInModal(selection.anchorNode)) {
                // Store complete selection context
                this.originalContext = {
                    text: selectedText,
                    element: selection.anchorNode.parentElement,
                    range: selection.getRangeAt(0).cloneRange(),
                    startContainer: selection.anchorNode,
                    startOffset: selection.anchorOffset,
                    endContainer: selection.focusNode,
                    endOffset: selection.focusOffset
                };

                // Keep these for backward compatibility
                this.selectedText = selectedText;
                this.selectedElement = selection.anchorNode.parentElement;
                this.selectedRange = selection.getRangeAt(0).cloneRange();
            }
        });
    }

    isInModal(node) {
        let current = node;
        while (current) {
            if (current.className === 'ai-editor-modal') {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }

    createEditorModal() {
        const modal = document.createElement('div');
        modal.className = 'ai-editor-modal';
        modal.innerHTML = `
            <div class="ai-editor-content">
                <textarea class="ai-editor-prompt" placeholder="Enter your prompt..."></textarea>
                <div class="ai-editor-status" style="display: none; margin: 10px 0; color: #666;"></div>
                <div class="ai-editor-buttons">
                    <button class="ai-editor-submit">Submit</button>
                    <button class="ai-editor-cancel">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.editorModal = modal;

        // Add event listeners
        const submitButton = modal.querySelector('.ai-editor-submit');
        const cancelButton = modal.querySelector('.ai-editor-cancel');
        const promptInput = modal.querySelector('.ai-editor-prompt');
        const statusDiv = modal.querySelector('.ai-editor-status');

        submitButton.addEventListener('click', async () => {
            const prompt = promptInput.value.trim();
            if (!prompt) {
                this.showStatus('Please enter a prompt', 'error');
                return;
            }

            try {
                submitButton.disabled = true;
                this.showStatus('Processing...', 'info');

                const response = await chrome.runtime.sendMessage({
                    action: 'process-text',
                    text: this.originalContext.text,
                    prompt: prompt
                });

                if (response.success) {
                    this.applyDiffToOriginal(response.result);
                    this.closeModal();
                } else {
                    this.showStatus(`Error: ${response.error}`, 'error');
                }
            } catch (error) {
                console.error('Error:', error);
                this.showStatus('An error occurred while processing the text', 'error');
            } finally {
                submitButton.disabled = false;
            }
        });

        cancelButton.addEventListener('click', () => this.closeModal());
    }

    applyDiffToOriginal(newText) {
        try {
            if (!this.originalContext) {
                throw new Error('No original selection context found');
            }

            // Create the diff elements
            const diffContainer = document.createElement('span');
            diffContainer.className = 'ai-diff-container';

            const deletedSpan = document.createElement('span');
            deletedSpan.className = 'ai-deleted-text';
            deletedSpan.textContent = this.originalContext.text;

            const addedSpan = document.createElement('span');
            addedSpan.className = 'ai-added-text';
            addedSpan.textContent = newText;

            diffContainer.appendChild(deletedSpan);
            diffContainer.appendChild(addedSpan);

            // Special handling for different input types
            if (this.originalContext.element.tagName === 'INPUT' ||
                this.originalContext.element.tagName === 'TEXTAREA') {

                const input = this.originalContext.element;
                const startPos = input.selectionStart;
                const endPos = input.selectionEnd;
                const currentValue = input.value;

                // Insert the diff container at the selection point
                const beforeText = currentValue.substring(0, startPos);
                const afterText = currentValue.substring(endPos);

                // Create a temporary container to hold everything
                const tempContainer = document.createElement('div');
                tempContainer.appendChild(document.createTextNode(beforeText));
                tempContainer.appendChild(diffContainer);
                tempContainer.appendChild(document.createTextNode(afterText));

                // Replace the input's content
                input.innerHTML = tempContainer.innerHTML;
            } else {
                // For regular content-editable or other elements
                // Restore the original selection
                const range = this.originalContext.range;
                range.deleteContents();
                range.insertNode(diffContainer);
            }

            // Scroll the changes into view
            diffContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        } catch (error) {
            console.error('Error applying diff:', error);
            this.showStatus('Failed to apply changes to the original text', 'error');
        }
    }

    showStatus(message, type = 'info') {
        const statusDiv = this.editorModal.querySelector('.ai-editor-status');
        statusDiv.style.display = 'block';
        statusDiv.style.color = type === 'error' ? '#dc3545' : '#666';
        statusDiv.textContent = message;
    }

    handleEditorOpen() {
        if (!this.originalContext) {
            alert('Please select some text first');
            return;
        }

        if (!this.editorModal) {
            this.createEditorModal();
        }
        this.editorModal.style.display = 'flex';

        // Clear previous status and focus the prompt input
        const statusDiv = this.editorModal.querySelector('.ai-editor-status');
        statusDiv.style.display = 'none';
        this.editorModal.querySelector('.ai-editor-prompt').focus();
    }

    closeModal() {
        if (this.editorModal) {
            this.editorModal.style.display = 'none';
            this.editorModal.querySelector('.ai-editor-prompt').value = '';
        }
    }
}

// Initialize the editor
new AIEditor(); 