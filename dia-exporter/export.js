// Full-page exporter: lets user organize tabs into groups before exporting.

const COLORS = ['blue','red','yellow','green','pink','purple','cyan','orange','grey'];
const COLOR_HEX = {
  grey:'#5f6368', blue:'#4a9eff', red:'#ea4335', yellow:'#fbbc04',
  green:'#34a853', pink:'#ff6d93', purple:'#a142f4', cyan:'#24c1e0', orange:'#fa903e',
};

let allTabs = [];       // { id, url, title, favIconUrl }
let groups = [];        // { name, color, tabIds: Set }
let pinnedIds = new Set();
let nextColorIdx = 0;

// --- Init ---

async function init() {
  const tabs = await chrome.tabs.query({});
  allTabs = tabs
    .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
    .map(t => ({ id: t.id, url: t.url, title: t.title || '', favIconUrl: t.favIconUrl || '' }));

  render();
  wireButtons();
}

// --- Rendering ---

function render() {
  const container = document.getElementById('tabList');

  // Tabs already assigned to groups
  const assignedIds = new Set();
  groups.forEach(g => g.tabIds.forEach(id => assignedIds.add(id)));

  let html = '';

  // Pinned section
  const pinnedTabs = allTabs.filter(t => pinnedIds.has(t.id));
  if (pinnedTabs.length) {
    html += `<div class="group-section">
      <div class="group-header">
        <div class="color-dot" style="background:#fa903e"></div>
        Pinned Tabs (${pinnedTabs.length})
        <button class="remove-group" data-action="unpin-all" title="Unpin all">&times;</button>
      </div>`;
    for (const t of pinnedTabs) {
      html += tabItemHtml(t, false);
    }
    html += '</div>';
  }

  // Group sections
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const gTabs = allTabs.filter(t => g.tabIds.has(t.id));
    const color = COLOR_HEX[g.color] || COLOR_HEX.grey;
    html += `<div class="group-section">
      <div class="group-header">
        <div class="color-dot" style="background:${color}"></div>
        ${esc(g.name)} (${gTabs.length} tabs)
        <button class="remove-group" data-action="remove-group" data-gi="${gi}" title="Dissolve group">&times;</button>
      </div>`;
    for (const t of gTabs) {
      html += tabItemHtml(t, false);
    }
    html += '</div>';
  }

  // Ungrouped section
  const ungrouped = allTabs.filter(t => !assignedIds.has(t.id) && !pinnedIds.has(t.id));
  if (ungrouped.length) {
    html += `<div class="group-section">
      <div class="group-header">
        <div class="color-dot" style="background:#555"></div>
        Ungrouped Tabs (${ungrouped.length})
      </div>`;
    for (const t of ungrouped) {
      html += tabItemHtml(t, true);
    }
    html += '</div>';
  }

  container.innerHTML = html;

  // Wire checkboxes and clicks
  container.querySelectorAll('.tab-item').forEach(el => {
    const cb = el.querySelector('input[type="checkbox"]');
    if (cb) {
      el.addEventListener('click', (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        el.classList.toggle('selected', cb.checked);
        updateToolbar();
      });
      cb.addEventListener('change', () => {
        el.classList.toggle('selected', cb.checked);
        updateToolbar();
      });
    }
  });

  // Wire remove-group buttons
  container.querySelectorAll('[data-action="remove-group"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const gi = parseInt(btn.dataset.gi);
      groups.splice(gi, 1);
      render();
    });
  });
  container.querySelectorAll('[data-action="unpin-all"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      pinnedIds.clear();
      render();
    });
  });

  updateStats();
  updateToolbar();
}

function tabItemHtml(tab, selectable) {
  const favicon = tab.favIconUrl
    ? `<img class="favicon" src="${esc(tab.favIconUrl)}" onerror="this.style.display='none'">`
    : '';
  const checkbox = selectable
    ? `<input type="checkbox" data-tab-id="${tab.id}">`
    : '';
  const pinBadge = pinnedIds.has(tab.id) ? '<span class="pin-badge">PIN</span>' : '';
  let host = '';
  try { host = new URL(tab.url).hostname; } catch {}
  return `<div class="tab-item" data-tab-id="${tab.id}">
    ${checkbox}${favicon}
    <span class="title">${esc(tab.title)}</span>
    <span class="url">${esc(host)}</span>
    ${pinBadge}
  </div>`;
}

function updateStats() {
  const assignedIds = new Set();
  groups.forEach(g => g.tabIds.forEach(id => assignedIds.add(id)));
  const ungrouped = allTabs.filter(t => !assignedIds.has(t.id) && !pinnedIds.has(t.id));
  document.getElementById('stats').innerHTML =
    `Total: <span>${allTabs.length}</span> &middot; ` +
    `Pinned: <span>${pinnedIds.size}</span> &middot; ` +
    `Groups: <span>${groups.length}</span> &middot; ` +
    `Ungrouped: <span>${ungrouped.length}</span>`;
}

function updateToolbar() {
  const selected = getSelectedIds();
  document.getElementById('createGroupBtn').disabled = selected.length === 0;
  document.getElementById('markPinnedBtn').disabled = selected.length === 0;
}

function getSelectedIds() {
  const ids = [];
  document.querySelectorAll('.tab-item input[type="checkbox"]:checked').forEach(cb => {
    ids.push(parseInt(cb.dataset.tabId));
  });
  return ids;
}

// --- Actions ---

function wireButtons() {
  document.getElementById('createGroupBtn').addEventListener('click', () => {
    const ids = getSelectedIds();
    if (!ids.length) return;
    const name = prompt('Group name:');
    if (!name) return;
    const color = COLORS[nextColorIdx % COLORS.length];
    nextColorIdx++;
    groups.push({ name, color, tabIds: new Set(ids) });
    render();
  });

  document.getElementById('markPinnedBtn').addEventListener('click', () => {
    const ids = getSelectedIds();
    ids.forEach(id => pinnedIds.add(id));
    render();
  });

  document.getElementById('selectAllBtn').addEventListener('click', () => {
    document.querySelectorAll('.tab-item input[type="checkbox"]').forEach(cb => {
      cb.checked = true;
      cb.closest('.tab-item').classList.add('selected');
    });
    updateToolbar();
  });

  document.getElementById('deselectAllBtn').addEventListener('click', () => {
    document.querySelectorAll('.tab-item input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
      cb.closest('.tab-item').classList.remove('selected');
    });
    updateToolbar();
  });

  document.getElementById('exportBtn').addEventListener('click', exportJson);
}

// --- Export ---

function exportJson() {
  const profile = document.getElementById('profileName').value.trim() || 'default';

  const assignedIds = new Set();
  groups.forEach(g => g.tabIds.forEach(id => assignedIds.add(id)));

  const tabById = {};
  allTabs.forEach(t => { tabById[t.id] = t; });

  const data = {
    profile,
    exportedAt: new Date().toISOString(),
    pinnedTabs: allTabs.filter(t => pinnedIds.has(t.id)).map(t => ({ url: t.url, title: t.title })),
    groups: groups.map(g => ({
      name: g.name,
      color: g.color,
      collapsed: true,
      tabs: [...g.tabIds].map(id => tabById[id]).filter(Boolean).map(t => ({ url: t.url, title: t.title })),
    })),
    ungroupedTabs: allTabs
      .filter(t => !assignedIds.has(t.id) && !pinnedIds.has(t.id))
      .map(t => ({ url: t.url, title: t.title })),
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dia-export-${profile}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

init();
