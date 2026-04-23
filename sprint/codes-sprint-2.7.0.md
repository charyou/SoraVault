# SoraVault 2.7.0 Technical Sprint Notes

Date: 2026-04-23

## Summary

SoraVault 2.7.0 converts the startup screen from a mixed collection of backup,
mirror, and creator toggles into a single exclusive mode picker. The release also
adds likes-range filtering to the ready/download screen and makes Creator Backup
usable without selecting any regular backup source.

The implementation remains scoped to `src/core.js`. The existing scan,
download, skip-existing, watermark removal, Mirror manifest, and creator
validation machinery are reused.

## UI State And First Screen

- Added `activeStartMode` with three active values: `regular`, `creator`, and
  `mirror`.
- Rebuilt `#sdl-s-init` as accordion-style mode cards:
  - Regular Backup is expanded by default.
  - Creator Backup contains creator chips, username input, include-characters,
    and remember-across-reloads controls.
  - Mirror Mode contains folder selection, min-likes, prompt sidecar, include
    keywords, exclude keywords, saved count, and manifest hint.
  - Discover & Download is rendered as locked coming-soon UI only.
- Added `setStartMode(mode)` inside `createPanel()` to:
  - Toggle the active card.
  - Show exactly one mode body.
  - Update `creatorFetchEnabled`.
  - Refresh the primary Start Scan button.
- Replaced the header settings gear with a Log & advanced button that opens
  `#sdl-expert-drawer` directly.

## Scan Flow Changes

- `updateScanButton()` now branches by mode:
  - Regular Backup: enabled only when at least one regular source is selected.
  - Creator Backup: enabled only when Sora 2 is available and at least one
    creator chip is valid.
  - Mirror Mode: enabled until Mirror is running.
- `startScan()` now branches by `activeStartMode`:
  - `regular` calls the existing `fetchSelectedSources()` path.
  - `creator` calls the new `fetchSelectedCreators()` path.
  - `mirror` calls `startMirrorMode()` and does not enter the regular ready
    screen.
- Extracted creator scan work into `fetchSelectedCreators()`:
  - Performs the same auth-token/bootstrap wait as source scanning.
  - Iterates only valid creator chips.
  - Fetches creator profile posts via `fetchAllV2(..., 'v2_creator', username)`.
  - Optionally fetches each creator's characters and cameo appearances into the
    existing nested creator folder structure.
- Added `renderCreatorScanProgress()` for creator-specific scan progress chips.
- Removed the old behavior where creator scanning was appended to
  `fetchSelectedSources()`.

## Mirror Mode Changes

- Reused existing Mirror state:
  - `browseFetchBaseDir`
  - `browseFetchRootDir`
  - `browseFetchQueue`
  - `browseFetchFilters`
  - `browseFetchManifest`
  - `enableBrowseFetch()` / `disableBrowseFetch()`
- Removed the first-screen Mirror enable toggle from the user flow. Mirror is
  started by the main Start Scan button when Mirror Mode is selected.
- Added a `mirror` UI state to `setState()` and the DOM:
  - Shows saved count from `browseFetchManifest.size`.
  - Shows captured, queued, failed stats.
  - Shows target folder.
  - Shows active Mirror filters.
  - Provides Stop Mirror Mode and Back to start actions.
- Added `updateMirrorRunningStats()`, `startMirrorStatsTimer()`, and
  `stopMirrorStatsTimer()` to keep the Mirror running screen fresh.
- `updateBrowseFetchBadge()` now also updates the in-accordion saved count and
  running-state stats.

## Creator Backup Persistence

- `creatorFetchPersist` now defaults to `true`.
- `#sdl-cf-persist` is checked by default in the Creator Backup accordion.
- Existing persistence remains localStorage-based under `soravault:creators`.
- Users can still opt out by unchecking Remember across reloads, which removes
  the stored creator list.

## Likes Range Filter

- Extended `filters` with:
  - `minLikes`
  - `maxLikes`
- Added a `Likes range` section to the ready-screen filter drawer with min and
  max number inputs.
- `getFilteredItems()` now applies likes range after source/favorites filtering
  and before prompt/date/aspect filters.
- If either bound is active, items with missing or non-numeric `likeCount` are
  excluded.
- `snapshotActiveFilters()`, `resetFilters()`, `resetFilterInputs()`, and
  `updateFilterBadge()` include the likes range controls.

## Geo-Block Handling

- `applyV2GeoBlock()` now also marks Creator Backup as unavailable when Sora 2
  is geo-blocked.
- If the user is in Creator Backup when Sora 2 becomes unavailable, the UI falls
  back to Regular Backup.
- Mirror Mode remains available because it can capture Sora 1 or Sora 2 content
  based on what the user can browse.

## Build And Verification

- Verified JavaScript syntax with:
  - `node --check src/core.js`
  - `node --check dist/chrome-extension/content.js`
- Built release artifacts with:
  - `C:\Users\chary\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe build.py`
- The generated `dist/` output is ignored by git; release workflow rebuilds it
  from source on tag push.

## Follow-Up Tasklist

- Test the accordion UI in a live Sora tab with both Sora 1-only and Sora 2
  access.
- Verify Creator Backup with persisted creators after a full page reload.
- Verify Mirror Mode resumes stats correctly after selecting an existing folder
  with a populated `mirror_manifest.json`.
- Consider adding a max-likes filter to Mirror Mode if users ask for parity with
  page 2 filters.
- Update README screenshots after 2.7.0 is stable.
