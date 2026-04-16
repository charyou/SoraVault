# SoraVault `core.js` — Complete Function Reference

`src/core.js` is the single unified source file for both the Tampermonkey userscript and the Chrome Extension. It is wrapped in a self-executing IIFE `(function() { 'use strict'; ... })()` to avoid polluting the global scope. All state and functions are local to this closure.

---

## File Layout (section order)

```
1.  PLATFORM DETECTION         ENV object
2.  CONFIG & RELEASE INFO      VERSION, CFG, constants
3.  SCAN SOURCES               SCAN_SOURCES, SOURCE_LABELS, SUBFOLDERS, SPEED_PRESETS
4.  SCAN STORIES               SCAN_STORIES array
5.  STATE                      Module-level variables
6.  UTILITIES                  sleep(), gcd(), shutdownDaysDelta()
7.  FETCH INTERCEPT            window.fetch + XMLHttpRequest monkey-patches
8.  DATA INGESTION — V1        ingestV1Page(), ingestV1LikedPage()
9.  DATA INGESTION — V2        ingestV2Page(), refreshScanCount()
10. FILTER ENGINE              getFilteredItems(), getDistinctValues*(), snapshotActiveFilters()
11. NETWORK HELPERS            buildHeaders(), fetchWithRetry()
12. GEO-BLOCK DETECTION        preflightV2Check(), applyV2GeoBlock()
13. API SCAN — FETCHERS        fetchAllV1(), fetchAllV1Liked(), fetchAllV2(), fetchAllV2Liked(), fetchSelectedSources()
14. DOWNLOAD HELPERS           getDownloadUrl(), extractUrlFromTree(), getSubfolderName(), getFileExt()
15. FILENAME & TXT BUILDERS    slugify(), buildBase(), buildTxtContent()
16. JSON EXPORT                exportJSON()
17. FILE SYSTEM HELPERS        downloadFileFS(), saveBlobFS(), truncFilename(), downloadTextFileFS()
18. GM/ANCHOR HELPERS          downloadFileGM(), downloadBlobGM(), downloadTextFileGM()
19. WATERMARK REMOVAL          (many helpers) + fetchWatermarkFreeVideoBytes(), fetchWatermarkFreeVideoBlob()
20. DOWNLOAD ORCHESTRATION     downloadWithCurrentSolution(), downloadMediaWithWatermarkProxyFallback()
21. SOURCE STATUS              setSrcStatus(), renderSrcProgress(), updateScanButton()
22. SCAN STORYTELLING          startScanStories(), stopScanStories(), showScanStory()
23. TOAST                      showToast()
24. VERSION CHECK              checkForUpdate()
25. SCAN                       startScan(), stopAll()
26. WATERMARK ESTIMATE BADGE   formatWatermarkEstimateLabel(), updateWatermarkEstimateBadge()
27. DOWNLOAD                   startDownload()
28. END SCREEN                 computeTimeSaved(), showEndScreen()
29. STATE MACHINE              setState(), syncExpertSections()
30. FILTER LOGIC               resetFilters(), resetFilterInputs(), rebuildSourceChips(), rebuildAllChips(), rebuildChips()
31. UI HELPERS                 setStatus(), renderActivityLine(), scheduleActivityRender(), showActivityWarning(),
                               updateDownloadProgress(), log(), readConfig(), readConfigBool(),
                               refreshAuthBadge(), setSpeedIdx(), getContentWord(), recomputeSelection(),
                               updateFilterBadge(), syncNDirButtons()
32. STYLES                     STYLE constant (inline CSS string)
33. PANEL HTML                 createPanel() — builds DOM + wires all event listeners
34. BOOTSTRAP                  DOMContentLoaded / setTimeout(createPanel, 500)
```

---

## Constants

### Release info
```js
const VERSION      = '2.0.1';
const RELEASE_DATE = '2026-04-14';
const GITHUB_REPO  = 'charyou/SoraVault';
const SORA_SHUTDOWN = new Date('2026-04-26T00:00:00Z');
```

### CFG — user-facing defaults
```js
const CFG = {
    PARALLEL_DOWNLOADS: 2,
    DOWNLOAD_TXT:       true,
    FILENAME_TEMPLATE:  '{date}_{prompt}_{genId}',
    PROMPT_MAX_LEN:     80,
    BEARER_TOKEN:       '',   // paste "eyJ…" here to hardcode auth
};
```
`CFG.BEARER_TOKEN` is also written at runtime by the session token auto-fetch in `fetchSelectedSources()` and `preflightV2Check()`.

### Watermark proxy constants
```js
const SHARED_VIDEO_ID_PATTERN            = /^s_[A-Za-z0-9_-]+$/;
const WATERMARK_FETCH_MAX_ATTEMPTS       = 6;
const WATERMARK_FETCH_BASE_RETRY_MS      = 1200;
const WATERMARK_FETCH_MAX_RETRY_MS       = 20000;
const WATERMARK_PROXY_FAILURE_LIMIT      = 3;
const MIN_VIDEO_BYTES_FALLBACK_THRESHOLD = 256 * 1024;   // 256 KB
const ESTIMATED_SIZE_FALLBACK_RATIO      = 0.2;          // < 20% of expected = bad
```

