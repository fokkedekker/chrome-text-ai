document.addEventListener('DOMContentLoaded', () => {
    const openOptionsButton = document.getElementById('openOptionsButton');

    if (openOptionsButton) {
        openOptionsButton.addEventListener('click', () => {
            // Check if the function exists (available in Chrome 42+)
            if (chrome.runtime.openOptionsPage) {
                chrome.runtime.openOptionsPage();
            } else {
                // Fallback for older Chrome versions or other browsers
                window.open(chrome.runtime.getURL('options.html'));
            }
            window.close(); // Close the popup after clicking the button
        });
    } else {
        console.error("Options button not found in popup.html");
    }
});

// All previous functions related to getting text, sending to AI,
// applying changes, rendering diffs, handling history, etc.,
// can be removed as they are no longer used in this simplified popup. 