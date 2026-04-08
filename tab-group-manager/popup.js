// ─── Color map matching Chrome's tab group colors ─────────────────

const COLOR_MAP = {
  grey: "#5F6368",
  blue: "#1A73E8",
  red: "#D93025",
  yellow: "#F9AB00",
  green: "#188038",
  pink: "#D01884",
  purple: "#A142F4",
  cyan: "#007B83",
  orange: "#E8710A",
};

// ─── Close button SVG (shared) ────────────────────────────────────

const CLOSE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

// ─── Search ───────────────────────────────────────────────────────

function getSearchQuery() {
  return document.getElementById("search-input").value;
}

function clearSearch() {
  const input = document.getElementById("search-input");
  if (input.value) {
    input.value = "";
    renderAll();
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Returns HTML with <mark> around matched substring, or null if no match.
// Matches the literal query as a contiguous sequence (case-insensitive).
function highlightMatch(text, query) {
  if (!query) return null;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const before = escapeHtml(text.slice(0, idx));
  const match = escapeHtml(text.slice(idx, idx + query.length));
  const after = escapeHtml(text.slice(idx + query.length));
  return `${before}<mark>${match}</mark>${after}`;
}

// Check if a group matches the query. Returns { matches, titleHtml, tabHighlights }
function matchGroup(group, query) {
  if (!query) return { matches: true, titleHtml: null, tabHighlights: null };

  const titleHit = highlightMatch(group.title, query);
  const tabHighlights = group.tabs.map((tab) => {
    const titleHit = highlightMatch(tab.title || tab.url || "New Tab", query);
    const urlHit = !titleHit ? highlightMatch(tab.url || "", query) : null;
    return { titleHit, urlHit };
  });

  const anyTabHit = tabHighlights.some((t) => t.titleHit || t.urlHit);
  return {
    matches: !!titleHit || anyTabHit,
    titleHtml: titleHit,
    tabHighlights: anyTabHit ? tabHighlights : null,
  };
}

function initSearch() {
  const input = document.getElementById("search-input");
  let debounceTimer;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderAll(), 150);
  });
}

// ─── Tab switching ────────────────────────────────────────────────

function switchToTab(tabName) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add("active");
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.getElementById(`panel-${tabName}`).classList.add("active");
}

function initTabs() {
  const tabButtons = document.querySelectorAll(".tab");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      switchToTab(btn.dataset.tab);
      if (btn.dataset.tab === "settings") {
        loadSettingsData();
      }
    });
  });
}

// ─── Render helpers ───────────────────────────────────────────────

