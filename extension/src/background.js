const SERVER_ORIGIN = "http://127.0.0.1:4317";
const CAPTURES_URL = `${SERVER_ORIGIN}/api/captures`;
const PHRASES_URL = `${SERVER_ORIGIN}/api/phrases`;
const BLOCKED_SITES_URL = `${SERVER_ORIGIN}/api/blocked-sites`;
const DEBUG_MODE = "__BACKTRACK_DEBUG__";
const DEBUG_ENABLED = DEBUG_MODE === "1" || DEBUG_MODE === "true" || DEBUG_MODE === "full";
const DEBUG_FULL = DEBUG_MODE === "full";
const captureCache = new Map();
let phraseCache = { phrases: [], loadedAt: 0 };
let blockedSiteCache = { blockedSites: [], loadedAt: 0 };

function debugPayload(label, payload) {
  if (!DEBUG_ENABLED) {
    return;
  }

  const text = String(payload.text || "");
  const html = String(payload.html || "");
  const screenshot = String(payload.screenshot || "");
  const summary = {
    ...payload,
    textLength: text.length,
    textPreview: text.slice(0, 500),
    text: DEBUG_FULL ? text : `[hidden in summary mode: ${text.length} chars]`,
    htmlLength: html.length,
    htmlPreview: html.slice(0, 500),
    html: DEBUG_FULL ? html : `[hidden in summary mode: ${html.length} chars]`,
    screenshotLength: screenshot.length,
    screenshot: DEBUG_FULL ? screenshot : screenshot ? "[hidden data URL]" : null
  };
  console.debug(`[backtrack] ${label}`, summary);
}

async function phrases() {
  if (Date.now() - phraseCache.loadedAt < 30_000) {
    return phraseCache.phrases;
  }

  try {
    const response = await fetch(PHRASES_URL);
    const payload = await response.json();
    phraseCache = { phrases: payload.phrases || [], loadedAt: Date.now() };
  } catch (error) {
    phraseCache = { phrases: phraseCache.phrases, loadedAt: Date.now() };
  }

  return phraseCache.phrases;
}

async function blockedSites() {
  if (Date.now() - blockedSiteCache.loadedAt < 30_000) {
    return blockedSiteCache.blockedSites;
  }

  try {
    const response = await fetch(BLOCKED_SITES_URL);
    const payload = await response.json();
    blockedSiteCache = { blockedSites: payload.blockedSites || [], loadedAt: Date.now() };
  } catch (error) {
    blockedSiteCache = {
      blockedSites: blockedSiteCache.blockedSites,
      loadedAt: Date.now()
    };
  }

  return blockedSiteCache.blockedSites;
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

async function shouldBlockUrl(url) {
  if (isLocalhost(url)) {
    return true;
  }

  const sites = await blockedSites();
  return sites.some((site) => siteMatches(url, site));
}

async function captureViewport(sender) {
  if (!sender.tab || typeof sender.tab.windowId !== "number") {
    return { screenshot: null, screenshotMeta: null };
  }

  return new Promise((resolve) => {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (dataUrl) => {
      const screenshot = chrome.runtime.lastError ? null : dataUrl;
      resolve({
        screenshot,
        screenshotMeta: {
          width: sender.tab.width || null,
          height: sender.tab.height || null,
          complete: true,
          mode: "viewport"
        }
      });
    });
  });
}

function cacheKey(payload) {
  return `${payload.url}\n${payload.text.length}`;
}

function shouldSkipCapture(payload) {
  if (payload.source === "manual") {
    return false;
  }
  const key = cacheKey(payload);
  const lastCaptured = captureCache.get(key);
  if (lastCaptured && Date.now() - lastCaptured < 60_000) {
    return true;
  }
  captureCache.set(key, Date.now());
  return false;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "BACKTRACK_GET_PHRASES") {
    phrases().then((items) => sendResponse({ phrases: items }));
    return true;
  }

  if (message && message.type === "BACKTRACK_GET_BLOCKED_SITES") {
    blockedSites().then((items) => sendResponse({ blockedSites: items }));
    return true;
  }

  if (!message || message.type !== "BACKTRACK_CAPTURE") {
    return false;
  }

  const payload = message.payload;
  if (isLocalhost(payload.url)) {
    sendResponse({ skipped: true, blocked: true });
    return false;
  }
  if (shouldSkipCapture(payload)) {
    sendResponse({ skipped: true });
    return false;
  }

  shouldBlockUrl(payload.url)
    .then((blocked) => {
      if (blocked) {
        sendResponse({ skipped: true, blocked: true });
        return null;
      }

      return captureViewport(sender)
        .catch(() => ({ screenshot: null, screenshotMeta: { complete: false, mode: "viewport" } }))
        .then(({ screenshot, screenshotMeta }) => {
          const requestPayload = { ...payload, screenshot, screenshotMeta };
          debugPayload("background request to server", requestPayload);
          return fetch(CAPTURES_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestPayload)
          });
        })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}));
          return {
            saved: response.status === 201,
            skipped: Boolean(body.skipped),
            blocked: Boolean(body.blocked),
            status: response.status
          };
        });
    })
    .then((result) => {
      if (result) {
        sendResponse(result);
      }
    })
    .catch(() => sendResponse({ saved: false }));

  return true;
});
