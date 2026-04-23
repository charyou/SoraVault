# SoraVault Project Handoff

Last updated: 2026-04-23

## Project Status

SoraVault is a local-first Sora backup tool shipped from a single source file:
`src/core.js`. It builds two targets:

- Tampermonkey userscript: `dist/SoraVault.user.js`
- Chrome extension content script: `dist/chrome-extension/content.js`

Build command:

```powershell
& 'C:\Users\chary\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' build.py
```

The GitHub release workflow runs on pushed tags matching `v*`, builds from
source, zips the Chrome extension, extracts the matching `CHANGELOG.md` section,
and publishes the userscript plus Chrome zip.

## Current Release Target

- Version: `2.7.0`
- Release date: `2026-04-23`
- Current branch: `main`
- Release tag expected by workflow: `v2.7.0`
- Previous tag in repo: `v2.7.0-preview`

## Recent Changes

The 2.7.0 work focused on the first screen and creator/mirror mode behavior:

- Rebuilt first screen into exclusive accordion modes:
  - Regular Backup
  - Creator Backup
  - Mirror Mode
  - Discover & Download placeholder
- Added `activeStartMode` to control primary Start Scan behavior.
- Creator Backup is now a standalone scan mode and no longer requires checked
  regular backup sources.
- Mirror Mode is started by the main Start Scan button and shows a dedicated
  running status screen.
- Added page-2 min/max likes filters. Unknown like counts are excluded whenever
  a likes bound is active.
- Creator Backup now defaults Remember across reloads to on.
- Header Log & advanced button now opens the existing expert/log drawer.

More detail is in `sprint/codes-sprint-2.7.0.md`.

## Important Files

- `src/core.js` - all runtime logic and UI.
- `CHANGELOG.md` - user-facing release notes; release workflow extracts notes by
  exact version heading.
- `.github/workflows/release.yml` - tag-triggered release workflow.
- `build.py` - zero-dependency builder for userscript and Chrome extension.
- `docs/core-js-reference.md` - older function map/reference for `core.js`.
- `docs/project-overview.md` - architecture and build overview.

## Implementation Notes

- Do not split `src/core.js` without planning the build system change.
- `SCAN_SOURCES`, `SOURCE_LABELS`, and `SUBFOLDERS` are the source-aware
  contracts used across scan, filters, and downloads.
- Creator Backup results use `source: 'v2_creator'` and `creatorUsername` for
  nested folder routing.
- Mirror Mode uses append-only `mirror_manifest.json` in `mirror_browse/` to
  avoid re-downloading already saved items.
- `dist/` artifacts are build output and are not tracked.
- Python may not be on PATH in Codex; use the bundled Python path above.
- `rg` may be blocked in this Windows sandbox; PowerShell `Select-String` is a
  reliable fallback.

## Tasklist

- [x] Implement first-screen accordion mode picker.
- [x] Make Creator Backup independent from regular backup sources.
- [x] Start Mirror Mode from primary Start Scan button.
- [x] Add Mirror Mode running status screen.
- [x] Add min/max likes filters on ready page.
- [x] Default Creator Backup persistence to on.
- [x] Update `CHANGELOG.md` for 2.7.0.
- [x] Add 2.7.0 technical sprint notes.
- [ ] Live-test the UI in a Sora tab with Sora 1-only access.
- [ ] Live-test the UI in a Sora tab with Sora 2 access.
- [ ] Refresh README screenshots after the 2.7.0 UI is final.

## Verification Commands

```powershell
node --check src\core.js
& 'C:\Users\chary\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' build.py
node --check dist\chrome-extension\content.js
git diff --check
```