### SCAN_SOURCES
Ordered array; iteration order controls scan sequence.
```js
{ id, icon, label, sub, group }
// group: 'v1' | 'v2'
```

### SOURCE_LABELS
```js
{ v1_library: 'Library', v1_liked: 'Likes (v1)', v2_profile: 'Videos',
  v2_drafts: 'Drafts', v2_liked: 'Liked' }
```

### SUBFOLDERS
```js
{ v1_library: 'sora_v1_images', v1_videos: 'sora_v1_videos', v1_liked: 'sora_v1_liked',
  v2_profile: 'sora_v2_profile', v2_drafts: 'sora_v2_drafts', v2_liked: 'sora_v2_liked' }
```

### SPEED_PRESETS
```js
[
    { workers: 2, delay: 300 },  // index 0 — Standard
    { workers: 4, delay: 150 },  // index 1 — Faster
    { workers: 8, delay:  60 },  // index 2 — Very fast
]
```
Active preset is `SPEED_PRESETS[speedIdx]`. GM/anchor mode always caps at 2 workers.

---

## Module-Level State Variables

All state is in the IIFE closure — no globals.

| Variable | Type | Purpose |
|----------|------|---------|
| `collected` | `Map<string, item>` | All ingested items (keyed by genId or postId) |
| `workerActivities` | `Map<number, string>` | Maps worker item-index to current phase phrase |
| `activityRenderTimer` | `number\|null` | Debounce handle for `renderActivityLine()` |
| `activityWarningTimer` | `number\|null` | 10s auto-clear timer for `#sdl-activity-right` |
| `oaiDeviceId` | `string\|null` | Captured `oai-device-id` header |
| `oaiLanguage` | `string` | Captured `oai-language`, default `'en-US'` |
| `storedV2Headers` | `object` | All captured headers from V2 API requests |
| `isRunning` | `boolean` | Scan or download in progress |
| `stopRequested` | `boolean` | Set by Stop button; workers check this each iteration |
| `completedCount` | `number` | Successfully downloaded items in current run |
| `failedCount` | `number` | Failed items in current run |
| `totalToDownload` | `number` | Items queued for download |
| `speedIdx` | `number` | Index into SPEED_PRESETS (0/1/2) |
| `uiState` | `string` | Current panel state: `'init'`/`'scanning'`/`'ready'`/`'downloading'`/`'done'` |
| `scanStoryTimer` | `number\|null` | Interval handle for scan storytelling |
| `scanStoryIdx` | `number` | Current story card index |
| `lastSaveTxt` | `boolean` | Snapshot of save-txt toggle from last download run |
| `lastSaveMedia` | `boolean` | Snapshot of save-media toggle |
| `lastSaveJSON` | `boolean` | Snapshot of save-json toggle |
| `lastFilterSnap` | `string[]` | Snapshot of active filter descriptions for done screen |
| `dlMethod` | `'fs'\|'gm'` | Download method in use |
| `baseDir` | `FileSystemDirectoryHandle\|null` | Root directory from folder picker |
| `cachedUserId` | `string\|null` | V2 user ID from `/v2/me`, cached for liked source |
| `watermarkRemovalEnabled` | `boolean` | Mirrors the WATERMARK_REMOVAL toggle |
| `watermarkProxyDisabled` | `boolean` | Set on 3 failures or first 408; disables proxy for session |
| `watermarkProxyFailureCount` | `number` | Consecutive proxy failures in current download run |
| `globalRateLimitCooldownUntilMs` | `number` | Epoch ms until rate limit cooldown expires |
| `watermarkRateLimitStreak` | `number` | Consecutive 429 responses (feeds backoff multiplier) |
| `isV2Supported` | `boolean` | False when geo-blocked |
| `geoCheckInitDone` | `boolean` | True after first `preflightV2Check()` triggered by auth capture |
| `enabledSources` | `Set<string>` | Source IDs currently checked in the UI |
| `srcStatus` | `object<id, string>` | Per-source scan status: `'idle'`/`'pending'`/`'active'`/`'done'`/`'error'`/`'skipped'` |
| `filters` | `object` | All active filter values (see Filter System) |
| `toastTimer` | `number\|null` | Auto-hide timer for toast notification |

---

## Utilities

### `sleep(ms) → Promise`
```js
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
```
Used throughout for inter-request delays and retry waits.

### `gcd(a, b) → number`
Greatest common divisor (recursive). Used to compute aspect ratios from pixel dimensions.

### `shutdownDaysDelta() → number`
Returns positive integer if Sora has already shut down (days since), negative if still open (days until). Uses `SORA_SHUTDOWN` constant.

---

## Fetch Intercept

```
ENV.win.fetch = async function (...args) { ... }
```

The original fetch is saved as `_fetch` before patching:
```js
const _fetch = ENV.win.fetch.bind(ENV.win);
```

