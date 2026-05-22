(() => {
  const DEBUG_MODE = "__BACKTRACK_DEBUG__";
  const DEBUG_ENABLED = DEBUG_MODE === "1" || DEBUG_MODE === "true" || DEBUG_MODE === "full";
  const DEBUG_FULL = DEBUG_MODE === "full";
  const MARK_CLASS = "backtrack-highlight";
  const PAUSE_KEY = "backtrackPaused";
  const HIGHLIGHTS_KEY = "backtrackHighlightsEnabled";
  let flaggedPhrases = [];
  let blockedSites = [];
  let settings = { captureDelayMs: 900 };
  let lastMatchCount = 0;
  let captureInFlight = false;
  let statusEl;
  let menuEl;
  let widgetPosition = null;
  let dragState = null;
  let lastDragEndedAt = 0;

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .${MARK_CLASS} {
        background: #fff3a3 !important;
        color: #111827 !important;
        box-shadow:
          0 0 0 2px rgba(10, 26, 42, 0.9),
          0 2px 5px rgba(0, 0, 0, 0.22) !important;
        border-radius: 3px;
        outline: 1px solid rgba(255, 255, 255, 0.9) !important;
      }
      #backtrack-widget {
        position: fixed;
        left: auto;
        top: auto;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
        padding: 0 12px;
        border: 1px solid rgba(8, 79, 95, 0.35);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.96);
        color: #18202a;
        box-shadow: 0 8px 22px rgba(24, 32, 42, 0.22);
        font: 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: grab;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }
      #backtrack-widget.dragging {
        cursor: grabbing;
      }
      #backtrack-widget:hover {
        border-color: rgba(8, 79, 95, 0.8);
      }
      #backtrack-widget[aria-expanded="true"] {
        border-color: rgba(8, 79, 95, 0.8);
      }
      #backtrack-widget-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #0b6f85;
      }
      #backtrack-widget.paused #backtrack-widget-dot {
        background: #a33434;
      }
      #backtrack-widget-label {
        white-space: nowrap;
      }
      #backtrack-widget-caret {
        color: #657282;
        font-size: 11px;
      }
      #backtrack-menu {
        position: fixed;
        left: auto;
        top: auto;
        z-index: 2147483647;
        display: grid;
        gap: 6px;
        width: 190px;
        padding: 8px;
        border: 1px solid rgba(8, 79, 95, 0.28);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 10px 26px rgba(24, 32, 42, 0.22);
        font: 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #backtrack-menu[hidden] {
        display: none;
      }
      #backtrack-menu button {
        min-height: 32px;
        padding: 0 9px;
        border: 1px solid rgba(8, 79, 95, 0.22);
        border-radius: 6px;
        background: #fff;
        color: #18202a;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      #backtrack-menu button:hover {
        background: #edf7fa;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function createWidget() {
    statusEl = document.createElement("button");
    statusEl.id = "backtrack-widget";
    statusEl.type = "button";
    statusEl.title = "backtrack is running. Open controls.";
    statusEl.setAttribute("aria-expanded", "false");
    statusEl.innerHTML = `<span id="backtrack-widget-dot"></span><span id="backtrack-widget-label">backtrack running</span><span id="backtrack-widget-caret">▾</span>`;
    statusEl.addEventListener("pointerdown", beginDrag);
    statusEl.addEventListener("click", toggleMenu);
    document.documentElement.appendChild(statusEl);

    menuEl = document.createElement("div");
    menuEl.id = "backtrack-menu";
    menuEl.hidden = true;
    menuEl.innerHTML = `
      <button type="button" data-action="save">Save this page now</button>
      <button type="button" data-action="highlights"></button>
      <button type="button" data-action="pause"></button>
    `;
    menuEl.addEventListener("click", handleMenuClick);
    document.documentElement.appendChild(menuEl);
    applyWidgetPosition();
    updatePauseUi();
  }

  function applyWidgetPosition() {
    if (!statusEl || !menuEl) {
      return;
    }

    const margin = 18;
    const width = statusEl.offsetWidth || 160;
    const height = statusEl.offsetHeight || 36;
    const left = widgetPosition ? widgetPosition.left : Math.max(margin, window.innerWidth - width - margin);
    const top = widgetPosition ? widgetPosition.top : Math.max(margin, window.innerHeight - height - margin);
    const clampedLeft = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin));
    const clampedTop = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin));
    widgetPosition = { left: clampedLeft, top: clampedTop };

    statusEl.style.left = `${clampedLeft}px`;
    statusEl.style.top = `${clampedTop}px`;
    statusEl.style.right = "auto";
    statusEl.style.bottom = "auto";

    const menuWidth = menuEl.offsetWidth || 190;
    const menuHeight = menuEl.offsetHeight || 90;
    const menuLeft = Math.min(
      Math.max(margin, clampedLeft + width - menuWidth),
      Math.max(margin, window.innerWidth - menuWidth - margin)
    );
    let menuTop = clampedTop - menuHeight - 8;
    if (menuTop < margin) {
      menuTop = Math.min(window.innerHeight - menuHeight - margin, clampedTop + height + 8);
    }

    menuEl.style.left = `${menuLeft}px`;
    menuEl.style.top = `${Math.max(margin, menuTop)}px`;
    menuEl.style.right = "auto";
    menuEl.style.bottom = "auto";
  }

  function beginDrag(event) {
    if (!statusEl) {
      return;
    }
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: widgetPosition ? widgetPosition.left : statusEl.getBoundingClientRect().left,
      originTop: widgetPosition ? widgetPosition.top : statusEl.getBoundingClientRect().top,
      moved: false
    };
    statusEl.classList.add("dragging");
    statusEl.setPointerCapture(event.pointerId);
    statusEl.addEventListener("pointermove", dragWidget);
    statusEl.addEventListener("pointerup", endDrag);
    statusEl.addEventListener("pointercancel", endDrag);
  }

  function dragWidget(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    event.preventDefault();
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
      dragState.moved = true;
    }

    widgetPosition = {
      left: dragState.originLeft + deltaX,
      top: dragState.originTop + deltaY
    };
    applyWidgetPosition();
  }

  function endDrag(event) {
    if (!statusEl || !dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    statusEl.releasePointerCapture(event.pointerId);
    statusEl.classList.remove("dragging");
    statusEl.removeEventListener("pointermove", dragWidget);
    statusEl.removeEventListener("pointerup", endDrag);
    statusEl.removeEventListener("pointercancel", endDrag);

    if (dragState.moved) {
      lastDragEndedAt = Date.now();
    }

    dragState = null;
  }

  function setStatus(text) {
    if (statusEl) {
      statusEl.querySelector("#backtrack-widget-label").textContent = text;
    }
  }

  function isPaused() {
    return sessionStorage.getItem(PAUSE_KEY) === "true";
  }

  function highlightsEnabled() {
    return sessionStorage.getItem(HIGHLIGHTS_KEY) !== "false";
  }

  function setPaused(paused) {
    sessionStorage.setItem(PAUSE_KEY, String(paused));
    updatePauseUi();
  }

  function setHighlightsEnabled(enabled) {
    sessionStorage.setItem(HIGHLIGHTS_KEY, String(enabled));
    updateHighlightUi();
  }

  function updatePauseUi() {
    if (!statusEl || !menuEl) {
      return;
    }

    const paused = isPaused();
    statusEl.classList.toggle("paused", paused);
    menuEl.querySelector('[data-action="pause"]').textContent = paused
      ? "Resume automatic capture"
      : "Pause automatic capture";
    if (paused) {
      clearHighlights();
      setStatus("backtrack paused");
    }
  }

  function updateHighlightUi() {
    if (!menuEl) {
      return;
    }

    const enabled = highlightsEnabled();
    menuEl.querySelector('[data-action="highlights"]').textContent = enabled
      ? "Hide text highlights"
      : "Show text highlights";

    if (enabled && !isPaused()) {
      lastMatchCount = highlightPhrases(flaggedPhrases);
    } else {
      clearHighlights();
    }
  }

  function toggleMenu() {
    if (!menuEl || !statusEl) {
      return;
    }
    if (Date.now() - lastDragEndedAt < 250) {
      return;
    }
    applyWidgetPosition();
    menuEl.hidden = !menuEl.hidden;
    statusEl.setAttribute("aria-expanded", String(!menuEl.hidden));
  }

  function handleMenuClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    if (button.dataset.action === "save") {
      menuEl.hidden = true;
      statusEl.setAttribute("aria-expanded", "false");
      sendCapture("manual");
    } else if (button.dataset.action === "highlights") {
      setHighlightsEnabled(!highlightsEnabled());
      menuEl.hidden = true;
      statusEl.setAttribute("aria-expanded", "false");
      if (!isPaused()) {
        setStatus(
          highlightsEnabled() && lastMatchCount
            ? `backtrack · ${lastMatchCount} marked`
            : "backtrack running"
        );
      }
    } else if (button.dataset.action === "pause") {
      setPaused(!isPaused());
      menuEl.hidden = true;
      statusEl.setAttribute("aria-expanded", "false");
      if (!isPaused()) {
        setStatus(lastMatchCount ? `backtrack · ${lastMatchCount} marked` : "backtrack running");
      }
    }
  }

  window.addEventListener("resize", applyWidgetPosition);

  function visibleText() {
    const clone = document.body ? document.body.cloneNode(true) : null;
    if (!clone) {
      return "";
    }

    clone
      .querySelectorAll("script, style, noscript, svg, canvas, #backtrack-widget, #backtrack-menu")
      .forEach((node) => node.remove());

    return clone.innerText.replace(/\s+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  }

  function snapshotHtml() {
    const clone = document.documentElement ? document.documentElement.cloneNode(true) : null;
    if (!clone) {
      return "";
    }

    clone
      .querySelectorAll("script, noscript, iframe, object, embed, #backtrack-widget, #backtrack-menu")
      .forEach((node) => node.remove());

    clone.querySelectorAll("*").forEach((node) => {
      for (const attribute of [...node.attributes]) {
        if (/^on/i.test(attribute.name)) {
          node.removeAttribute(attribute.name);
        }
      }
    });

    const head = clone.querySelector("head") || clone.insertBefore(document.createElement("head"), clone.firstChild);
    const base = document.createElement("base");
    base.href = location.href;
    head.insertBefore(base, head.firstChild);

    const meta = document.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", "script-src 'none'; object-src 'none'; base-uri *");
    head.insertBefore(meta, base.nextSibling);

    return `<!doctype html>\n${clone.outerHTML}`;
  }

  function viewportMetrics() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    };
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
    return isLocalhost(url) || blockedSites.some((site) => siteMatches(url, site));
  }

  function debugPayload(label, payload) {
    if (!DEBUG_ENABLED) {
      return;
    }

    const text = String(payload.text || "");
    const html = String(payload.html || "");
    const summary = {
      ...payload,
      textLength: text.length,
      textPreview: text.slice(0, 500),
      text: DEBUG_FULL ? text : `[hidden in summary mode: ${text.length} chars]`,
      htmlLength: html.length,
      htmlPreview: html.slice(0, 500),
      html: DEBUG_FULL ? html : `[hidden in summary mode: ${html.length} chars]`
    };
    console.debug(`[backtrack] ${label}`, summary);
  }

  function textNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (
          !parent ||
          parent.closest(`#backtrack-widget, #backtrack-menu, .${MARK_CLASS}`) ||
          ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT"].includes(parent.tagName)
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  function snippetFor(text, phrase) {
    const index = text.toLowerCase().indexOf(phrase.toLowerCase());
    if (index === -1) {
      return "";
    }
    const start = Math.max(0, index - 120);
    const end = Math.min(text.length, index + phrase.length + 180);
    return `${start > 0 ? "..." : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "..." : ""}`;
  }

  function wrapPhraseInNode(node, phrase) {
    const text = node.nodeValue;
    const index = text.toLowerCase().indexOf(phrase.toLowerCase());
    if (index === -1) {
      return null;
    }

    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + phrase.length);
    const mark = document.createElement("mark");
    mark.className = MARK_CLASS;
    mark.dataset.backtrackPhrase = phrase;
    range.surroundContents(mark);
    range.detach();
    return mark;
  }

  function clearHighlights() {
    const marks = [...document.querySelectorAll(`.${MARK_CLASS}`)];
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) {
        continue;
      }

      const text = document.createTextNode(mark.textContent || "");
      parent.replaceChild(text, mark);
      parent.normalize();
    }
    lastMatchCount = 0;
  }

  function highlightPhrases(phrases) {
    clearHighlights();
    if (!highlightsEnabled() || isPaused()) {
      return 0;
    }
    let count = 0;
    const normalized = phrases
      .map((phrase) => String(phrase || "").trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    for (const phrase of normalized) {
      let nodes = textNodes(document.body || document.documentElement);
      for (const node of nodes) {
        while (node.nodeValue && node.nodeValue.toLowerCase().includes(phrase.toLowerCase())) {
          const mark = wrapPhraseInNode(node, phrase);
          if (!mark) {
            break;
          }
          count += 1;
          if (count >= 250) {
            return count;
          }
        }
      }
    }

    return count;
  }

  function findPhraseMatches(phrases, pageText) {
    return phrases
      .map((phrase) => String(phrase || "").trim())
      .filter(Boolean)
      .filter((phrase) => pageText.toLowerCase().includes(phrase.toLowerCase()))
      .map((phrase) => {
        const rects = [...document.querySelectorAll(`.${MARK_CLASS}`)]
          .filter((node) => node.dataset.backtrackPhrase === phrase)
          .slice(0, 20)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height
            };
          });
        return {
          phrase,
          snippet: snippetFor(pageText, phrase),
          rects
        };
      });
  }

  function requestPhrases() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "BACKTRACK_GET_PHRASES" }, (response) => {
        resolve((response && response.phrases) || []);
      });
    });
  }

  function requestBlockedSites() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "BACKTRACK_GET_BLOCKED_SITES" }, (response) => {
        resolve((response && response.blockedSites) || []);
      });
    });
  }

  function requestSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "BACKTRACK_GET_SETTINGS" }, (response) => {
        resolve((response && response.settings) || { captureDelayMs: 900 });
      });
    });
  }

  async function sendCapture(source) {
    if (captureInFlight) {
      return;
    }

    if (isBlockedUrl(location.href)) {
      setStatus("backtrack blocked here");
      return;
    }

    if (source !== "manual" && isPaused()) {
      setStatus("backtrack paused");
      return;
    }

    const text = visibleText();
    if (text.length < 20) {
      setStatus("backtrack: no text");
      return;
    }

    setStatus(source === "manual" ? "saving page..." : "capturing...");
    captureInFlight = true;
    const payload = {
      url: location.href,
      title: document.title,
      text,
      html: snapshotHtml(),
      metrics: viewportMetrics(),
      matches: findPhraseMatches(flaggedPhrases, text),
      source
    };
    debugPayload("content capture payload", payload);
    chrome.runtime.sendMessage(
      {
        type: "BACKTRACK_CAPTURE",
        payload
      },
      (response) => {
        captureInFlight = false;
        if (chrome.runtime.lastError || !response) {
          setStatus("backtrack: server unavailable");
        } else if (response.blocked) {
          setStatus("backtrack blocked here");
        } else if (response.skipped) {
          setStatus("backtrack: skipped");
        } else if (response.saved) {
          setStatus(lastMatchCount ? `saved · ${lastMatchCount} marked` : "saved");
        } else {
          setStatus("backtrack: save failed");
        }
        setTimeout(() => {
          updatePauseUi();
          if (!isPaused()) {
            setStatus(lastMatchCount ? `backtrack · ${lastMatchCount} marked` : "backtrack running");
          }
        }, 1600);
      }
    );
  }

  async function initialize() {
    injectStyles();
    createWidget();
    [flaggedPhrases, blockedSites, settings] = await Promise.all([
      requestPhrases(),
      requestBlockedSites(),
      requestSettings()
    ]);
    if (isBlockedUrl(location.href)) {
      clearHighlights();
      setStatus("backtrack blocked here");
      return;
    }
    updatePauseUi();
    updateHighlightUi();
    if (!isPaused()) {
      setStatus(lastMatchCount ? `backtrack · ${lastMatchCount} marked` : "backtrack running");
    }
    setTimeout(() => sendCapture("automatic"), Number(settings.captureDelayMs) || 900);
  }

  if (document.readyState === "complete") {
    setTimeout(initialize, 600);
  } else {
    window.addEventListener("load", () => setTimeout(initialize, 600), { once: true });
  }
})();
