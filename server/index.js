const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.BACKTRACK_PORT || 4317);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "backtrack");
const CAPTURE_DIR = path.join(DATA_DIR, "captures");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const PHRASES_FILE = path.join(DATA_DIR, "phrases.json");
const PUBLIC_DIR = path.join(ROOT, "server", "public");

const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

function ensureStore() {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_FILE)) {
    fs.writeFileSync(INDEX_FILE, "[]\n");
  }
  if (!fs.existsSync(PHRASES_FILE)) {
    fs.writeFileSync(PHRASES_FILE, "[]\n");
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

function domainFor(row) {
  try {
    return new URL(row.url).hostname.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
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
    const url = String(payload.url || "");
    if (!/^https?:\/\//i.test(url)) {
      sendJson(res, 400, { error: "url must be http or https" });
      return;
    }

    const text = normalizeText(payload.text);
    if (!text) {
      sendJson(res, 400, { error: "text is required" });
      return;
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const textPath = path.join(CAPTURE_DIR, `${id}.txt`);
    fs.writeFileSync(textPath, `${text}\n`);

    const row = {
      id,
      url,
      title: safeTitle(payload.title),
      createdAt,
      textFile: `/captures/${id}.txt`,
      screenshotFile: writeScreenshot(id, payload.screenshot),
      screenshotMeta: payload.screenshotMeta || null,
      textLength: text.length,
      matches: cleanMatches(payload.matches)
    };

    const rows = readIndex();
    rows.unshift(row);
    writeIndex(rows.slice(0, 10000));
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
    } else if (req.method === "POST" && url.pathname === "/api/clear") {
      clearCaptures();
      sendJson(res, 200, { ok: true });
    } else if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/phrases") {
      handlePhrases(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/flagged") {
      handleFlagged(req, res);
    } else {
      handleStatic(req, res, url);
    }
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`backtrack listening on http://127.0.0.1:${PORT}`);
  });
