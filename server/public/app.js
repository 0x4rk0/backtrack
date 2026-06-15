const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const phrasesForm = document.querySelector("#phrases-form");
const phrasesInput = document.querySelector("#phrases");
const blockedSitesForm = document.querySelector("#blocked-sites-form");
const blockedSitesInput = document.querySelector("#blocked-sites");
const recentTab = document.querySelector("#recent-tab");
const flaggedTab = document.querySelector("#flagged-tab");
const menuToggle = document.querySelector("#menu-toggle");
const menuPanel = document.querySelector("#menu-panel");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
let linkChoiceEl;
let currentView = "recent";
let currentQuery = "";
let sortValue = "newest";
let lastRenderedSignature = "";
let refreshTimer;
let flaggedPhrases = [];
let blockedSites = [];
let settings = {
  saveImages: true,
  maxImagesPerCapture: 24,
  captureDelayMs: 900,
  proxyUrl: "",
  density: "comfortable",
  accentColor: "#0b6f85"
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlightedText(value, term) {
  const escaped = escapeHtml(value);
  if (!term) {
    return escaped;
  }

  const safeTerm = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(new RegExp(`(${safeTerm})`, "ig"), "<mark>$1</mark>");
}

function screenshotBlock(row) {
  if (!row.screenshotFile) {
    return `<div class="thumb"></div>`;
  }

  const width = row.screenshotMeta && row.screenshotMeta.width ? row.screenshotMeta.width : 1280;
  const height = row.screenshotMeta && row.screenshotMeta.height ? row.screenshotMeta.height : 800;
  const boxes = (row.matches || [])
    .flatMap((match) =>
      (match.rects || []).map((rect) => {
        const left = (rect.x / width) * 100;
        const top = (rect.y / height) * 100;
        const boxWidth = (rect.width / width) * 100;
        const boxHeight = (rect.height / height) * 100;
        return `<span class="highlight-box" title="${escapeHtml(match.phrase)}" style="left:${left}%;top:${top}%;width:${boxWidth}%;height:${boxHeight}%;"></span>`;
      })
    )
    .join("");

  return `
    <a class="shot" href="${escapeHtml(row.viewFile || `/view/${encodeURIComponent(row.id)}`)}" target="_blank" rel="noreferrer">
      <img class="thumb" src="${escapeHtml(row.screenshotFile)}" alt="">
      ${boxes}
    </a>
  `;
}

function matchList(row, query) {
  if (!row.matches || !row.matches.length) {
    return "";
  }

  return `
    <div class="matches">
      ${row.matches
        .map(
          (match) => `
            <div class="match">
              <strong>${escapeHtml(match.phrase)}</strong>
              <span>${highlightedText(match.snippet || "Match captured on this page.", query || match.phrase)}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function captureLinks(row) {
  const readerUrl = row.readerFile || (row.id ? `/reader/${encodeURIComponent(row.id)}` : row.textFile);
  const viewUrl = row.viewFile || (row.id ? `/view/${encodeURIComponent(row.id)}` : "");
  const links = [
    `<a href="${escapeHtml(readerUrl)}" target="_blank" rel="noreferrer">Read captured text</a>`
  ];

  if (viewUrl) {
    links.push(`<a href="${escapeHtml(viewUrl)}" target="_blank" rel="noreferrer">View capture</a>`);
  } else if (row.htmlFile) {
    links.push(`<a href="${escapeHtml(row.htmlFile)}" target="_blank" rel="noreferrer">Static HTML snapshot</a>`);
  }

  if (Array.isArray(row.imageFiles) && row.imageFiles.length) {
    links.push(`<a href="${escapeHtml(viewUrl)}" target="_blank" rel="noreferrer">${row.imageFiles.length} saved image${row.imageFiles.length === 1 ? "" : "s"}</a>`);
  }

  links.push(`<a href="${escapeHtml(row.textFile)}" target="_blank" rel="noreferrer">Raw text</a>`);
  const deleteBtn = row.id
    ? ` · <button type="button" class="capture-link-delete" data-capture-id="${escapeHtml(row.id)}">Delete</button>`
    : "";
  return `<p class="capture-links">${links.join(" · ")}${deleteBtn}</p>`;
}

function baseUrl(row) {
  try {
    const url = new URL(row.url);
    return `${url.protocol}//${url.hostname}`;
  } catch (error) {
    return "Unknown source";
  }
}

function baseLabel(base) {
  try {
    return new URL(base).hostname.replace(/^www\./, "");
  } catch (error) {
    return base;
  }
}

function resultCard(row) {
  const title = escapeHtml(row.title || row.url);
  const viewUrl = row.viewFile || (row.id ? `/view/${encodeURIComponent(row.id)}` : row.textFile);
  const captureId = escapeHtml(row.id || "");
  const snippet = row.snippet
    ? highlightedText(row.snippet, currentView === "search" ? currentQuery : "")
    : "Match found in the title, URL, or flagged phrase list.";
  return `
    <article class="result" data-capture-id="${captureId}">
      ${screenshotBlock(row)}
      <div>
        <h2>
          <button
            type="button"
            class="title-link"
            data-external-url="${escapeHtml(row.url)}"
            data-local-url="${escapeHtml(viewUrl)}"
          >${title}</button>
        </h2>
        <div class="meta">${escapeHtml(new Date(row.createdAt).toLocaleString())} · ${escapeHtml(row.url)}</div>
        <p class="snippet">${snippet}</p>
        ${matchList(row, currentView === "search" ? currentQuery : "")}
        ${captureLinks(row)}
      </div>
    </article>
  `;
}

function renderResults(rows) {
  lastRenderedSignature = rows.map((row) => `${row.id}:${row.createdAt}`).join("|");
  if (!rows.length) {
    resultsEl.innerHTML = `<p class="empty-state">${currentView === "flagged" ? "No flagged captures yet." : currentView === "search" ? "No results found." : "No captures yet. Browse with the extension to start collecting."}</p>`;
    return;
  }
  const groups = new Map();
  for (const row of rows) {
    const base = baseUrl(row);
    if (!groups.has(base)) {
      groups.set(base, []);
    }
    groups.get(base).push(row);
  }

  resultsEl.innerHTML = [...groups.entries()]
    .map(([base, groupRows], index) => `
      <section class="source-group">
        <header class="source-header">
          <div>
            <h2>${escapeHtml(baseLabel(base))}</h2>
            <a href="${escapeHtml(base)}" target="_blank" rel="noreferrer">${escapeHtml(base)}</a>
          </div>
          <span>${groupRows.length} capture${groupRows.length === 1 ? "" : "s"}</span>
        </header>
        <div class="source-results">
          ${groupRows.map(resultCard).join("")}
        </div>
      </section>
    `)
    .join("");
}

function ensureLinkChoice() {
  if (linkChoiceEl) {
    return linkChoiceEl;
  }

  linkChoiceEl = document.createElement("div");
  linkChoiceEl.className = "link-choice";
  linkChoiceEl.hidden = true;
  linkChoiceEl.innerHTML = `
    <div class="link-choice-backdrop" data-action="close"></div>
    <section class="link-choice-panel" role="dialog" aria-modal="true" aria-labelledby="link-choice-title">
      <h2 id="link-choice-title">Open external page?</h2>
      <p>This title points to a page outside backtrack.</p>
      <p class="link-choice-url"></p>
      <div class="link-choice-actions">
        <button type="button" data-action="local">Open local capture</button>
        <button type="button" data-action="external" class="danger-button">Go to external page</button>
        <button type="button" data-action="close" class="secondary-button">Cancel</button>
      </div>
    </section>
  `;
  document.body.appendChild(linkChoiceEl);
  return linkChoiceEl;
}

function openLinkChoice(externalUrl, localUrl) {
  const dialog = ensureLinkChoice();
  dialog.querySelector(".link-choice-url").textContent = externalUrl;
  dialog.dataset.externalUrl = externalUrl;
  dialog.dataset.localUrl = localUrl;
  dialog.hidden = false;
  dialog.querySelector('[data-action="local"]').focus();
}

function closeLinkChoice() {
  if (linkChoiceEl) {
    linkChoiceEl.hidden = true;
  }
}

function openChoiceTarget(target) {
  if (!linkChoiceEl) {
    return;
  }

  const url = target === "external" ? linkChoiceEl.dataset.externalUrl : linkChoiceEl.dataset.localUrl;
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  closeLinkChoice();
}

async function loadPhrases() {
  const response = await fetch("/api/phrases");
  const payload = await response.json();
  flaggedPhrases = payload.phrases || [];
  phrasesInput.value = flaggedPhrases.join("\n");
  renderMenuPanel();
}

async function savePhrases() {
  const phrases = phrasesInput.value
    .split(/\n|,/)
    .map((phrase) => phrase.trim())
    .filter(Boolean);

  const response = await fetch("/api/phrases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phrases })
  });
  const payload = await response.json();
  flaggedPhrases = payload.phrases || [];
  phrasesInput.value = flaggedPhrases.join("\n");
  statusEl.textContent = `Saved ${payload.phrases.length} flagged phrase${payload.phrases.length === 1 ? "" : "s"}`;
  renderMenuPanel();
}

async function loadBlockedSites() {
  const response = await fetch("/api/blocked-sites");
  const payload = await response.json();
  blockedSites = payload.blockedSites || [];
  blockedSitesInput.value = blockedSites.join("\n");
  renderMenuPanel();
}

async function saveBlockedSites() {
  const blockedSites = blockedSitesInput.value
    .split(/\n|,/)
    .map((site) => site.trim())
    .filter(Boolean);

  const response = await fetch("/api/blocked-sites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blockedSites })
  });
  const payload = await response.json();
  blockedSites = payload.blockedSites || [];
  blockedSitesInput.value = blockedSites.join("\n");
  statusEl.textContent = `Saved ${payload.blockedSites.length} blocked site${payload.blockedSites.length === 1 ? "" : "s"}`;
  renderMenuPanel();
}

