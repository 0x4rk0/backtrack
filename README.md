# backtrack

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/codybernardy) [![YouTube](https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/c/0x4rko) [![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://bit.ly/3YpiZZE)

backtrack is a free and open source OSINT tool. Any support through Buy Me a Coffee is 100% reinvested back into the community through free tools, tutorials, and resources.

backtrack is a local OSINT webpage memory tool. A Chrome or Firefox extension scans pages as you browse, sends extracted text and a screenshot to a local Node.js server, and the server gives you a searchable web UI with the original URL, title, capture time, matching text, saved page images, and screenshot.

Screenshots capture the current visible browser viewport.

The server also supports flagged names and phrases. Add entries such as names, handles, companies, or keywords in the web UI. Matching is case-insensitive. When a flagged phrase appears on a captured page, backtrack highlights it on the page before capture and stores it in a dedicated flagged section with context.

Use the hamburger menu in the web UI to sort findings, clear captures, jump into individual flagged phrases, review blocked sites, and tune product settings such as image saving, capture delay, proxy URL, density, and accent color.

## Start the Local Server

```sh
npm start
```

The server listens on `http://127.0.0.1:4317` by default. Set `BACKTRACK_PORT` to use another port.

Each server start creates a new session directory under `data/sessions/`. The session path is printed to the console on startup:

```
backtrack session: data/sessions/2026-06-14_10-30-00_abc123
```

Each session contains:

- `index.json` — capture metadata
- `captures/*.txt` — extracted page text
- `captures/*.html` — static local page snapshots
- `captures/*.png` — screenshots
- `captures/*-images/` — downloaded JPG/PNG page images
- `phrases.json` — flagged names and phrases
- `blocked-sites.json` — capture block rules
- `settings.json` — product settings

## Build the Browser Add-ons

```sh
npm run build:extensions
```

Load the generated extension directories:

- Chrome: `extension/dist/chrome`
- Firefox: `extension/dist/firefox`

Both add-ons send page captures to `http://127.0.0.1:4317/api/captures`.

To create release packages:

```sh
npm run package:extensions
```

This creates:

- `extension/releases/backtrack-chrome.zip` for Chrome Web Store upload
- `extension/releases/backtrack-firefox.xpi` for Firefox signing or self-distribution after signing

Chrome and Firefox stable releases require signed add-ons for normal install. Use the generated packages for store submission/signing; unpacked local loading is only for development.

## Debug Capture Data

Run the server with debug logging to see capture requests as they arrive:

```sh
BACKTRACK_DEBUG=1 npm start
```

Build the add-ons with the same flag to log payloads in the browser extension console:

```sh
BACKTRACK_DEBUG=1 npm run build:extensions
```

Use `BACKTRACK_DEBUG=full` instead of `1` to print full page text and screenshot data URLs. The default debug mode prints metadata, phrase matches, text length, screenshot length, and a short text preview.

## Flag Names and Phrases

1. Start the server with `npm start`.
2. Open `http://127.0.0.1:4317`.
3. Add one flagged name or phrase per line. Matching is case-insensitive.
4. Browse normally with the extension enabled.
5. Open the **Flagged** tab to review captures containing those phrases.

The browser add-on also places a small backtrack status pill on webpages. Click it to manually save the current page.

New captures include a formatted reader view and a capture view that shows the screenshot beside the static local page snapshot. The dashboard refreshes automatically and groups captures by base URL. The snapshot removes scripts and is meant for review, not for preserving a fully interactive copy of the original site.

When image saving is enabled, the server extracts JPG and PNG URLs from the captured HTML and downloads them into the local capture folder. If a proxy URL is configured in settings, image fetches use that proxy. A proxy URL can include `{url}` as a placeholder, or backtrack appends `?url=<encoded-url>` / `&url=<encoded-url>`.

## Delete Captures

Each capture card includes a **Delete** button that removes that capture and its associated files (text, screenshot, HTML snapshot, downloaded images). To remove all captures at once, use **Clear Findings** in the hamburger menu.

## Block Capture Sites

The add-on never captures `127.0.0.1`, `localhost`, or `[::1]`.

To block more sites, open `http://127.0.0.1:4317` and add one host or URL path per line in **Blocked capture sites**. Examples:

- `example.com` blocks `example.com` and subdomains.
- `example.com/private` blocks URLs containing that path.

## Privacy Notes

backtrack stores the text of pages you visit and screenshots of the visible tab. Captured data lives in `data/sessions/` — one subdirectory per server session. Treat this directory as sensitive. Do not commit captured data.
