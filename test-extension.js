// Test script: launches Chromium with the extension loaded and takes screenshots.
// Usage: node test-extension.js

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

  // Wait for extension to load
  await new Promise(r => setTimeout(r, 2000));

  // Open a test page
  const page = await context.newPage();
  await page.goto('https://en.wikipedia.org/wiki/Tab_(interface)');
  await page.waitForLoadState('networkidle');

  console.log('Page loaded. Taking screenshot...');
  await page.screenshot({ path: 'test-screenshots/01-page-loaded.png' });

  // Test 1: Cmd+K (tab search)
  console.log('Testing Cmd+K (tab search)...');
  await page.keyboard.press('Meta+k');
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'test-screenshots/02-tab-search.png' });

  // Type a search query
  // The search input is in Shadow DOM, so we use keyboard directly
  await page.keyboard.type('wiki');
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: 'test-screenshots/03-tab-search-typed.png' });

  // Close search with Escape
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 300));

  // Test 2: Alt+R (rename tab)
  console.log('Testing Alt+R (rename tab)...');
  await page.keyboard.press('Alt+r');
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'test-screenshots/04-rename-dialog.png' });

  // Type a new name
  await page.keyboard.press('Control+a');
  await page.keyboard.type('My Custom Tab Name');
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: 'test-screenshots/05-rename-typed.png' });

  // Press Escape to cancel (don't actually rename)
  await page.keyboard.press('Escape');

  // Test 3: Right-click context menu
  console.log('Testing context menu...');
  await page.click('body', { button: 'right' });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'test-screenshots/06-context-menu.png' });

  // Close context menu
  await page.keyboard.press('Escape');

  // Test 4: Cmd+Shift+C (copy URL)
  console.log('Testing Cmd+Shift+C (copy URL)...');
  await page.keyboard.press('Meta+Shift+c');
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'test-screenshots/07-url-copied-toast.png' });

  console.log('\nAll tests complete! Screenshots saved to test-screenshots/');
  console.log('Check the test-screenshots/ directory for results.');

  // Keep browser open for manual inspection
  console.log('\nBrowser is still open. Press Ctrl+C to close.');
  await new Promise(() => {}); // Keep alive
}

main().catch(console.error);