async function loadSettings() {
  const response = await fetch("/api/settings");
  const payload = await response.json();
  settings = { ...settings, ...(payload.settings || {}) };
  applySettings();
  renderMenuPanel();
}

async function saveSettingsFromMenu() {
  const formData = new FormData(menuPanel.querySelector("#settings-form"));
  settings = {
    ...settings,
    saveImages: formData.get("saveImages") === "on",
    maxImagesPerCapture: Number(formData.get("maxImagesPerCapture")),
    captureDelayMs: Number(formData.get("captureDelayMs")),
    proxyUrl: String(formData.get("proxyUrl") || ""),
    density: String(formData.get("density") || "comfortable"),
    accentColor: String(formData.get("accentColor") || "#0b6f85")
  };
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings })
  });
  const payload = await response.json();
  settings = payload.settings || settings;
  applySettings();
  renderMenuPanel();
  statusEl.textContent = "Saved settings";
}

function applySettings() {
  document.documentElement.style.setProperty("--accent", settings.accentColor);
  document.documentElement.classList.toggle("compact-density", settings.density === "compact");
  document.documentElement.classList.toggle("spacious-density", settings.density === "spacious");
}

function renderMenuPanel() {
  menuPanel.innerHTML = `
    <details open>
      <summary>Findings <span class="help" title="Operational controls for sorting and clearing captured findings.">?</span></summary>
      <label for="sort-mode">Sort findings</label>
      <select id="sort-mode">
        <option value="newest"${sortValue === "newest" ? " selected" : ""}>Newest first</option>
        <option value="oldest"${sortValue === "oldest" ? " selected" : ""}>Oldest first</option>
        <option value="domain"${sortValue === "domain" ? " selected" : ""}>Domain</option>
        <option value="title"${sortValue === "title" ? " selected" : ""}>Title</option>
      </select>
      <button type="button" id="clear-findings" class="danger-button">Clear Findings</button>
    </details>
    <details>
      <summary>Flagged phrases <span class="help" title="Quick filters for phrase-specific matches from your flagged phrase list.">?</span></summary>
      <div class="menu-list">
        ${flaggedPhrases.length ? flaggedPhrases.map((phrase) => `<button type="button" data-phrase="${escapeHtml(phrase)}">${escapeHtml(phrase)} <span class="help" title="Filter flagged results to this phrase.">?</span></button>`).join("") : `<p>No flagged phrases saved.</p>`}
      </div>
    </details>
    <details>
      <summary>Blocked sites <span class="help" title="Sites listed here are skipped by extension capture and server-side save checks.">?</span></summary>
      <div class="menu-list">
        ${blockedSites.length ? blockedSites.map((site) => `<span>${escapeHtml(site)} <span class="help" title="Matches this host or URL pattern and blocks capture.">?</span></span>`).join("") : `<p>No blocked sites saved.</p>`}
      </div>
    </details>
    <details>
      <summary>Settings <span class="help" title="Capture behavior, UI preferences, and image fetch options.">?</span></summary>
      <form id="settings-form" class="settings-form">
        <label><input type="checkbox" name="saveImages"${settings.saveImages ? " checked" : ""}> Save JPG/PNG images locally <span class="help" title="When enabled, backtrack downloads jpg/png assets referenced by captured page HTML.">?</span></label>
        <label>Images per capture <span class="help" title="Maximum number of jpg/png assets to save from one captured page.">?</span> <input type="number" name="maxImagesPerCapture" min="0" max="100" value="${escapeHtml(settings.maxImagesPerCapture)}"></label>
        <label>Capture delay <span class="help" title="Milliseconds to wait after page load before automatic extension capture starts.">?</span> <input type="number" name="captureDelayMs" min="250" max="10000" step="250" value="${escapeHtml(settings.captureDelayMs)}"></label>
        <label>Proxy URL <span class="help" title="Optional proxy used for server-side image downloads. Use {url} placeholder or leave blank.">?</span> <input type="url" name="proxyUrl" placeholder="https://proxy.example/fetch?url=" value="${escapeHtml(settings.proxyUrl)}"></label>
        <label>Density <span class="help" title="Adjusts spacing density of capture cards in the dashboard.">?</span>
          <select name="density">
            <option value="compact"${settings.density === "compact" ? " selected" : ""}>Compact</option>
            <option value="comfortable"${settings.density === "comfortable" ? " selected" : ""}>Comfortable</option>
            <option value="spacious"${settings.density === "spacious" ? " selected" : ""}>Spacious</option>
          </select>
        </label>
        <label>Accent <span class="help" title="Primary UI action color used across buttons and links.">?</span> <input type="color" name="accentColor" value="${escapeHtml(settings.accentColor)}"></label>
        <button type="submit">Save Settings</button>
      </form>
    </details>
  `;
}

