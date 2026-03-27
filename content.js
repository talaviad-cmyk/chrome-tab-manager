// =============================================================================
// Content Script — Shadow DOM overlay for tab switcher & rename dialog
// =============================================================================

(function () {
  // Guard against double-injection
  if (window.__tabManagerExtLoaded) return;
  window.__tabManagerExtLoaded = true;

  // --- Shadow DOM Setup ---

  const host = document.createElement('div');
  host.id = '__tab-manager-ext-host__';
  host.style.cssText = 'all:initial; position:fixed; z-index:2147483647; top:0; left:0; width:0; height:0;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'closed' });

  // Load CSS into shadow root
  const styleEl = document.createElement('style');
  shadow.appendChild(styleEl);

  fetch(chrome.runtime.getURL('content.css'))
    .then((r) => r.text())
    .then((css) => {
      styleEl.textContent = css;
    })
    .catch(() => {
      // Extension may have been reloaded — use inline fallback
    });

  // --- State ---

  let isSwitcherOpen = false;
  let selectedIndex = 0;
  let switcherTabs = [];
  let switcherOverlay = null;
  let renameOverlay = null;
  let customTitle = null;
  let titleObserver = null;
  // --- Global key release detection ---
  // chrome.commands swallows the Alt keyup event, so we can't detect it directly.
  // Instead we use multiple strategies:
  //
  // 1. Direct keyup for 'Alt' — works if Chrome forwards it
  // 2. Any keydown/keyup where altKey===false — proves Alt was released
  // 3. Window blur — user clicked away or switched via other means
  //
  // NO idle timer — we only switch on actual key release evidence.

  window.addEventListener(
    'keyup',
    (e) => {
      if (!isSwitcherOpen) return;
      // Strategy 1: Direct Alt keyup
      if (e.key === 'Alt') {
        e.preventDefault();
        e.stopPropagation();
        switchToTab(selectedIndex);
        return;
      }
      // Strategy 2: Any key released while Alt is no longer held
      // (e.g., user released Alt first, then released S — this keyup for S has altKey=false)
      if (!e.altKey && e.key !== 'Escape' && e.key !== 'Enter') {
        switchToTab(selectedIndex);
        return;
      }
    },
    true,
  );

  // Strategy 2b: Any keydown without Alt held means Alt was released
  window.addEventListener(
    'keydown',
    (e) => {
      if (!isSwitcherOpen) return;
      // If a non-modifier key is pressed WITHOUT Alt, user released Alt
      if (!e.altKey && !e.metaKey && !e.ctrlKey &&
          e.key !== 'Alt' && e.key !== 'Meta' && e.key !== 'Control' && e.key !== 'Shift' &&
          e.key !== 'Escape' && e.key !== 'Enter' &&
          e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Tab') {
        switchToTab(selectedIndex);
      }
    },
    true,
  );

  // Strategy 3: Window blur (e.g., user clicked outside, or used mouse)
  window.addEventListener('blur', () => {
    if (isSwitcherOpen) {
      switchToTab(selectedIndex);
    }
  });

  // --- Cmd+Shift+C: Copy current tab URL to clipboard ---

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.metaKey && e.shiftKey && e.key === 'c') {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(location.href).then(() => {
          showToast('URL copied to clipboard');
        }).catch(() => {
          // Fallback for pages where clipboard API is blocked
          const ta = document.createElement('textarea');
          ta.value = location.href;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          showToast('URL copied to clipboard');
        });
      }
    },
    true,
  );

  // --- Global keyboard listener for Cmd+Option+Up/Down (tab navigation) ---
  // Handled here instead of chrome.commands because Chrome blocks that key combo
  // in the manifest suggested_key.

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        e.stopPropagation();
        chrome.runtime.sendMessage({
          type: 'MOVE_TAB',
          direction: e.key === 'ArrowUp' ? 'up' : 'down',
        });
      }
    },
    true,
  );

  // --- Message Listener ---

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'SHOW_RENAME_DIALOG':
        showRenameDialog();
        sendResponse({ ok: true });
        break;

      case 'SHOW_TAB_SWITCHER':
        if (isSwitcherOpen) {
          advanceSelection(message.direction);
        } else {
          showTabSwitcher(message.tabs, message.direction);
        }
        sendResponse({ ok: true });
        break;

      case 'APPLY_CUSTOM_TITLE':
        applyCustomTitle(message.title);
        sendResponse({ ok: true });
        break;

      case 'SHOW_TOAST':
        showToast(message.message);
        sendResponse({ ok: true });
        break;
    }
  });

  // --- Init: Restore custom title ---

  chrome.runtime.sendMessage({ type: 'GET_TAB_INFO' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.customTitle) {
      applyCustomTitle(response.customTitle);
    }
  });

  // ==========================================================================
  // RENAME DIALOG
  // ==========================================================================

  function showRenameDialog() {
    if (renameOverlay) closeRenameDialog();

    renameOverlay = document.createElement('div');
    renameOverlay.className = 'tm-overlay';
    renameOverlay.innerHTML = `
      <div class="tm-rename-dialog">
        <div class="tm-rename-header">Rename Tab</div>
        <input class="tm-rename-input" type="text" placeholder="Enter tab name..." />
        <div class="tm-rename-actions">
          <button class="tm-btn tm-btn-clear">Reset</button>
          <button class="tm-btn tm-btn-cancel">Cancel</button>
          <button class="tm-btn tm-btn-save">Save</button>
        </div>
      </div>
    `;

    shadow.appendChild(renameOverlay);

    const input = renameOverlay.querySelector('.tm-rename-input');
    const saveBtn = renameOverlay.querySelector('.tm-btn-save');
    const cancelBtn = renameOverlay.querySelector('.tm-btn-cancel');
    const clearBtn = renameOverlay.querySelector('.tm-btn-clear');

    input.value = customTitle || document.title;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });

    function save() {
      const newTitle = input.value.trim();
      if (newTitle) {
        applyCustomTitle(newTitle);
        chrome.runtime.sendMessage({
          type: 'SAVE_TAB_NAME',
          tabId: getTabId(),
          title: newTitle,
          url: location.href,
        });
      }
      closeRenameDialog();
    }

    function clearName() {
      customTitle = null;
      stopTitleObserver();
      // Restore original title by reloading — or just let the page set its own
      const original = document.querySelector('title');
      if (original && original.dataset.tmOriginal) {
        document.title = original.dataset.tmOriginal;
      }
      chrome.runtime.sendMessage({
        type: 'CLEAR_TAB_NAME',
        tabId: getTabId(),
      });
      closeRenameDialog();
    }

    saveBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', closeRenameDialog);
    clearBtn.addEventListener('click', clearName);

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') closeRenameDialog();
    });

    // Click outside to close
    renameOverlay.addEventListener('click', (e) => {
      if (e.target === renameOverlay) closeRenameDialog();
    });
  }

  function closeRenameDialog() {
    if (renameOverlay) {
      renameOverlay.remove();
      renameOverlay = null;
    }
  }

  // ==========================================================================
  // TITLE MANAGEMENT
  // ==========================================================================

  function applyCustomTitle(title) {
    customTitle = title;

    // Store original title for reset
    const titleEl = document.querySelector('title');
    if (titleEl && !titleEl.dataset.tmOriginal) {
      titleEl.dataset.tmOriginal = document.title;
    }

    document.title = title;
    startTitleObserver();
  }

  function startTitleObserver() {
    stopTitleObserver();

    titleObserver = new MutationObserver(() => {
      if (customTitle && document.title !== customTitle) {
        document.title = customTitle;
      }
    });

    const titleElement = document.querySelector('title');
    if (titleElement) {
      titleObserver.observe(titleElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    // Also watch head for title element replacement
    if (document.head) {
      titleObserver.observe(document.head, { childList: true });
    }
  }

  function stopTitleObserver() {
    if (titleObserver) {
      titleObserver.disconnect();
      titleObserver = null;
    }
  }

  // ==========================================================================
  // TAB SWITCHER
  // ==========================================================================

  function showTabSwitcher(tabs, direction) {
    if (tabs.length === 0) return;
    closeSwitcher();

    isSwitcherOpen = true;
    switcherTabs = tabs;

    // Start at the second item (first is current tab)
    if (direction === 1) {
      selectedIndex = tabs.length > 1 ? 1 : 0;
    } else {
      selectedIndex = tabs.length - 1;
    }

    switcherOverlay = document.createElement('div');
    switcherOverlay.className = 'tm-overlay';

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';

    const grid = document.createElement('div');
    grid.className = 'tm-switcher-container';

    tabs.forEach((tab, index) => {
      const card = createTabCard(tab, index);
      grid.appendChild(card);
    });

    const hint = document.createElement('div');
    hint.className = 'tm-hint';
    hint.innerHTML =
      'Release <kbd>Alt</kbd> to switch · <kbd>←</kbd> <kbd>→</kbd> navigate · <kbd>Esc</kbd> cancel';

    container.appendChild(grid);
    container.appendChild(hint);
    switcherOverlay.appendChild(container);
    shadow.appendChild(switcherOverlay);

    updateSelection();

    // Click outside to close
    switcherOverlay.addEventListener('click', (e) => {
      if (e.target === switcherOverlay) closeSwitcher();
    });

    // Keyboard handler for navigation (keyup is handled by the global listener)
    document.addEventListener('keydown', switcherKeyHandler, true);
  }

  function createTabCard(tab, index) {
    const card = document.createElement('div');
    card.className = 'tm-tab-card';
    if (index === 0) card.classList.add('tm-current');
    card.dataset.index = index;

    // Thumbnail
    const thumbWrapper = document.createElement('div');
    thumbWrapper.className = 'tm-tab-thumbnail';

    if (tab.thumbnail) {
      const img = document.createElement('img');
      img.src = tab.thumbnail;
      img.alt = tab.title;
      thumbWrapper.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'tm-tab-placeholder';
      if (tab.favIconUrl) {
        const icon = document.createElement('img');
        icon.src = tab.favIconUrl;
        icon.onerror = () => (icon.style.display = 'none');
        placeholder.appendChild(icon);
      }
      const text = document.createElement('span');
      text.className = 'tm-placeholder-text';
      try {
        text.textContent = new URL(tab.url).hostname;
      } catch {
        text.textContent = tab.url || 'New Tab';
      }
      placeholder.appendChild(text);
      thumbWrapper.appendChild(placeholder);
    }

    // Info bar
    const info = document.createElement('div');
    info.className = 'tm-tab-info';

    if (tab.favIconUrl) {
      const favicon = document.createElement('img');
      favicon.className = 'tm-favicon';
      favicon.src = tab.favIconUrl;
      favicon.onerror = () => (favicon.style.display = 'none');
      info.appendChild(favicon);
    }

    const title = document.createElement('span');
    title.className = 'tm-tab-title';
    title.textContent = tab.title || 'Untitled';
    title.title = tab.title || '';
    info.appendChild(title);

    card.appendChild(thumbWrapper);
    card.appendChild(info);

    // Click to switch
    card.addEventListener('click', () => {
      switchToTab(index);
    });

    return card;
  }

  function updateSelection() {
    if (!switcherOverlay) return;
    const cards = switcherOverlay.querySelectorAll('.tm-tab-card');
    cards.forEach((card, i) => {
      card.classList.toggle('tm-selected', i === selectedIndex);
    });
  }

  function advanceSelection(direction) {
    if (!isSwitcherOpen || switcherTabs.length === 0) return;
    // True modulo that always returns positive (JS % can return negative)
    const len = switcherTabs.length;
    selectedIndex = ((selectedIndex + direction) % len + len) % len;
    updateSelection();
  }

  function switchToTab(index) {
    const tab = switcherTabs[index];
    if (!tab) return;
    chrome.runtime.sendMessage({
      type: 'SWITCH_TO_TAB',
      tabId: tab.id,
      windowId: tab.windowId,
    });
    closeSwitcher();
  }

  function closeSwitcher() {
    if (switcherOverlay) {
      switcherOverlay.remove();
      switcherOverlay = null;
    }
    isSwitcherOpen = false;
    switcherTabs = [];
    selectedIndex = 0;
    document.removeEventListener('keydown', switcherKeyHandler, true);
  }

  function switcherKeyHandler(e) {
    if (!isSwitcherOpen) return;

    const cols = 3; // 3x2 grid

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        advanceSelection(1);
        break;

      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        advanceSelection(-1);
        break;

      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        advanceSelection(cols);
        break;

      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        advanceSelection(-cols);
        break;

      case 'Tab':
        e.preventDefault();
        e.stopPropagation();
        advanceSelection(e.shiftKey ? -1 : 1);
        break;

      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        switchToTab(selectedIndex);
        break;

      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        closeSwitcher();
        break;
    }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'tm-toast';
    toast.textContent = msg;
    shadow.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  let cachedTabId = null;

  function getTabId() {
    return cachedTabId;
  }

  // Cache our own tab ID on load
  chrome.runtime.sendMessage({ type: 'GET_MY_TAB_ID' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.tabId) {
      cachedTabId = response.tabId;
    }
  });
})();
