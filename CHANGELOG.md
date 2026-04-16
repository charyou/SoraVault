# Changelog

All notable user-facing changes to SoraVault are documented here.
For technical implementation notes, see `sprint-notes.md`.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

---

## [2.5.3] — 2026-04-17

### Added

- **Skip existing files** — turn your download into a true resume. SoraVault now
  checks each target folder before starting and skips anything already saved, so
  you can safely re-run on the same folder to fill in only what's missing. Partial
  or broken files (videos under 3 MB, images under 1 MB) are re-downloaded
  automatically. The done screen shows a clear summary: *"Skipped 3,247 existing
  files — 1,892 videos, 1,340 prompts · by source: Liked 1,203 · Drafts 1,224."*
  Toggle it off in export settings if you want to force-redownload everything.
  *(File System Access mode only — i.e. when you've chosen a download folder.)*

- **Pause button** — you can now pause an in-flight download and resume it later
  without losing progress. Workers finish whatever item they're on and wait at
  the gate until you press Resume. The progress bar dims to amber and the ETA
  shows *Paused* so you always know the state. Stop still wins over Pause if you
  want to abort entirely.

### Changed

- **Smarter default filenames** — new downloads are now saved as
  `{genId}_{date}_{prompt}` instead of `{date}_{prompt}_{genId}`. This puts the
  unique content ID at the start of the filename, which makes Skip-existing
  reliable even when long prompts cause filenames to be truncated. Your
  customized filename templates are left untouched.

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