**On every request:**
- Extracts `oai-device-id` and `oai-language` from request headers
- On `/backend/project_y/` requests: stores all non-skip headers in `storedV2Headers`

**On successful responses:**
- `/list_tasks` → `ingestV1Page()`
- `/backend/project_y/profile_feed/` → `ingestV2Page()`
- `/backend/project_y/profile/drafts/v2` → `ingestV2Page()`

**`_fetch` is the raw, un-patched fetch** — used for all SoraVault's own API calls to avoid recursion.

XMLHttpRequest is patched similarly for `setRequestHeader` (auth capture) and the `load` event on `/list_tasks` (passive V1 ingestion).

---

## Data Ingestion

### `ingestV1Page(data, sourceId) → { hasMore, lastId }`
Parses `/backend/v2/list_tasks` responses. Iterates `data.task_responses` / `data.tasks`, then nested `task.generations`. Skips deleted items and non-ready download statuses. Sets `mode: 'v1'`. Detects video vs. image from `taskType` or `n_frames`. Returns pagination state.

### `ingestV1LikedPage(data) → { hasMore, lastId }`
Parses `/backend/collections/social_favorites/generations` responses. Single-level array (no task wrapper). Captures `author` (username from `gen.user`). `source` is always `'v1_liked'`.

### `ingestV2Page(data, url, sourceId) → { hasMore, nextCursor }`
Handles both draft and profile/liked responses. Branched on `isDrafts`:
- **Drafts:** Items are flat generation objects. URL resolved from `encodings.source.path → downloadable_url → download_urls.watermark → url`.
- **Profile/Liked:** Items are `{ post, profile }` wrappers. URL resolved from `post.attachments[0]` using the same chain.

Contains a debugging `check()` helper that `console.log`s candidate URLs as they're evaluated. The `console.log("Final ausgewählt …")` lines are intentional debug output.

All three ingest functions call `refreshScanCount()` to update the live counter in the scanning state.

---

## Filter Engine

### `getFilteredItems() → item[]`
Applies all `filters` in order. Returns an array (not a Map). Filter application order:
1. `filterSources` — source category filter
2. `keyword` — comma-separated, all terms must match `item.prompt`
3. `authorExclude` — exact match (case-insensitive)
4. `ratios`, `qualities`, `operations` — Set membership
5. `dateFrom`, `dateTo` — string comparison (YYYY-MM-DD sorts lexically)
6. `nItems` + `nDirection` — `slice(0, n)` for 'last', `slice(-n)` for 'first'

### `getDistinctValues(key) → string[]`
Returns all distinct non-null values for a field across all of `collected`. Sorted alphabetically.

### `getDistinctValuesByMode(key, mode) → string[]`
Like `getDistinctValues` but filters by `item.mode === mode` first.

### `getDistinctValuesByModeFiltered(key, mode) → string[]`
Like `getDistinctValuesByMode` but also respects `filters.filterSources`. Used by `rebuildAllChips()` to show only values relevant to currently-selected source categories.

### `snapshotActiveFilters() → string[]`
Returns human-readable descriptions of currently active filters. Used to populate the "Filters applied" section on the done screen.

---

## Network Helpers

### `buildHeaders(extra = {}) → object`
Merges `storedV2Headers` + standard fields + optional bearer token + `extra` overrides. Always includes `accept: '*/*'`, `oai-language`, `referer`. Adds `oai-device-id` only when captured.

### `fetchWithRetry(url, opts, maxRetries = 3) → Response | null`
Wraps `_fetch` with:
- **429:** Waits `retry-after` seconds, then retries
- **400 with geo-block body:** Immediately sets `isV2Supported = false`, calls `applyV2GeoBlock()`, returns `null` (no retry)
- **401:** Logs and retries (auth headers may not be ready)
- **other errors:** Logs, sleeps `600ms × attempt`, retries
Returns `null` if all retries fail.

---

## Geo-Block Detection

### `preflightV2Check()`
Probes `/backend/project_y/profile_feed/me?limit=1` with captured auth headers. On HTTP 400, inspects JSON/text body for `unsupported_country`/`unsupported_region`. Calls `applyV2GeoBlock()` in both directions (blocked ↔ unblocked). Also attempts to auto-fetch `CFG.BEARER_TOKEN` from `/api/auth/session` if not set.

Called:
- Once 2.5s after panel creation
- Every 10s while `uiState === 'init'` or `!isV2Supported`
- Once when auth is first captured (`refreshAuthBadge` → `geoCheckInitDone`)

### `applyV2GeoBlock()`
Reads `isV2Supported` and updates UI accordingly:
- Disables/enables V2 source checkboxes (`sdl-src-cb-v2_*`)
- Sets row opacity and adds/removes `sdl-geo-tag` badge spans
- Updates `#sdl-v2-geo-notice` text and class
- Updates `#sdl-v2-status-badge`
- Calls `updateScanButton()`

---

## API Scan Fetchers

