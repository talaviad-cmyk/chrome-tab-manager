---
name: add-feature
description: Scaffolds a new Chrome extension feature end-to-end. Adds manifest command, background.js handler, content script listener, and context menu entry as needed. Use when user says "add a feature", "add a new command", "I want a new shortcut that does X", or "add keyboard shortcut for".
metadata:
  author: talaviad-cmyk
  version: 1.0.0
---

# Add Feature to Chrome Extension

## Instructions

When the user wants to add a new feature to the Tab Manager extension, follow this sequential workflow.

### Step 1: Understand the Feature

Ask the user:
- What should the feature do?
- What keyboard shortcut should trigger it? (if any)
- Should it have a context menu entry?

### Step 2: Determine Implementation Path

Chrome has a limit of 4 `suggested_key` entries in the manifest. Check how many are already used:

```bash
python3 -c "
import json
with open('manifest.json') as f:
    m = json.load(f)
count = sum(1 for c in m['commands'].values() if 'suggested_key' in c)
print(f'Suggested keys used: {count}/4')
"
```

Decision tree for keyboard shortcuts:
- **Simple modifier + letter** (Alt+X, Cmd+E): Use `chrome.commands` in manifest.json. If under 4 suggested keys, add `suggested_key`. Otherwise, add command without default and tell user to set it in `chrome://extensions/shortcuts`.
- **Cmd+Shift+key** or **Ctrl+Option+Arrow**: Use content script `window.addEventListener('keydown')` because Chrome's command API may not support these combos.
- **Ctrl+Tab or other reserved keys**: Cannot be set via manifest. Explain the limitation and offer alternatives.

### Step 3: Add to manifest.json

Add a new entry to the `commands` object:

```json
"command-name": {
  "suggested_key": {
    "default": "Alt+X",
    "mac": "Alt+X"
  },
  "description": "Human-readable description"
}
```

CRITICAL: Validate the manifest is still valid JSON after editing.

### Step 4: Add Background Handler

In `background.js`, add the command handler inside `chrome.commands.onCommand.addListener`:

```javascript
if (command === 'command-name') {
  // implementation
  return;
}
```

For context menu features, also:
1. Add `chrome.contextMenus.create()` in the `initialize()` function
2. Add click handler in the `chrome.contextMenus.onClicked` listener

### Step 5: Add Content Script Handler (if needed)

For features with UI overlays, add:
1. Message handler in `chrome.runtime.onMessage.addListener` in content.js
2. New function to build the overlay inside the Shadow DOM
3. Styles in content.css

For content-script-based shortcuts, add a `window.addEventListener('keydown')` at the top of the IIFE in content.js.

### Step 6: Add Message Protocol (if needed)

If background and content script need to communicate:
1. Define message type (e.g., `SHOW_MY_FEATURE`)
2. Add sender in background.js
3. Add handler in content.js message listener switch

Update CLAUDE.md message protocol table.

### Step 7: Validate

Run the validate-extension skill or manually check:
- manifest.json is valid JSON
- All referenced files exist
- No duplicate command names
- suggested_key count is at most 4

## Examples

### Example 1: Add "Close Other Tabs" shortcut

User says: "Add Alt+W to close all other tabs"

Actions:
1. Add command `close-other-tabs` to manifest with `suggested_key: Alt+W`
2. Add handler in background.js: `chrome.tabs.query` + `chrome.tabs.remove`
3. No content script changes needed (pure background action)

### Example 2: Add "Search Tabs" overlay

User says: "Add a search bar to find tabs by name"

Actions:
1. Add command `search-tabs` to manifest
2. Add background handler that gathers all tabs and sends to content script
3. Add search overlay UI in content.js (input field + filtered list)
4. Add styles in content.css
5. Add `SHOW_TAB_SEARCH` message type

## Troubleshooting

### Error: "Invalid value for commands"
Cause: Chrome doesn't accept certain key combinations in `suggested_key`
Solution: Remove `suggested_key` and handle via content script keydown listener instead. Arrow keys, Tab, and backtick have restrictions.

### Error: Manifest has more than 4 suggested keys
Cause: Chrome limits extensions to 4 commands with default shortcuts
Solution: Remove `suggested_key` from least-used commands. User can set them manually via `chrome://extensions/shortcuts`.
