const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const phrasesForm = document.querySelector("#phrases-form");
const phrasesInput = document.querySelector("#phrases");
const recentTab = document.querySelector("#recent-tab");
const flaggedTab = document.querySelector("#flagged-tab");
const menuToggle = document.querySelector("#menu-toggle");
const menuPanel = document.querySelector("#menu-panel");
const sortMode = document.querySelector("#sort-mode");
const clearFindings = document.querySelector("#clear-findings");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
let currentView = "recent";
let currentQuery = "";

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
    <a class="shot" href="${row.screenshotFile}" target="_blank" rel="noreferrer">
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

function renderResults(rows) {
  resultsEl.innerHTML = rows
    .map((row) => {
      const title = escapeHtml(row.title || row.url);
      const snippet = row.snippet
        ? highlightedText(row.snippet, currentView === "search" ? currentQuery : "")
        : "Match found in the title, URL, or flagged phrase list.";
      return `
        <article class="result">
          ${screenshotBlock(row)}
          <div>
            <h2><a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">${title}</a></h2>
            <div class="meta">${escapeHtml(new Date(row.createdAt).toLocaleString())} · ${escapeHtml(row.url)}</div>
            <p class="snippet">${snippet}</p>
            ${matchList(row, currentView === "search" ? currentQuery : "")}
            <p><a href="${row.textFile}" target="_blank" rel="noreferrer">View captured text</a></p>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadPhrases() {
  const response = await fetch("/api/phrases");
  const payload = await response.json();
  phrasesInput.value = (payload.phrases || []).join("\n");
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
  phrasesInput.value = (payload.phrases || []).join("\n");
  statusEl.textContent = `Saved ${payload.phrases.length} flagged phrase${payload.phrases.length === 1 ? "" : "s"}`;
}

async function loadRecent() {
  currentView = "recent";
  currentQuery = "";
  const response = await fetch(`/api/recent?sort=${encodeURIComponent(sortMode.value)}`);
  const payload = await response.json();
  statusEl.textContent = `Recent captures (${payload.results.length})`;
  renderResults(payload.results);
}

async function loadFlagged() {
  currentView = "flagged";
  currentQuery = "";
  const response = await fetch(`/api/flagged?sort=${encodeURIComponent(sortMode.value)}`);
  const payload = await response.json();
  statusEl.textContent = `Flagged captures (${payload.results.length})`;
  renderResults(payload.results);
}

async function search(query) {
  currentView = "search";
  currentQuery = query;
  const response = await fetch(
    `/api/search?q=${encodeURIComponent(query)}&sort=${encodeURIComponent(sortMode.value)}`
  );
  const payload = await response.json();
  statusEl.textContent = `${payload.results.length} result${payload.results.length === 1 ? "" : "s"} for "${query}"`;
  renderResults(payload.results);
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

recentTab.addEventListener("click", loadRecent);
flaggedTab.addEventListener("click", loadFlagged);
menuToggle.addEventListener("click", () => {
  const isOpen = !menuPanel.hidden;
  menuPanel.hidden = isOpen;
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
});

sortMode.addEventListener("change", reloadCurrentView);

clearFindings.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Clear all captured findings, text files, and screenshots? Flagged phrase settings will remain."
  );
  if (!confirmed) {
    return;
  }

  await fetch("/api/clear", { method: "POST" });
  statusEl.textContent = "Cleared captured findings";
  renderResults([]);
});

loadPhrases();
loadRecent();
