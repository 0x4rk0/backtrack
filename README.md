# Backtrack

Backtrack is a local browser capture tool. A Firefox or Chrome extension saves page text, screenshots, and related metadata to a local Node.js server so you can review and search what you visited.

## Requirements

- Node.js 18 or newer
- npm
- Firefox or Chrome/Chromium
- Git

## Get Started

1. Clone the repo and enter the project folder:

```sh
git clone https://github.com/0x4rk0/backtrack.git
cd backtrack
```

2. Install project metadata:

```sh
npm install
```

3. Build the browser add-ons:

```sh
npm run build:extensions
```

4. Start the local server:

```sh
npm start
```

5. Open the local web UI:

```text
http://127.0.0.1:4317
```

## Install the Browser Add-on

### Firefox

1. Open:

```text
about:debugging#/runtime/this-firefox
```

2. Click `Load Temporary Add-on`
3. Select `manifest.json` located in `/extension/dist/firefox/`

### Chrome or Chromium

1. Open:

```text
chrome://extensions
```

2. Turn on `Developer mode`
3. Click `Load unpacked`
4. Select `extension/dist/chrome`

## First Use

1. Leave `npm start` running
2. Open a normal `http://` or `https://` page in the browser with the add-on loaded
3. Wait a moment for the page to be captured
4. Return to `http://127.0.0.1:4317`
5. Use `Recent`, `Flagged`, or `Images captured` to review saved captures

## Stored Data

Backtrack saves local capture data in `data/backtrack/`:

- `index.json` stores capture metadata
- `captures/*.txt` stores extracted page text
- `captures/*.html` stores static page snapshots
- `captures/*.png` stores screenshots
- `captures/*-images/` stores downloaded JPG/PNG page images
- `settings.json` stores local product settings

## Privacy

Backtrack stores page text and screenshots locally. Treat `data/backtrack/` as sensitive and do not commit it.
