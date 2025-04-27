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
    if (request.action === 'process-text' || request.action === 'process-follow-up') {
        // Use the same function for initial processing and follow-ups
        // Follow-ups might need more context, handled in the prompt below
        processTextWithSambaNova(request.text, request.prompt, request.action === 'process-follow-up')
            .then(diffData => sendResponse({ success: true, diffData: diffData })) // Send back diffData
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Required for async response
    }
    // Handle other actions if needed
});

async function processTextWithSambaNova(text, prompt, isFollowUp = false) {
    const API_ENDPOINT = 'https://api.sambanova.ai/v1/chat/completions';

    try {
        const result = await chrome.storage.sync.get(['apiKey']);
        if (!result.apiKey) {
            throw new Error('Please set your API key in the extension settings');
        }

        // Construct user message, adding context for follow-ups
        let userContent = `Original text: "${text}"\nInstructions: ${prompt}\n\nRespond with diff_segments JSON only.`;
        if (isFollowUp) {
            userContent = `Current text (potentially modified from original): "${text}"\nFollow-up Instructions: ${prompt}\n\nRespond with new diff_segments JSON based on the CURRENT text and follow-up instructions.`;
        }

        const requestBody = {
            stream: false,
            model: 'Meta-Llama-3.3-70B-Instruct', // Or your preferred model
            messages: [
                {
                    role: 'system',
                    content: `You are a text editing assistant performing changes based on user instructions.
1. Analyze the provided text and the user's instructions.
2. Return ONLY a JSON object describing the changes with the following structure:
{
    "diff_segments": [
        { "type": "equal", "text": "Unchanged text segment" },
        { "type": "delete", "text": "Text segment to be deleted" },
        { "type": "insert", "text": "Text segment to be added" }
        // ... more segments in sequence to reconstruct the final text
    ]
}
- Ensure the segments cover the entire resulting text when concatenated.
- Represent the difference between the input text and the result of applying the instructions.
- 'delete' segments refer to text present in the input but not the output.
- 'insert' segments refer to text present in the output but not the input.
- 'equal' segments refer to text present in both.
Do not include any other text, explanations, or markdown formatting. Just the JSON.`
                },
                {
                    role: 'user',
                    content: userContent
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
            const errorBody = await response.text();
            console.error("API Error Response:", errorBody);
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        // Check for errors in the API response structure
        if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
            console.error("Unexpected API response structure:", data);
            throw new Error('Invalid response structure from AI API');
        }
        const assistantMessage = data.choices[0].message.content;

        // Parse the JSON response
        try {
            // Remove potential markdown code fences
            const cleanedJsonString = assistantMessage.replace(/```json\n?([\s\S]*?)\n?```/g, '$1').trim();
            const result = JSON.parse(cleanedJsonString);
            if (!result || !Array.isArray(result.diff_segments)) {
                throw new Error('AI response is missing the diff_segments array or is not valid JSON.');
            }
            // Return the entire object containing the diff_segments array
            return result;
        } catch (e) {
            console.error("Failed to parse AI response:", assistantMessage, e);
            throw new Error(`Failed to parse AI response as JSON diff segments: ${e.message}`);
        }
    } catch (error) {
        console.error('SambaNova API Error:', error);
        throw error; // Re-throw to be caught by the caller
    }
} 