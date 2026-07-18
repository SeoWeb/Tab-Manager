# Build and Test Instructions for Chrome Extension

This document provides instructions on how to build the TabSpace Chrome Extension and load it for testing in Google Chrome.

## Prerequisites

- Node.js and npm installed (version specified in `package.json` or latest LTS).
- Google Chrome browser.

## Build Steps

1.  **Install Dependencies:**
    If you haven't already, open your terminal in the project root and run:

    ```bash
    npm install
    ```

2.  **Build the Extension:**
    Run the build script:
    ```bash
    npm run build
    ```
    This command will compile the Next.js application and export it as static files to the `build/` directory in the project root.

## Loading the Extension in Chrome

1.  **Open Chrome Extensions Page:**
    Open Google Chrome, type `chrome://extensions` in the address bar, and press Enter.

2.  **Enable Developer Mode:**
    In the top right corner of the Extensions page, toggle the "Developer mode" switch to the ON position.

3.  **Load Unpacked Extension:**
    - Click the "Load unpacked" button that appears after enabling Developer mode.
    - A file dialog will open. Navigate to the project's root directory and select the `build/` folder.
    - Click "Select Folder" (or "Open").

4.  **Verify the Extension:**
    - The "TabSpace (Next.js)" extension should now appear in your list of extensions.
    - **Test New Tab Page:** Open a new tab in Chrome. It should display the content from the extension (you should see the "TabSpace Extension - Main View" heading).
    - **Test Browser Action (Popup):** Click on the TabSpace extension icon in the Chrome toolbar (it might be under the "puzzle piece" extensions icon). The popup should appear, also displaying the main view.

## Development Notes

- After making changes to the source code (`src/` directory), you will need to re-run `npm run build` and then reload the extension in `chrome://extensions` (you can usually click the refresh icon on the extension card).
- Ensure there are no errors displayed for the extension on the `chrome://extensions` page. If there are, they might provide clues for debugging.
