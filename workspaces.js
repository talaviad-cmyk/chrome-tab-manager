// Tab Workspaces — save/restore sets of tabs, groups, and pinned tabs.

async function init() {
  await renderWorkspaces();
  document.getElementById('saveBtn').addEventListener('click', saveWorkspace);
  document.getElementById('workspaceName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveWorkspace();
  });
}

// --- Save ---

async function saveWorkspace() {
  const nameInput = document.getElementById('workspaceName');
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    nameInput.style.borderColor = '#ea4335';
    setTimeout(() => { nameInput.style.borderColor = ''; }, 1500);
    return;
  }

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
    name,
    savedAt: new Date().toISOString(),
    pinnedTabs,
    groups: Object.values(groupMap).filter(g => g.tabs.length > 0),
    ungroupedTabs,
  };

  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  workspaces.unshift(workspace);
  await chrome.storage.local.set({ workspaces });

  nameInput.value = '';
  await renderWorkspaces();
}

// --- Restore ---

async function restoreWorkspace(index) {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  const ws = workspaces[index];
  if (!ws) return;

  // Create pinned tabs
  for (const t of ws.pinnedTabs || []) {
    if (!t.url) continue;
    await chrome.tabs.create({ url: t.url, pinned: true, active: false });
    await sleep(100);
  }

  // Create groups
  for (const group of ws.groups || []) {
    if (!group.tabs?.length) continue;
    const tabIds = [];
    for (const t of group.tabs) {
      if (!t.url) continue;
      const newTab = await chrome.tabs.create({ url: t.url, active: false });
      tabIds.push(newTab.id);
      await sleep(100);
    }
    if (tabIds.length > 0) {
      const groupId = await chrome.tabs.group({ tabIds });
      const props = {};
      if (group.name) props.title = group.name;
      if (group.color) props.color = group.color;
      if (group.collapsed !== undefined) props.collapsed = group.collapsed;
      await chrome.tabGroups.update(groupId, props);
    }
  }

  // Create ungrouped tabs
  for (const t of ws.ungroupedTabs || []) {
    if (!t.url) continue;
    await chrome.tabs.create({ url: t.url, active: false });
    await sleep(100);
  }
}

// --- Delete ---

async function deleteWorkspace(index) {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  workspaces.splice(index, 1);
  await chrome.storage.local.set({ workspaces });
  await renderWorkspaces();
}

// --- Render ---

async function renderWorkspaces() {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  const container = document.getElementById('workspaceList');

  if (workspaces.length === 0) {
    container.innerHTML = '<div class="empty-state">No saved workspaces yet. Save your current tabs above.</div>';
    return;
  }

  container.innerHTML = workspaces.map((ws, i) => {
    const totalTabs = (ws.pinnedTabs?.length || 0) +
      (ws.groups || []).reduce((n, g) => n + (g.tabs?.length || 0), 0) +
      (ws.ungroupedTabs?.length || 0);
    const date = new Date(ws.savedAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    let tabsHtml = '';

    if (ws.pinnedTabs?.length) {
      tabsHtml += '<div class="ws-group-label">Pinned</div>';
      tabsHtml += ws.pinnedTabs.map(t => tabItemHtml(t)).join('');
    }

    for (const g of ws.groups || []) {
      tabsHtml += `<div class="ws-group-label">${esc(g.name || 'Unnamed group')} (${g.tabs.length})</div>`;
      tabsHtml += g.tabs.map(t => tabItemHtml(t)).join('');
    }

    if (ws.ungroupedTabs?.length) {
      tabsHtml += '<div class="ws-group-label">Ungrouped</div>';
      tabsHtml += ws.ungroupedTabs.slice(0, 15).map(t => tabItemHtml(t)).join('');
      if (ws.ungroupedTabs.length > 15) {
        tabsHtml += `<div style="font-size:11px;color:#666;padding:4px 0">...and ${ws.ungroupedTabs.length - 15} more</div>`;
      }
    }

    return `
      <div class="workspace-card">
        <div class="workspace-header">
          <div class="workspace-name">${esc(ws.name)}</div>
          <div class="workspace-meta">${date}</div>
        </div>
        <div class="workspace-stats">
          <div>Tabs: <span>${totalTabs}</span></div>
          <div>Pinned: <span>${ws.pinnedTabs?.length || 0}</span></div>
          <div>Groups: <span>${ws.groups?.length || 0}</span></div>
        </div>
        <button class="toggle-tabs" data-index="${i}">Show tabs</button>
        <div class="workspace-tabs" id="ws-tabs-${i}">${tabsHtml}</div>
        <div class="workspace-actions" style="margin-top:10px">
          <button class="btn-green restore-btn" data-index="${i}">Restore</button>
          <button class="btn-red delete-btn" data-index="${i}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Wire event listeners
  container.querySelectorAll('.restore-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Restoring...';
      await restoreWorkspace(parseInt(btn.dataset.index));
      btn.textContent = 'Restored!';
    });
  });

  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Delete this workspace?')) {
        deleteWorkspace(parseInt(btn.dataset.index));
      }
    });
  });

  container.querySelectorAll('.toggle-tabs').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabs = document.getElementById(`ws-tabs-${btn.dataset.index}`);
      const expanded = tabs.classList.toggle('expanded');
      btn.textContent = expanded ? 'Hide tabs' : 'Show tabs';
    });
  });
}

function tabItemHtml(tab) {
  const favicon = tab.favIconUrl
    ? `<img src="${esc(tab.favIconUrl)}" onerror="this.style.display='none'">`
    : '';
  let host = '';
  try { host = new URL(tab.url).hostname; } catch {}
  return `<div class="ws-tab-item">${favicon}<span class="ws-tab-title">${esc(tab.title)}</span><span class="ws-tab-url">${esc(host)}</span></div>`;
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

init();
