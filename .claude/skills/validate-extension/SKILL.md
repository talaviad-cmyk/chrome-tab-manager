---
name: validate-extension
description: Validates the Chrome extension is correctly configured and ready to load. Checks manifest.json syntax, file references, command limits, and permission completeness. Use when user says "validate", "check extension", "is it valid", "test the manifest", or after making changes to the extension.
metadata:
  author: talaviad-cmyk
  version: 1.0.0
---

# Validate Chrome Extension

## Instructions

Run all validation checks in sequence. Report issues clearly with how to fix them.

### Step 1: Validate manifest.json

```bash
python3 -c "
import json, sys
try:
    with open('manifest.json') as f:
        m = json.load(f)
    print('Manifest JSON: VALID')
    print(f'  Name: {m[\"name\"]}')
    print(f'  Version: {m[\"version\"]}')
    print(f'  MV: {m[\"manifest_version\"]}')
except json.JSONDecodeError as e:
    print(f'Manifest JSON: INVALID - {e}')
    sys.exit(1)
"
```

### Step 2: Check all referenced files exist

```bash
python3 -c "
import json, os
with open('manifest.json') as f:
    m = json.load(f)
files = [m['background']['service_worker']]
for cs in m.get('content_scripts', []):
    files.extend(cs.get('js', []))
    files.extend(cs.get('css', []))
for v in m.get('icons', {}).values():
    files.append(v)
for v in m.get('action', {}).get('default_icon', {}).values():
    files.append(v)
for r in m.get('web_accessible_resources', []):
    files.extend(r.get('resources', []))
ok = True
for f in files:
    exists = os.path.exists(f)
    status = 'OK' if exists else 'MISSING'
    if not exists: ok = False
    print(f'  {f}: {status}')
if ok:
    print('All files: OK')
else:
    print('ERROR: Some files are missing')
"
```

### Step 3: Check command limits

```bash
python3 -c "
import json
with open('manifest.json') as f:
    m = json.load(f)
cmds = m.get('commands', {})
suggested = sum(1 for c in cmds.values() if 'suggested_key' in c)
print(f'Commands: {len(cmds)} total, {suggested}/4 with suggested_key')
if suggested > 4:
    print('WARNING: Chrome only allows 4 suggested keys. Extras will be ignored.')
for name, cmd in cmds.items():
    desc = cmd.get('description', 'NO DESCRIPTION')
    key = cmd.get('suggested_key', {}).get('mac', cmd.get('suggested_key', {}).get('default', '(none)'))
    print(f'  {name}: {key} - {desc}')
"
```

### Step 4: Check permissions

Verify required permissions are present for the APIs used:
- `tabs` — for chrome.tabs API
- `tabGroups` — for chrome.tabGroups API
- `activeTab` — for captureVisibleTab
- `storage` — for chrome.storage API
- `contextMenus` — for chrome.contextMenus API
- `scripting` — for chrome.scripting.executeScript

### Step 5: Check for common issues

- No duplicate command names
- No `suggested_key` using reserved keys (Tab, Ctrl+Tab)
- Content script `matches` includes `<all_urls>` or appropriate patterns
- `web_accessible_resources` includes files loaded via `chrome.runtime.getURL()`

### Step 6: Report Summary

Print a clear summary:
```
Extension Validation Summary
  Manifest: OK/ERROR
  Files: X/Y found
  Commands: N total (M with defaults)
  Permissions: OK/MISSING [list]
  Issues: [list or "None"]
```

## Examples

### Example: After adding a new feature
User says: "validate the extension"

Result:
```
Extension Validation Summary
  Manifest: OK - Tab Manager v1.0.0
  Files: 7/7 found
  Commands: 8 total (4 with defaults)
  Permissions: OK
  Issues: None
```
