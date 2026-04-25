# Changelog

All notable user-facing changes to SoraVault are documented here.
For technical implementation notes and handoff context, see `claude.md`.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

---

## [3.0.0] - 2026-04-25

### Final release

SoraVault 3.0 is the final release. Sora is shutting down, and this version is
meant to give you one last practical way to save as much of your Sora world as
possible: your own library, drafts, likes, cameos, characters, creator backups,
and now active discovery downloads.

The app has been rebuilt around clear backup modes instead of one crowded panel.
Choose the job you want to run, point SoraVault at a folder, scan or browse, and
let it save the files, prompts, and metadata locally. Nothing goes through a
SoraVault server.

Thank you to everyone who tested, reported endpoint changes, shared edge cases,
and used the tool while Sora was still here. It was nice to share this with you
all.

### Added

- **Discover & Download mode** - a new active discovery mode that scans the Sora
  Explore/Top feeds, discovers creators from the feed, and downloads matching
  content as it is found. It uses its own `discover_download/` folder and
  `discover_manifest.json` so discovery runs stay separate from Mirror Mode.
- **Version-aware discovery** - Discover supports the Sora version you are
  currently browsing on: Sora 1 or Sora 2. Pick the matching version before
  starting. If you browse Sora 1 while Discover is set to Sora 2, or the other
  way around, discovery cannot use the right feed/runtime state.
- **Sora 1 discovery feeds** - Sora 1 Discover can target Explore, Videos, or
  Images. Media type filters are enforced so a videos-only or images-only run
  does not save the wrong file type.
- **Sora 2 discovery feeds** - Sora 2 Discover supports Explore and includes Top
  feed probing. Top is Sora 2-only and is disabled for Sora 1.
- **Discover filters** - include keywords, exclude keywords, min/max likes,
  date range, aspect ratio filters, max creators, optional character crawling,
  polling, and prompt sidecars.
- **Discover running status** - the live screen now shows the current feed or
  creator being processed, feed pages, discovered creators, creator queue,
  media queue, workers, screened/matched/filtered counts, duplicates, known
  files, and recent per-creator summaries.
- **Discover creator crawling** - discovered Sora 2 creators are crawled through
  the existing Creator Backup path, including character posts and appearances
  when enabled. Sora 1 feed creators are handled through Sora 1 discovery paths
  and do not trigger Sora 2 creator requests.
- **Creator Backup mode** - public Sora 2 creators can be added by username or
  profile URL, validated live, remembered across reloads, and backed up into
  `sora_v2_creators/{creator}/`.
- **Creator character backup** - Creator Backup can also save a creator's
  character posts and cameo appearances into nested character folders.
- **My Characters backup** - Regular Backup can save your own characters,
  character posts, character appearances, and character drafts where Sora exposes
  them.
- **Cameos and cameo drafts** - Regular Backup now includes public cameo posts
  featuring you and private cameo drafts.
- **Mirror Mode** - browse Sora normally and let SoraVault passively capture
  items you scroll past. Mirror Mode saves into `mirror_browse/`, keeps an
  append-only `mirror_manifest.json`, and supports likes and keyword filters.
- **Open download folder action** - the final screen can open the browser's
  downloads folder for extension/default-download flows, or reopen the selected
  folder picker for File System Access downloads.
- **Coffee/support visuals** - the download and done screens now include the new
  local logo and coffee assets, packaged with the extension and with userscript
  fallbacks.

### Changed

- **Complete UI rehaul** - the first screen is now an exclusive mode picker:
  Regular Backup, Creator Backup, Mirror Mode, and Discover & Download. Modes no
  longer stack accidentally, and the main action changes to match the selected
  mode.
- **Ready/download screens redesigned** - output toggles, filter summary,
  active filter chips, progress card, category-aware activity text, ETA,
  failures, and worker count were rebuilt for clearer long-running backups.
- **Mirror running screen redesigned** - Mirror Mode now has a dedicated running
  status view that matches the newer download UI and keeps its filters editable
  while running.
- **Download speed presets expanded** - speed now uses Safe, Balanced, Fast, and
  Very Fast presets: 2, 4, 6, and 8 workers. Tampermonkey/GM mode remains capped
  at 2 active workers.
- **Worker pool retuning** - changing speed during an active download now
  immediately starts extra workers when increasing speed, and lets excess
  in-flight workers retire cleanly when decreasing speed.
- **JSON manifest export timing** - JSON manifests are written before media
  downloads begin when enabled, and manifest filenames include date and time so
  repeated or partial backups do not overwrite earlier manifests.
- **Characters enabled by default** - Regular Backup now includes Characters by
  default and no longer labels the flow as a fragile preview in the start panel.
- **Likes filtering improved** - likes are now read across more Sora 1 and Sora
  2 response shapes, and likes filters show clearly in the ready-panel summary.
- **Source rows clarified** - each Regular Backup source now has a shorter name
  and a plain-language description.