async function loadRecent() {
  currentView = "recent";
  currentQuery = "";
  const response = await fetch(`/api/recent?sort=${encodeURIComponent(sortValue)}`);
  const payload = await response.json();
  statusEl.textContent = `Recent captures (${payload.results.length})`;
  renderResults(payload.results);
}

async function loadFlagged() {
  currentView = "flagged";
  currentQuery = "";
  const response = await fetch(`/api/flagged?sort=${encodeURIComponent(sortValue)}`);
  const payload = await response.json();
  statusEl.textContent = `Flagged captures (${payload.results.length})`;
  renderResults(payload.results);
}

async function loadFlaggedByPhrase(phrase) {
  currentView = "flagged";
  currentQuery = "";
  const response = await fetch(
    `/api/flagged?phrase=${encodeURIComponent(phrase)}&sort=${encodeURIComponent(sortValue)}`
  );
  const payload = await response.json();
  statusEl.textContent = `Flagged captures for "${phrase}" (${payload.results.length})`;
  renderResults(payload.results);
}

async function search(query) {
  currentView = "search";
  currentQuery = query;
  const response = await fetch(
    `/api/search?q=${encodeURIComponent(query)}&sort=${encodeURIComponent(sortValue)}`
  );
  const payload = await response.json();
  statusEl.textContent = `${payload.results.length} result${payload.results.length === 1 ? "" : "s"} for "${query}"`;
  renderResults(payload.results);
}

