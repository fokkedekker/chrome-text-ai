// Listen for keyboard command
chrome.commands.onCommand.addListener((command) => {
    if (command === 'open-editor') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'open-editor' });
        });
    }
});

// Handle API communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'process-text') {
        processTextWithSambaNova(request.text, request.prompt)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Required for async response
    }
});

async function processTextWithSambaNova(text, prompt) {
    const API_ENDPOINT = 'https://api.sambanova.ai/v1/chat/completions';

    try {
        // Get API key from storage
        const result = await chrome.storage.sync.get(['apiKey']);
        if (!result.apiKey) {
            throw new Error('Please set your API key in the extension settings');
        }

        const requestBody = {
            stream: false,
            model: 'Llama-3.1-Swallow-70B-Instruct-v0.3',
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful assistant that modifies text based on user instructions. Only respond with the modified text, without any additional commentary or explanations.'
                },
                {
                    role: 'user',
                    content: `Please modify the following text according to these instructions: ${prompt}\n\nText to modify: ${text}`
                }
            ]
        };

        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${result.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const assistantMessage = data.choices[0].message.content;
        return assistantMessage.trim();
    } catch (error) {
        console.error('SambaNova API Error:', error);
        throw error;
    }
} 