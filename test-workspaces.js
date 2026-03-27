const { chromium } = require('playwright');
const path = require('path');
const EXT_PATH = path.resolve(__dirname);

async function main() {
  console.log('Launching Chromium with extension...');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  await new Promise(r => setTimeout(r, 2000));

  // Open a few tabs to have content
  const page1 = await context.newPage();
  await page1.goto('https://en.wikipedia.org/wiki/Tab_(interface)');
  await page1.waitForLoadState('networkidle');

  const page2 = await context.newPage();
  await page2.goto('https://en.wikipedia.org/wiki/Chrome_extension');
  await page2.waitForLoadState('networkidle');

  // Open workspaces page
  console.log('Opening workspaces page...');
  const wsPage = await context.newPage();
  await wsPage.goto(`chrome-extension://${await getExtId(context)}/workspaces.html`);
  await new Promise(r => setTimeout(r, 1000));
  await wsPage.screenshot({ path: 'test-screenshots/ws-01-empty.png' });

  // Save a workspace
  console.log('Saving workspace...');
  await wsPage.fill('#workspaceName', 'Test Workspace');
  await wsPage.click('#saveBtn');
  await new Promise(r => setTimeout(r, 1000));
  await wsPage.screenshot({ path: 'test-screenshots/ws-02-saved.png' });

  console.log('Done! Check test-screenshots/ws-*.png');
  await new Promise(() => {});
}

async function getExtId(context) {
  const bgPages = context.serviceWorkers();
  for (const sw of bgPages) {
    const url = sw.url();
    if (url.includes('background.js')) {
      return new URL(url).hostname;
    }
  }
  // Fallback: list extensions page
  const p = await context.newPage();
  await p.goto('chrome://extensions');
  await new Promise(r => setTimeout(r, 1000));
  const extId = await p.evaluate(() => {
    const items = document.querySelector('extensions-manager')
      ?.shadowRoot?.querySelector('extensions-item-list')
      ?.shadowRoot?.querySelectorAll('extensions-item');
    for (const item of items || []) {
      const name = item.shadowRoot?.querySelector('#name')?.textContent;
      if (name?.includes('Tab Manager')) return item.id;
    }
    return null;
  });
  await p.close();
  return extId;
}

main().catch(console.error);