async function refreshIfChanged() {
  if (document.hidden) {
    return;
  }

  const response = await fetch(`/api/recent?sort=${encodeURIComponent(sortValue)}`);
  const payload = await response.json();
  const signature = (payload.results || []).map((row) => `${row.id}:${row.createdAt}`).join("|");
  if (signature !== lastRenderedSignature && currentView !== "search") {
    reloadCurrentView();
  }
}

function refreshFromCaptureEvent() {
  if (document.hidden) {
    return;
  }

  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(reloadCurrentView, 100);
}

function connectCaptureEvents() {
  if (!window.EventSource) {
    setInterval(refreshIfChanged, 4000);
    return;
  }

  const events = new EventSource("/api/events");
  events.addEventListener("screenshot", refreshFromCaptureEvent);
  events.addEventListener("error", () => {
    if (events.readyState === EventSource.CLOSED) {
      setInterval(refreshIfChanged, 4000);
    }
  });
}

function reloadCurrentView() {
  if (currentView === "flagged") {
    loadFlagged();
  } else if (currentView === "search" && currentQuery) {
    search(currentQuery);
  } else {
    loadRecent();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (query) {
    search(query);
  } else {
    loadRecent();
  }
});

phrasesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  savePhrases();
});

blockedSitesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveBlockedSites();
});