function getFaviconUrl(pageUrl) {
  try {
    const url = new URL(pageUrl);
    return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url.href)}&size=16`;
  } catch {
    return "";
  }
}

function createTabList(tabs, tabHighlights) {
  const list = document.createElement("div");
  list.className = "tab-list";
  tabs.forEach((tab, i) => {
    const item = document.createElement("div");
    item.className = "tab-item";

    const favicon = document.createElement("img");
    favicon.className = "tab-favicon";
    favicon.src = tab.favIconUrl || getFaviconUrl(tab.url);
    favicon.onerror = () => {
      favicon.style.display = "none";
    };

    const title = document.createElement("span");
    title.className = "tab-title";
    title.title = tab.url || "";

    const highlight = tabHighlights && tabHighlights[i];
    if (highlight && highlight.titleHit) {
      title.innerHTML = highlight.titleHit;
    } else if (highlight && highlight.urlHit) {
      title.innerHTML = highlight.urlHit;
    } else {
      title.textContent = tab.title || tab.url || "New Tab";
    }

    item.appendChild(favicon);
    item.appendChild(title);
    list.appendChild(item);
  });
  return list;
}

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Render open groups ──────────────────────────────────────────

async function renderOpenGroups(currentGroupId) {
  const container = document.getElementById("open-groups");
  const query = getSearchQuery();

  const response = await chrome.runtime.sendMessage({ action: "getOpenGroups" });
  let groups = response.groups || [];

  // Sort alphabetically, current tab's group first
  groups.sort((a, b) => {
    if (currentGroupId) {
      if (a.id === currentGroupId) return -1;
      if (b.id === currentGroupId) return 1;
    }
    return a.title.localeCompare(b.title);
  });

  // Filter by search
  const matched = groups.map((g) => ({ group: g, ...matchGroup(g, query) })).filter((m) => m.matches);

  if (matched.length === 0) {
    container.innerHTML = query
      ? '<p class="empty-state">No matching open groups</p>'
      : '<p class="empty-state">No open tab groups</p>';
    return;
  }

  container.innerHTML = "";

  matched.forEach(({ group, titleHtml, tabHighlights }) => {
    const card = document.createElement("div");
    card.className = "group-card";
    if (group.id === currentGroupId) card.classList.add("current");

    const color = COLOR_MAP[group.color] || COLOR_MAP.grey;

    card.innerHTML = `
      <div class="group-header">
        <div class="group-color" style="background-color: ${color}"></div>
        <span class="group-title">${titleHtml || escapeHtml(group.title)}</span>
        <span class="tab-count">${group.tabCount} tab${group.tabCount !== 1 ? "s" : ""}</span>
        <div class="group-actions">
          <button class="btn btn-close" data-group-id="${group.id}" title="Close group">
            ${CLOSE_SVG}
          </button>
          <button class="btn btn-save" data-group-id="${group.id}" title="Save group">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    const tabList = createTabList(group.tabs, tabHighlights);
    card.appendChild(tabList);

    const closeBtn = card.querySelector(".btn-close");
    closeBtn.addEventListener("click", async () => {
      closeBtn.disabled = true;
      await chrome.runtime.sendMessage({ action: "closeGroup", groupId: group.id });
      clearSearch();
      await renderAll();
    });

    const saveBtn = card.querySelector(".btn-save");
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      await chrome.runtime.sendMessage({ action: "saveGroup", groupId: group.id });
      await renderAll();
    });

    container.appendChild(card);
  });
}

// ─── Render saved groups ─────────────────────────────────────────

