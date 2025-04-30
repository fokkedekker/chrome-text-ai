// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
    // Load API Key, Custom Instructions, and Custom Buttons
    chrome.storage.sync.get([
        'apiKey', 'customInstructions',
        'customButton1Label', 'customButton1Prompt',
        'customButton2Label', 'customButton2Prompt',
        'customButton3Label', 'customButton3Prompt'
    ], (result) => {
        if (result.apiKey) {
            document.getElementById('apiKey').value = result.apiKey;
        }
        if (result.customInstructions) {
            document.getElementById('customInstructions').value = result.customInstructions;
        }
        // Load button 1
        if (result.customButton1Label) {
            document.getElementById('customButton1Label').value = result.customButton1Label;
        }
        if (result.customButton1Prompt) {
            document.getElementById('customButton1Prompt').value = result.customButton1Prompt;
        }
        // Load button 2
        if (result.customButton2Label) {
            document.getElementById('customButton2Label').value = result.customButton2Label;
        }
        if (result.customButton2Prompt) {
            document.getElementById('customButton2Prompt').value = result.customButton2Prompt;
        }
        // Load button 3
        if (result.customButton3Label) {
            document.getElementById('customButton3Label').value = result.customButton3Label;
        }
        if (result.customButton3Prompt) {
            document.getElementById('customButton3Prompt').value = result.customButton3Prompt;
        }
    });
});

// Save settings
document.getElementById('save').addEventListener('click', () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const customInstructions = document.getElementById('customInstructions').value.trim();
    const status = document.getElementById('status');

    // Get custom button values
    const customButton1Label = document.getElementById('customButton1Label').value.trim();
    const customButton1Prompt = document.getElementById('customButton1Prompt').value.trim();
    const customButton2Label = document.getElementById('customButton2Label').value.trim();
    const customButton2Prompt = document.getElementById('customButton2Prompt').value.trim();
    const customButton3Label = document.getElementById('customButton3Label').value.trim();
    const customButton3Prompt = document.getElementById('customButton3Prompt').value.trim();

    // API Key is still required
    if (!apiKey) {
        showStatus('Please enter an API key', 'error');
        return;
    }

    console.log("Saving API Key (options.js):", apiKey);

    // Save all settings
    chrome.storage.sync.set({
        apiKey,
        customInstructions,
        customButton1Label,
        customButton1Prompt,
        customButton2Label,
        customButton2Prompt,
        customButton3Label,
        customButton3Prompt
    }, () => {
        // Check for errors during save
        if (chrome.runtime.lastError) {
            console.error("Error saving settings:", chrome.runtime.lastError);
            showStatus(`Error saving settings: ${chrome.runtime.lastError.message}`, 'error');
        } else {
            showStatus('Settings saved successfully!', 'success');
        }
    });
});

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';

    setTimeout(() => {
        status.style.display = 'none';
    }, 3000);
} 