---
name: release
description: Prepares and publishes a new release of the Chrome extension. Bumps the version in manifest.json, validates the extension, commits, tags, and pushes to GitHub. Use when user says "release", "bump version", "publish", "new version", "cut a release", or "push a release".
metadata:
  author: talaviad-cmyk
  version: 1.0.0
---

# Release Chrome Extension

## Instructions

### Step 1: Determine Version Bump

Ask the user or infer from recent changes:
- **patch** (1.0.0 -> 1.0.1): Bug fixes, small tweaks
- **minor** (1.0.0 -> 1.1.0): New features, new shortcuts
- **major** (1.0.0 -> 2.0.0): Breaking changes, major redesign

### Step 2: Validate Before Release

Run the validate-extension checks:
1. manifest.json is valid JSON
2. All referenced files exist
3. No more than 4 suggested_key entries
4. No uncommitted changes that should be excluded

```bash
git status
python3 -c "
import json
with open('manifest.json') as f:
    m = json.load(f)
print(f'Current version: {m[\"version\"]}')
"
```

### Step 3: Bump Version

Update `version` in manifest.json:

```bash
python3 -c "
import json
with open('manifest.json') as f:
    m = json.load(f)
parts = m['version'].split('.')
# Adjust index: 0=major, 1=minor, 2=patch
parts[2] = str(int(parts[2]) + 1)  # patch bump example
m['version'] = '.'.join(parts)
with open('manifest.json', 'w') as f:
    json.dump(m, f, indent=2)
    f.write('\n')
print(f'Version bumped to {m[\"version\"]}')
"
```

Also update version in `dia-exporter/manifest.json` if it changed.

### Step 4: Commit and Tag

```bash
git add manifest.json dia-exporter/manifest.json
git commit -m "Release vX.Y.Z

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git tag vX.Y.Z
```

### Step 5: Push

```bash
git push && git push --tags
```

### Step 6: Confirm

Report the release summary:
- Version: vX.Y.Z
- Tag: vX.Y.Z
- GitHub URL: https://github.com/talaviad-cmyk/chrome-tab-manager/releases/tag/vX.Y.Z

## Examples

### Example: Patch release after bug fix
User says: "release a patch"

Actions:
1. Bump 1.0.0 -> 1.0.1
2. Validate extension
3. Commit with message "Release v1.0.1"
4. Tag v1.0.1
5. Push to GitHub

### Example: Minor release after new feature
User says: "release, we added the copy URL feature"

Actions:
1. Bump 1.0.0 -> 1.1.0
2. Validate extension
3. Commit with message "Release v1.1.0"
4. Tag v1.1.0
5. Push to GitHub
