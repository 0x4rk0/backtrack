const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.BACKTRACK_PORT || 4317);
const DEBUG_MODE = process.env.BACKTRACK_DEBUG || "";
const DEBUG_ENABLED = DEBUG_MODE === "1" || DEBUG_MODE === "true" || DEBUG_MODE === "full";
const DEBUG_FULL = DEBUG_MODE === "full";
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "backtrack");
const CAPTURE_DIR = path.join(DATA_DIR, "captures");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const PHRASES_FILE = path.join(DATA_DIR, "phrases.json");
const BLOCKED_SITES_FILE = path.join(DATA_DIR, "blocked-sites.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const PUBLIC_DIR = path.join(ROOT, "server", "public");
const DEFAULT_SETTINGS = {
  saveImages: true,
  maxImagesPerCapture: 24,
  captureDelayMs: 900,
  proxyUrl: "",
  density: "comfortable",
  accentColor: "#0b6f85"
};

const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};
const eventClients = new Set();

function ensureStore() {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_FILE)) {
    fs.writeFileSync(INDEX_FILE, "[]\n");
  }
  if (!fs.existsSync(PHRASES_FILE)) {
    fs.writeFileSync(PHRASES_FILE, "[]\n");
  }
  if (!fs.existsSync(BLOCKED_SITES_FILE)) {
    fs.writeFileSync(BLOCKED_SITES_FILE, "[]\n");
  }
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`);
  }
}

function readIndex() {
  ensureStore();
  return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
}

function writeIndex(rows) {
  fs.writeFileSync(INDEX_FILE, `${JSON.stringify(rows, null, 2)}\n`);
}

function readPhrases() {
  ensureStore();
  return JSON.parse(fs.readFileSync(PHRASES_FILE, "utf8"));
}

function writePhrases(phrases) {
  const cleaned = [...new Set(phrases.map((phrase) => String(phrase).trim()).filter(Boolean))];
  fs.writeFileSync(PHRASES_FILE, `${JSON.stringify(cleaned, null, 2)}\n`);
  return cleaned;
}

function readBlockedSites() {
  ensureStore();
  return JSON.parse(fs.readFileSync(BLOCKED_SITES_FILE, "utf8"));
}

function writeBlockedSites(sites) {
  const cleaned = [
    ...new Set(
      sites
        .map((site) => String(site).trim().toLowerCase())
        .map((site) => site.replace(/^https?:\/\//, "").replace(/\/$/, ""))
        .filter(Boolean)
    )
  ];
  fs.writeFileSync(BLOCKED_SITES_FILE, `${JSON.stringify(cleaned, null, 2)}\n`);
  return cleaned;
}

function readSettings() {
  ensureStore();
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings) {
  const current = readSettings();
  const next = {
    ...current,
    saveImages: Boolean(settings.saveImages),
    maxImagesPerCapture: Math.max(0, Math.min(Number(settings.maxImagesPerCapture) || 0, 100)),
    captureDelayMs: Math.max(250, Math.min(Number(settings.captureDelayMs) || DEFAULT_SETTINGS.captureDelayMs, 10000)),
    proxyUrl: String(settings.proxyUrl || "").trim(),
    density: ["compact", "comfortable", "spacious"].includes(settings.density) ? settings.density : "comfortable",
    accentColor: /^#[0-9a-f]{6}$/i.test(String(settings.accentColor || ""))
      ? String(settings.accentColor)
      : DEFAULT_SETTINGS.accentColor
  };
  fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function domainFor(row) {
  try {
    return new URL(row.url).hostname.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

function hostnameFor(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (error) {
    return "";
  }
}

function normalizedUrl(url) {
  try {
    return new URL(url).href.toLowerCase();
  } catch (error) {
    return String(url || "").toLowerCase();
  }
}

function isLocalhost(url) {
  const hostname = hostnameFor(url);
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function siteMatches(url, site) {
  const rule = String(site || "").trim().toLowerCase();
  if (!rule) {
    return false;
  }

  const hostname = hostnameFor(url);
  if (!hostname) {
    return false;
  }

  if (rule.includes("/")) {
    return normalizedUrl(url).includes(rule);
  }

  const domain = rule.replace(/^\*\./, "");
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isBlockedUrl(url) {
  return isLocalhost(url) || readBlockedSites().some((site) => siteMatches(url, site));
}

function sortRows(rows, sort) {
  const sorted = [...rows];
  if (sort === "oldest") {
    sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } else if (sort === "domain") {
    sorted.sort((a, b) => {
      const domainCompare = domainFor(a).localeCompare(domainFor(b));
      if (domainCompare !== 0) {
        return domainCompare;
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  } else if (sort === "title") {
    sorted.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  } else {
    sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  return sorted;
}

function sendJson(res, statusCode, value) {
  res.writeHead(statusCode, JSON_HEADERS);
  res.end(JSON.stringify(value));
}

function sendEvent(res, event, value) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(value)}\n\n`);
}

