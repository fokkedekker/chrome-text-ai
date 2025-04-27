# AI Text Editor Chrome Extension

This extension allows you to edit selected text on webpages using AI through the SambaNova API.

## Features

*   Select text on any page and open the editor with a keyboard shortcut (Cmd/Ctrl+K).
*   Provide instructions to the AI (e.g., fix grammar, change tone, summarize).
*   Review proposed changes in an interactive diff view.
*   Accept or reject individual changes.
*   Provide follow-up instructions for refinement.
*   Apply the accepted changes back to the webpage.
*   Configure persistent custom instructions for the AI in the settings.
*   Securely store your SambaNova API key.

## Setup

1.  Install the extension.
2.  Right-click the extension icon in your Chrome toolbar and select "Options".
3.  Enter your SambaNova API key in the settings page and click "Save Settings".

## Usage

1.  Select text on a webpage.
2.  Press Cmd+K (Mac) or Ctrl+K (Windows/Linux).
3.  Enter your editing instructions in the modal prompt.
4.  Click "Get Suggestions".
5.  Review the changes, using the ✓/X buttons to accept/reject.
6.  Optionally, provide follow-up instructions and click "Send Follow-up".
7.  Click "Apply Accepted Changes" to modify the text on the page.

---

## Privacy Policy

**Last Updated:** 2025-04-27

This Privacy Policy describes how the AI Text Editor Chrome Extension ("the Extension") handles your information.

**Information We Collect and Use:**

1.  **User-Provided Information:**
    *   **API Key:** We require your SambaNova API key to authenticate requests to the SambaNova API. This key is stored locally and securely within your browser using the `chrome.storage.sync` API. It is only sent directly to the SambaNova API endpoint (`https://api.sambanova.ai`) for authentication purposes when you request an edit.
    *   **Persistent Custom Instructions (Optional):** If you provide persistent custom instructions in the Extension's settings, these instructions are stored locally using `chrome.storage.sync` and are included in the prompts sent to the SambaNova API to guide the AI's behavior according to your preferences.

2.  **Information Processed for Functionality:**
    *   **Selected Text:** When you activate the Extension on selected text, that text is sent to the SambaNova API along with your instructions to generate the suggested edits.
    *   **Editing Instructions:** The specific instructions you provide in the editor modal (including initial and follow-up prompts) are sent to the SambaNova API to guide the editing process.

**How Information is Used:**

The selected text and your instructions (both specific and persistent) are sent to the SambaNova API solely for the purpose of providing the core functionality of the Extension – generating text edits based on your requests. Your API key is used only for authenticating these requests with SambaNova.

The Extension itself does not store your selected text or specific editing instructions after the editing session is complete. Persistent Custom Instructions are stored locally via `chrome.storage.sync` until you change or remove them.

**Information Sharing:**

We share the following information with the third-party service provider, SambaNova (`https://api.sambanova.ai`):

*   Your API Key (for authentication)
*   Selected text from the webpage (for editing context)
*   Your specific and persistent instructions (to guide the AI)

We do not share this information with any other third parties. We do not collect analytics or any other personally identifiable information.

**Security:**

We use the `chrome.storage.sync` API to store your API key and persistent instructions, which provides security within the browser's extension environment. All communication with the SambaNova API occurs over HTTPS.

**Changes to This Privacy Policy:**

We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy within the Extension listing or description.

**Contact Us:**

If you have any questions about this Privacy Policy, please contact Fokke Dekker fokke@dekker.email