- **Scan and completion copy refreshed** - scan snippets, final actions, GitHub
  star link, and Buy Me A Coffee call-to-action were cleaned up for the final
  release.
- **Extension frame support** - the Chrome extension now runs in same-origin
  frames so Discover can warm Sora feed routes and use the current Sora runtime
  state without showing duplicate panels in subframes.

### Fixed

- **Character drafts fixed** - replaced guessed character draft probes with the
  confirmed endpoint:
  `/backend/project_y/profile/drafts/cameos/character/{characterId}?limit=50`.
- **Character appearances fixed** - character backup now fetches appearances
  through `/backend/project_y/profile_feed/{characterId}?limit=50&cut=appearances`.
- **Character ID handling hardened** - character lookup accepts multiple Sora
  response shapes, including `user_id`, `id`, `character_id`, and
  `profile.user_id`.
- **Cameo/character draft ingestion fixed** - the V2 ingestion path now handles
  draft wrappers where the actual video object is nested inside the response.
- **Mirror profile/search capture fixed** - Mirror Mode now captures Sora
  profile pages that load through `/backend/search`, including wrapped
  `generation` objects.
- **Mirror V1 download URLs fixed** - opportunistic Sora 1 captures preserve
  signed `encodings.source.path` URLs and use the correct file extension instead
  of assuming every captured item is an MP4.
- **Mirror stop flow fixed** - returning to the start panel while Mirror is
  running now shows a working `Stop Mirror Mode` action instead of a disabled
  running button.
- **Download stop flow fixed** - pressing Stop during downloads now waits for
  active workers to finish their current files, then shows a partial-save end
  screen instead of jumping back too early.
- **Discover Sora 1 feed auth fixed** - Sora 1 feed probes now use warmed
  same-origin frames and the live page fetch path so Sora's current feed token
  can be attached when available. Tokens are never printed to the panel log.
- **Discover duplicate self-ingest fixed** - Discover suppresses duplicate
  ingestion of its own direct feed requests while still allowing passive capture
  from normal Sora browsing.
- **Worker reliability fixes** - active worker counts, speed changes,
  queue-draining, and stop behavior were cleaned up across regular downloads,
  Mirror Mode, and Discover & Download.

### Notes

- Discover & Download depends on live Sora feed/runtime state. It only supports
  the Sora version you are currently browsing on, Sora 1 or Sora 2.
- Top feed discovery is Sora 2-only.
- Watermark removal is still optional, disabled by default, and powered by the
  third-party `soravdl.com` proxy. Mirror Mode and Discover & Download use
  direct downloads.
- SoraVault will not work after Sora's APIs and media URLs are gone. Run your
  backups while the service is still available.

---

## [2.7.1] - 2026-04-24

### Fixed

- Removed "Coming Soon" section. Hotfix

### Previously added in 2.7.0

- **New first-screen mode picker** - rebuilt the startup UI as an exclusive
  accordion with Regular Backup, Creator Backup, Mirror Mode, and a locked
  Discover & Download placeholder.

- **Likes range filter** - page 2 now has minimum and maximum likes filters for
  Regular Backup and Creator Backup results. When either bound is set, items
  without a known like count are excluded.

- **Creators (beta)** — a new tile below Mirror. Type Sora creator usernames
  (comma-separated or Enter to add); each becomes a chip that validates live
  against the Sora API, turning green with post/character counts on success or
  red if the name isn't found. On Scan All, every valid creator's full post
  history is fetched automatically and saved to `sora_v2_creators/{name}/`.
  - **Remember creators across reloads** — toggle "Remember across reloads"
    to persist your validated creator list in localStorage, so it survives
    page reloads and tab switches. Re-validates in the background on restore.
  - **Include characters** — with the checkbox on (default), each creator's
    characters are also discovered and their posts + cameo appearances pulled
    automatically into `sora_v2_creators/{name}/characters/{char}/`.
  - Chips support × removal, `@` prefix stripping, and URL paste
    (`sora.chatgpt.com/profile/…` → extracts the username).

- **My Characters — preview** (`v2_my_characters`) — new scan source (off by
  default; tick the checkbox to enable). Discovers all characters you own,
  then fetches each character's published posts and cameo appearances. Also
  probes three likely draft endpoints — if your character has drafts and
  SoraVault misses them, please use the "report" link next to the checkbox.
  Files land in `sora_v2_characters/{character_name}/`.

---

## [2.7.0] - 2026-04-23

### Added

- **New first-screen mode picker** - rebuilt the startup UI as an exclusive
  accordion with Regular Backup, Creator Backup, Mirror Mode, and a locked
  Discover & Download placeholder.
- **Creator Backup as a standalone mode** - creator scans no longer require any
  Regular Backup source to be selected. Add valid creators, choose Creator
  Backup, and start the scan directly.
