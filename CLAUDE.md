# CLAUDE.md — Project Context for Claude Code

## What is this?

A locally-loaded Chrome extension (Manifest V3) for tab management. Built because the user's organization blocks external Chrome Web Store extensions.

## Architecture

### background.js (Service Worker)
The orchestration hub. Handles:
- **MRU tracking** — `chrome.tabs.onActivated` updates a list in `chrome.storage.session` (capped at 20)
- **Thumbnail capture** — `chrome.captureVisibleTab()` with 350ms debounce after tab activation, stored as JPEG quality 50 data URIs in `chrome.storage.session`
- **Pinned URLs** — saves tab URL when `changeInfo.pinned === true` or `changeInfo.groupId` changes. Fallback scan on startup for existing grouped/pinned tabs
- **Context menus** — Rename Tab, Back to Pinned URL, Set Current URL as Pinned, Import Dia Tabs
- **Commands** — keyboard shortcut handlers for all features
- **Message routing** — handles messages from content script (SAVE_TAB_NAME, SWITCH_TO_TAB, MOVE_TAB, etc.)
- **Tab title restoration** — on `tabs.onUpdated` with `status: complete`, re-applies custom titles via content script

**Important**: Service worker is ephemeral in MV3. Never use module-level variables for persistent state — always read from `chrome.storage.session` or `chrome.storage.local`.

### content.js (Content Script)
Runs on every page. All UI is inside a **closed Shadow DOM** to prevent CSS conflicts with host pages.

Responsibilities:
- **Rename dialog** — modal with input, Save/Cancel/Reset buttons
- **Tab switcher overlay** — 3x2 grid of tab cards with thumbnails and favicons
- **Title protection** — MutationObserver prevents pages from overriding custom tab names
- **Toast notifications** — brief feedback messages
- **Keyboard listeners** — Cmd+Shift+C (copy URL), Ctrl+Option+Up/Down (tab nav), Alt key release detection for switcher auto-switch

### content.css
Loaded into Shadow DOM via `fetch(chrome.runtime.getURL('content.css'))`. Not injected via manifest `css` field because that would put styles in the main document, not the shadow root.

### import.html + import.js
Full-page import UI opened as a chrome-extension:// tab. Reads exported JSON from Dia browser, creates pinned tabs, tab groups (with names/colors), and ungrouped tabs.

### dia-exporter/ (Separate Extension)
Minimal MV3 extension for the Dia browser. Opens a full page listing all tabs (Dia's proprietary groups are not accessible via Chrome APIs). User manually creates groups by selecting tabs, then exports as JSON.

## Storage Strategy

| Data | Storage | Why |
|------|---------|-----|
| MRU list, thumbnails, pinned URLs | `chrome.storage.session` | Ephemeral, auto-cleared on browser close |
| Renamed tab titles | `chrome.storage.local` | Persists across restarts |

## Message Protocol

| Direction | Type | Purpose |
|-----------|------|---------|
| BG → CS | `SHOW_RENAME_DIALOG` | Open rename dialog |
| BG → CS | `SHOW_TAB_SWITCHER` | Show/advance tab switcher |
| BG → CS | `APPLY_CUSTOM_TITLE` | Restore saved title on page load |
| BG → CS | `SHOW_TOAST` | Show brief notification |
| CS → BG | `SAVE_TAB_NAME` | Persist renamed tab |
| CS → BG | `GET_TAB_INFO` | Request saved custom title |
| CS → BG | `SWITCH_TO_TAB` | Activate a tab (with window focus) |
| CS → BG | `MOVE_TAB` | Navigate to adjacent tab |
| CS → BG | `BACK_TO_PINNED` | Navigate to pinned URL |
| CS → BG | `GET_MY_TAB_ID` | Content script learns its own tab ID |
| CS → BG | `CLEAR_TAB_NAME` | Remove custom name |

## Known Limitations

- **Ctrl+Tab is reserved by Chrome** — cannot be overridden via manifest `suggested_key`. Can be set manually in `chrome://extensions/shortcuts` on some platforms, or by editing Chrome's Preferences JSON while Chrome is closed
- **Alt keyup detection** — `chrome.commands` consumes keyboard events at the browser level. The content script uses a global `window.addEventListener('keyup')` registered at init time (before switcher opens) plus fallback strategies (any keyup/keydown with `altKey===false`, window blur)
- **Dia browser groups** — Dia uses proprietary tab management not exposed via `chrome.tabs`/`chrome.tabGroups` APIs. The SNSS session files contain group names in UTF-16LE but tab-to-group mapping requires complex binary parsing
- **Content script on restricted pages** — `chrome://`, `about:`, `chrome-extension://` pages don't allow content scripts. `sendToTab()` in background.js has a fallback that injects via `chrome.scripting.executeScript`
- **Context menu scope** — Chrome doesn't allow extensions to add items to the tab bar right-click menu. Our "Rename Tab" appears in the page content right-click menu

## Development

No build step. Edit files and refresh the extension in `chrome://extensions`.

To test changes:
1. Make edits to any file
2. Click the refresh icon on the extension card in `chrome://extensions`
3. Reload any open tab to get the updated content script
4. Check the service worker console for errors (click "service worker" link on the extension card)

## File Quick Reference

| File | Lines | Role |
|------|-------|------|
| `manifest.json` | ~90 | Extension manifest, permissions, commands |
| `background.js` | ~460 | Service worker — all backend logic |
| `content.js` | ~520 | Content script — all UI overlays |
| `content.css` | ~260 | Shadow DOM styles |
| `import.html` | ~130 | Dia import page layout |
| `import.js` | ~180 | Dia import logic |
| `dia-exporter/*` | ~250 | Separate Dia browser exporter extension |
