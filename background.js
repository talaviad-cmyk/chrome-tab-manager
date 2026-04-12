// =============================================================================
// Background Service Worker — MRU tracking, thumbnails, context menus, commands
// =============================================================================

let captureTimeout = null;

// --- In-memory cache for renamedTabs (chrome.storage.local is slow on SW wake) ---
let renamedTabsCache = null;

async function getRenamedTabs() {
  if (renamedTabsCache !== null) return renamedTabsCache;
  const { renamedTabs = {} } = await chrome.storage.local.get('renamedTabs');
  renamedTabsCache = renamedTabs;
  return renamedTabsCache;
}

async function setRenamedTabs(renamedTabs) {
  renamedTabsCache = renamedTabs;
  await chrome.storage.local.set({ renamedTabs });
}

// --- Initialization ---

chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  initialize();
});

function initialize() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'rename-tab',
      title: 'Rename Tab',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'back-to-pinned',
      title: 'Back to Pinned URL',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'set-pinned-url',
      title: 'Set Current URL as Pinned',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'separator-1',
      type: 'separator',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'import-dia-tabs',
      title: 'Import Dia Tabs...',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'open-workspaces',
      title: 'Tab Workspaces...',
      contexts: ['page'],
    });
  });

  chrome.storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
  });

  // Scan existing grouped tabs and pin their current URLs
  scanExistingGroupedTabs();

}

async function scanExistingGroupedTabs() {
  const allTabs = await chrome.tabs.query({});
  const { pinnedUrls = {} } = await chrome.storage.session.get('pinnedUrls');
  let changed = false;
  for (const tab of allTabs) {
    const isGrouped = tab.groupId !== -1;
    const isChromePin = tab.pinned === true;
    if ((isGrouped || isChromePin) && tab.url && !pinnedUrls[tab.id]) {
      pinnedUrls[tab.id] = {
        url: tab.url,
        title: tab.title || '',
        groupId: tab.groupId,
        chromePin: isChromePin,
      };
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.session.set({ pinnedUrls });
  }
}

// --- MRU Tracking ---

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { mruList = [] } = await chrome.storage.session.get('mruList');
  const filtered = mruList.filter((id) => id !== activeInfo.tabId);
  filtered.unshift(activeInfo.tabId);
  const capped = filtered.slice(0, 20);
  await chrome.storage.session.set({ mruList: capped });

  scheduleThumbnailCapture(activeInfo.tabId);

  // Ensure content script is injected (lazy — only when tab is activated)
  ensureContentScript(activeInfo.tabId);
});

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch {
    // Content script not loaded — inject it
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('about:')) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
      }
    } catch {}
  }
}

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (!tab) return;
    const { mruList = [] } = await chrome.storage.session.get('mruList');
    const filtered = mruList.filter((id) => id !== tab.id);
    filtered.unshift(tab.id);
    await chrome.storage.session.set({ mruList: filtered.slice(0, 20) });
  } catch {
    // Window may have closed
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { mruList = [] } = await chrome.storage.session.get('mruList');
  await chrome.storage.session.set({
    mruList: mruList.filter((id) => id !== tabId),
  });

  const { thumbnails = {} } = await chrome.storage.session.get('thumbnails');
  delete thumbnails[tabId];
  await chrome.storage.session.set({ thumbnails });

  const renamedTabs = await getRenamedTabs();
  if (renamedTabs[tabId]) {
    delete renamedTabs[tabId];
    await setRenamedTabs(renamedTabs);
  }
});

// --- Pinned URLs (save URL when tab joins a group or gets pinned) ---

// Detect the EXACT moment a tab is pinned or added to a group
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Tab was just pinned (Chrome pin)
  if (changeInfo.pinned === true) {
    await savePinnedUrl(tabId, tab);
    return;
  }

  // Tab just joined a group
  if (changeInfo.groupId !== undefined && changeInfo.groupId !== -1) {
    await savePinnedUrl(tabId, tab);
    return;
  }
});

async function savePinnedUrl(tabId, tab) {
  if (!tab?.url) return;
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) return;

  const { pinnedUrls = {} } = await chrome.storage.session.get('pinnedUrls');
  // Always overwrite when the pin/group event fires — this is the definitive moment
  pinnedUrls[tabId] = {
    url: tab.url,
    title: tab.title || '',
    groupId: tab.groupId,
    chromePin: tab.pinned === true,
  };
  await chrome.storage.session.set({ pinnedUrls });
}

