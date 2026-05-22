const recentTab = document.querySelector("#recent-tab");
const flaggedTab = document.querySelector("#flagged-tab");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#image-results");

let currentView = "recent";
let lastRenderedSignature = "";
let refreshTimer;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateTabs() {
  recentTab.classList.toggle("active", currentView === "recent");
  flaggedTab.classList.toggle("active", currentView === "flagged");
}

function resultCard(row) {
  const title = escapeHtml(row.title || row.url);
  const viewUrl = row.viewFile || `/view/${encodeURIComponent(row.id)}`;
  const imageCount = Array.isArray(row.imageFiles) ? row.imageFiles.length : 0;

  return `
    <article class="image-card">
      <a class="image-shot" href="${escapeHtml(viewUrl)}" target="_blank" rel="noreferrer">
        <img class="image-thumb" src="${escapeHtml(row.screenshotFile || "")}" alt="">
      </a>
      <div class="image-card-body">
        <h2>${title}</h2>
        <p class="meta">${escapeHtml(new Date(row.createdAt).toLocaleString())}</p>
        <p class="image-card-url">${escapeHtml(row.url)}</p>
        <p class="image-card-links">
          <a href="${escapeHtml(viewUrl)}" target="_blank" rel="noreferrer">Open capture</a>
          <span>${imageCount} saved image${imageCount === 1 ? "" : "s"}</span>
        </p>
      </div>
    </article>
  `;
}

function renderResults(rows) {
  const filteredRows = rows.filter((row) => row.screenshotFile || (Array.isArray(row.imageFiles) && row.imageFiles.length));
  lastRenderedSignature = rows.map((row) => `${row.id}:${row.createdAt}`).join("|");

  if (!filteredRows.length) {
    resultsEl.innerHTML = `<section class="empty-state">No image captures match this view.</section>`;
    return;
  }

  resultsEl.innerHTML = filteredRows.map(resultCard).join("");
}

async function loadRecent() {
  currentView = "recent";
  updateTabs();
  const response = await fetch("/api/recent");
  const payload = await response.json();
  const rows = payload.results || [];
  statusEl.textContent = `Recent image captures (${rows.filter((row) => row.screenshotFile || (Array.isArray(row.imageFiles) && row.imageFiles.length)).length})`;
  renderResults(rows);
}

async function loadFlagged() {
  currentView = "flagged";
  updateTabs();
  const response = await fetch("/api/flagged");
  const payload = await response.json();
  const rows = payload.results || [];
  statusEl.textContent = `Flagged image captures (${rows.filter((row) => row.screenshotFile || (Array.isArray(row.imageFiles) && row.imageFiles.length)).length})`;
  renderResults(rows);
}

function reloadCurrentView() {
  if (currentView === "flagged") {
    loadFlagged();
  } else {
    loadRecent();
  }
}

async function refreshIfChanged() {
  if (document.hidden) {
    return;
  }

  const response = await fetch("/api/recent");
  const payload = await response.json();
  const signature = (payload.results || []).map((row) => `${row.id}:${row.createdAt}`).join("|");
  if (signature !== lastRenderedSignature) {
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

recentTab.addEventListener("click", loadRecent);
flaggedTab.addEventListener("click", loadFlagged);

loadRecent();
connectCaptureEvents();
