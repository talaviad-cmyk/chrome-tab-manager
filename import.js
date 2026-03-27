// Import Dia tabs/groups from exported JSON into Chrome.

const COLOR_MAP = {
  grey: '#5f6368', blue: '#4a9eff', red: '#ea4335',
  yellow: '#fbbc04', green: '#34a853', pink: '#ff6d93',
  purple: '#a142f4', cyan: '#24c1e0', orange: '#fa903e',
};

let importData = null;

// --- File handling ---

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) loadFile(file);
});

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      importData = JSON.parse(e.target.result);
      showPreview(importData);
    } catch (err) {
      alert('Invalid JSON file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// --- Preview ---

function showPreview(data) {
  const preview = document.getElementById('preview');
  const totalTabs =
    (data.pinnedTabs?.length || 0) +
    (data.groups || []).reduce((n, g) => n + (g.tabs?.length || 0), 0) +
    (data.ungroupedTabs?.length || 0);

  let html = `
    <h3>Preview — ${escapeHtml(data.profile || 'Unknown profile')}</h3>
    <div class="stats">
      <div class="stat"><div class="stat-value">${data.pinnedTabs?.length || 0}</div><div class="stat-label">Pinned Tabs</div></div>
      <div class="stat"><div class="stat-value">${data.groups?.length || 0}</div><div class="stat-label">Groups</div></div>
      <div class="stat"><div class="stat-value">${data.ungroupedTabs?.length || 0}</div><div class="stat-label">Ungrouped</div></div>
    </div>
  `;

  if (data.pinnedTabs?.length) {
    html += '<div class="section-header">Pinned Tabs</div><div class="group-tabs">';
    for (const t of data.pinnedTabs) {
      html += `<div class="group-tab">${escapeHtml(t.title || t.url)}</div>`;
    }
    html += '</div>';
  }

  if (data.groups?.length) {
    html += '<div class="section-header">Tab Groups</div><div class="group-list">';
    for (const g of data.groups) {
      const color = COLOR_MAP[g.color] || '#5f6368';
      html += `
        <div class="group-item">
          <div class="group-color" style="background:${color}"></div>
          <span class="group-name">${escapeHtml(g.name)}</span>
          <span class="group-count">${g.tabs?.length || 0} tabs</span>
        </div>
      `;
      if (g.tabs?.length) {
        html += '<div class="group-tabs">';
        for (const t of g.tabs) {
          html += `<div class="group-tab">${escapeHtml(t.title || t.url)}</div>`;
        }
        html += '</div>';
      }
    }
    html += '</div>';
  }

  if (data.ungroupedTabs?.length) {
    html += '<div class="section-header">Ungrouped Tabs</div><div class="group-tabs">';
    for (const t of data.ungroupedTabs.slice(0, 20)) {
      html += `<div class="group-tab">${escapeHtml(t.title || t.url)}</div>`;
    }
    if (data.ungroupedTabs.length > 20) {
      html += `<div class="group-tab" style="color:#666">...and ${data.ungroupedTabs.length - 20} more</div>`;
    }
    html += '</div>';
  }

  html += `
    <div class="actions" style="margin-top:16px">
      <button class="btn-secondary" id="clearBtn">Clear</button>
      <button class="btn-primary" id="importBtn">Import ${totalTabs} tabs</button>
    </div>
  `;

  preview.innerHTML = html;
  preview.classList.add('visible');

  document.getElementById('clearBtn').addEventListener('click', () => {
    importData = null;
    preview.classList.remove('visible');
    preview.innerHTML = '';
    fileInput.value = '';
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    runImport(data);
  });
}

// --- Import ---

async function runImport(data) {
  const importBtn = document.getElementById('importBtn');
  importBtn.disabled = true;

  const progress = document.getElementById('progress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  progress.classList.add('visible');

  const totalSteps =
    (data.pinnedTabs?.length || 0) +
    (data.groups?.length || 0) +
    (data.groups || []).reduce((n, g) => n + (g.tabs?.length || 0), 0) +
    (data.ungroupedTabs?.length || 0);

  let completed = 0;

  function updateProgress(msg) {
    completed++;
    const pct = Math.round((completed / totalSteps) * 100);
    progressFill.style.width = pct + '%';
    progressText.textContent = msg;
  }

  try {
    // 1. Create pinned tabs
    if (data.pinnedTabs?.length) {
      for (const t of data.pinnedTabs) {
        if (!t.url) continue;
        await chrome.tabs.create({ url: t.url, pinned: true, active: false });
        updateProgress(`Pinned: ${t.title || t.url}`);
        await sleep(100);
      }
    }

    // 2. Create tab groups
    if (data.groups?.length) {
      for (const group of data.groups) {
        updateProgress(`Creating group: ${group.name}`);
        if (!group.tabs?.length) continue;

        // Create all tabs in this group
        const tabIds = [];
        for (const t of group.tabs) {
          if (!t.url) continue;
          const newTab = await chrome.tabs.create({ url: t.url, active: false });
          tabIds.push(newTab.id);
          updateProgress(`Tab: ${t.title || t.url}`);
          await sleep(100);
        }

        if (tabIds.length === 0) continue;

        // Group the tabs
        const groupId = await chrome.tabs.group({ tabIds });

        // Set group name and color
        const updateProps = {};
        if (group.name) updateProps.title = group.name;
        if (group.color) updateProps.color = group.color;
        if (group.collapsed !== undefined) updateProps.collapsed = group.collapsed;
        await chrome.tabGroups.update(groupId, updateProps);
      }
    }

    // 3. Create ungrouped tabs
    if (data.ungroupedTabs?.length) {
      for (const t of data.ungroupedTabs) {
        if (!t.url) continue;
        await chrome.tabs.create({ url: t.url, active: false });
        updateProgress(`Tab: ${t.title || t.url}`);
        await sleep(100);
      }
    }

    progressFill.style.width = '100%';
    progressText.textContent = `Done! Imported ${completed} items.`;
    progressFill.style.background = '#34a853';
  } catch (err) {
    progressText.textContent = `Error: ${err.message}`;
    progressFill.style.background = '#ea4335';
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
