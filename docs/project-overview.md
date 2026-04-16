# SoraVault — Project Overview

## What is SoraVault?

SoraVault is a browser-side tool that bulk-downloads a user's Sora content (images, videos, drafts, liked items) directly from OpenAI's internal APIs. It intercepts the page's own network requests to capture authentication headers, then walks all API pages and downloads files to the user's local disk.

It ships as **two build targets from one source file**:

| Target | Delivery | Context |
|--------|----------|---------|
| Tampermonkey userscript | `dist/SoraVault.user.js` | Runs in a privileged TM sandbox |
| Chrome Extension (MV3) | `dist/chrome-extension/` | Runs as a content script in MAIN world |

---

## Repository Structure

```
Plugin Soravault/
├── src/
│   ├── core.js              # Single unified source (~3,040 lines)
│   ├── headers.txt          # ==UserScript== metadata block (TM only)
│   └── chrome/
│       ├── manifest.json    # MV3 manifest
│       ├── background.js    # Service worker (chrome.downloads relay)
│       ├── bridge.js        # ISOLATED world — injects asset base URL
│       └── assets/          # icon16/48/128 + soravault-logo-square.png
├── tampermonkey/
│   ├── SoraVault_v2copy.user.js  # TM dev reference (not production)
│   └── SoraVault_v2_0.user.js
├── build.py                 # Micro-builder (no dependencies)
├── dist/                    # Build output (gitignored)
│   ├── SoraVault.user.js
│   └── chrome-extension/
├── docs/
│   ├── project-overview.md  # This file
│   ├── core-js-reference.md # Full function reference for core.js
│   └── soravdl-proxy-api.md # Watermark proxy API reference
├── changelog.md
├── CLAUDE.md
└── .gitignore
```

---

## Build System

`build.py` is a 25-line Python script with zero dependencies:

```bash
cd "Plugin Soravault"
python build.py
```

What it does:
1. **Tampermonkey target:** Concatenates `src/headers.txt` + `src/core.js` → `dist/SoraVault.user.js`
2. **Chrome Extension target:** Copies `src/core.js` → `dist/chrome-extension/content.js`, copies `manifest.json`, `background.js`, `bridge.js`, and the `assets/` folder

**Windows gotcha:** All file reads use `encoding='utf-8'` explicitly — `core.js` contains emoji characters which break Python's default `cp1252` encoding on Windows.

---

## Platform Detection — the ENV Object

At the top of `core.js`'s IIFE, a single `ENV` object establishes the runtime environment. All platform-specific branches in the code read from this object instead of querying the runtime inline.

```js
const ENV = {
    isTM:     typeof GM_download === 'function',
    win:      typeof unsafeWindow !== 'undefined' ? unsafeWindow : window,
    hasGM:    typeof GM_download === 'function',
    LOGO_URL: (() => {
        const meta = document.querySelector('meta[name="soravault-ext-base"]');
        return meta?.content
            ? meta.content + 'assets/soravault-logo-square.png'
            : 'https://raw.githubusercontent.com/charyou/SoraVault/main/assets/soravault-logo-square.png';
    })(),
};
```

