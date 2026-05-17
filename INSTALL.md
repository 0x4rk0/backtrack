# backtrack Install Guide

This guide explains how to download, set up, and run backtrack locally.

## Requirements

- Node.js 18 or newer
- npm
- Chrome, Chromium, Firefox, or another compatible browser
- Git, if you are downloading with `git clone`

Check Node and npm:

```sh
node --version
npm --version
```

## Download backtrack

Clone the repository:

```sh
git clone <repository-url>
cd backtrack
```

If you downloaded a ZIP file instead, unzip it and open a terminal in the extracted `backtrack` folder.

## Install Project Metadata

backtrack currently uses only Node.js built-in modules, so there are no runtime dependencies to install. Run this once to verify npm can read the project:

```sh
npm install
```

## Build the Browser Add-ons

Generate the Chrome and Firefox extension folders:

```sh
npm run build:extensions
```

This creates:

- `extension/dist/chrome`
- `extension/dist/firefox`

## Start the Local Server

Start backtrack:

```sh
npm start
```

The server runs at:

```text
http://127.0.0.1:4317
```

Keep this terminal window open while using the browser add-on.

To use a different port:

```sh
BACKTRACK_PORT=5000 npm start
```

If you change the port, also update `SERVER_URL` in `extension/src/background.js` and rebuild the extensions.

## Install in Chrome or Chromium

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select `extension/dist/chrome`.
5. Confirm the backtrack extension appears in the extensions list.

## Install in Firefox

For temporary local use:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `extension/dist/firefox/manifest.json`.
4. Confirm the backtrack extension appears in the temporary extensions list.

Firefox temporary add-ons are removed when Firefox restarts, so load it again after restarting the browser.

## Verify It Works

1. Make sure the server is running with `npm start`.
2. Open a normal `http://` or `https://` webpage.
3. Wait a second after the page finishes loading.
4. Visit `http://127.0.0.1:4317`.
5. Search for a word, name, phrase, or URL from the page.

Search results include:

- Page title
- Original URL
- Capture time
- Matching text snippet
- Link to the captured text
- Screenshot of the visible tab, when browser permissions allow it

Screenshots capture the current visible browser viewport. backtrack does not scroll the page while capturing.

## Add OSINT Flags

backtrack can watch for names, handles, companies, phrases, or other OSINT indicators.

1. Visit `http://127.0.0.1:4317`.
2. Enter one flagged name or phrase per line in **Flagged names and phrases**.
3. Click **Save Flags**.
4. Browse normally with the extension enabled.
5. Return to `http://127.0.0.1:4317` and open **Flagged**.

When a flagged phrase appears on a captured page, backtrack highlights the text in the page before capture and stores:

- The phrase that matched
- A context snippet
- The source URL
- The capture time
- The captured text file
- The screenshot of the visible viewport

The add-on places a small backtrack status pill on webpages. Click it to manually save the current page.

## Stored Data

Captured data is stored locally in:

```text
data/backtrack/
```

Important files:

- `data/backtrack/index.json` stores capture metadata.
- `data/backtrack/phrases.json` stores flagged names and phrases.
- `data/backtrack/captures/*.txt` stores extracted webpage text.
- `data/backtrack/captures/*.png` stores screenshots.

This directory may contain sensitive browsing data. Do not commit it or share it casually.

## Stop backtrack

In the terminal running the server, press:

```text
Ctrl+C
```

## Clear Captured Findings

Open `http://127.0.0.1:4317`, click the hamburger menu, then click **Clear Findings**.

This deletes captured metadata, text files, and screenshots from `data/backtrack/captures/`. It keeps your flagged names and phrases.

The same menu also sorts results by newest, oldest, domain, or title.

## Updating backtrack

If installed from Git:

```sh
git pull
npm install
npm run build:extensions
npm start
```

After rebuilding extensions, reload the browser add-on from the browser extensions page.

## Reload the Add-on After Changes

You do not need to reinstall Chrome every time. If backtrack source files changed:

```sh
npm run build:extensions
```

Then reload the existing unpacked add-on:

- Chrome: open `chrome://extensions`, find backtrack, click the reload icon.
- Firefox temporary add-on: open `about:debugging#/runtime/this-firefox`, remove backtrack, then load `extension/dist/firefox/manifest.json` again.

Firefox temporary add-ons do not survive browser restarts. Chrome unpacked extensions normally do, but they still need a reload after rebuilding files.

## Troubleshooting

If no captures appear:

- Confirm `npm start` is still running.
- Confirm the browser extension is loaded and enabled.
- Confirm the page URL starts with `http://` or `https://`.
- Open `http://127.0.0.1:4317` directly to confirm the server UI loads.
- Rebuild with `npm run build:extensions` after changing extension source files.

If the browser blocks a screenshot:

- Reload the webpage and try again.
- Confirm the extension has tab permissions.
- Some browser pages, extension pages, and internal settings pages cannot be captured.
