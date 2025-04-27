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
            .then(diffData => {
                sendResponse({ success: true, diff: diffData.diff_segments });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (request.action === 'request-ai-edit') {
        processFollowUpWithSambaNova(request.originalText, request.diffHistory, request.prompt)
            .then(diffData => {
                sendResponse({ success: true, diff: diffData.diff_segments });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else {
    }
});

// Initial processing function
async function processTextWithSambaNova(text, prompt) {
    const API_ENDPOINT = 'https://api.sambanova.ai/v1/chat/completions';

    try {
        // Fetch API Key and Custom Instructions
        const settings = await chrome.storage.sync.get(['apiKey', 'customInstructions']);
        if (!settings.apiKey) {
            throw new Error('Please set your API key in the extension settings');
        }
        // Trim the key to remove potential leading/trailing whitespace
        const apiKey = settings.apiKey.trim();
        const customInstructions = settings.customInstructions || ''; // Default to empty string if not set

        // Base system prompt
        let systemPrompt = `You are a text editing assistant performing changes based on user instructions.
1. Analyze the provided text and the user's instructions.
2. Return ONLY a JSON object describing the changes with the following structure:
{
    "diff_segments": [
        { "type": "equal", "text": "Unchanged text segment" },
        { "type": "delete", "text": "Text segment to be deleted" },
        { "type": "insert", "text": "Text segment to be added" }
    ]
}
- Ensure the segments cover the entire resulting text when concatenated.
- Represent the difference between the input text and the result of applying the instructions.
Do not include any other text, explanations, or markdown formatting. Just the JSON.`;

        // Append custom instructions if they exist
        if (customInstructions) {
            systemPrompt += `\n\nIMPORTANT: Always adhere to the following custom instructions provided by the user:\n${customInstructions}`;
        }

        let userContent = `Original text: "${text}"\nInstructions: ${prompt}\n\nRespond with diff_segments JSON only.`;

        const requestBody = {
            stream: false,
            model: 'Meta-Llama-3.3-70B-Instruct',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt // Use the potentially modified system prompt
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
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("API Error Response:", errorBody);
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
            console.error("Unexpected API response structure:", data);
            throw new Error('Invalid response structure from AI API');
        }
        const assistantMessage = data.choices[0].message.content;

        try {
            const cleanedJsonString = assistantMessage.replace(/```json\n?([\s\S]*?)\n?```/g, '$1').trim();
            const diffResult = JSON.parse(cleanedJsonString);
            if (!diffResult || !Array.isArray(diffResult.diff_segments)) {
                throw new Error('AI response is missing the diff_segments array or is not valid JSON.');
            }
            return diffResult;
        } catch (e) {
            console.error("Failed to parse AI response:", assistantMessage, e);
            throw new Error(`Failed to parse AI response as JSON diff segments: ${e.message}`);
        }
    } catch (error) {
        // Simplify logging back
        console.error('SambaNova API Error (Initial):', error);
        throw error; // Restore throwing the error
    }
}

// Function for handling follow-up edits with history
async function processFollowUpWithSambaNova(originalText, diffHistory, newPrompt) {
    const API_ENDPOINT = 'https://api.sambanova.ai/v1/chat/completions';

    try {
        // Fetch API Key and Custom Instructions
        const settings = await chrome.storage.sync.get(['apiKey', 'customInstructions']);
        if (!settings.apiKey) {
            throw new Error('Please set your API key in the extension settings (follow-up)');
        }
        const apiKey = settings.apiKey.trim();
        const customInstructions = settings.customInstructions || ''; // Default to empty string

        // Base system prompt for follow-up
        let systemPrompt = `You are a text editing assistant performing changes based on user instructions.
1. You are given the ORIGINAL text, a history of previously proposed changes (delete/insert segments) with their accepted/rejected status, and NEW instructions.
2. Your goal is to generate a NEW set of diff segments (relative to the ORIGINAL text) that incorporates the user's feedback (accepted/rejected changes) and fulfills the NEW instructions.
3. Base your response on the ORIGINAL text, modifying it according to the accepted changes from the history AND the new instructions.
4. Return ONLY a JSON object describing the *new* changes compared to the *original* text with the following structure:
{
    "diff_segments": [
        { "type": "equal", "text": "Unchanged part of the original text" },
        { "type": "delete", "text": "Part of the original text to be deleted now" },
        { "type": "insert", "text": "New text to be added" }
    ]
}
- Ensure the segments cover the entire final text when applied to the original.
- 'delete' segments refer to text present in the original but not the final output.
- 'insert' segments refer to text present in the final output but not the original.
- 'equal' segments refer to text present in both the original and the final output after all changes.
Do not include any other text, explanations, or markdown formatting. Just the JSON.`;

        // Append custom instructions if they exist
        if (customInstructions) {
            systemPrompt += `\n\nIMPORTANT: Always adhere to the following custom instructions provided by the user:\n${customInstructions}`;
        }

        // Construct user message including the history
        let userContent = `Original text: "${originalText}"\n`;

        // Serialize the diff history for the prompt
        let historyString = diffHistory.map(seg => {
            const status = seg.accepted ? '[Accepted]' : '[Rejected]';
            return `${status} ${seg.type}: "${seg.text}"`;
        }).join('\n');

        userContent += `Previous Changes Attempt (relative to original, with user decisions):
${historyString}\n\n`;
        userContent += `New Instructions: ${newPrompt}\n\nRespond with new diff_segments JSON relative to the ORIGINAL text, considering the history and new instructions.`;

        const requestBody = {
            stream: false,
            model: 'Meta-Llama-3.3-70B-Instruct',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt // Use the potentially modified system prompt
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
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("API Error Response (Follow-up):", errorBody);
            throw new Error(`API request failed (Follow-up): ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
            console.error("Unexpected API response structure (Follow-up):", data);
            throw new Error('Invalid response structure from AI API (Follow-up)');
        }
        const assistantMessage = data.choices[0].message.content;

        try {
            const cleanedJsonString = assistantMessage.replace(/```json\n?([\s\S]*?)\n?```/g, '$1').trim();
            const diffResult = JSON.parse(cleanedJsonString);
            if (!diffResult || !Array.isArray(diffResult.diff_segments)) {
                throw new Error('AI response is missing the diff_segments array or is not valid JSON (Follow-up).');
            }
            return diffResult;
        } catch (e) {
            console.error("Failed to parse AI response (Follow-up):", assistantMessage, e);
            throw new Error(`Failed to parse AI response as JSON diff segments (Follow-up): ${e.message}`);
        }
    } catch (error) {
        // Simplify logging back
        console.error('SambaNova API Error (Follow-up):', error);
        throw error; // Restore throwing the error
    }
} 