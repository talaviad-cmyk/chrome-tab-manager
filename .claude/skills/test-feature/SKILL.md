---
name: test-feature
description: Visually tests Chrome extension features using Playwright. Launches Chromium with the extension loaded, runs test actions, takes screenshots, and reports results. Use when user says "test the extension", "test this feature", "take a screenshot", "visual test", or "does it work".
metadata:
  author: talaviad-cmyk
  version: 1.0.0
---

# Test Extension Feature

## Instructions

Launch a standalone Chromium instance with the extension loaded, perform test actions, capture screenshots, and analyze the results.

### Prerequisites

Playwright must be installed:
```bash
npm list playwright 2>/dev/null || npm install playwright
```

The managed Chrome (Fireblocks) blocks `--remote-debugging-port`, so we CANNOT connect to the running Chrome instance. Always use a standalone Chromium with the extension loaded via `--load-extension`.

### Step 1: Write a Test Script

Create a temporary test script that:
1. Launches Chromium with the extension loaded from the project root
2. Opens test pages
3. Triggers the feature being tested
4. Takes screenshots at each step
5. Keeps the browser open for manual inspection (optional)

Template:
```javascript
const { chromium } = require('playwright');
const path = require('path');
const EXT_PATH = path.resolve(__dirname);

async function main() {
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
  const page = await context.newPage();
  await page.goto('https://en.wikipedia.org/wiki/Tab_(interface)');
  await page.waitForLoadState('networkidle');

  // --- Test actions go here ---

  await page.screenshot({ path: 'test-screenshots/test-result.png' });
  console.log('Done!');
  await context.close();
}

main().catch(console.error);
```

### Step 2: Run the Test

```bash
mkdir -p test-screenshots
node test-script-name.js
```

Use a timeout of 30 seconds when running via Bash.

### Step 3: Analyze Screenshots

Read the screenshot files to visually verify the feature works:
```
Read test-screenshots/test-result.png
```

### Important Notes

- **Content script shortcuts** (Cmd+K, Cmd+Shift+C, Ctrl+Option+Up/Down) work because they use `window.addEventListener('keydown')` which fires in Playwright
- **chrome.commands shortcuts** (Alt+R, Alt+S, Alt+P, Cmd+E) may NOT work in Playwright because the extension's command shortcuts aren't registered in the standalone Chromium the same way
- **Extension pages** (workspaces.html, import.html) can be opened directly via `chrome-extension://EXTENSION_ID/page.html` — get the extension ID from the service worker URL
- **Shadow DOM** elements cannot be accessed directly via Playwright selectors. Use keyboard events (`page.keyboard.press()`) to interact with overlays
- Screenshots are saved to `test-screenshots/` which is gitignored
- Always kill test processes after: `pkill -f "test-script-name.js"`

### Getting the Extension ID

```javascript
async function getExtId(context) {
  const workers = context.serviceWorkers();
  for (const sw of workers) {
    if (sw.url().includes('background.js')) {
      return new URL(sw.url()).hostname;
    }
  }
  return null;
}
```

## Examples

### Example 1: Test tab search overlay

User says: "test the tab search feature"

Script:
```javascript
await page.keyboard.press('Meta+k');
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: 'test-screenshots/search-open.png' });
await page.keyboard.type('wiki');
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: 'test-screenshots/search-filtered.png' });
await page.keyboard.press('Escape');
```

### Example 2: Test workspaces page

User says: "test workspaces"

Script:
```javascript
const wsPage = await context.newPage();
await wsPage.goto(`chrome-extension://${extId}/workspaces.html`);
await wsPage.fill('#workspaceName', 'My Workspace');
await wsPage.click('#saveBtn');
await wsPage.screenshot({ path: 'test-screenshots/workspace-saved.png' });
```

## Troubleshooting

### Error: Browser not installed
Run: `npx playwright install chromium`

### Extension not loading
Verify `EXT_PATH` points to the directory containing `manifest.json`. The path must be absolute.

### Screenshots are blank/empty
The extension's content script may not have loaded yet. Add `await new Promise(r => setTimeout(r, 2000))` after navigating.
