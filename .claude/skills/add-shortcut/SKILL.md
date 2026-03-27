---
name: add-shortcut
description: Adds a keyboard shortcut to the Chrome extension with the correct implementation approach. Determines whether to use chrome.commands API or content script keydown listener based on the key combination. Use when user says "add shortcut", "add hotkey", "bind key", "keyboard shortcut for", or "I want to press X to do Y".
metadata:
  author: talaviad-cmyk
  version: 1.0.0
---

# Add Keyboard Shortcut

## Instructions

### Step 1: Classify the Key Combination

Determine the correct implementation path based on the requested shortcut.

**Use chrome.commands (manifest.json)** when:
- Modifier + single letter/number: Alt+S, Ctrl+E, Command+E
- Works on all pages including those without content scripts loaded
- Limited to 4 commands with `suggested_key`

**Use content script keydown listener** when:
- Cmd+Shift+key (e.g., Cmd+Shift+C) — may conflict with DevTools
- Ctrl+Option+Arrow — Chrome rejects multi-modifier+arrow in manifest
- Any combo Chrome's API rejects with "Invalid value"
- Only works on pages where content script is injected (not chrome:// pages)

**Cannot be overridden:**
- Ctrl+Tab / Ctrl+Shift+Tab — Chrome reserves these. Can be set manually via editing Chrome's Preferences JSON while Chrome is closed, but not via manifest.
- Cmd+W, Cmd+T, Cmd+N — Chrome core shortcuts, not overridable.

### Step 2A: chrome.commands Approach

1. Check current suggested_key count:
```bash
python3 -c "
import json
with open('manifest.json') as f:
    m = json.load(f)
count = sum(1 for c in m['commands'].values() if 'suggested_key' in c)
print(f'{count}/4 suggested keys used')
"
```

2. Add to manifest.json `commands` object:
```json
"command-name": {
  "suggested_key": {
    "default": "Alt+X",
    "mac": "Alt+X"
  },
  "description": "What this shortcut does"
}
```
If at 4/4, omit `suggested_key` and add note in description.

3. Add handler in background.js inside `chrome.commands.onCommand.addListener`:
```javascript
if (command === 'command-name') {
  // implementation
  return;
}
```

### Step 2B: Content Script Keydown Approach

Add a `window.addEventListener('keydown')` in content.js, near the other global keyboard listeners at the top of the IIFE:

```javascript
window.addEventListener(
  'keydown',
  (e) => {
    if (e.metaKey && e.shiftKey && e.key === 'x') {
      e.preventDefault();
      e.stopPropagation();
      // action here, or send message to background:
      chrome.runtime.sendMessage({ type: 'MY_ACTION' });
    }
  },
  true,
);
```

Key property reference:
- `e.metaKey` = Cmd on Mac
- `e.ctrlKey` = Ctrl (actual Control key)
- `e.altKey` = Option on Mac
- `e.shiftKey` = Shift
- `e.key` = 'ArrowUp', 'ArrowDown', 'c', 's', etc.

If the action needs background script APIs (chrome.tabs, etc.), send a message and add a handler in background.js `chrome.runtime.onMessage.addListener`.

### Step 3: Validate

- Verify manifest.json is valid JSON
- Test the shortcut on a regular webpage
- Note: content script shortcuts won't work on chrome:// pages

## Key Combination Reference (Mac)

| Notation | Keys | manifest.json format |
|----------|------|---------------------|
| Cmd+E | Command + E | `"mac": "Command+E"` |
| Alt+S | Option + S | `"mac": "Alt+S"` |
| Ctrl+Option+Up | Control + Option + Up | Content script only |
| Cmd+Shift+C | Command + Shift + C | Content script only |

## Troubleshooting

### Error: "Invalid value for commands[N].default"
Cause: Chrome doesn't accept the key combination in `suggested_key`. Arrow keys with multiple modifiers and backtick are common failures.
Solution: Remove `suggested_key`, implement via content script keydown listener instead.

### Shortcut doesn't fire
Cause: Another extension or Chrome itself has the same shortcut bound.
Solution: Check `chrome://extensions/shortcuts` for conflicts. Try a different key combo.

### Shortcut works on some pages but not others
Cause: Content script keydown listeners don't work on chrome://, about:, or extension pages.
Solution: This is a Chrome limitation. For universal shortcuts, use chrome.commands instead.