// Fallback: on activation, save ONLY if no pinned URL exists yet
// (catches tabs that were already grouped/pinned before extension loaded)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab?.url) return;
    const isGrouped = tab.groupId && tab.groupId !== -1;
    const isChromePin = tab.pinned === true;
    if (!isGrouped && !isChromePin) return;
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) return;

    const { pinnedUrls = {} } = await chrome.storage.session.get('pinnedUrls');
    if (!pinnedUrls[tab.id]) {
      pinnedUrls[tab.id] = {
        url: tab.url,
        title: tab.title || '',
        groupId: tab.groupId,
        chromePin: isChromePin,
      };
      await chrome.storage.session.set({ pinnedUrls });
    }
  } catch {}
});

// Clean up pinned URLs on tab close
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { pinnedUrls = {} } = await chrome.storage.session.get('pinnedUrls');
  if (pinnedUrls[tabId]) {
    delete pinnedUrls[tabId];
    await chrome.storage.session.set({ pinnedUrls });
  }
});

// --- Thumbnail Capture ---

function scheduleThumbnailCapture(tabId) {
  if (captureTimeout) clearTimeout(captureTimeout);
  captureTimeout = setTimeout(() => captureThumbnail(tabId), 350);
}

async function captureThumbnail(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url) return;
    const url = tab.url;
    if (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('devtools://') ||
      url.startsWith('about:') ||
      url.startsWith('edge://')
    ) {
      return;
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 50,
    });

    const { thumbnails = {} } = await chrome.storage.session.get('thumbnails');
    thumbnails[tabId] = dataUrl;
    await chrome.storage.session.set({ thumbnails });
  } catch {
    // Tab may have closed, or is a restricted page
  }
}

// --- Context Menu ---

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'rename-tab' && tab?.id) {
    await sendToTab(tab.id, { type: 'SHOW_RENAME_DIALOG' });
  }
  if (info.menuItemId === 'back-to-pinned' && tab?.id) {
    const { pinnedUrls = {} } = await chrome.storage.session.get('pinnedUrls');
    if (pinnedUrls[tab.id]) {
      await navigateToPinnedUrl(tab.id);
    } else {
      // No pinned URL for this tab — notify the user
      await sendToTab(tab.id, {
        type: 'SHOW_TOAST',
        message: 'No pinned URL — add this tab to a group first',
      });
    }
  }
  if (info.menuItemId === 'set-pinned-url' && tab?.id) {
    await setCurrentAsPinnedUrl(tab);
  }
  if (info.menuItemId === 'import-dia-tabs') {
    chrome.tabs.create({ url: chrome.runtime.getURL('import.html') });
  }
  if (info.menuItemId === 'open-workspaces') {
    chrome.tabs.create({ url: chrome.runtime.getURL('workspaces.html') });
  }
});

async function setCurrentAsPinnedUrl(tab) {
  if (!tab?.url || !tab.id) return;
  const { pinnedUrls = {} } = await chrome.storage.session.get('pinnedUrls');
  pinnedUrls[tab.id] = {
    url: tab.url,
    title: tab.title || '',
    groupId: tab.groupId,
    chromePin: tab.pinned === true,
  };
  await chrome.storage.session.set({ pinnedUrls });
  let hostname = '';
  try { hostname = new URL(tab.url).hostname; } catch {}
  await sendToTab(tab.id, {
    type: 'SHOW_TOAST',
    message: `Pinned URL set to ${hostname}`,
  });
}

async function navigateToPinnedUrl(tabId) {
  const { pinnedUrls = {} } = await chrome.storage.session.get('pinnedUrls');
  const entry = pinnedUrls[tabId];
  if (entry?.url) {
    await chrome.tabs.update(tabId, { url: entry.url });
  }
}

// --- Toolbar Icon Click ---

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) {
    await sendToTab(tab.id, { type: 'SHOW_RENAME_DIALOG' });
  }
});

