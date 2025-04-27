// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
    // Load API Key and Custom Instructions
    chrome.storage.sync.get(['apiKey', 'customInstructions'], (result) => {
        if (result.apiKey) {
            document.getElementById('apiKey').value = result.apiKey;
        }
        if (result.customInstructions) {
            document.getElementById('customInstructions').value = result.customInstructions;
        }
    });
});

// Save settings
document.getElementById('save').addEventListener('click', () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const customInstructions = document.getElementById('customInstructions').value.trim();
    const status = document.getElementById('status');

    // API Key is still required
    if (!apiKey) {
        showStatus('Please enter an API key', 'error');
        return;
    }

    console.log("Saving API Key (options.js):", apiKey);

    // Save both settings
    chrome.storage.sync.set({ apiKey, customInstructions }, () => {
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