[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/codybernardy)
# Backtrack

Backtrack is a local browser capture tool. A Firefox or Chrome extension saves page text, screenshots, and related metadata to a local Node.js server so you can review and search what you visited.

<img width="1440" height="780" alt="Screenshot 2026-05-21 at 22 11 47" src="https://github.com/user-attachments/assets/de1c1130-49dc-451c-b9f6-b3de668bd49f" />

<img width="1245" height="674" alt="Screenshot 2026-05-21 at 22 25 11" src="https://github.com/user-attachments/assets/65829468-8d99-4f51-95e1-70d61ced6788" />

<img width="1434" height="786" alt="Screenshot 2026-05-21 at 22 12 07" src="https://github.com/user-attachments/assets/c7437d6a-6fa2-417b-b26c-f5a2a91c0444" />


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
