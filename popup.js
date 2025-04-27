// State management
let state = {
    originalText: '',
    currentText: '',
    lines: [],
    approvedLines: new Set(),
    conversationHistory: [],
    isProcessing: false
};

// Initialize when popup opens
document.addEventListener('DOMContentLoaded', async () => {
    // Get the selected text from the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getSelectedText' });

    if (response && response.text) {
        state.originalText = response.text;
        state.currentText = response.text;
        state.lines = splitIntoLines(response.text);
        renderTextContainer();
    }

    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('sendButton').addEventListener('click', handleSendToAI);
    document.getElementById('applyButton').addEventListener('click', handleApplyChanges);
    document.getElementById('promptInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleSendToAI();
        }
    });
}

function splitIntoLines(text) {
    return text.split('\n').map((content, index) => ({
        id: index,
        content,
        type: 'unchanged',
        approved: false
    }));
}

function renderTextContainer() {
    const container = document.getElementById('textContainer');
    container.innerHTML = '';

    state.lines.forEach(line => {
        const lineElement = document.createElement('div');
        lineElement.className = 'text-line';

        const contentElement = document.createElement('div');
        contentElement.className = `text-content ${line.type}`;
        contentElement.textContent = line.content;

        const approveButton = document.createElement('button');
        approveButton.className = 'approve-button';
        approveButton.textContent = '✓';
        approveButton.disabled = line.type === 'unchanged' || line.approved;
        approveButton.onclick = () => approveLine(line.id);

        lineElement.appendChild(contentElement);
        if (line.type !== 'unchanged') {
            lineElement.appendChild(approveButton);
        }

        container.appendChild(lineElement);
    });
}

function approveLine(lineId) {
    const line = state.lines[lineId];
    if (line && line.type !== 'unchanged') {
        line.approved = true;
        state.approvedLines.add(lineId);
        renderTextContainer();
    }
}

async function handleSendToAI() {
    const promptInput = document.getElementById('promptInput');
    const prompt = promptInput.value.trim();

    if (!prompt) return;

    try {
        setLoading(true);
        setStatus('');

        // Get API key from storage
        const { apiKey } = await chrome.storage.sync.get('apiKey');
        if (!apiKey) {
            setStatus('Please set your API key in the extension settings', 'error');
            return;
        }

        // Send to background script for API call
        const response = await chrome.runtime.sendMessage({
            action: 'processText',
            text: state.currentText,
            prompt: prompt,
            apiKey: apiKey
        });

        if (response.error) {
            throw new Error(response.error);
        }

        // Update conversation history
        state.conversationHistory.push({
            prompt,
            response: response.text
        });

        // Process the differences
        const diffs = calculateDiffs(state.currentText, response.text);
        updateLinesWithDiffs(diffs);

        // Clear prompt input
        promptInput.value = '';

        // Update UI
        renderTextContainer();
        renderConversationHistory();

    } catch (error) {
        setStatus(error.message, 'error');
    } finally {
        setLoading(false);
    }
}

function calculateDiffs(oldText, newText) {
    // Implement diff algorithm here
    // For now, we'll use a simple line-by-line comparison
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    return newLines.map((newLine, index) => {
        const oldLine = oldLines[index] || '';
        if (newLine === oldLine) {
            return { type: 'unchanged', content: newLine };
        }
        return { type: 'added', content: newLine };
    });
}

function updateLinesWithDiffs(diffs) {
    state.lines = diffs.map((diff, index) => ({
        id: index,
        content: diff.content,
        type: diff.type,
        approved: false
    }));
}

async function handleApplyChanges() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Construct final text from approved changes
        const finalText = state.lines
            .map(line => line.approved || line.type === 'unchanged' ? line.content : state.originalText.split('\n')[line.id])
            .join('\n');

        // Send the final text back to the content script
        await chrome.tabs.sendMessage(tab.id, {
            action: 'replaceText',
            text: finalText
        });

        setStatus('Changes applied successfully!', 'success');

        // Reset state
        state.originalText = finalText;
        state.currentText = finalText;
        state.lines = splitIntoLines(finalText);
        state.approvedLines.clear();
        renderTextContainer();

    } catch (error) {
        setStatus('Failed to apply changes: ' + error.message, 'error');
    }
}

function renderConversationHistory() {
    const container = document.getElementById('conversationHistory');
    container.innerHTML = state.conversationHistory
        .map(item => `
            <div class="history-item">
                <div class="history-prompt">${escapeHtml(item.prompt)}</div>
            </div>
        `)
        .join('');
}

function setLoading(isLoading) {
    state.isProcessing = isLoading;
    document.getElementById('loading').style.display = isLoading ? 'block' : 'none';
    document.getElementById('sendButton').disabled = isLoading;
}

function setStatus(message, type = 'success') {
    const statusElement = document.getElementById('status');
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
    statusElement.style.display = message ? 'block' : 'none';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

document.getElementById('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
}); 