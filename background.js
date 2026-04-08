// ─── Storage helpers ───────────────────────────────────────────────

async function getSavedGroups() {
  const { savedGroups = {} } = await chrome.storage.local.get("savedGroups");
  return savedGroups;
}

async function setSavedGroups(savedGroups) {
  await chrome.storage.local.set({ savedGroups });
}

// Mapping from live browser groupId → saved group key
// Rebuilt on startup and whenever groups are saved/restored
let liveGroupMap = {}; // { [browserGroupId]: savedGroupKey }

async function getLiveGroupMap() {
  const { liveGroupMap: stored = {} } = await chrome.storage.local.get("liveGroupMap");
  liveGroupMap = stored;
  return liveGroupMap;
}

async function setLiveGroupMap(map) {
  liveGroupMap = map;
  await chrome.storage.local.set({ liveGroupMap: map });
}

// ─── Core: snapshot a live group into a saveable object ────────────

async function snapshotGroup(groupId) {
  const group = await chrome.tabGroups.get(groupId);
  const tabs = await chrome.tabs.query({ groupId });
  return {
    title: group.title || "Untitled",
    color: group.color,
    collapsed: group.collapsed,
    tabs: tabs.map((t) => ({
      url: t.url || t.pendingUrl || "chrome://newtab",
      title: t.title || "",
      pinned: t.pinned,
      active: t.active,
    })),
    updatedAt: Date.now(),
  };
}

// ─── Save a group (called from popup) ─────────────────────────────

async function saveGroup(groupId) {
  const snapshot = await snapshotGroup(groupId);
  const savedGroups = await getSavedGroups();
  const key = `group_${Date.now()}_${groupId}`;
  savedGroups[key] = snapshot;
  await setSavedGroups(savedGroups);

  // Track this live group
  const map = await getLiveGroupMap();
  map[groupId] = key;
  await setLiveGroupMap(map);

  return key;
}

// ─── Auto-save: persist current state of a tracked group ──────────

async function autoSaveGroup(groupId) {
  const map = await getLiveGroupMap();
  const key = map[groupId];
  if (!key) return; // not a saved group

  try {
    const snapshot = await snapshotGroup(groupId);
    const savedGroups = await getSavedGroups();
    if (!savedGroups[key]) return; // was deleted from storage
    savedGroups[key] = snapshot;
    await setSavedGroups(savedGroups);
  } catch {
    // Group may have been closed — clean up mapping
    delete map[groupId];
    await setLiveGroupMap(map);
  }
}

// ─── Restore a saved group into a new browser tab group ───────────

async function restoreGroup(key) {
  const savedGroups = await getSavedGroups();
  const group = savedGroups[key];
  if (!group) return;

  // Create tabs (chrome:// URLs cannot be opened by extensions, substitute)
  const urls = group.tabs.map((t) =>
    t.url.startsWith("chrome://") ? "about:blank" : t.url
  );

  if (urls.length === 0) return;

  const createdTabs = await Promise.all(
    urls.map((url) => chrome.tabs.create({ url, active: false }))
  );

  const tabIds = createdTabs.map((t) => t.id);
  const newGroupId = await chrome.tabs.group({ tabIds });

  await chrome.tabGroups.update(newGroupId, {
    title: group.title,
    color: group.color,
    collapsed: false,
  });

  // Focus the first tab in the restored group
  if (createdTabs.length > 0) {
    await chrome.tabs.update(createdTabs[0].id, { active: true });
  }

  // Map this new live group to the saved key for auto-save tracking
  const map = await getLiveGroupMap();
  map[newGroupId] = key;
  await setLiveGroupMap(map);

  return newGroupId;
}

// ─── Delete a saved group ─────────────────────────────────────────

async function deleteSavedGroup(key) {
  const savedGroups = await getSavedGroups();
  delete savedGroups[key];
  await setSavedGroups(savedGroups);

  // Remove from live map if tracked
  const map = await getLiveGroupMap();
  for (const [gid, k] of Object.entries(map)) {
    if (k === key) {
      delete map[gid];
    }
  }
  await setLiveGroupMap(map);
}

// ─── Rename a saved group ─────────────────────────────────────────

async function renameSavedGroup(key, newTitle) {
  const savedGroups = await getSavedGroups();
  if (!savedGroups[key]) return;
  savedGroups[key].title = newTitle;
  savedGroups[key].updatedAt = Date.now();
  await setSavedGroups(savedGroups);
}

// ─── Event listeners for auto-save ────────────────────────────────

// Debounce auto-saves to avoid rapid-fire writes
const pendingSaves = new Map();

function debouncedAutoSave(groupId) {
  if (pendingSaves.has(groupId)) {
    clearTimeout(pendingSaves.get(groupId));
  }
  pendingSaves.set(
    groupId,
    setTimeout(() => {
      pendingSaves.delete(groupId);
      autoSaveGroup(groupId);
    }, 500)
  );
}