| Property | Tampermonkey | Chrome Extension |
|----------|-------------|-----------------|
| `ENV.isTM` | `true` | `false` |
| `ENV.hasGM` | `true` | `false` |
| `ENV.win` | `unsafeWindow` (page's global) | `window` (already MAIN world) |
| `ENV.LOGO_URL` | GitHub raw URL (fallback) | `chrome-extension://…/assets/soravault-logo-square.png` |

`ENV.win` is critical for the fetch/XHR intercept: in Tampermonkey, `window` inside the sandbox is the sandbox's `window`, not the page's. `unsafeWindow` is the real page window where Sora's own fetch lives.

---

## Chrome Extension Architecture

The Chrome Extension uses **two content script worlds**:

### `bridge.js` — ISOLATED world
- Runs at `document_start`, before any page JavaScript
- Has access to `chrome.runtime` (not available in MAIN world)
- Injects a `<meta name="soravault-ext-base">` tag with `chrome.runtime.getURL('')` as its content
- This passes the extension's base URL into the page DOM so `core.js` can resolve `chrome-extension://` asset URLs

### `content.js` (= `core.js`) — MAIN world
- Runs the entire SoraVault logic
- MAIN world means it shares the same JavaScript execution environment as the page — it can directly intercept `window.fetch` and `XMLHttpRequest.prototype.open`
- Reads the `<meta>` tag injected by `bridge.js` to build `ENV.LOGO_URL`

### `background.js` — Service Worker
- Listens for `SV_DOWNLOAD` messages and relays them as `chrome.downloads.download()` calls
- Currently unused in the active download pipeline (the FS API path is preferred; anchor fallback is used when FS is unavailable)
- The infrastructure is there if a future path needs it

### Manifest (MV3) Permissions
```json
"permissions": ["downloads", "storage"],
"host_permissions": [
    "https://sora.chatgpt.com/*",
    "https://sora.com/*",
    "https://www.sora.com/*",
    "https://videos.openai.com/*",
    "https://api.github.com/*"
]
```

---

## Authentication Model

SoraVault does not store or hardcode credentials. It captures them passively:

### How auth is captured
`core.js` monkey-patches `window.fetch` and `XMLHttpRequest.prototype.setRequestHeader` at `document_start` (before any page code runs). When Sora makes its own API calls, the intercept reads:

- `oai-device-id` — a per-device identifier Sora sends with every request
- `oai-language` — locale header
- All other non-skip headers on `/backend/project_y/` requests → stored in `storedV2Headers`

Once `oaiDeviceId` is captured, the amber auth indicator dot in the UI turns green.

### Bearer token
`CFG.BEARER_TOKEN` is normally empty. `fetchSelectedSources()` and `preflightV2Check()` both attempt to auto-fetch it from `/api/auth/session` before scanning. It can also be hardcoded directly in `CFG.BEARER_TOKEN` for testing.

### `buildHeaders(extra)` 
Constructs request headers by merging `storedV2Headers` with standard fields and the optionally-set bearer token. Used by all scan fetchers.

---

## Scan Sources

Five sources, each with its own API endpoint and pagination mechanism:

| Source ID | Endpoint | Pagination | API Version |
|-----------|----------|-----------|-------------|
| `v1_library` | `/backend/v2/list_tasks` | `after` cursor + `has_more` | V1 |
| `v1_liked` | `/backend/collections/social_favorites/generations` | `after` cursor + `has_more` | V1 |
| `v2_profile` | `/backend/project_y/profile_feed/me?limit=8&cut=nf2` | `cursor` field | V2 |
| `v2_drafts` | `/backend/project_y/profile/drafts/v2?limit=15` | `cursor` field | V2 |
| `v2_liked` | `/backend/project_y/profile/{userId}/post_listing/likes?limit=8` | `cursor` field | V2 |

`v2_liked` requires fetching the user's ID first from `/backend/project_y/v2/me` and caches it in `cachedUserId`.

### Passive ingestion
V1 library and profile feed responses are also ingested passively: when Sora itself makes those API calls during normal page use, the fetch intercept clones the response and runs `ingestV1Page` / `ingestV2Page` on it. This means items already loaded by the page appear in `collected` even before a scan is started.

---

## Data Model — Item Object

All ingested items land in `collected: Map<string, item>`, keyed by generation ID or post ID. V1 and V2 items share a common shape but have different fields populated:

### V1 item shape
```js
{
    mode:      'v1',
    source:    'v1_library' | 'v1_liked',
    genId,
    taskId,
    date,          // YYYY-MM-DD string
    prompt,
    pngUrl,        // the URL used for downloading
    width, height,
    ratio,         // e.g. "16:9"
    quality,
    operation,
    model,
    seed,
    taskType,
    nVariants,
    isVideo,       // true if taskType includes 'vid' or n_frames > 1
    author,        // only for v1_liked
    likeCount,     // only for v1_liked
    canDownload,   // only for v1_liked
    _raw,
}
```

### V2 item shape
```js
{
    mode:       'v2',
    source:     'v2_profile' | 'v2_drafts' | 'v2_liked',
    genId,
    taskId,
    postId,     // only for profile/liked
    date,       // YYYY-MM-DD string
    prompt,
    downloadUrl, // resolved best URL (encodings.source.path priority chain)
    previewUrl,
    thumbUrl,
    width, height,
    ratio,
    duration,   // seconds
    model,
    isLiked,    // only for v2_profile
    _raw,
}
```

### URL resolution priority chain (V2)
```
encodings.source.path  →  downloadable_url  →  download_urls.watermark  →  url
```

The `url` property on V2 API objects points to a medium (`md`) encoding. Full resolution requires `encodings.source.path`.

---

## Download Methods

Three methods, selected based on environment and availability:

| Method | `dlMethod` | When used |
|--------|-----------|-----------|
| File System API | `'fs'` | Chrome/Edge with `window.showDirectoryPicker` — preferred |
| GM_download | `'gm'` | Tampermonkey when FS API not available |
| Anchor/blob fallback | `'gm'` (same path) | Chrome without FS API (rare) |

### FS API path (`dlMethod === 'fs'`)
1. `window.showDirectoryPicker()` → user picks a folder → stored in `baseDir`
2. Subfolders created via `baseDir.getDirectoryHandle(name, { create: true })`
3. Files written via `dir.getFileHandle(fn, { create: true })` + `createWritable()`
4. Auto-truncates filenames if the path exceeds Windows MAX_PATH (~260 chars)

### GM path (`dlMethod === 'gm'`)
- TM: uses `GM_download({ url, name, saveAs: false })` — supports subfolders via path in `name`
- Chrome fallback: creates a `Blob`, calls `URL.createObjectURL`, clicks a hidden `<a>` element
- `URL.revokeObjectURL()` is called immediately after `a.click()` (Chromium copies the blob ref at click-time, so this is safe and prevents memory leaks)
- Always capped at 2 concurrent workers regardless of speed preset

---

## Worker Pool & Speed Presets

Downloads run in a parallel worker pool. The number of concurrent workers is controlled by the speed preset:

| Preset | Workers | Delay between items | Risk |
|--------|---------|--------------------|----|
| Standard | 2 | 300 ms | Safe |
| Faster | 4 | 150 ms | Low |
| Very fast | 8 | 60 ms | Ban risk |

GM/anchor mode is always capped at 2 workers.

Workers are implemented as concurrent `async function worker()` coroutines sharing a shared `idx` counter (no atomics needed — JS is single-threaded). `Promise.all` launches them in a batch.

---

## Watermark Removal Pipeline

For `v2_profile` and `v2_liked` MP4 videos, SoraVault attempts to fetch a watermark-free version from a third-party proxy before falling back to the direct OpenAI URL.

### Proxy endpoint
```
GET https://soravdl.com/api/proxy/video/{videoId}
```

`videoId` must match `/^s_[A-Za-z0-9_-]+$/` (the `SHARED_VIDEO_ID_PATTERN`). The ID is extracted from the item's API fields (tries ~20 candidate fields in priority order via `getWatermarkProxyVideoId`).

### Failure handling
| Condition | Behaviour |
|-----------|-----------|
| HTTP 408 | **Immediately disable proxy for session** — 408 means Sora's upstream timed out, which is session-wide. No retry. |
| HTTP 429 | Respect `retry-after` header; apply exponential backoff. `globalRateLimitCooldownUntilMs` blocks all workers. |
| 3 consecutive failures | Disable proxy for session |
| Payload too small or non-video magic bytes | Throw — counted as failure |

### Constants
```js
WATERMARK_FETCH_MAX_ATTEMPTS       = 6
WATERMARK_FETCH_BASE_RETRY_MS      = 1200
WATERMARK_FETCH_MAX_RETRY_MS       = 20000
WATERMARK_PROXY_FAILURE_LIMIT      = 3
MIN_VIDEO_BYTES_FALLBACK_THRESHOLD = 256 * 1024  // 256 KB minimum
ESTIMATED_SIZE_FALLBACK_RATIO      = 0.2         // <20% of expected = bad payload
```

---

## Geo-Blocking Detection

The Sora V2 API returns HTTP 400 with a body containing `"unsupported_country"` or `"unsupported_region"` when accessed from a geo-blocked region.

Detection happens in two places:
1. `preflightV2Check()` — probes the V2 API once at startup (2.5s after panel creation) and every 10s while blocked or in init state
2. `fetchWithRetry()` — instant detection on any 400 response during scanning

When geo-blocked, `applyV2GeoBlock()` disables all V2 source checkboxes in the UI and shows a warning banner. When unblocked (e.g. after the user enables a VPN), the same function re-enables them.

---

## Filter System

Filters live in the module-level `filters` object:

```js
const filters = {
    keyword:       '',          // comma-separated; all terms must match prompt
    ratios:        new Set(),   // e.g. "16:9"
    dateFrom:      '',          // YYYY-MM-DD
    dateTo:        '',          // YYYY-MM-DD
    qualities:     new Set(),
    operations:    new Set(),
    nItems:        '',          // numeric; combined with nDirection
    nDirection:    'last',      // 'last' | 'first'
    authorExclude: '',          // exact username (case-insensitive), liked items only
    filterSources: new Set(),   // empty = all sources pass
};
```

`getFilteredItems()` applies filters in order: sources → keyword → author → ratios → qualities → operations → date range → N items.

`filterSources` is applied **first** so sub-filter chips (ratios, qualities, operations) reflect only values present in the selected categories. This is done via `getDistinctValuesByModeFiltered()` vs `getDistinctValuesByMode()`.

---

## UI State Machine

The panel's body is divided into five named sections. Only one is visible at a time:

```
init  →  scanning  →  ready  →  downloading  →  done
                   ↗               |
              (stop)          (stop)
```

| State | ID | Shown when |
|-------|----|-----------|
| `init` | `#sdl-s-init` | Startup / after rescan |
| `scanning` | `#sdl-s-scanning` | `startScan()` running |
| `ready` | `#sdl-s-ready` | Scan complete, ready to filter/download |
| `downloading` | `#sdl-s-downloading` | `startDownload()` running |
| `done` | `#sdl-s-done` | Download complete |

`setState(s)` shows the matching `#sdl-s-{s}` div and hides all others, updates `#sdl-status`, and calls `syncExpertSections()`.

---

## Output Files

Per-download run, the following files are written to the chosen folder:

| File | Always | Toggle |
|------|--------|--------|
| Media file (`.mp4` / `.png`) | — | Save media (on by default) |
| `.txt` sidecar | — | Save .txt sidecar (on by default) |
| `soravault_manifest_YYYY-MM-DD.json` | — | Save .json manifest (on by default) |
| `SoraVault_log_*.txt` | ✓ | Always saved if download method is FS/GM |

### Subfolder layout
```
<chosen folder>/
├── sora_v1_images/
├── sora_v1_videos/
├── sora_v1_liked/
├── sora_v2_profile/
├── sora_v2_drafts/
└── sora_v2_liked/
```

### Filename template
Default: `{date}_{prompt}_{genId}`

Available tokens: `{date}` `{prompt}` `{genId}` `{taskId}` `{width}` `{height}` `{ratio}` `{quality}` `{operation}` `{model}` `{seed}` `{duration}`

Long filenames are auto-truncated by `truncFilename()` / `saveBlobFS()` to avoid Windows MAX_PATH errors. Minimum filename length is 40 characters.

---

## Version Bumping

Version string lives in three places — all must be updated together:

1. `src/headers.txt` — `@name` and `@version` lines
2. `src/chrome/manifest.json` — `"version"` field
3. `src/core.js` — `const VERSION = '...'`

---

## Known Limitations & Gotchas

- **Windows MAX_PATH (260 chars):** FS API throws "file not found" when the full path exceeds 260 chars. SoraVault's auto-truncation handles this for typical OneDrive paths (~113 chars base).
- **Download errors are transient:** CORS + VPN interaction causes non-deterministic failures. Retry logic is in `downloadFileFS` (GM_xmlhttpRequest fallback).
- **`log()` is DOM-only:** Writes to `#sdl-log` `textContent` only — no in-memory buffer.
- **`check()` in `ingestV2Page`** has intentional `console.log` calls for debugging.
- **`encodings.source.url` is always null** in V2 API responses. Use `.path` instead.
- **Passive ingestion:** Items may be in `collected` before Scan is clicked if Sora made API calls while the user was browsing. Scan adds to these, it does not replace.
- **`recomputeSelection()`** is the central hub for all selection-dependent UI (counter pill, download button, filter badge, watermark estimate). Hook new counters here.
