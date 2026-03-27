// Capture screenshots of all extension features for README documentation.
const { chromium } = require('playwright');
const path = require('path');
const EXT_PATH = path.resolve(__dirname);

async function main() {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1200, height: 800 },
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  await new Promise(r => setTimeout(r, 3000));

  // Get extension ID from service worker
  let extId = null;
  for (const sw of context.serviceWorkers()) {
    if (sw.url().includes('background.js')) {
      extId = new URL(sw.url()).hostname;
      break;
    }
  }
  console.log('Extension ID:', extId);

  // Open several tabs
  const page1 = await context.newPage();
  await page1.goto('https://en.wikipedia.org/wiki/Tab_(interface)');
  await page1.waitForLoadState('networkidle');

  const page2 = await context.newPage();
  await page2.goto('https://en.wikipedia.org/wiki/Google_Chrome');
  await page2.waitForLoadState('networkidle');
  await new Promise(r => setTimeout(r, 500));

  const page3 = await context.newPage();
  await page3.goto('https://en.wikipedia.org/wiki/Browser_extension');
  await page3.waitForLoadState('networkidle');
  await new Promise(r => setTimeout(r, 500));

  const page4 = await context.newPage();
  await page4.goto('https://en.wikipedia.org/wiki/Keyboard_shortcut');
  await page4.waitForLoadState('networkidle');
  await new Promise(r => setTimeout(r, 500));

  // Build MRU by switching tabs
  await page1.bringToFront(); await new Promise(r => setTimeout(r, 400));
  await page2.bringToFront(); await new Promise(r => setTimeout(r, 400));
  await page3.bringToFront(); await new Promise(r => setTimeout(r, 400));
  await page4.bringToFront(); await new Promise(r => setTimeout(r, 400));
  await page1.bringToFront(); await new Promise(r => setTimeout(r, 600));

  // Helper: trigger overlay via extension background service worker
  async function triggerViaBackground(type, extraData = {}) {
    const bgPage = context.serviceWorkers().find(sw => sw.url().includes('background.js'));
    if (!bgPage) { console.log('No background SW found'); return; }

    await bgPage.evaluate(async ({ type, extraData }) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      if (type === 'SHOW_RENAME_DIALOG') {
        await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_RENAME_DIALOG' });
      } else if (type === 'SHOW_TAB_SWITCHER') {
        const { mruList = [] } = await chrome.storage.session.get('mruList');
        const { thumbnails = {} } = await chrome.storage.session.get('thumbnails');
        const { renamedTabs = {} } = await chrome.storage.local.get('renamedTabs');
        const tabInfos = [];
        for (const tabId of mruList.slice(0, 6)) {
          try {
            const t = await chrome.tabs.get(tabId);
            tabInfos.push({
              id: t.id, title: renamedTabs[tabId]?.title || t.title,
              url: t.url, favIconUrl: t.favIconUrl || '',
              thumbnail: thumbnails[tabId] || null, windowId: t.windowId,
            });
          } catch {}
        }
        await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_TAB_SWITCHER', tabs: tabInfos, direction: 1 });
      } else if (type === 'SHOW_TOAST') {
        await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_TOAST', message: extraData.message });
      }
    }, { type, extraData });
  }

  // ===== SCREENSHOTS =====

  console.log('1. Tab Search (Cmd+K)...');
  await page1.keyboard.press('Meta+k');
  await new Promise(r => setTimeout(r, 600));
  await page1.screenshot({ path: 'docs/tab-search.png' });
  await page1.keyboard.type('chrome');
  await new Promise(r => setTimeout(r, 400));
  await page1.screenshot({ path: 'docs/tab-search-filtered.png' });
  await page1.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 300));

  console.log('2. Rename Dialog...');
  await triggerViaBackground('SHOW_RENAME_DIALOG');
  await new Promise(r => setTimeout(r, 600));
  await page1.screenshot({ path: 'docs/rename-dialog.png' });
  await page1.keyboard.press('Control+a');
  await page1.keyboard.type('My Custom Tab Name');
  await new Promise(r => setTimeout(r, 300));
  await page1.screenshot({ path: 'docs/rename-typed.png' });
  await page1.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 300));

  console.log('3. MRU Tab Switcher...');
  await triggerViaBackground('SHOW_TAB_SWITCHER');
  await new Promise(r => setTimeout(r, 600));
  await page1.screenshot({ path: 'docs/tab-switcher.png' });
  await page1.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 300));

  console.log('4. Toast notification...');
  await triggerViaBackground('SHOW_TOAST', { message: 'URL copied to clipboard' });
  await new Promise(r => setTimeout(r, 400));
  await page1.screenshot({ path: 'docs/toast-notification.png' });
  await new Promise(r => setTimeout(r, 300));

  console.log('5. Context Menu...');
  await page1.click('#firstHeading', { button: 'right' });
  await new Promise(r => setTimeout(r, 600));
  await page1.screenshot({ path: 'docs/context-menu.png' });
  await page1.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 300));

  if (extId) {
    console.log('6. Workspaces...');
    const wsPage = await context.newPage();
    await wsPage.goto(`chrome-extension://${extId}/workspaces.html`);
    await new Promise(r => setTimeout(r, 800));
    await wsPage.fill('#workspaceName', 'Morning Standup');
    await wsPage.click('#saveBtn');
    await new Promise(r => setTimeout(r, 600));
    await wsPage.fill('#workspaceName', 'Debug Session');
    await wsPage.click('#saveBtn');
    await new Promise(r => setTimeout(r, 600));
    await wsPage.screenshot({ path: 'docs/workspaces.png' });

    console.log('7. Import page...');
    const importPage = await context.newPage();
    await importPage.goto(`chrome-extension://${extId}/import.html`);
    await new Promise(r => setTimeout(r, 800));
    await importPage.screenshot({ path: 'docs/import.png' });
  }

  console.log('\nAll screenshots saved to docs/');
  await context.close();
}

main().catch(console.error);
