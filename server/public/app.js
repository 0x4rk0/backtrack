const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const phrasesForm = document.querySelector("#phrases-form");
const phrasesInput = document.querySelector("#phrases");
const blockedSitesForm = document.querySelector("#blocked-sites-form");
const blockedSitesInput = document.querySelector("#blocked-sites");
const recentTab = document.querySelector("#recent-tab");
const flaggedTab = document.querySelector("#flagged-tab");
const imagesOnlyInput = document.querySelector("#images-only");
const phrasesToggle = document.querySelector("#phrases-toggle");
const phrasesPanel = document.querySelector("#phrases-panel");
const blockedSitesToggle = document.querySelector("#blocked-sites-toggle");
const blockedSitesPanel = document.querySelector("#blocked-sites-panel");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");

let linkChoiceEl;
let currentView = "recent";
let currentQuery = "";
let lastRenderedSignature = "";
let refreshTimer;
let flaggedPhrases = [];
let blockedSites = [];
let activeFlaggedPhrases = [];
let activeBlockedSites = [];
let imagesOnly = false;

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

function filterRows(rows) {
  return rows.filter((row) => {
    if (imagesOnly && (!Array.isArray(row.imageFiles) || !row.imageFiles.length)) {
      return false;
    }

    if (shouldFilterByPhrase() && !rowMatchesActivePhrase(row)) {
      return false;
    }

    if (shouldFilterByBlockedSite() && !rowMatchesActiveBlockedSite(row)) {
      return false;
    }

    return true;
  });
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function shouldFilterByPhrase() {
  return activeFlaggedPhrases.length > 0 && activeFlaggedPhrases.length < flaggedPhrases.length;
}

function shouldFilterByBlockedSite() {
  return activeBlockedSites.length > 0 && activeBlockedSites.length < blockedSites.length;
}

function rowMatchesActivePhrase(row) {
  if (!activeFlaggedPhrases.length) {
    return true;
  }

  const matches = (row.matches || []).map((match) => normalizeValue(match.phrase));
  return activeFlaggedPhrases.some((phrase) => matches.includes(normalizeValue(phrase)));
}

function rowMatchesRule(urlValue, rule) {
  try {
    const url = new URL(urlValue);
    const normalizedRule = String(rule || "").trim().toLowerCase();
    if (!normalizedRule) {
      return false;
    }

    const [hostRule, ...pathParts] = normalizedRule.split("/");
    const pathRule = pathParts.length ? `/${pathParts.join("/")}` : "";
    const host = url.hostname.toLowerCase();
    const hostMatches = host === hostRule || host.endsWith(`.${hostRule}`);

    if (!hostMatches) {
      return false;
    }

    return pathRule ? url.pathname.toLowerCase().startsWith(pathRule) : true;
  } catch (error) {
    return false;
  }
}

function rowMatchesActiveBlockedSite(row) {
  if (!activeBlockedSites.length) {
    return true;
  }

  return activeBlockedSites.some((rule) => rowMatchesRule(row.url, rule));
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
      <img class="thumb" src="${row.screenshotFile}" alt="">
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
  const links = [`<a href="${escapeHtml(readerUrl)}" target="_blank" rel="noreferrer">Read captured text</a>`];

  if (viewUrl) {
    links.push(`<a href="${escapeHtml(viewUrl)}" target="_blank" rel="noreferrer">View capture</a>`);
  } else if (row.htmlFile) {
    links.push(`<a href="${escapeHtml(row.htmlFile)}" target="_blank" rel="noreferrer">Static HTML snapshot</a>`);
  }

  if (Array.isArray(row.imageFiles) && row.imageFiles.length) {
    links.push(`<a href="${escapeHtml(viewUrl)}" target="_blank" rel="noreferrer">${row.imageFiles.length} saved image${row.imageFiles.length === 1 ? "" : "s"}</a>`);
  }

  links.push(`<a href="${escapeHtml(row.textFile)}" target="_blank" rel="noreferrer">Raw text</a>`);
  return `<p class="capture-links">${links.join(" · ")}</p>`;
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
  const snippet = row.snippet
    ? highlightedText(row.snippet, currentQuery ? currentQuery : "")
    : "Match found in the title, URL, or flagged phrase list.";

  return `
    <article class="result">
      ${screenshotBlock(row)}
      <div class="result-body">
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
        ${matchList(row, currentQuery ? currentQuery : "")}
        ${captureLinks(row)}
      </div>
    </article>
  `;
}

function renderResults(rows) {
  const filteredRows = filterRows(rows);
  lastRenderedSignature = rows.map((row) => `${row.id}:${row.createdAt}`).join("|");
  const groups = new Map();

  for (const row of filteredRows) {
    const base = baseUrl(row);
    if (!groups.has(base)) {
      groups.set(base, []);
    }
    groups.get(base).push(row);
  }

  resultsEl.innerHTML = [...groups.entries()]
    .map(
      ([base, groupRows]) => `
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
      `
    )
    .join("");

  if (!filteredRows.length) {
    resultsEl.innerHTML = `<section class="empty-state">No captures match this view.</section>`;
  }
}

function updateTabs() {
  recentTab.classList.toggle("active", currentView === "recent");
  flaggedTab.classList.toggle("active", currentView === "flagged");
}

function updatePickerButton(toggle, activeCount, totalCount, label) {
  if (!totalCount) {
    toggle.textContent = `${label} (0)`;
    return;
  }

  toggle.textContent = `${label} (${activeCount}/${totalCount})`;
}

function renderPicker(panel, items, type) {
  const title = type === "phrase" ? "phrase" : "site";
  const activeItems = type === "phrase" ? activeFlaggedPhrases : activeBlockedSites;
  panel.innerHTML = `
    <div class="picker-list">
      ${items.length
        ? items
            .map(
              (item, index) => `
                <label class="picker-item">
                  <input type="checkbox" data-type="${type}" data-index="${index}" ${activeItems.includes(item) ? "checked" : ""}>
                  <span>${escapeHtml(item)}</span>
                </label>
              `
            )
            .join("")
        : `<p class="picker-empty">No ${title}s saved.</p>`}
    </div>
    <form class="picker-add" data-type="${type}">
      <input type="text" name="value" placeholder="Add ${title}">
      <button type="submit">Add</button>
    </form>
  `;
}

function closePickers() {
  phrasesPanel.hidden = true;
  blockedSitesPanel.hidden = true;
  phrasesToggle.setAttribute("aria-expanded", "false");
  blockedSitesToggle.setAttribute("aria-expanded", "false");
}

function togglePicker(type) {
  const panel = type === "phrase" ? phrasesPanel : blockedSitesPanel;
  const toggle = type === "phrase" ? phrasesToggle : blockedSitesToggle;
  const isOpen = !panel.hidden;
  closePickers();
  panel.hidden = isOpen;
  toggle.setAttribute("aria-expanded", String(!isOpen));
}

function syncPhrases() {
  phrasesInput.value = flaggedPhrases.join("\n");
  activeFlaggedPhrases = activeFlaggedPhrases.filter((phrase) => flaggedPhrases.includes(phrase));
  renderPicker(phrasesPanel, flaggedPhrases, "phrase");
  updatePickerButton(phrasesToggle, activeFlaggedPhrases.length, flaggedPhrases.length, "Flagged names and phrases");
}

function syncBlockedSites() {
  blockedSitesInput.value = blockedSites.join("\n");
  activeBlockedSites = activeBlockedSites.filter((site) => blockedSites.includes(site));
  renderPicker(blockedSitesPanel, blockedSites, "site");
  updatePickerButton(blockedSitesToggle, activeBlockedSites.length, blockedSites.length, "Blocked sites");
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

async function savePhrases() {
  const phrases = flaggedPhrases
    .map((phrase) => phrase.trim())
    .filter(Boolean);

  const response = await fetch("/api/phrases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phrases })
  });
  const payload = await response.json();
  flaggedPhrases = payload.phrases || [];
  syncPhrases();
  statusEl.textContent = `Saved ${flaggedPhrases.length} flagged phrase${flaggedPhrases.length === 1 ? "" : "s"}`;
  reloadCurrentView();
}

async function saveBlockedSites() {
  const nextBlockedSites = blockedSites
    .map((site) => site.trim())
    .filter(Boolean);

  const response = await fetch("/api/blocked-sites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blockedSites: nextBlockedSites })
  });
  const payload = await response.json();
  blockedSites = payload.blockedSites || [];
  syncBlockedSites();
  statusEl.textContent = `Saved ${blockedSites.length} blocked site${blockedSites.length === 1 ? "" : "s"}`;
  reloadCurrentView();
}