// --- Keyboard Commands ---

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'rename-tab') {
    if (tab?.id) {
      await sendToTab(tab.id, { type: 'SHOW_RENAME_DIALOG' });
    }
    return;
  }

  if (command === 'back-to-pinned') {
    if (tab?.id) {
      await navigateToPinnedUrl(tab.id);
    }
    return;
  }

  if (command === 'set-pinned-url') {
    if (tab) {
      await setCurrentAsPinnedUrl(tab);
    }
    return;
  }

  if (command === 'duplicate-tab') {
    if (tab?.id) {
      try {
        await chrome.tabs.duplicate(tab.id);
      } catch {
        // Tab may not support duplication
      }
    }
    return;
  }

  if (command === 'move-tab-up' || command === 'move-tab-down') {
    if (!tab) return;
    try {
      const tabsInWindow = await chrome.tabs.query({ windowId: tab.windowId });
      tabsInWindow.sort((a, b) => a.index - b.index);
      const currentIdx = tabsInWindow.findIndex((t) => t.id === tab.id);
      const targetIdx =
        command === 'move-tab-up' ? currentIdx - 1 : currentIdx + 1;
      if (targetIdx >= 0 && targetIdx < tabsInWindow.length) {
        await chrome.tabs.update(tabsInWindow[targetIdx].id, { active: true });
      }
    } catch {
      // Window may have closed
    }
    return;
  }

  if (
    command === 'switch-tab-forward' ||
    command === 'switch-tab-backward'
  ) {
    const t0 = performance.now();
    console.log(`[SWITCHER] ${new Date().toISOString()} Command received: ${command}, tab: ${tab?.id}, url: ${tab?.url?.slice(0, 60)}`);

    const direction = command === 'switch-tab-forward' ? 1 : -1;

    const t1 = performance.now();
    const { mruList = [] } = await chrome.storage.session.get('mruList');
    console.log(`[SWITCHER] +${(performance.now() - t1).toFixed(1)}ms storage.session.get(mruList) — ${mruList.length} entries: [${mruList.slice(0, 6).join(', ')}]`);

    const t2 = performance.now();
    const { thumbnails = {} } =
      await chrome.storage.session.get('thumbnails');
    console.log(`[SWITCHER] +${(performance.now() - t2).toFixed(1)}ms storage.session.get(thumbnails) — ${Object.keys(thumbnails).length} entries`);

    const t3 = performance.now();
    const renamedTabs = await getRenamedTabs();
    console.log(`[SWITCHER] +${(performance.now() - t3).toFixed(1)}ms getRenamedTabs (cached)`);

    const tabInfos = [];
    const t4 = performance.now();
    for (const tabId of mruList.slice(0, 6)) {
      try {
        const tabData = await chrome.tabs.get(tabId);
        tabInfos.push({
          id: tabData.id,
          title: renamedTabs[tabId]?.title || tabData.title,
          url: tabData.url,
          favIconUrl: tabData.favIconUrl || '',
          thumbnail: thumbnails[tabId] || null,
          windowId: tabData.windowId,
        });
      } catch (err) {
        console.log(`[SWITCHER] tabs.get(${tabId}) failed: ${err.message}`);
      }
    }
    console.log(`[SWITCHER] +${(performance.now() - t4).toFixed(1)}ms built ${tabInfos.length} tab infos`);

    if (tabInfos.length === 0) {
      console.log(`[SWITCHER] No tabs to show, aborting`);
      return;
    }

    if (tab?.id) {
      const t5 = performance.now();
      console.log(`[SWITCHER] Sending SHOW_TAB_SWITCHER to tab ${tab.id}...`);
      await sendToTab(tab.id, {
        type: 'SHOW_TAB_SWITCHER',
        tabs: tabInfos,
        direction,
      });
      console.log(`[SWITCHER] +${(performance.now() - t5).toFixed(1)}ms sendToTab completed`);
    } else {
      console.log(`[SWITCHER] No active tab to send to`);
    }

    console.log(`[SWITCHER] Total: ${(performance.now() - t0).toFixed(1)}ms`);
  }
});

