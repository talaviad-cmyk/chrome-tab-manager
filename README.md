# Tab Manager - Rename & Switch

A Chrome extension for power users who need better tab management. Built for organizations that don't allow external extensions from the Chrome Web Store — load it locally in developer mode.

## Features

### Tab Renaming
Rename any tab to identify it easily. The custom name appears in the tab bar and persists across page reloads.

- **Alt+R** — open rename dialog
- **Right-click page** — "Rename Tab" in context menu
- **Click extension icon** — opens rename dialog
- **Reset** button restores the original title
- A MutationObserver protects the custom title from being overwritten by the page

### MRU Tab Switcher
A visual overlay showing your 6 most recently used tabs in a 3x2 grid with thumbnails.

- **Alt+S** — open switcher (forward)
- Repeated presses advance the selection
- Arrow keys navigate the grid
- **Enter** switches to selected tab
- **Escape** cancels
- Releasing the Alt key auto-switches to the highlighted tab
- Thumbnails are captured automatically as you visit tabs

### Pinned URLs
Automatically saves the URL when a tab is pinned or added to a tab group. Navigate back anytime, even after browsing elsewhere.

- **Alt+P** — navigate back to pinned URL
- **Right-click** — "Back to Pinned URL" (shows the saved hostname)
- **Right-click** — "Set Current URL as Pinned" (override the saved URL)
- Works with both Chrome's pinned tabs and tab groups
- URLs are saved at the exact moment a tab is pinned/grouped

### Tab Navigation (Vertical Tabs)
For users with Chrome's vertical tab strip:

- **Ctrl+Option+Up** — go one tab up
- **Ctrl+Option+Down** — go one tab down

### Other Shortcuts
- **Cmd+E** — duplicate current tab
- **Cmd+Shift+C** — copy current tab URL to clipboard

### Import from Dia Browser
Migrate tabs and groups from the Dia browser to Chrome using the included Dia Tab Exporter tool.

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the repository folder

## Keyboard Shortcuts

| Action | Default Shortcut | Customizable |
|--------|-----------------|-------------|
| Tab switcher (forward) | Alt+S | Yes |
| Tab switcher (backward) | — | Set in shortcuts page |
| Rename tab | Alt+R | Yes |
| Duplicate tab | Cmd+E | Yes |
| Back to pinned URL | Alt+P | Yes |
| Set current URL as pinned | — | Set in shortcuts page |
| Go one tab up | Ctrl+Option+Up | Via content script |
| Go one tab down | Ctrl+Option+Down | Via content script |
| Copy URL | Cmd+Shift+C | Via content script |

To customize shortcuts: go to `chrome://extensions/shortcuts`

Chrome reserves Ctrl+Tab — it cannot be overridden by extensions. You can try setting it manually in the shortcuts page, but it may not work on all platforms.

## File Structure

```
chrome-tab-manager/
├── manifest.json          # MV3 extension manifest
├── background.js          # Service worker: MRU tracking, thumbnails,
│                          #   context menus, commands, pinned URLs
├── content.js             # Content script: Shadow DOM overlay for
│                          #   tab switcher, rename dialog, toasts
├── content.css            # Styles injected into Shadow DOM
├── import.html            # Dia tabs import page
├── import.js              # Import logic (creates tabs/groups in Chrome)
├── icons/                 # Extension icons (16/32/48/128px)
│
├── dia-exporter/          # Separate extension for Dia browser
│   ├── manifest.json
│   ├── background.js
│   ├── export.html
│   └── export.js
│
├── CLAUDE.md              # Project context for Claude Code
└── README.md
```

## Dia Browser Migration

Dia uses a proprietary tab group system not accessible via Chrome APIs. To migrate:

1. Load `dia-exporter/` as an unpacked extension in Dia
2. Click the extension icon — opens a full page listing all tabs
3. Select tabs and use "Create Group from Selected" / "Mark Selected as Pinned"
4. Enter your profile name and click "Export JSON"
5. In Chrome, right-click any page → Tab Manager → "Import Dia Tabs..."
6. Upload the JSON file — tabs, groups, and pinned tabs are recreated

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test by loading the unpacked extension in Chrome
5. Submit a pull request

### Development

No build step required — the extension runs directly from source. Edit any file, then refresh the extension in `chrome://extensions` to test changes.

Key things to know:
- The service worker (`background.js`) is ephemeral — never store state in module-level variables, always use `chrome.storage`
- The content script UI lives in a closed Shadow DOM to avoid CSS conflicts
- CSS is loaded into the Shadow DOM via `fetch()`, not the manifest's `css` field

## License

MIT
