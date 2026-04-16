# Changelog

All notable user-facing changes to SoraVault are documented here.
For technical implementation notes, see `sprint-notes.md`.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

---

## [2.5.3] — 2026-04-17

### Fixed

- **Skip-existing now catches all prefixed IDs** — re-running a download against a
  folder of already-saved files would occasionally re-download a handful of items
  whose filenames had been auto-truncated. The ID matcher now captures the
  `gen_` / `task_` / `s_` prefix as part of the token, so truncated and untruncated
  filenames both match reliably. Reproduced against a 158-item re-download: all
  matching items are now correctly skipped.

---

## [2.5.2] — 2026-04-17

### Added

- **Skip existing files** — new toggle (on by default) in the export settings.
  Before downloading, SoraVault enumerates each target subfolder and skips items
  already present on disk. Videos must be ≥ 3 MB and images ≥ 1 MB to count as
  valid (so partial/broken files get re-downloaded). Skips are tracked separately
  and shown on the done screen as `Skipped N existing files — X videos, Y prompts,
  Z images · by source: …`. Works in File System Access mode only.
- **Pause button** — pause and resume an in-flight download without losing
  progress. Workers finish their current item, then wait at the gate until you
  resume. Stop still wins over pause. The progress bar dims to amber and the ETA
  shows `Paused` while held.

### Changed

- **Filename template default** — changed from `{date}_{prompt}_{genId}` to
  `{genId}_{date}_{prompt}` so the ID anchor is always present at the start of the
  filename, even after long-path truncation. User-customized templates are left
  untouched.

---

## [2.5.1] — 2026-04-16

### Fixed

- **Watermark removal off by default** — the toggle now ships unchecked. Users who
  want watermark-free downloads can enable it manually. This avoids confusion for
  users who saw slow or failed downloads without understanding why (soravdl.com is
  a third-party proxy — availability is not guaranteed).
- **UI label clarified** — the watermark removal sub-label now reads
  *"Via soravdl.com (3rd party). No support for drafts."* so it's immediately
  clear this relies on an external service.
- **Proxy failure faster** — max retry attempts reduced from 6 → 3, max retry delay
  from 20 s → 10 s. A dead proxy session now aborts sooner and falls back to direct
  download faster.
- **Download fetch timeout + retry** — direct video downloads now abort after 30 s
  instead of hanging indefinitely. One automatic retry follows before the item is
  marked as failed. Prevents workers from parking on stalled requests (e.g. under
  VPN or transient Azure connectivity issues).

---

## [2.5.0] — 2026-04-16

### Added

- **Watermark-free downloads** — Profile, Liked, and Cameo videos are now fetched
  through the soravdl.com proxy, removing the Sora watermark automatically. A live
  time estimate badge in the export section shows how much extra time watermark
  removal will add for your current selection. Toggle it off in export settings if
  you want faster downloads.
  - Auto-disables for the session after 3 consecutive proxy failures, or immediately
    on an upstream timeout (HTTP 408). Falls back to direct OpenAI download without
    interrupting the queue.
  - Rate-limit aware: respects `retry-after` headers with exponential backoff.
  - SoraVDL is a third-party proxy — availability may vary.

- **Cameos & Cameo Drafts** — Two new scan sources:
  - `v2_cameos` — public posts where you appear as a cameo.
  - `v2_cameo_drafts` — private draft posts mentioning you.
  Both are fully integrated into filters, auto-subfolders, and watermark removal.

- **Category filter** — New chip row at the top of the filter drawer. Select one or
  more sources (Profile, Liked, Cameos, Drafts…) to narrow your selection before
  downloading. Sub-filters (aspect ratio, quality, date, etc.) automatically reflect
  only what's available in the selected categories.

- **Favorites filter** — New filter in the filter drawer to show only items you have
  marked as favorites within your own v1 library. Lets you export just your starred
  content without downloading your entire library.

- **Live activity status line** — A single line below the progress bar shows what
  each download worker is doing in real time: direct download, watermark removal
  attempt, rate-limit wait, or fallback. Multiple workers in the same state are
  grouped as `×N`.

### Changed

- Scan sources expanded from 5 to 7 (added cameos and cameo drafts).
- Auto-sort subfolders expanded to 8 (added `sora_v2_cameos`, `sora_v2_cameo_drafts`).
- Speed presets clarified: Standard (2 workers), Faster (4), Very fast (8).
  GM/anchor mode always capped at 2.

---

## [2.0.1] — 2026-04-10

### Fixed

- **Download quality** — downloader now consistently prioritizes the best available
  source quality, with a more robust fallback chain.
- **Auto-truncate path** — file paths exceeding OS limits are now automatically
  truncated so downloads don't silently fail on long prompts or deep folder paths.

---

## [2.0.0] — 2026-03

### Added

- Full API-driven architecture — no more page scrolling.
- V2 scan sources: profile feed, drafts, liked feed.
- Granular filter engine (author exclusion, aspect ratio, quality, operation,
  date range, index range).
- File System Access API folder picker — one permission, zero popups per file.
- Parallel worker pool (configurable speed presets).
- `.txt` sidecar and `.json` metadata export toggles.
- Geo-block detection for V2 API (`unsupported_country` / `unsupported_region`).

---

## [1.0.0] — 2026-02

Initial release. Page-scroll-based scraper for Sora v1 library and liked content.