// --- Message Handler (from content script) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_TAB_NAME') {
    (async () => {
      const renamedTabs = await getRenamedTabs();
      renamedTabs[message.tabId] = {
        title: message.title,
        url: message.url,
      };
      await setRenamedTabs(renamedTabs);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'GET_TAB_INFO') {
    (async () => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        sendResponse({ customTitle: null });
        return;
      }
      const renamedTabs = await getRenamedTabs();
      const entry = renamedTabs[tabId];
      sendResponse({ customTitle: entry?.title || null });
    })();
    return true;
  }

  if (message.type === 'SWITCH_TO_TAB') {
    (async () => {
      try {
        await chrome.tabs.update(message.tabId, { active: true });
        if (message.windowId) {
          await chrome.windows.update(message.windowId, { focused: true });
        }
      } catch {
        // Tab may have been closed
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'MOVE_TAB') {
    (async () => {
      const tab = sender.tab;
      if (!tab) { sendResponse({ ok: false }); return; }
      try {
        const tabsInWindow = await chrome.tabs.query({ windowId: tab.windowId });
        tabsInWindow.sort((a, b) => a.index - b.index);
        const currentIdx = tabsInWindow.findIndex((t) => t.id === tab.id);
        const targetIdx =
          message.direction === 'up' ? currentIdx - 1 : currentIdx + 1;
        if (targetIdx >= 0 && targetIdx < tabsInWindow.length) {
          await chrome.tabs.update(tabsInWindow[targetIdx].id, { active: true });
        }
      } catch {
        // Window may have closed
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'QUICK_SAVE_WORKSPACE') {
    (async () => {
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      let groups = [];
      try {
        groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
      } catch {}

      const groupMap = {};
      for (const g of groups) {
        groupMap[g.id] = {
          name: g.title || '',
          color: g.color || 'grey',
          collapsed: g.collapsed || false,
          tabs: [],
        };
      }

      const pinnedTabs = [];
      const ungroupedTabs = [];

      for (const tab of allTabs) {
        if (tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://')) continue;
        const entry = { url: tab.url, title: tab.title || '', favIconUrl: tab.favIconUrl || '' };
        if (tab.pinned) {
          pinnedTabs.push(entry);
        } else if (tab.groupId !== -1 && groupMap[tab.groupId]) {
          groupMap[tab.groupId].tabs.push(entry);
        } else {
          ungroupedTabs.push(entry);
        }
      }

      const workspace = {
        name: message.name,
        savedAt: new Date().toISOString(),
        pinnedTabs,
        groups: Object.values(groupMap).filter(g => g.tabs.length > 0),
        ungroupedTabs,
      };

      const { workspaces = [] } = await chrome.storage.local.get('workspaces');
      workspaces.unshift(workspace);
      await chrome.storage.local.set({ workspaces });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'SEARCH_TABS') {
    (async () => {
      const allTabs = await chrome.tabs.query({});
      const renamedTabs = await getRenamedTabs();
      const tabs = allTabs
        .filter(t => t.url && !t.url.startsWith('chrome-extension://'))
        .map(t => ({
          id: t.id,
          title: renamedTabs[t.id]?.title || t.title || '',
          url: t.url,
          favIconUrl: t.favIconUrl || '',
          windowId: t.windowId,
          pinned: t.pinned,
          groupId: t.groupId,
        }));
      sendResponse({ tabs });
    })();
    return true;
  }

  if (message.type === 'BACK_TO_PINNED') {
    (async () => {
      const tabId = sender.tab?.id;
      if (tabId) {
        await navigateToPinnedUrl(tabId);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'GET_PINNED_URL') {
    (async () => {
      const tabId = sender.tab?.id;
      const { pinnedUrls = {} } = await chrome.storage.session.get('pinnedUrls');
      sendResponse({ pinnedUrl: pinnedUrls[tabId] || null });
    })();
    return true;
  }

  if (message.type === 'GET_MY_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id || null });
    return;
  }

  if (message.type === 'CLEAR_TAB_NAME') {
    (async () => {
      const tabId = message.tabId;
      const renamedTabs = await getRenamedTabs();
      if (renamedTabs[tabId]) {
        delete renamedTabs[tabId];
        await setRenamedTabs(renamedTabs);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});

// --- Title Restoration on Page Load ---

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const renamedTabs = await getRenamedTabs();
  const entry = renamedTabs[tabId];
  if (!entry) return;

  // Only apply title if the URL is on the same origin as when it was renamed.
  // If different origin, skip but DON'T delete — user may navigate back.
  try {
    const savedOrigin = new URL(entry.url).origin;
    const currentOrigin = new URL(tab.url).origin;
    if (savedOrigin !== currentOrigin) {
      return; // Skip, but keep the entry for when user returns
    }
  } catch {
    return;
  }

  // Send title restoration — try multiple times because:
  // 1. Content script may not be ready yet (just navigated)
  // 2. SPA pages may overwrite the title AFTER status:complete
  async function applyTitle(tid, title) {
    try {
      await chrome.tabs.sendMessage(tid, { type: 'APPLY_CUSTOM_TITLE', title });
    } catch {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tid }, files: ['content.js'] });
        await new Promise(r => setTimeout(r, 100));
        await chrome.tabs.sendMessage(tid, { type: 'APPLY_CUSTOM_TITLE', title });
      } catch {}
    }
  }

  await applyTitle(tabId, entry.title);
  // Retry after delays to catch late SPA title changes
  setTimeout(() => applyTitle(tabId, entry.title), 500);
  setTimeout(() => applyTitle(tabId, entry.title), 1500);
  setTimeout(() => applyTitle(tabId, entry.title), 3000);
});

// --- Helper: Send message to tab with fallback injection ---

async function sendToTab(tabId, message) {
  const t0 = performance.now();
  try {
    await chrome.tabs.sendMessage(tabId, message);
    console.log(`[SEND] +${(performance.now() - t0).toFixed(1)}ms sendMessage(${tabId}, ${message.type}) — direct success`);
  } catch (err) {
    console.log(`[SEND] +${(performance.now() - t0).toFixed(1)}ms sendMessage(${tabId}, ${message.type}) — FAILED: ${err.message}`);
    console.log(`[SEND] Falling back to executeScript injection...`);
    try {
      const t1 = performance.now();
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      console.log(`[SEND] +${(performance.now() - t1).toFixed(1)}ms executeScript completed`);
      await new Promise((r) => setTimeout(r, 100));
      await chrome.tabs.sendMessage(tabId, message);
      console.log(`[SEND] +${(performance.now() - t0).toFixed(1)}ms retry sendMessage — success`);
    } catch (err2) {
      console.log(`[SEND] +${(performance.now() - t0).toFixed(1)}ms retry FAILED: ${err2.message}`);
    }
  }
}