### `fetchAllV1()`
Paginates `/backend/v2/list_tasks` using `after={lastId}`. Limit: 20 per page. Calls `ingestV1Page()`. Sets `srcStatus` to `'done'` or `'error'`. Waits 30ms between pages.

### `fetchAllV1Liked()`
Paginates `/backend/collections/social_favorites/generations` using `after={lastId}`. Limit: 10 per page. Calls `ingestV1LikedPage()`. Waits 50ms between pages.

### `fetchAllV2(baseEndpoint, sourceId)`
Generic V2 paginator. Appends `&cursor={cursor}` for subsequent pages. Calls `ingestV2Page()`. Waits 60ms between pages.

### `fetchAllV2Liked()`
First fetches `/backend/project_y/v2/me` to get `cachedUserId`, then calls `fetchAllV2()` with the liked endpoint. Fails with `'error'` status if user ID cannot be retrieved.

### `fetchSelectedSources()`
**The main scan orchestrator.** 
1. Attempts to auto-fetch bearer token from `/api/auth/session`
2. Waits up to 10s for `oaiDeviceId` to be captured (polls every 250ms)
3. Iterates `SCAN_SOURCES` in order; skips sources not in `enabledSources`
4. Calls the appropriate fetcher from `FETCH_MAP` for each source
5. Sets `srcStatus` as it goes

---

## Download URL Resolution

### `getDownloadUrl(item) → string | null`
- **V2:** Returns `item.downloadUrl` if present. Otherwise tries the post tree API (`/backend/project_y/post/{postId}/tree`). Falls back to `item.previewUrl`.
- **V1:** Calls `/backend/generations/{genId}/download` to get a fresh signed URL. Falls back to `item.pngUrl`.

### `extractUrlFromTree(tree) → string | null`
Extracts the first available URL from `post.attachments`, trying `downloadable_url → download_urls.watermark → download_urls.no_watermark → url`.

### `getSubfolderName(item) → string`
Maps item to a SUBFOLDERS key. V1 items check `item.isVideo` to decide between `v1_videos` and `v1_library`.

### `getFileExt(item) → string`
Returns `'.mp4'` for V2 items or V1 videos, `'.png'` for V1 images.

---

## Filename & TXT Builders

### `slugify(str, maxLen) → string`
Normalises a string for use in a filename:
- Collapses whitespace → underscores
- Removes most special characters (keeps `äöüÄÖÜ\w\s-`)
- Trims leading/trailing underscores
- Truncates to `maxLen`

### `buildBase(item) → string`
Applies the filename template (read from `#sdl-cfg-FILENAME_TEMPLATE` input, fallback to `CFG.FILENAME_TEMPLATE`). Substitutes all `{token}` placeholders. Collapses repeated underscores and trims.

### `buildTxtContent(item) → string`
Builds the `.txt` sidecar content: metadata block (source, IDs, date, resolution, quality, etc.) followed by a separator line and the full prompt text.

---

## JSON Export

### `exportJSON(silent = false)`
Serialises all of `collected` to JSON with a `soravault_version`, `exported_at` timestamp, active scan sources, and total count. Filename: `soravault_manifest_YYYY-MM-DD.json`.

Write path priority:
1. FS API: `baseDir.getFileHandle()` (if `baseDir` is set)
2. TM: `GM_download()` with `saveAs: true`
3. Chrome: anchor/blob download

---

## File System Helpers

### `downloadFileFS(url, filename, dir) → Promise<boolean>`
Fetches a URL as a blob and writes it to `dir` via the FS API.
1. Tries `_fetch(url)` first
2. On failure and if running in TM: falls back to `GM_xmlhttpRequest` (bypasses CORS)
3. Delegates actual file write to `saveBlobFS()`

### `saveBlobFS(blob, filename, dir) → Promise<boolean>`
Writes a blob to a `FileSystemDirectoryHandle`. Implements auto-truncation for Windows MAX_PATH:
- If write fails, reduces `maxLen` to `min(maxLen - 30, floor(maxLen * 0.7))` and retries
- Stops at 40-character minimum
- Logs when a shorter name is used

### `truncFilename(name, maxLen) → string`
Truncates a filename while preserving the extension. Removes trailing underscores before the extension.

### `downloadTextFileFS(content, filename, dir) → Promise<boolean>`
Same as `saveBlobFS` but writes a text string directly. Same auto-truncation loop.

---

## GM / Anchor Helpers

### `downloadFileGM(url, subfolder, filename) → Promise<boolean>`
**TM:** `GM_download({ url, name: subfolder/filename, saveAs: false })`. Supports subfolders in the download path.
**Chrome:** Fetches URL → blob → anchor click → immediate `revokeObjectURL`. No subfolder support.

### `downloadBlobGM(blob, subfolder, filename) → Promise<boolean>`
Like `downloadFileGM` but accepts an in-memory blob. Used for watermark-removed video blobs.
**TM:** Creates a blob URL, passes to `GM_download`, revokes on completion.
**Chrome:** Anchor click + immediate revoke. `blob = null` after revoke to allow GC.

