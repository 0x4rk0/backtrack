(() => {
  const MARK_CLASS = "backtrack-highlight";
  const PAUSE_KEY = "backtrackPaused";
  let flaggedPhrases = [];
  let lastMatchCount = 0;
  let statusEl;
  let menuEl;

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .${MARK_CLASS} {
        background: rgba(255, 214, 64, 0.72) !important;
        color: inherit !important;
        box-shadow: 0 0 0 1px rgba(128, 89, 0, 0.35);
        border-radius: 2px;
      }
      #backtrack-widget {
        position: fixed;
        right: 18px;
        bottom: 18px;
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
        cursor: pointer;
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
        right: 18px;
        bottom: 62px;
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
    statusEl.addEventListener("click", toggleMenu);
    document.documentElement.appendChild(statusEl);

    menuEl = document.createElement("div");
    menuEl.id = "backtrack-menu";
    menuEl.hidden = true;
    menuEl.innerHTML = `
      <button type="button" data-action="save">Save this page now</button>
      <button type="button" data-action="pause"></button>
    `;
    menuEl.addEventListener("click", handleMenuClick);
    document.documentElement.appendChild(menuEl);
    updatePauseUi();
  }

  function setStatus(text) {
    if (statusEl) {
      statusEl.querySelector("#backtrack-widget-label").textContent = text;
    }
  }

  function isPaused() {
    return sessionStorage.getItem(PAUSE_KEY) === "true";
  }

  function setPaused(paused) {
    sessionStorage.setItem(PAUSE_KEY, String(paused));
    updatePauseUi();
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
      setStatus("backtrack paused");
    }
  }

  function toggleMenu() {
    if (!menuEl || !statusEl) {
      return;
    }
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
    } else if (button.dataset.action === "pause") {
      setPaused(!isPaused());
      menuEl.hidden = true;
      statusEl.setAttribute("aria-expanded", "false");
      if (!isPaused()) {
        setStatus(lastMatchCount ? `backtrack · ${lastMatchCount} marked` : "backtrack running");
      }
    }
  }

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

  function highlightPhrases(phrases) {
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

  async function sendCapture(source) {
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
    chrome.runtime.sendMessage(
      {
        type: "BACKTRACK_CAPTURE",
        payload: {
          url: location.href,
          title: document.title,
          text,
          metrics: viewportMetrics(),
          matches: findPhraseMatches(flaggedPhrases, text),
          source
        }
      },
      () => {
        setStatus(lastMatchCount ? `saved · ${lastMatchCount} marked` : "saved");
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
    flaggedPhrases = await requestPhrases();
    lastMatchCount = highlightPhrases(flaggedPhrases);
    updatePauseUi();
    if (!isPaused()) {
      setStatus(lastMatchCount ? `backtrack · ${lastMatchCount} marked` : "backtrack running");
    }
    setTimeout(() => sendCapture("automatic"), 900);
  }

  if (document.readyState === "complete") {
    setTimeout(initialize, 600);
  } else {
    window.addEventListener("load", () => setTimeout(initialize, 600), { once: true });
  }
})();