// Tab added, removed, or updated within a group
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Tab moved into a group (drag & drop, or programmatic)
  if (changeInfo.groupId !== undefined) {
    // Save the new group the tab joined
    if (changeInfo.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      debouncedAutoSave(changeInfo.groupId);
    }
    // Also save all other tracked groups — the tab may have left one
    getLiveGroupMap().then((map) => {
      for (const groupId of Object.keys(map)) {
        const gid = Number(groupId);
        if (gid !== changeInfo.groupId) {
          debouncedAutoSave(gid);
        }
      }
    });
    return;
  }

  // URL/title/load changes within an existing group
  if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
      debouncedAutoSave(tab.groupId);
    }
  }
});

// Tab moved to a different group or ungrouped
chrome.tabs.onRemoved.addListener((_tabId, _removeInfo) => {
  // We can't know which group lost the tab easily, so save all tracked groups
  setTimeout(async () => {
    const map = await getLiveGroupMap();
    for (const groupId of Object.keys(map)) {
      debouncedAutoSave(Number(groupId));
    }
  }, 300);
});

// Tab attached/detached from group
chrome.tabGroups.onUpdated.addListener((group) => {
  debouncedAutoSave(group.id);
});

chrome.tabGroups.onRemoved.addListener((group) => {
  // Group was closed — remove from live tracking (keep saved data)
  getLiveGroupMap().then((map) => {
    if (map[group.id]) {
      delete map[group.id];
      setLiveGroupMap(map);
    }
  });
});

// When a tab changes group membership
chrome.tabs.onAttached.addListener(async (tabId) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      debouncedAutoSave(tab.groupId);
    }
  } catch {
    // Tab may not exist anymore
  }
});

// ─── Message handler for popup communication ──────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.action) {
      case "getOpenGroups": {
        const groups = await chrome.tabGroups.query({});
        const result = [];
        for (const g of groups) {
          const tabs = await chrome.tabs.query({ groupId: g.id });
          result.push({
            id: g.id,
            title: g.title || "Untitled",
            color: g.color,
            collapsed: g.collapsed,
            tabCount: tabs.length,
            tabs: tabs.map((t) => ({
              url: t.url || t.pendingUrl || "",
              title: t.title || "",
              favIconUrl: t.favIconUrl || "",
            })),
          });
        }
        sendResponse({ groups: result });
        break;
      }

      case "getSavedGroups": {
        const savedGroups = await getSavedGroups();
        const map = await getLiveGroupMap();
        // Build reverse map: savedKey → live groupId
        const keyToGroupId = {};
        for (const [gid, k] of Object.entries(map)) {
          keyToGroupId[k] = Number(gid);
        }
        const result = Object.entries(savedGroups).map(([key, g]) => ({
          key,
          title: g.title,
          color: g.color,
          tabCount: g.tabs.length,
          tabs: g.tabs,
          updatedAt: g.updatedAt,
          isActive: key in keyToGroupId,
          liveGroupId: keyToGroupId[key] || null,
        }));
        // Sort by most recently updated
        result.sort((a, b) => b.updatedAt - a.updatedAt);
        sendResponse({ groups: result });
        break;
      }

      case "saveGroup": {
        const key = await saveGroup(msg.groupId);
        sendResponse({ success: true, key });
        break;
      }

      case "restoreGroup": {
        const newGroupId = await restoreGroup(msg.key);
        sendResponse({ success: true, groupId: newGroupId });
        break;
      }

      case "deleteGroup": {
        await deleteSavedGroup(msg.key);
        sendResponse({ success: true });
        break;
      }

      case "renameGroup": {
        await renameSavedGroup(msg.key, msg.title);
        sendResponse({ success: true });
        break;
      }

      case "closeGroup": {
        const tabs = await chrome.tabs.query({ groupId: msg.groupId });
        const tabIds = tabs.map((t) => t.id);
        if (tabIds.length > 0) {
          await chrome.tabs.remove(tabIds);
        }
        // Clean up live map
        const closeMap = await getLiveGroupMap();
        if (closeMap[msg.groupId]) {
          delete closeMap[msg.groupId];
          await setLiveGroupMap(closeMap);
        }
        sendResponse({ success: true });
        break;
      }

      case "getCurrentTabGroup": {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.groupId || activeTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
          sendResponse({ groupId: null, savedKey: null });
          break;
        }
        const currentMap = await getLiveGroupMap();
        sendResponse({
          groupId: activeTab.groupId,
          savedKey: currentMap[activeTab.groupId] || null,
        });
        break;
      }

      default:
        sendResponse({ error: "Unknown action" });
    }
  })();
  return true; // keep message channel open for async response
});

// ─── Startup: rebuild liveGroupMap from current open groups ───────

chrome.runtime.onStartup.addListener(async () => {
  // Clear stale mappings on browser restart
  await setLiveGroupMap({});
});

// Also initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  await getLiveGroupMap();
});