async function loadPhrases() {
  const response = await fetch("/api/phrases");
  const payload = await response.json();
  flaggedPhrases = payload.phrases || [];
  activeFlaggedPhrases = [...flaggedPhrases];
  syncPhrases();
}

async function loadBlockedSites() {
  const response = await fetch("/api/blocked-sites");
  const payload = await response.json();
  blockedSites = payload.blockedSites || [];
  activeBlockedSites = [...blockedSites];
  syncBlockedSites();
}

async function loadRecent() {
  currentView = "recent";
  currentQuery = "";
  updateTabs();
  const response = await fetch("/api/recent");
  const payload = await response.json();
  const filteredRows = filterRows(payload.results || []);
  statusEl.textContent = `Recent captures (${filteredRows.length})`;
  renderResults(payload.results || []);
}

async function loadFlagged() {
  currentView = "flagged";
  currentQuery = "";
  updateTabs();
  const response = await fetch("/api/flagged");
  const payload = await response.json();
  const filteredRows = filterRows(payload.results || []);
  statusEl.textContent = `Flagged captures (${filteredRows.length})`;
  renderResults(payload.results || []);
}

async function search(query) {
  currentQuery = query;
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  const payload = await response.json();
  const filteredRows = filterRows(payload.results || []);
  statusEl.textContent = `${filteredRows.length} result${filteredRows.length === 1 ? "" : "s"} for "${query}"`;
  renderResults(payload.results || []);
}

