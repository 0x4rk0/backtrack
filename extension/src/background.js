const SERVER_ORIGIN = "http://127.0.0.1:4317";
const CAPTURES_URL = `${SERVER_ORIGIN}/api/captures`;
const PHRASES_URL = `${SERVER_ORIGIN}/api/phrases`;
const captureCache = new Map();
let phraseCache = { phrases: [], loadedAt: 0 };

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

  if (!message || message.type !== "BACKTRACK_CAPTURE") {
    return false;
  }

  const payload = message.payload;
  if (shouldSkipCapture(payload)) {
    sendResponse({ skipped: true });
    return false;
  }

  captureViewport(sender)
    .catch(() => ({ screenshot: null, screenshotMeta: { complete: false, mode: "viewport" } }))
    .then(({ screenshot, screenshotMeta }) =>
      fetch(CAPTURES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, screenshot, screenshotMeta })
      })
    )
    .then(() => sendResponse({ saved: true }))
    .catch(() => sendResponse({ saved: false }));

  return true;
});