async function renderSavedGroups(currentSavedKey) {
  const container = document.getElementById("saved-groups");
  const query = getSearchQuery();

  const response = await chrome.runtime.sendMessage({ action: "getSavedGroups" });
  let groups = response.groups || [];

  // Sort alphabetically, current tab's saved group first
  groups.sort((a, b) => {
    if (currentSavedKey) {
      if (a.key === currentSavedKey) return -1;
      if (b.key === currentSavedKey) return 1;
    }
    return a.title.localeCompare(b.title);
  });

  // Filter by search
  const matched = groups.map((g) => ({ group: g, ...matchGroup(g, query) })).filter((m) => m.matches);

  if (matched.length === 0) {
    container.innerHTML = query
      ? '<p class="empty-state">No matching saved groups</p>'
      : '<p class="empty-state">No saved groups yet</p>';
    return;
  }

  container.innerHTML = "";

  matched.forEach(({ group, titleHtml, tabHighlights }) => {
    const card = document.createElement("div");
    card.className = "group-card saved";
    if (group.key === currentSavedKey) card.classList.add("current");

    const color = COLOR_MAP[group.color] || COLOR_MAP.grey;

    card.innerHTML = `
      <div class="group-header">
        <div class="group-color" style="background-color: ${color}"></div>
        <span class="group-title" data-key="${escapeHtml(group.key)}" title="Click to rename">${titleHtml || escapeHtml(group.title)}</span>
        <span class="tab-count">${group.tabCount} tab${group.tabCount !== 1 ? "s" : ""}</span>
        ${group.isActive ? '<span class="badge active-badge">Live</span>' : ""}
        <div class="group-actions">
          ${group.isActive ? `<button class="btn btn-close" data-group-id="${group.liveGroupId}" title="Close group">${CLOSE_SVG}</button>` : ""}
          <button class="btn btn-delete" data-key="${escapeHtml(group.key)}" title="Delete group">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="group-meta">Updated ${timeAgo(group.updatedAt)}</div>
    `;

    const tabList = createTabList(group.tabs, tabHighlights);
    card.appendChild(tabList);

    // Close button (only present for active/live groups)
    const closeBtn = card.querySelector(".btn-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        closeBtn.disabled = true;
        await chrome.runtime.sendMessage({ action: "closeGroup", groupId: group.liveGroupId });
        clearSearch();
        await renderAll();
      });
    }

    // Click card to restore group
    card.addEventListener("click", async (e) => {
      if (e.target.closest(".btn-delete") || e.target.closest(".btn-close") || e.target.closest(".rename-input")) return;
      if (e.target.closest(".group-title")) return;
      card.classList.add("restoring");
      clearSearch();
      await chrome.runtime.sendMessage({ action: "restoreGroup", key: group.key });
      await renderAll();
    });

    // Delete button
    const deleteBtn = card.querySelector(".btn-delete");
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Delete saved group "${group.title}"?`)) {
        await chrome.runtime.sendMessage({ action: "deleteGroup", key: group.key });
        await renderAll();
      }
    });

    // Rename on title click
    const titleEl = card.querySelector(".group-title");
    titleEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.type = "text";
      input.className = "rename-input";
      input.value = group.title;
      titleEl.replaceWith(input);
      input.focus();
      input.select();

      const finishRename = async () => {
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== group.title) {
          await chrome.runtime.sendMessage({
            action: "renameGroup",
            key: group.key,
            title: newTitle,
          });
        }
        await renderAll();
      };

      input.addEventListener("blur", finishRename);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          input.blur();
        } else if (e.key === "Escape") {
          input.value = group.title;
          input.blur();
        }
      });
    });

    container.appendChild(card);
  });
}

// ─── Utility ─────────────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ─── Settings panel ──────────────────────────────────────────

async function loadSettingsData() {
  const textarea = document.getElementById("settings-data");
  const result = await chrome.storage.local.get("savedGroups");
  const data = result.savedGroups || {};
  textarea.value = JSON.stringify(data, null, 2);
}

function initSettings() {
  const saveBtn = document.getElementById("settings-save");
  const textarea = document.getElementById("settings-data");
  const status = document.getElementById("settings-status");

  saveBtn.addEventListener("click", async () => {
    status.textContent = "";
    status.className = "settings-status";

    try {
      const parsed = JSON.parse(textarea.value);
      await chrome.storage.local.set({ savedGroups: parsed });
      status.textContent = "Saved";
      status.className = "settings-status success";
      // Re-render saved groups to reflect changes
      await renderSavedGroups(currentSavedKey);
    } catch (e) {
      status.textContent = "Invalid JSON";
      status.className = "settings-status error";
    }

    setTimeout(() => {
      status.textContent = "";
      status.className = "settings-status";
    }, 2000);
  });
}

// ─── State ───────────────────────────────────────────────────────

let currentTabGroupId = null;
let currentSavedKey = null;

// ─── Init ────────────────────────────────────────────────────────

async function renderAll() {
  await Promise.all([
    renderOpenGroups(currentTabGroupId),
    renderSavedGroups(currentSavedKey),
  ]);
}

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  initSearch();
  initSettings();

  // Detect which group the current tab belongs to
  const info = await chrome.runtime.sendMessage({ action: "getCurrentTabGroup" });
  currentTabGroupId = info.groupId;
  currentSavedKey = info.savedKey;

  // Auto-select the right panel
  if (currentTabGroupId) {
    if (currentSavedKey) {
      switchToTab("saved");
    } else {
      switchToTab("open");
    }
  }

  await renderAll();
});