function broadcastEvent(event, value) {
  for (const res of eventClients) {
    sendEvent(res, event, value);
  }
}

function handleEvents(req, res) {
  res.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no"
  });
  res.write(": connected\n\n");
  eventClients.add(res);
  req.on("close", () => {
    eventClients.delete(res);
  });
}

function debugCapture(payload) {
  if (!DEBUG_ENABLED) {
    return;
  }

  const text = String(payload.text || "");
  const html = String(payload.html || "");
  const screenshot = String(payload.screenshot || "");
  const summary = {
    url: payload.url,
    title: payload.title,
    source: payload.source,
    metrics: payload.metrics || null,
    matches: payload.matches || [],
    screenshotMeta: payload.screenshotMeta || null,
    textLength: text.length,
    textPreview: text.slice(0, 500),
    text: DEBUG_FULL ? text : `[hidden in summary mode: ${text.length} chars]`,
    htmlLength: html.length,
    htmlPreview: html.slice(0, 500),
    html: DEBUG_FULL ? html : `[hidden in summary mode: ${html.length} chars]`,
    screenshotLength: screenshot.length,
    screenshot: DEBUG_FULL ? screenshot : screenshot ? "[hidden data URL]" : null
  };
  console.log(`[backtrack] received capture\n${JSON.stringify(summary, null, 2)}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function safeTitle(title) {
  return String(title || "Untitled").slice(0, 300);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function writeScreenshot(id, screenshot) {
  if (!screenshot || typeof screenshot !== "string") {
    return null;
  }

  const match = screenshot.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!match) {
    return null;
  }

  const ext = match[1] === "jpeg" ? "jpg" : "png";
  const filename = `${id}.${ext}`;
  fs.writeFileSync(path.join(CAPTURE_DIR, filename), Buffer.from(match[2], "base64"));
  return `/captures/${filename}`;
}

function resolveImageUrl(value, pageUrl) {
  try {
    const parsed = new URL(value, pageUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }
    if (!/\.(png|jpe?g)([?#].*)?$/i.test(parsed.href)) {
      return "";
    }
    return parsed.href;
  } catch (error) {
    return "";
  }
}

function extractImageUrls(html, pageUrl) {
  if (!html || typeof html !== "string") {
    return [];
  }

  const urls = [];
  const attrPattern = /\s(?:src|href)=["']([^"']+)["']/gi;
  const srcsetPattern = /\ssrcset=["']([^"']+)["']/gi;
  let match;
  while ((match = attrPattern.exec(html))) {
    urls.push(resolveImageUrl(match[1], pageUrl));
  }
  while ((match = srcsetPattern.exec(html))) {
    for (const candidate of match[1].split(",")) {
      urls.push(resolveImageUrl(candidate.trim().split(/\s+/)[0], pageUrl));
    }
  }

  return [...new Set(urls.filter(Boolean))];
}

function proxiedUrl(url, proxyUrl) {
  if (!proxyUrl) {
    return url;
  }
  if (proxyUrl.includes("{url}")) {
    return proxyUrl.replace("{url}", encodeURIComponent(url));
  }
  const separator = proxyUrl.includes("?") ? "&" : "?";
  return `${proxyUrl}${separator}url=${encodeURIComponent(url)}`;
}

async function fetchImage(url, settings) {
  const response = await fetch(proxiedUrl(url, settings.proxyUrl), {
    headers: {
      "Accept": "image/png,image/jpeg;q=0.9,*/*;q=0.1",
      "User-Agent": "backtrack-local-capture/0.1"
    },
    redirect: "follow"
  });
  if (!response.ok) {
    return null;
  }

  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!["image/png", "image/jpeg"].includes(type)) {
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
    return null;
  }

  return {
    buffer,
    ext: type === "image/png" ? "png" : "jpg",
    type
  };
}

async function writePageImages(id, pageUrl, html, settings) {
  if (!settings.saveImages || !settings.maxImagesPerCapture) {
    return [];
  }

  const imageUrls = extractImageUrls(html, pageUrl).slice(0, settings.maxImagesPerCapture);
  const saved = [];
  const imageDir = path.join(CAPTURE_DIR, `${id}-images`);
  for (const imageUrl of imageUrls) {
    try {
      const image = await fetchImage(imageUrl, settings);
      if (!image) {
        continue;
      }
      const filename = `${crypto.createHash("sha1").update(imageUrl).digest("hex").slice(0, 16)}.${image.ext}`;
      fs.mkdirSync(imageDir, { recursive: true });
      fs.writeFileSync(path.join(imageDir, filename), image.buffer);
      saved.push({
        sourceUrl: imageUrl,
        file: `/captures/${id}-images/${filename}`,
        type: image.type,
        bytes: image.buffer.length
      });
    } catch (error) {
      if (DEBUG_ENABLED) {
        console.log(`[backtrack] image fetch failed: ${imageUrl} (${error.message})`);
      }
    }
  }
  return saved;
}

function writeSnapshot(id, html) {
  if (!html || typeof html !== "string") {
    return null;
  }

  const cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
  const filename = `${id}.html`;
  fs.writeFileSync(path.join(CAPTURE_DIR, filename), cleaned);
  return `/captures/${filename}`;
}

function readerHtml(row, text) {
  const paragraphs = normalizeText(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(row.title || row.url)} - backtrack capture</title>
    <style>
      :root { color-scheme: light; --ink: #18202a; --muted: #657282; --line: #d9dee6; --bg: #f6f7f9; --panel: #fff; }
      body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.65 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(860px, calc(100% - 32px)); margin: 32px auto; }
      header { margin-bottom: 22px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
      h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.2; }
      .meta { color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; }
      a { color: #084f5f; }
      article { padding: 24px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
      p { margin: 0 0 1em; overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>${escapeHtml(row.title || row.url)}</h1>
        <div class="meta">${escapeHtml(new Date(row.createdAt).toLocaleString())} &middot; ${escapeHtml(row.url)}</div>
        <div class="actions">
          <a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">Original page</a>
          <a href="${escapeHtml(row.textFile)}" target="_blank" rel="noreferrer">Raw text</a>
          ${row.screenshotFile ? `<a href="${escapeHtml(row.screenshotFile)}" target="_blank" rel="noreferrer">Screenshot</a>` : ""}
          ${row.htmlFile ? `<a href="${escapeHtml(row.htmlFile)}" target="_blank" rel="noreferrer">Static HTML snapshot</a>` : ""}
        </div>
      </header>
      ${row.screenshotFile ? `<p><img src="${escapeHtml(row.screenshotFile)}" alt="" style="width:100%;height:auto;border:1px solid var(--line);border-radius:8px;background:#eef1f4;"></p>` : ""}
      <article>
        ${paragraphs || "<p>No readable text was captured.</p>"}
      </article>
    </main>
  </body>
</html>`;
}

function captureViewHtml(row) {
  const images = Array.isArray(row.imageFiles) ? row.imageFiles : [];
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(row.title || row.url)} - backtrack view</title>
    <style>
      :root { color-scheme: light; --ink: #18202a; --muted: #657282; --line: #d9dee6; --bg: #f6f7f9; --panel: #fff; }
      body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(1280px, calc(100% - 32px)); margin: 28px auto; }
      header { margin-bottom: 16px; }
      h1 { margin: 0 0 6px; font-size: 26px; line-height: 1.2; }
      .meta { color: var(--muted); overflow-wrap: anywhere; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
      a { color: #084f5f; }
      .grid { display: grid; grid-template-columns: minmax(320px, 0.9fr) minmax(420px, 1.1fr); gap: 16px; align-items: start; }
      section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
      h2 { margin: 0; padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 15px; }
      img { display: block; width: 100%; height: auto; background: #eef1f4; }
      iframe { display: block; width: 100%; height: 78vh; border: 0; background: #fff; }
      .images { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; padding: 12px; }
      .images img { aspect-ratio: 1 / 1; object-fit: cover; border: 1px solid var(--line); border-radius: 6px; }
      .empty { padding: 18px; color: var(--muted); }
      @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } iframe { height: 70vh; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>${escapeHtml(row.title || row.url)}</h1>
        <div class="meta">${escapeHtml(new Date(row.createdAt).toLocaleString())} &middot; ${escapeHtml(row.url)}</div>
        <div class="actions">
          <a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">Original page</a>
          <a href="${escapeHtml(row.readerFile || `/reader/${row.id}`)}" target="_blank" rel="noreferrer">Readable text</a>
          <a href="${escapeHtml(row.textFile)}" target="_blank" rel="noreferrer">Raw text</a>
        </div>
      </header>
      <div class="grid">
        <section>
          <h2>Captured screenshot</h2>
          ${row.screenshotFile ? `<a href="${escapeHtml(row.screenshotFile)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(row.screenshotFile)}" alt=""></a>` : `<div class="empty">No screenshot was captured.</div>`}
        </section>
        <section>
          <h2>Static local snapshot</h2>
          ${row.htmlFile ? `<iframe src="${escapeHtml(row.htmlFile)}" sandbox=""></iframe>` : `<div class="empty">No HTML snapshot was captured.</div>`}
        </section>
      </div>
      <section style="margin-top:16px;">
        <h2>Saved page images</h2>
        ${images.length ? `<div class="images">${images.map((image) => `<a href="${escapeHtml(image.file)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(image.file)}" alt=""></a>`).join("")}</div>` : `<div class="empty">No JPG or PNG page images were saved.</div>`}
      </section>
    </main>
  </body>
</html>`;
}

function handleCaptureView(req, res, id) {
  const row = readIndex().find((item) => item.id === id);
  if (!row) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(captureViewHtml(row));
}

function handleReader(req, res, id) {
  const row = readIndex().find((item) => item.id === id);
  if (!row) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const textPath = path.join(CAPTURE_DIR, `${id}.txt`);
  if (!fs.existsSync(textPath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(readerHtml(row, fs.readFileSync(textPath, "utf8")));
}

function clearCaptures() {
  writeIndex([]);
  if (fs.existsSync(CAPTURE_DIR)) {
    for (const entry of fs.readdirSync(CAPTURE_DIR)) {
      fs.rmSync(path.join(CAPTURE_DIR, entry), { force: true });
    }
  }
}

function cleanMatches(matches) {
  if (!Array.isArray(matches)) {
    return [];
  }

  return matches
    .map((match) => ({
      phrase: String(match.phrase || "").slice(0, 200),
      snippet: String(match.snippet || "").slice(0, 800),
      rects: Array.isArray(match.rects)
        ? match.rects.slice(0, 20).map((rect) => ({
            x: Number(rect.x) || 0,
            y: Number(rect.y) || 0,
            width: Number(rect.width) || 0,
            height: Number(rect.height) || 0
          }))
        : []
    }))
    .filter((match) => match.phrase);
}

async function handleCreateCapture(req, res) {
  try {
    const payload = JSON.parse(await readBody(req));
    debugCapture(payload);
    const url = String(payload.url || "");
    if (!/^https?:\/\//i.test(url)) {
      sendJson(res, 400, { error: "url must be http or https" });
      return;
    }
    if (isBlockedUrl(url)) {
      sendJson(res, 202, { skipped: true, blocked: true });
      return;
    }

    const text = normalizeText(payload.text);
    if (!text) {
      sendJson(res, 400, { error: "text is required" });
      return;
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const settings = readSettings();
    const textPath = path.join(CAPTURE_DIR, `${id}.txt`);
    fs.writeFileSync(textPath, `${text}\n`);

    const row = {
      id,
      url,
      title: safeTitle(payload.title),
      createdAt,
      textFile: `/captures/${id}.txt`,
      readerFile: `/reader/${id}`,
      viewFile: `/view/${id}`,
      htmlFile: writeSnapshot(id, payload.html),
      screenshotFile: writeScreenshot(id, payload.screenshot),
      imageFiles: await writePageImages(id, url, payload.html, settings),
      screenshotMeta: payload.screenshotMeta || null,
      textLength: text.length,
      matches: cleanMatches(payload.matches)
    };

    const rows = readIndex();
    rows.unshift(row);
    writeIndex(rows.slice(0, 10000));
    if (row.screenshotFile) {
      broadcastEvent("screenshot", {
        id: row.id,
        url: row.url,
        screenshotFile: row.screenshotFile,
        createdAt: row.createdAt
      });
    }
    sendJson(res, 201, row);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function handlePhrases(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, { phrases: readPhrases() });
    return;
  }

  readBody(req)
    .then((body) => {
      const payload = JSON.parse(body);
      sendJson(res, 200, { phrases: writePhrases(payload.phrases || []) });
    })
    .catch((error) => sendJson(res, 400, { error: error.message }));
}

function handleBlockedSites(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, { blockedSites: readBlockedSites() });
    return;
  }

  readBody(req)
    .then((body) => {
      const payload = JSON.parse(body);
      sendJson(res, 200, { blockedSites: writeBlockedSites(payload.blockedSites || []) });
    })
    .catch((error) => sendJson(res, 400, { error: error.message }));
}

function handleSettings(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, { settings: readSettings() });
    return;
  }

  readBody(req)
    .then((body) => {
      const payload = JSON.parse(body);
      sendJson(res, 200, { settings: writeSettings(payload.settings || {}) });
    })
    .catch((error) => sendJson(res, 400, { error: error.message }));
}

function handleFlagged(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const phraseFilter = (url.searchParams.get("phrase") || "").trim().toLowerCase();
  const sort = url.searchParams.get("sort") || "newest";
  const rows = readIndex();
  const results = [];

  for (const row of rows) {
    const matches = (row.matches || []).filter(
      (match) => !phraseFilter || match.phrase.toLowerCase() === phraseFilter
    );
    if (matches.length) {
      results.push({ ...row, matches });
    }
  }

  sendJson(res, 200, { results: sortRows(results, sort) });
}

function makeSnippet(text, query) {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + query.length + 180);
  const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "..." : ""}${snippet}${end < text.length ? "..." : ""}`;
}

function handleSearch(req, res, url) {
  const query = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
  const sort = url.searchParams.get("sort") || "newest";
  if (!query) {
    sendJson(res, 200, { query, results: [] });
    return;
  }

  const results = [];
  for (const row of readIndex()) {
    const textPath = path.join(CAPTURE_DIR, `${row.id}.txt`);
    if (!fs.existsSync(textPath)) {
      continue;
    }

    const text = fs.readFileSync(textPath, "utf8");
    if (
      text.toLowerCase().includes(query.toLowerCase()) ||
      row.title.toLowerCase().includes(query.toLowerCase()) ||
      row.url.toLowerCase().includes(query.toLowerCase())
    ) {
      results.push({
        ...row,
        snippet: text.toLowerCase().includes(query.toLowerCase())
          ? makeSnippet(text, query)
          : ""
      });
    }

    if (results.length >= limit) {
      break;
    }
  }

  sendJson(res, 200, { query, results: sortRows(results, sort) });
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg")) return "image/jpeg";
  if (filePath.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  });
}

function handleStatic(req, res, url) {
  const viewMatch = url.pathname.match(/^\/view\/([0-9a-f-]+)$/i);
  if (viewMatch) {
    handleCaptureView(req, res, viewMatch[1]);
    return;
  }

  const readerMatch = url.pathname.match(/^\/reader\/([0-9a-f-]+)$/i);
  if (readerMatch) {
    handleReader(req, res, readerMatch[1]);
    return;
  }

  if (url.pathname.startsWith("/captures/")) {
    const filePath = path.join(DATA_DIR, url.pathname);
    if (!filePath.startsWith(CAPTURE_DIR)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    serveFile(res, filePath);
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(PUBLIC_DIR, requested);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  serveFile(res, filePath);
}

ensureStore();

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
    } else if (req.method === "POST" && url.pathname === "/api/captures") {
      handleCreateCapture(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/search") {
      handleSearch(req, res, url);
    } else if (req.method === "GET" && url.pathname === "/api/recent") {
      sendJson(res, 200, {
        results: sortRows(readIndex(), url.searchParams.get("sort") || "newest").slice(0, 50)
      });
    } else if (req.method === "GET" && url.pathname === "/api/events") {
      handleEvents(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/clear") {
      clearCaptures();
      sendJson(res, 200, { ok: true });
    } else if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/phrases") {
      handlePhrases(req, res);
    } else if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/blocked-sites") {
      handleBlockedSites(req, res);
    } else if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/settings") {
      handleSettings(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/flagged") {
      handleFlagged(req, res);
    } else {
      handleStatic(req, res, url);
    }
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`backtrack listening on http://127.0.0.1:${PORT}`);
    if (DEBUG_ENABLED) {
      console.log(`backtrack debug logging enabled (${DEBUG_FULL ? "full payloads" : "summaries"})`);
    }
  });