async function refreshIfChanged() {
  if (document.hidden) {
    return;
  }

  const response = await fetch("/api/recent");
  const payload = await response.json();
  const signature = (payload.results || []).map((row) => `${row.id}:${row.createdAt}`).join("|");
  if (signature !== lastRenderedSignature && currentQuery === "") {
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
  if (currentQuery) {
    search(currentQuery);
  } else if (currentView === "flagged") {
    loadFlagged();
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
    reloadCurrentView();
  }
});

recentTab.addEventListener("click", loadRecent);
flaggedTab.addEventListener("click", loadFlagged);
imagesOnlyInput.addEventListener("change", () => {
  imagesOnly = imagesOnlyInput.checked;
  reloadCurrentView();
});

phrasesToggle.addEventListener("click", () => togglePicker("phrase"));
blockedSitesToggle.addEventListener("click", () => togglePicker("site"));

phrasesPanel.addEventListener("change", (event) => {
  if (!event.target.matches('input[type="checkbox"][data-type="phrase"]')) {
    return;
  }
  const phrase = flaggedPhrases[Number(event.target.dataset.index)];
  activeFlaggedPhrases = event.target.checked
    ? [...activeFlaggedPhrases, phrase]
    : activeFlaggedPhrases.filter((value) => value !== phrase);
  syncPhrases();
  reloadCurrentView();
});

blockedSitesPanel.addEventListener("change", (event) => {
  if (!event.target.matches('input[type="checkbox"][data-type="site"]')) {
    return;
  }
  const site = blockedSites[Number(event.target.dataset.index)];
  activeBlockedSites = event.target.checked
    ? [...activeBlockedSites, site]
    : activeBlockedSites.filter((value) => value !== site);
  syncBlockedSites();
  reloadCurrentView();
});

phrasesPanel.addEventListener("submit", (event) => {
  const addForm = event.target.closest('.picker-add[data-type="phrase"]');
  if (!addForm) {
    return;
  }
  event.preventDefault();
  const input = addForm.querySelector('input[name="value"]');
  const value = input.value.trim();
  if (!value || flaggedPhrases.includes(value)) {
    return;
  }
  flaggedPhrases = [...flaggedPhrases, value];
  activeFlaggedPhrases = [...activeFlaggedPhrases, value];
  input.value = "";
  savePhrases();
});

blockedSitesPanel.addEventListener("submit", (event) => {
  const addForm = event.target.closest('.picker-add[data-type="site"]');
  if (!addForm) {
    return;
  }
  event.preventDefault();
  const input = addForm.querySelector('input[name="value"]');
  const value = input.value.trim();
  if (!value || blockedSites.includes(value)) {
    return;
  }
  blockedSites = [...blockedSites, value];
  activeBlockedSites = [...activeBlockedSites, value];
  input.value = "";
  saveBlockedSites();
});

resultsEl.addEventListener("click", (event) => {
  const button = event.target.closest(".title-link");
  if (!button) {
    return;
  }

  openLinkChoice(button.dataset.externalUrl, button.dataset.localUrl);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".picker")) {
    closePickers();
  }

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
    closePickers();
    closeLinkChoice();
  }
});

loadPhrases();
loadBlockedSites();
loadRecent();
connectCaptureEvents();