recentTab.addEventListener("click", loadRecent);
flaggedTab.addEventListener("click", loadFlagged);
resultsEl.addEventListener("click", async (event) => {
  const deleteBtn = event.target.closest(".capture-link-delete");
  if (deleteBtn) {
    const id = deleteBtn.dataset.captureId;
    if (!window.confirm("Delete this capture and its files? This cannot be undone.")) return;
    await fetch(`/api/captures/${encodeURIComponent(id)}/delete`, { method: "POST" });
    const card = deleteBtn.closest(".result");
    const group = card && card.closest(".source-group");
    if (card) card.remove();
    if (group && !group.querySelector(".result")) group.remove();
    if (!resultsEl.querySelector(".result")) {
      resultsEl.innerHTML = `<p class="empty-state">${currentView === "flagged" ? "No flagged captures yet." : "No captures yet. Browse with the extension to start collecting."}</p>`;
    }
    return;
  }

  const button = event.target.closest(".title-link");
  if (!button) {
    return;
  }

  openLinkChoice(button.dataset.externalUrl, button.dataset.localUrl);
});
menuToggle.addEventListener("click", () => {
  const isOpen = !menuPanel.hidden;
  menuPanel.hidden = isOpen;
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
});

menuPanel.addEventListener("change", (event) => {
  if (event.target.id === "sort-mode") {
    sortValue = event.target.value;
    reloadCurrentView();
  }
});

menuPanel.addEventListener("submit", (event) => {
  if (event.target.id !== "settings-form") {
    return;
  }
  event.preventDefault();
  saveSettingsFromMenu();
});

menuPanel.addEventListener("click", async (event) => {
  if (event.target.id === "clear-findings") {
    const confirmed = window.confirm(
      "Clear all captured findings, text files, and screenshots? Flagged phrase settings will remain."
    );
    if (!confirmed) {
      return;
    }

    await fetch("/api/clear", { method: "POST" });
    statusEl.textContent = "Cleared captured findings";
    renderResults([]);
    return;
  }

  const phraseButton = event.target.closest("[data-phrase]");
  if (phraseButton) {
    loadFlaggedByPhrase(phraseButton.dataset.phrase);
  }
});

document.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  const action = actionTarget && actionTarget.dataset.action;
  if (!action || !actionTarget.closest(".link-choice")) {
    return;
  }

  if (action === "external" || action === "local") {
    openChoiceTarget(action);
  } else if (action === "close") {
    closeLinkChoice();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLinkChoice();
    return;
  }
  if (event.key === "/" && !event.target.matches("input, textarea, select, button")) {
    event.preventDefault();
    queryInput.focus();
    queryInput.select();
  }
});

loadPhrases();
loadBlockedSites();
loadSettings();
loadRecent();
connectCaptureEvents();