### `downloadTextFileGM(content, subfolder, filename) → Promise<boolean>`
Creates a UTF-8 text blob and routes through `GM_download` (TM) or anchor (Chrome).

---

## Watermark Removal Helpers

### `extractMaybeSharedVideoId(value) → string | null`
Tests a string against `SHARED_VIDEO_ID_PATTERN` (`/^s_[A-Za-z0-9_-]+$/`). If it doesn't match exactly, tries to extract a matching substring. Returns the ID or `null`.

### `getWatermarkProxyVideoId(item, directUrl) → string | null`
Searches ~20 candidate fields across the item and its `_raw` API data to find a valid shared video ID. Tries them in priority order. Returns the first match found.

### `getWatermarkExpectedSizeBytes(item) → number | null`
Searches various size-related field names across the item and its attachment data to find an expected byte count. Used for "too small" fallback detection.

### `isWatermarkRemovalSourceSupported(item) → boolean`
Returns `true` only for `v2_profile` and `v2_liked` sources.

### `isWatermarkProxyEligible(item, directUrl) → boolean`
All conditions must be true:
- `watermarkRemovalEnabled && !watermarkProxyDisabled`
- `item.mode === 'v2'`
- Source is supported (profile or liked)
- File extension is `.mp4`
- A valid video ID can be extracted

### `clampRetryMs(value) → number`
Clamps to `[800, WATERMARK_FETCH_MAX_RETRY_MS]`.

### `jitterMs(maxJitterMs) → number`
Returns a random integer `[0, maxJitterMs)`. Prevents synchronized retries across workers.

### `resolveRetryDelayMs(response, attempt, rateLimitStreak) → number`
Prefers `retry-after` header value (in seconds, converted to ms + jitter). Falls back to exponential backoff scaled by attempt number and rate-limit streak.

### `isRetryableWatermarkStatus(status) → boolean`
Returns `true` for `425`, `429`, and `5xx`. Notably **excludes 408** — a 408 is a session-wide upstream timeout that should trigger immediate proxy disablement, not retry.

### `shouldFallbackToSourceDownload(byteLength, expectedSizeBytes) → boolean`
Returns `true` if:
- `byteLength < MIN_VIDEO_BYTES_FALLBACK_THRESHOLD` (256 KB), or
- `byteLength < expectedSizeBytes * ESTIMATED_SIZE_FALLBACK_RATIO` (< 20% of expected)

### `isLikelyVideoPayload(bytes) → boolean`
Checks magic bytes: MP4 (`'ftyp'` at offset 4–7) or WebM (EBML header at offset 0–3).

### `getVideoMimeType(bytes) → string`
Returns `'video/mp4'`, `'video/webm'`, or `'application/octet-stream'` based on magic bytes.

### `fetchWatermarkFreeVideoBytes(videoId, expectedSizeBytes, setPhase) → Promise<Uint8Array>`
The core proxy fetch loop. Up to `WATERMARK_FETCH_MAX_ATTEMPTS` attempts:
1. Waits for any active rate-limit cooldown
2. GETs `https://soravdl.com/api/proxy/video/{videoId}`
3. On 429: updates `globalRateLimitCooldownUntilMs`, increments streak, calls `setPhase` with wait text
4. On 408: breaks loop immediately (caller must disable proxy)
5. On other non-ok: retries if status is retryable
6. On ok: validates magic bytes and minimum size; returns `Uint8Array`

Throws on all failure paths — caller handles the exception.

### `fetchWatermarkFreeVideoBlob(item, directUrl, setPhase) → Promise<Blob>`
Wrapper: extracts video ID via `getWatermarkProxyVideoId`, calls `fetchWatermarkFreeVideoBytes`, wraps result in a `Blob` with the correct MIME type.

---

## Download Orchestration

### `downloadWithCurrentSolution(url, filename, item, dir, setPhase)`
The simple (non-watermark) download path. Sets phase to `⬇ {sourceLabel}`. Routes to `downloadFileFS()` or `downloadFileGM()` based on `dlMethod`.

### `downloadMediaWithWatermarkProxyFallback(item, url, filename, dir, setPhase)`
The main per-item download function. 
- If item is not proxy-eligible: falls through to `downloadWithCurrentSolution()`
- If proxy-eligible: attempts `fetchWatermarkFreeVideoBlob()`, writes the resulting blob
- On proxy failure: increments `watermarkProxyFailureCount`, checks 408 flag, may set `watermarkProxyDisabled = true`, calls `showActivityWarning()`, falls through to `downloadWithCurrentSolution()`

---

## Source Status

### `setSrcStatus(id, status)`
Sets `srcStatus[id]` and calls `renderSrcProgress()`.

### `renderSrcProgress()`
Renders the scan progress indicator (shown in the scanning state). Maps each enabled source to a colored status chip with icon, label, and status icon. Status classes: `sp-active`, `sp-done`, `sp-err`, `sp-skip`.

### `updateScanButton()`
Reads how many sources are available (not disabled by geo-block) and how many are checked. Updates the Scan button's `disabled` state and label text (`'Scan All'` vs `'Scan (N sources)'`).

