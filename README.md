# Backtrack

Backtrack is a local OSINT webpage memory tool. A Chrome or Firefox extension scans pages as you browse, sends extracted text and a screenshot to a local Node.js server, and the server gives you a searchable web UI with the original URL, title, capture time, matching text, saved page images, and screenshot.

The server also supports flagged names and phrases. Add entries such as names, handles, companies, or keywords in the web UI. When a flagged phrase appears on a captured page, backtrack highlights it on the page before capture and stores it in a dedicated flagged section with context.


## Start the Local Server

```sh
npm start
```

The server listens on `http://127.0.0.1:4317` by default. Set `BACKTRACK_PORT` to use another port.

Captured data is stored locally in `data/backtrack/`:

- `index.json` stores capture metadata.
- `captures/*.txt` stores extracted page text.
- `captures/*.html` stores static local page snapshots for new captures.
- `captures/*.png` stores screenshots.
- `captures/*-images/` stores downloaded JPG/PNG page images.
- `settings.json` stores product settings.

## Install browser add-on

- In the Firefox search bar type
```sh
about:debugging#/runtime/this-firefox
Load Temporary Add-on
extension/dist/firefox/manifest.json 
```

## Privacy Notes

backtrack stores the text of pages you visit and screenshots of the visible tab. Treat `data/backtrack/` as sensitive. Do not commit captured data.
