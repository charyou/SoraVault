# SoraVault Project Brief

Last updated: 2026-04-24

## Product Intent

SoraVault is a local-first backup and bulk export tool for OpenAI Sora. The
project exists because Sora users need a practical way to preserve their work
before access changes, content disappears, or the service shuts down.

The product promise is simple:

- Save the user's own Sora library quickly.
- Preserve prompts and metadata, not just media files.
- Cover content that official export/manual download workflows miss.
- Keep everything local in the browser.
- Make the tool useful for real creators with hundreds or thousands of files.

SoraVault should feel like a serious archive tool built by someone who actually
uses Sora: clear, urgent, technically capable, and honest about limitations.

## Target Users

- Sora creators backing up their own Sora 1 and Sora 2 work.
- Users who care about drafts, liked content, cameos, and character content that
  is not easy to export manually.
- People who need prompts and metadata beside media files for future reference.
- Users in regions with only Sora 1 access.
- Power users who want to back up public creator libraries or passively capture
  what they browse.

## Feature Scope

### 1. Regular Backup

Regular Backup is the primary workflow and should remain the most obvious path.
It scans selected API endpoints, builds a result set, lets users filter, then
downloads the selected files.

Supported sources:

- Sora 1 generated library.
- Sora 1 liked content.
- Sora 2 published profile videos.
- Sora 2 drafts.
- Sora 2 liked videos.
- Sora 2 cameos.
- Sora 2 cameo drafts.
- User-owned character posts and appearances.

Important positioning:

- Drafts and liked content are a core differentiator.
- Official OpenAI export is not a focused Sora backup workflow.
- Manual download is not viable for large libraries or metadata preservation.

### 2. Highest-Quality Archive Downloads

SoraVault should prioritize source/original URLs where available, not browser
thumbnails or compressed previews. This matters for both personal content and
creator backup content.

Archive outputs:

- Media file.
- Optional `.txt` prompt sidecar.
- Optional raw `.json` metadata manifest.
- Smart filename template with `genId` by default.
- Auto-sorted source folders.
- Skip-existing checks for safe re-runs.

### 3. Watermark Removal

Watermark removal is optional and disabled by default. It uses `soravdl.com`,
which is a third-party proxy and must always be described with that disclaimer.

Behavior:

- Supported for selected Sora 2 video sources.
- Adds extra time per video.
- Can fail or be rate-limited.
- Falls back to direct OpenAI/Sora download.
- Not used by Mirror Mode.

### 4. Filters

The ready/download screen exists so users can scan broadly and download
selectively.

Current filters:

- Source/category.
- Prompt keyword search.
- Author exclusion.
- Aspect ratio.
- Quality.
- Operation.
- Date range.
- First/last N.
- Favorites-only for Sora 1 library.
- Min/max likes.

Likes range behavior:

- Applies to Regular Backup and Creator Backup result sets.
- If either likes bound is active, items with unknown like count are excluded.

### 5. Creator Backup

Creator Backup backs up public Sora 2 creators by username. It is a standalone
mode, not an add-on to Regular Backup.

Capabilities:

- Add usernames or profile URLs.
- Validate chips live.
- Remember valid creators across reloads by default.
- Fetch public posts.
- Optionally fetch creator character posts and cameo appearances.
- Save under `sora_v2_creators/{creator}/`.

Constraints:

- Requires Sora 2 access.
- If Sora 2 is geo-blocked, the UI should push users back toward Regular Backup
  for Sora 1 or Mirror Mode for browse-based capture.

### 6. Mirror Mode

Mirror Mode is passive capture while browsing. It watches Sora API responses
that the page already makes and downloads items that pass Mirror filters.

Capabilities:

- Sora 1 and Sora 2 browse capture.
- Explore pages, profiles, drafts, liked feeds, single-post pages.
- Min likes.
- Include keywords.
- Exclude keywords.
- Optional prompt sidecars.
- `mirror_manifest.json` to avoid duplicate downloads.
- Dedicated running status screen.

Limitations:

- State lives in the current Sora tab.
- Full page reload stops Mirror Mode.
- Watermark removal is intentionally skipped.

### 7. Future / Placeholder

Discover & Download is a visible locked placeholder. Intended future direction:
auto-discover creators and continuously download content matching rules. Do not
implement this without a separate design pass.