---

## Scan Storytelling

Displayed in the scanning state, rotates through `SCAN_STORIES` every 4.2s.

### `startScanStories()`
Resets index to 0, shows first story, starts a `setInterval` at 4200ms.

### `stopScanStories()`
Clears the interval.

### `showScanStory(idx)`
Updates `#sdl-story-icon` and cross-fades `#sdl-story-text` (sets opacity to 0, then to 1 after 180ms).

---

## Toast

### `showToast(msg, ms = 2400)`
Adds class `tin` to `#sdl-toast` (fade in), schedules `tout` class after `ms` (fade out). Cancels any pending timer on repeated calls.

---

## Version Check

### `checkForUpdate()`
Fetches `https://api.github.com/repos/{GITHUB_REPO}/releases/latest`. If the latest tag differs from `VERSION`, shows `#sdl-update-badge` with the new version string. Fails silently.

---

## Scan Control

### `startScan()`
Guard: returns if `isRunning`. Clears `collected`, resets counts and `cachedUserId`, calls `resetFilters()`. Sets all source statuses to `'pending'`. Calls `setState('scanning')`, `startScanStories()`, then `await fetchSelectedSources()`. On completion: calls `setState('ready')`, `rebuildAllChips()`, `recomputeSelection()`.

### `stopAll()`
Sets `stopRequested = true`, `isRunning = false`. Stops scan stories. Transitions to `'ready'` if items were collected, otherwise back to `'init'`.

---

## Watermark Estimate Badge

### `formatWatermarkEstimateLabel(minSeconds, maxSeconds) → string`
Returns `'+N min'` or `'+N-M min'` or `'+0 min'`.

### `updateWatermarkEstimateBadge()`
Called at the end of `recomputeSelection()` and on toggle changes. Counts proxy-eligible items in the current filtered selection. Estimates 10–20s per video. Updates `#sdl-watermark-estimate`. Shows `'off'` style when save-media or watermark-removal toggle is off.

---

## Download Orchestration — `startDownload()`

The main download entry point:

1. Reads toggle states (`SAVE_MEDIA`, `DOWNLOAD_TXT`, `SAVE_JSON`, `WATERMARK_REMOVAL`)
2. Detects available download method (FS API → GM → error)
3. Opens folder picker if needed
4. Resets watermark state counters
5. Sets `setState('downloading')`
6. Creates subfolder cache (`subDirCache`) to avoid re-calling `getDirectoryHandle` per item
7. Spawns `conc` concurrent `worker()` coroutines via `Promise.all`

### Inner `worker()` coroutine
Each worker:
- Tracks `prevI` (previous item index) to delete its stale `workerActivities` entry at the start of each new item (eliminates empty-line flash in activity display)
- Creates a `setPhase(phrase)` closure keyed to the current item index `i`
- Calls `getDownloadUrl()` → `downloadMediaWithWatermarkProxyFallback()`
- Optionally writes a `.txt` sidecar
- Updates `completedCount`/`failedCount` and calls `updateDownloadProgress()`
- Sleeps `SPEED_PRESETS[speedIdx].delay` between items

After all workers complete:
- Optionally exports JSON manifest
- Saves the download log as a `.txt` file
- Calls `showEndScreen()` or transitions to `'ready'` if stopped

---

## End Screen

### `computeTimeSaved(count, withTxt) → string`
20s per item without txt; 120s per item with txt. Formats as seconds / minutes / "X hours and Y minutes".

### `showEndScreen(saveTxt, saveMedia, saveJSON)`
Sets state to `'done'`. Populates:
- `.sdl-done-title` — count + time saved
- `#sdl-done-saved` — prompt saved message
- `#sdl-done-stats` — stat chips for saved/failed/prompts/manifest
- `#sdl-done-filters` — filter snapshot if filters were active
- `.sdl-coffee-msg` — personalised time-saved message

---

## State Machine

### `setState(s)`
Shows `#sdl-s-{s}`, hides all other state divs. Updates `#sdl-status` text. Calls `syncExpertSections()`.

### `syncExpertSections()`
Shows `#sdl-exp-template` (filename template section) only in `'ready'` state.

---

## Filter Logic

### `resetFilters()`
Clears all `filters` fields and Sets.

### `resetFilterInputs()`
Clears DOM input values and removes `.active` from all chip buttons. Calls `syncNDirButtons()`.

### `rebuildSourceChips()`
Rebuilds `#sdl-f-sources`. Only shows sources that have items in `collected`. Shows `—` if ≤ 1 source present. Chip click toggles `filters.filterSources`, then calls `rebuildAllChips()` and `recomputeSelection()`.

### `rebuildAllChips()`
Calls `rebuildSourceChips()` then `rebuildChips()` for all sub-filter chip containers (V1 ratios, qualities, operations; V2 ratios, qualities). Uses `getDistinctValuesByModeFiltered()` so chips reflect source-filtered data.

