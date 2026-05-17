# backtrack

backtrack is a local OSINT webpage memory tool. A Chrome or Firefox extension scans pages as you browse, sends extracted text and a screenshot to a local Node.js server, and the server gives you a searchable web UI with the original URL, title, capture time, matching text, and screenshot.

Screenshots capture the current visible browser viewport.

The server also supports flagged names and phrases. Add entries such as names, handles, companies, or keywords in the web UI. When a flagged phrase appears on a captured page, backtrack highlights it on the page before capture and stores it in a dedicated flagged section with context.

Use the hamburger menu in the web UI to sort findings by newest, oldest, domain, or title. The same menu can clear existing captured findings while keeping your flagged phrase list.

## Start the Local Server

```sh
npm start
```

The server listens on `http://127.0.0.1:4317` by default. Set `BACKTRACK_PORT` to use another port.

Captured data is stored locally in `data/backtrack/`:

- `index.json` stores capture metadata.
- `captures/*.txt` stores extracted page text.
- `captures/*.png` stores screenshots.

## Build the Browser Add-ons

```sh
npm run build:extensions
```

Load the generated extension directories:

- Chrome: `extension/dist/chrome`
- Firefox: `extension/dist/firefox`

Both add-ons send page captures to `http://127.0.0.1:4317/api/captures`.

## Flag Names and Phrases

1. Start the server with `npm start`.
2. Open `http://127.0.0.1:4317`.
3. Add one flagged name or phrase per line.
4. Browse normally with the extension enabled.
5. Open the **Flagged** tab to review captures containing those phrases.

The browser add-on also places a small backtrack status pill on webpages. Click it to manually save the current page.

## Privacy Notes

backtrack stores the text of pages you visit and screenshots of the visible tab. Treat `data/backtrack/` as sensitive. Do not commit captured data.