## Current UX Direction

The first screen is an exclusive mode picker:

- Regular Backup is active by default.
- Creator Backup and Mirror Mode cannot be combined with Regular Backup.
- Start Scan changes meaning based on the selected mode.
- Advanced/log access should stay available without distracting normal users.

The design should remain dark, compact, and utility-focused. It should feel like
a creator tool, not a marketing landing page.

## Architecture

SoraVault ships from one main source file:

- `src/core.js` - all runtime logic, UI, styles, API capture, scan, filters, and
  downloads.

Build targets:

- Tampermonkey userscript: `dist/SoraVault.user.js`.
- Chrome extension content script: `dist/chrome-extension/content.js`.

Build command:

```powershell
& 'C:\Users\chary\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' build.py
```

Release workflow:

- `.github/workflows/release.yml`
- Trigger: push tag matching `v*`.
- Builds from source.
- Publishes `SoraVault.user.js` and `SoraVault-chrome.zip`.
- Extracts release notes from matching `CHANGELOG.md` heading.

## Important Files

- `README.md` - public product description and SEO surface.
- `CHANGELOG.md` - user-facing release notes.
- `sprint/codes-sprint-2.7.0.md` - technical 2.7.0 changelist.
- `src/core.js` - implementation source of truth.
- `build.py` - no-dependency build script.
- `.github/workflows/release.yml` - release automation.
- `assets/new-features.gif` - 2.7 feature preview.
- `assets/videothumbnail.png` - YouTube thumbnail.

## Implementation Contracts

- Do not split `src/core.js` casually; the build pipeline expects it.
- `SCAN_SOURCES`, `SOURCE_LABELS`, and `SUBFOLDERS` are shared contracts.
- Creator Backup items use `source: 'v2_creator'` and `creatorUsername`.
- Mirror Mode uses `browseFetch*` state and `mirror_manifest.json`.
- Keep `genId` in default filenames; skip-existing depends on stable IDs.
- Preserve user edits in dirty worktrees. Do not revert unrelated changes.

## Current Release State

- Current release: `2.7.0`.
- Release tag: `v2.7.0`.
- 2.7.0 added the accordion first screen, standalone Creator Backup, Mirror Mode
  start flow, likes range filters, README refresh, and updated handoff docs.

## Open Tasks

- [x] Replace guessed character draft endpoint probing with the confirmed
  character draft endpoint:
  `/backend/project_y/profile/drafts/cameos/character/{chId}?limit=50`.
- [x] Fetch character appearances through the character backup with
  `/backend/project_y/profile_feed/{chId}?limit=50&cut=appearances`.
- [x] Keep character posts, appearances, and drafts grouped under
  `sora_v2_characters/{character_name}/` by assigning the character context
  during V2 ingest.
- [x] Make character ID lookup more tolerant of response shape changes by
  accepting `user_id`, `id`, `character_id`, or `profile.user_id`.
- [x] Rebuild generated outputs with `build.py` after the character backup
  changes.
- [x] Verify syntax for `src/core.js`, `dist/SoraVault.user.js`, and
  `dist/chrome-extension/content.js` with `node --check`.
- [x] Redo download worker configuration so worker count/speed can be changed
  while downloads are already running. The active download run now owns a live
  worker-pool scheduler: increasing speed starts additional workers immediately,
  decreasing speed lets in-flight workers finish their current item before
  retiring, Tampermonkey/GM mode remains capped at 2 workers, and rapid speed
  changes are clamped to valid presets.
- [ ] Live-test Regular Backup with Sora 1-only access.
- [x] Live-test Regular Backup with Sora 2 access.
- [ ] Live-test Creator Backup with multiple validated creators.
- [ ] Live-test Creator Backup with persisted creators after reload.
- [ ] Live-test Mirror Mode with an existing populated manifest.
- [ ] Decide whether Mirror Mode should also support max likes.
- [ ] Refresh README media whenever the UI changes materially.
- [ ] Keep SEO FAQ wording broad enough for "Sora downloader", "Sora scraper",
  "Sora backup", "Sora drafts", and "Sora liked videos" searches.

## Verification Commands

```powershell
node --check src\core.js
& 'C:\Users\chary\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' build.py
node --check dist\chrome-extension\content.js
git diff --check
```