- **Mirror Mode from the start screen** - Mirror settings now live in the
  accordion. Start Scan launches Mirror Mode and shows a dedicated running
  status screen with saved, captured, queued, failed, folder, and active filter
  details.
- **Likes range filter** - page 2 now has minimum and maximum likes filters for
  Regular Backup and Creator Backup results. When either bound is set, items
  without a known like count are excluded.
- **Developer handoff docs** - added `sprint/codes-sprint-2.7.0.md` and
  `claude.md` to make the 2.7.0 logic changes and current project state easier
  to pick up in future sessions.

### Changed

- **Remember creators defaults on** - Creator Backup now persists validated
  creator chips across reloads by default unless the user turns the option off.
- **Header advanced control** - replaced the settings gear with a Log &
  advanced control that opens the filename template and log drawer directly.
- **Start Scan logic** - the primary action now branches by selected mode:
  Regular Backup scans checked sources, Creator Backup scans valid creators, and
  Mirror Mode starts passive background capture.
- **Sora 2 geo handling** - Creator Backup is disabled when Sora 2 is
  geo-blocked, while Regular Backup can still use Sora 1 sources and Mirror Mode
  remains available for browsing-based capture.

### Fixed

- Creator Backup no longer gets stuck behind the previous Scan button rule that
  required at least one regular backup checkbox to be selected.

---

## [2.7.0-preview] — 2026-04-22

> **Preview release.** Characters backup (v2_my_characters) has not been
> fully tested end-to-end — the owner's one character has no published posts
> or drafts. If your characters have content and something is missed, please
> [open an issue](https://github.com/charyou/SoraVault/issues/new?labels=characters&title=My+Characters+scan+feedback).

### Added

- **Creators (beta)** — a new tile below Mirror. Type Sora creator usernames
  (comma-separated or Enter to add); each becomes a chip that validates live
  against the Sora API, turning green with post/character counts on success or
  red if the name isn't found. On Scan All, every valid creator's full post
  history is fetched automatically and saved to `sora_v2_creators/{name}/`.
  - **Remember creators across reloads** — toggle "Remember across reloads"
    to persist your validated creator list in localStorage, so it survives
    page reloads and tab switches. Re-validates in the background on restore.
  - **Include characters** — with the checkbox on (default), each creator's
    characters are also discovered and their posts + cameo appearances pulled
    automatically into `sora_v2_creators/{name}/characters/{char}/`.
  - Chips support × removal, `@` prefix stripping, and URL paste
    (`sora.chatgpt.com/profile/…` → extracts the username).

- **My Characters — preview** (`v2_my_characters`) — new scan source (off by
  default; tick the checkbox to enable). Discovers all characters you own,
  then fetches each character's published posts and cameo appearances. Also
  probes three likely draft endpoints — if your character has drafts and
  SoraVault misses them, please use the "report" link next to the checkbox.
  Files land in `sora_v2_characters/{character_name}/`.

### Changed

- **Scan sources expanded from 7 to 8** — `v2_my_characters` added. Creators
  scan (`v2_creator`) is activated via the Creators tile, not the source
  checkbox list.
- `fetchAllV2` now accepts an optional `contextTag` used to stamp
  `creatorUsername` on ingested entries — downstream folder routing uses this
  to nest creator content without a separate ingest path.
- The main download pipeline's subfolder resolver now supports nested paths
  (e.g. `sora_v2_creators/alice/characters/sparky/`). Was single-segment only.

---

## [2.6.0] — 2026-04-20

### Added

- **Mirror mode (beta)** — a brand-new way to build your library: just browse
  Sora normally, and SoraVault quietly captures everything you scroll past and
  downloads it in the background with 4 workers. No scanning, no waiting — open
  Explore, a creator's profile, or your own drafts, and the files land on disk
  as you go. Files are organised by where you found them:
  `mirror_browse/sora2_explore/`, `mirror_browse/sora2_profile/charju/`,
  `mirror_browse/sora1_library/`, etc. Single-post pages route into the
  author's folder when known.
- **Mirror filters** — set a minimum like count, an include-keywords list, or
  an exclude-keywords list to capture only the content you actually want.
  Optional `.txt` prompt sidecar is enabled by default and can be toggled off.
- **Append-only manifest** (`mirror_manifest.json`) — Mirror mode keeps a log
  of everything it has already saved, so turning it on again never re-downloads
  what's already on disk.
- **Minimised-panel status** — when you collapse the SoraVault panel and
  Mirror mode is running, a small pulsing 📡 stays visible in the header so
  you never have to wonder whether captures are still happening.
- **UI refactor** — the main panel is now split into clearly-labelled
  **Backup** and **Mirror (beta)** sections so the two features don't
  compete for attention.

### Known limitations

- Mirror mode stops if the Sora tab fully reloads (state lives in the page).
  A reload-resume flow is planned for a follow-up release.
- Watermark removal is intentionally skipped in Mirror mode. Use the regular
  Backup flow with watermark removal enabled if you need clean MP4s.

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