### `rebuildChips(containerId, filterKey, availableValues)`
Rebuilds a chip container:
- Available values → normal chips
- Values in `filters[filterKey]` that are no longer in `availableValues` → dimmed chips (`.dim` class, 32% opacity, preserved selection state)
- Shows `—` when empty

---

## UI Helpers

### `setStatus(text)`
Sets `#sdl-status` text and toggles `display:none` when empty.

### `renderActivityLine()`
Reads `workerActivities` Map, groups duplicate phrases (`×N` suffix). Updates `#sdl-activity-left`. Toggles `.sdl-activity-pulse` class when any phrase contains `'soravdl'` or `'rate-limited'`. Sets `\u00A0` (non-breaking space) when empty to prevent height collapse.

### `scheduleActivityRender()`
Debounces `renderActivityLine()` to 120ms using `activityRenderTimer`.

### `showActivityWarning(text)`
Writes to `#sdl-activity-right` with amber color. Auto-clears after 10s via `activityWarningTimer`. Cancels any pending timer on repeated calls.

### `updateDownloadProgress(dlStart?)`
Updates `#sdl-dl-count`, `#sdl-dl-bar` width, `#sdl-dl-done`, `#sdl-dl-failed`, `#sdl-dl-eta`. ETA calculation: `(totalToDownload - completedCount - failedCount) / (completedCount / elapsed)`. Shows `~Xs left` or `~Nmin left`.

### `log(msg)`
Prepends `[HH:MM:SS] msg\n` to `#sdl-log.textContent`. No in-memory buffer — DOM-only.

### `readConfig(key) → string | null`
Reads `#sdl-cfg-{key}` element's `.value`. Returns `null` if element not found.

### `readConfigBool(key, def) → boolean`
Reads `#sdl-cfg-{key}` element's `.checked`. Returns `def` if element not found.

### `refreshAuthBadge()`
Updates `#sdl-auth` dot: green + pulse when `oaiDeviceId` is captured, amber when not. Triggers `preflightV2Check()` the first time auth is captured (guarded by `geoCheckInitDone`).

### `setSpeedIdx(i)`
Updates `speedIdx`, toggles `.active` on `.sdl-speed-seg` elements, updates hint text with warning class.

### `getContentWord() → string`
Returns `'items'`, `'videos'`, or `'images'` based on what types are in `collected`. Used for grammatically correct UI strings.

### `recomputeSelection()`
**The central UI update hub.** Called after every filter change, scan completion, and reset. Updates:
- `#sdl-counter-pill` text and `.filtered` class
- `#sdl-dl` button text and `disabled` state
- Calls `updateFilterBadge()`
- Calls `updateWatermarkEstimateBadge()`

### `updateFilterBadge()`
Counts active filter dimensions (1 per text field with content, 1 per Set entry per chip group). Updates `#sdl-filter-badge` text and `.active` class.

### `syncNDirButtons()`
Toggles `.active` on `#sdl-n-last` and `#sdl-n-first` to match `filters.nDirection`.

---

## Panel Creation — `createPanel()`

The largest function (~500 lines). Creates the entire UI:

1. Injects the `STYLE` constant as a `<style>` element into `<head>`
2. Appends `#sdl-toast` to `<body>`
3. Creates the main `#sdl` div with full HTML (all 5 states + settings drawer + expert drawer)
4. **Event listeners wired in order:**
   - Logo error fallback (shows emoji placeholder)
   - Drag-to-move on header (mousedown/mousemove/mouseup, excluded on buttons/inputs)
   - Minimize/expand toggle
   - Source checkboxes (each toggles `enabledSources`, calls `updateScanButton()`)
   - Settings gear drawer toggle
   - Expert drawer toggle
   - Filter disclosure toggle
   - Scan, Stop, Download, Rescan, Back, Clear buttons
   - Speed segments
   - N-direction buttons
   - Filter text inputs (live `input` events)
   - Date range inputs (`change` events)
   - Filter reset link
   - SAVE_MEDIA and WATERMARK_REMOVAL toggles → `updateWatermarkEstimateBadge()`
5. **Async init:**
   - `setTimeout(checkForUpdate, 1500)` — version check
   - `updateShutdownBadge()` — Sora days remaining
   - `updateScanButton()` — initial button state
   - `updateWatermarkEstimateBadge()` — initial badge
   - `setState('init')`
   - `setTimeout(preflightV2Check, 2500)` — first geo check
   - `setInterval(..., 10000)` — recurring geo checks in init/blocked states

### Bootstrap
```js
if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', createPanel);
else
    setTimeout(createPanel, 500);
```
The 500ms delay on `setTimeout` is intentional — gives the page time to settle before injecting the panel (relevant when `document_start` fires very early).

---

## DOM Element ID Reference

| ID | State/Section | Purpose |
|----|--------------|---------|
| `#sdl` | All | Root panel element |
| `#sdl-header` | All | Drag handle + header bar |
| `#sdl-logo` | All | Logo image (with error fallback) |
| `#sdl-logo-fb` | All | Emoji fallback when logo fails to load |
| `#sdl-title` | All | "SoraVault 2.0" text |
| `#sdl-update-badge` | All | Update available badge (hidden by default) |
| `#sdl-auth` | All | Auth status dot (amber/green) |
| `#sdl-min` | All | Minimize/expand button |
| `#sdl-gear` | All | Settings drawer toggle |
| `#sdl-body` | All | Scrollable body container |
| `#sdl-status` | All | Status text bar (hidden when empty) |
| `#sdl-s-init` | init | Source selection + scan button |
| `#sdl-src-cb-{id}` | init | Source checkbox (one per SCAN_SOURCES entry) |
| `#sdl-src-row-{id}` | init | Source row label element |
| `#sdl-v2-status-badge` | init | "checking…" / "✓ available" / "⚠ geo-blocked" |
| `#sdl-v2-geo-notice` | init | Geo-block notice text |
| `#sdl-scan` | init | "Scan All" / "Scan (N sources)" button |
| `#sdl-s-scanning` | scanning | Scanning state UI |
| `#sdl-scan-count` | scanning | Live item count |
| `#sdl-src-progress` | scanning | Per-source status chips |
| `#sdl-story-icon` | scanning | Rotating story icon |
| `#sdl-story-text` | scanning | Rotating story text |
| `#sdl-shutdown-badge` | scanning | "N days left" / "closed N days ago" |
| `#sdl-stop-scan` | scanning | Stop scan button |
| `#sdl-s-ready` | ready | Post-scan / filter state |
| `#sdl-cfg-SAVE_MEDIA` | ready | Save media toggle (checkbox) |
| `#sdl-cfg-DOWNLOAD_TXT` | ready | Save .txt toggle (checkbox) |
| `#sdl-cfg-SAVE_JSON` | ready | Save JSON toggle (checkbox) |
| `#sdl-cfg-WATERMARK_REMOVAL` | ready | Watermark removal toggle (checkbox) |
| `#sdl-watermark-estimate` | ready | "+N-M min" estimate badge |
| `#sdl-counter-pill` | ready | "N / M selected" or "N videos" |
| `#sdl-dl` | ready | Download button |
| `#sdl-rescan` | ready | Rescan button |
| `#sdl-filter-disc` | ready | Filter section toggle |
| `#sdl-filter-badge` | ready | "N active" / "none active" |
| `#sdl-filter-drawer` | ready | Filter drawer (collapsible) |
| `#sdl-f-sources` | filter | Category filter chips |
| `#sdl-f-keyword` | filter | Keyword input |
| `#sdl-f-author` | filter | Author exclude input |
| `#sdl-f-date-from` | filter | Date from input |
| `#sdl-f-date-to` | filter | Date to input |
| `#sdl-f-n-items` | filter | N items input |
| `#sdl-n-last` | filter | "Last N" direction button |
| `#sdl-n-first` | filter | "First N" direction button |
| `#sdl-f-v1-ratios` | filter | V1 aspect ratio chips |
| `#sdl-f-v1-qualities` | filter | V1 quality chips |
| `#sdl-f-v1-operations` | filter | V1 operation chips |
| `#sdl-f-v2-ratios` | filter | V2 aspect ratio chips |
| `#sdl-f-v2-qualities` | filter | V2 quality chips |
| `#sdl-filter-reset` | filter | Reset all filters link |
| `#sdl-s-downloading` | downloading | Download progress state |
| `#sdl-dl-count` | downloading | Completed file count |
| `#sdl-dl-total` | downloading | Total file count |
| `#sdl-dl-bar` | downloading | Progress bar fill |
| `#sdl-activity-line` | downloading | Activity status line container |
| `#sdl-activity-left` | downloading | Worker phase text (pulsing when slow) |
| `#sdl-activity-right` | downloading | Proxy warning (amber, 10s auto-clear) |
| `#sdl-dl-done` | downloading | Done count |
| `#sdl-dl-failed` | downloading | Failed count |
| `#sdl-fail-wrap` | downloading | Failed stat wrapper (red when > 0) |
| `#sdl-dl-eta` | downloading | ETA text |
| `#sdl-stop-dl` | downloading | Stop download button |
| `#sdl-s-done` | done | Done screen |
| `#sdl-done-saved` | done | "Saved to your hard drive" text |
| `#sdl-done-stats` | done | Stat chips row |
| `#sdl-done-filters` | done | Active filters section |
| `#sdl-done-filter-list` | done | Filter description text |
| `#sdl-done-back` | done | ← Back button |
| `#sdl-settings-drawer` | settings | Settings drawer (collapsible) |
| `#sdl-expert-foot` | expert | Expert settings toggle bar |
| `#sdl-expert-drawer` | expert | Expert settings drawer |
| `#sdl-exp-template` | expert | Filename template section (ready state only) |
| `#sdl-cfg-FILENAME_TEMPLATE` | expert | Filename template input |
| `#sdl-cfg-PROMPT_MAX_LEN` | expert | Prompt max length input |
| `#sdl-log` | expert | Log output div |
| `#sdl-clear` | expert | Clear &amp; reset button |
| `#sdl-toast` | All (body) | Toast notification |
