# SoraVault Project Brief

Last updated: 2026-04-25

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
- Power users who want to back up public creator libraries, passively capture
  what they browse, or actively discover feed content before shutdown.

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
- User-owned character posts, appearances, and drafts where Sora exposes them.

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
- Not used by Mirror Mode or Discover & Download.

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

### 7. Discover & Download

Discover & Download is an active discovery mode. It scans the selected Sora feed,
discovers creators from feed responses, optionally crawls supported creator
content, applies filters, and downloads matching media through the Browse & Fetch
pipeline.

Capabilities:

- Separate root folder: `discover_download/`.
- Separate manifest file: `discover_manifest.json`.
- Sora 1 feed choices: Explore, Videos, Images.
- Sora 2 feed choices: Explore and Top probing.
- Include keywords, exclude keywords, min/max likes, date range, aspect ratios,
  max creators, optional Sora 2 character crawling, polling, and prompt sidecars.
- Running status with feed pages, discovered creators, creator queue, media
  queue, workers, screened/matched/filtered counts, duplicates, known files, and
  recent per-creator summaries.

Critical limitation:

- Discover only supports the Sora version currently being browsed, Sora 1 or
  Sora 2. The user must choose the matching version in the Discover card before
  starting. If the selected version does not match the current Sora browsing
  runtime, discovery cannot use the correct feed state.

## Current UX Direction

The first screen is an exclusive mode picker:

- Regular Backup is active by default.
- Creator Backup, Mirror Mode, and Discover & Download cannot be combined with
  Regular Backup.
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
- `src/core.js` - implementation source of truth.
- `build.py` - no-dependency build script.
- `.github/workflows/release.yml` - release automation.
- `assets/new-features.gif` - feature preview.
- `assets/videothumbnail.png` - YouTube thumbnail.

## Implementation Contracts

- Do not split `src/core.js` casually; the build pipeline expects it.
- `SCAN_SOURCES`, `SOURCE_LABELS`, and `SUBFOLDERS` are shared contracts.
- Creator Backup items use `source: 'v2_creator'` and `creatorUsername`.
- Mirror Mode and Discover & Download share `browseFetch*` downloader state.
- Mirror Mode uses `mirror_browse/` and `mirror_manifest.json`.
- Discover & Download uses `discover_download/` and `discover_manifest.json`.
- Keep `genId` in default filenames; skip-existing depends on stable IDs.
- Preserve user edits in dirty worktrees. Do not revert unrelated changes.

## Current Release State

- Current release: `3.0.0`.
- Release tag: `v3.0.0`.
- 3.0.0 is the final release. It includes the complete UI rehaul, Creator
  Backup, Mirror Mode, Discover & Download, character drafts/downloads, cameo
  downloads, live worker retuning, Sora 1/Sora 2 discovery fixes, README refresh,
  and final changelog release notes.

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

## 2026-04-24 UI Redesign Session Notes

Current session changed the mid-flow and download surfaces after the first-panel redesign:

- Panel 2 / ready state now has modern output-option rows with per-toggle symbols, larger type, and a visible filter summary card. The filters themselves are still the same controls, but the live effect is now shown as "Will download X of Y" directly in the card.
- Download state now has the new coffee banner using `src/img/coffeemug_big.png` and `src/img/coffeemug_small.png`, a redesigned progress card, category-aware activity text, watermark-removal activity text, ETA, failure count, and active worker count.
- Download speed changed from 3 presets to 4 presets: Safe (2 workers), Balanced (4 workers), Fast (6 workers), Very Fast (8 workers). Tampermonkey/GM mode still caps active workers at 2.
- JSON manifest export now runs before media downloads start when enabled, and manifest filenames include date and time to avoid overwrites during repeated or partial backups.
- Logo and coffee assets now resolve from extension-local `img/*` first, with GitHub raw `src/img` fallback for userscript/Tampermonkey-style execution. Chrome manifest exposes `img/*`, and `build.py` copies `src/img` into `dist/chrome-extension/img`.
- Regular Backup now includes Characters by default. The old character preview/report-issues wording was removed from the first panel.
- The source grid in panel 1 now uses a two-line layout for each source: source name first, explanatory comment below. The old "no scrolling needed" copy was removed.
- Scan-in-progress now uses short, readable personal snippets about Sebastian/Munich/1,800+ Sora images/local-first backup instead of long emoji-heavy story text.
- Mirror-running state now has a live status hero and modernized stats rows so it matches the newer ready/download panel visual language.
- Done-screen GitHub star link is slightly larger and button-like, but remains secondary to the Buy Me A Coffee call-to-action.
- "Expert settings" was renamed to "Log & advanced" and visually softened after becoming too prominent.
- Follow-up changes in this same UI pass:
  - Likes filtering now uses a tolerant `readLikeCount()` helper across Sora 1 and Sora 2 shapes (`like_count`, `likeCount`, `likes_count`, `num_likes`, stats/metrics/counts containers, etc.). V1 library items now also store `likeCount` when the API exposes it.
  - The ready-panel filter summary now uses a conic radial indicator based on selected/total items. The selected count is only shown once in the text, avoiding the duplicated number from the previous pass.
  - Active filters are now summarized as mini chips under the filter header, so collapsed filters still show what is affecting the selection.
  - Ready actions changed to a two-button row: compact "Rescan" on the left with "scan resets" subtext, primary Download button on the right.
  - Watermark Removal row copy was made slightly larger for readability.

Important follow-up consideration:

- Manifest append/dedupe mode is not implemented yet. Current behavior avoids overwrites through timestamped filenames and saves JSON first, but it does not merge with an existing manifest item-by-item.
- Versioning note: the cumulative scope is large enough to justify a 2.8.0 bump if this ships as a public release, because it includes UI redesign, changed speed presets, JSON timing/filename behavior, asset packaging changes, and filter behavior fixes.

## 2026-04-24 Follow-up: Mirror Stop + End Screen

- Fixed Mirror Mode back-state bug: when Mirror Mode is running and the user returns to the start panel, the main scan button now becomes `Stop Mirror Mode` instead of a disabled `Mirror Mode is running` button. The same stop helper is used by the Mirror running view.
- Download `Stop` now stays in the download state while active workers finish their current file, then routes to the end screen with partial-save copy instead of jumping back to Panel 2.
- End screen now has an `Open download folder` action:
  - For File System Access folder-picker downloads, browser security does not allow directly opening the OS folder. The button tries to reopen the directory picker starting from the selected folder and otherwise shows the selected folder name.
  - For Chrome extension/default-download fallback flows, bridge/background support `SV_SHOW_DOWNLOADS_FOLDER` and call `chrome.downloads.showDefaultFolder()`.
- Added a small whitelist in `src/chrome/bridge.js` so page messages can only request the downloads-folder command, not arbitrary extension messages.

## 2026-04-24 Follow-up: Mirror `/backend/search` Profile Pages

- Fixed Mirror Mode capture for Sora profile URLs such as
  `/explore?user=nanabozo`, where Sora loads results through
  `/backend/search` instead of the older explore feed shape.
- Root cause: search responses return rows shaped like
  `{ ts, metadata, score, generation: { ... } }`. Mirror's opportunistic
  normalizer only understood flat generation objects or V2 post attachment
  objects, so it saw the wrapper object, found no `id`/`url`, returned `null`,
  and queued nothing.
- Change in `src/core.js`:
  - `normaliseOpportunisticItem()` now unwraps `raw.generation` before trying
    the existing V1/V2 normalization paths.
  - V1 opportunistic items now preserve `encodings.source.path` as
    `downloadUrl` when the API already provides a signed source URL.
  - `getDownloadUrl()` now returns `item.downloadUrl` before branching by mode,
    so opportunistic V1 captures can use the signed URL from `/backend/search`
    without requiring a second `/backend/generations/{genId}/download` call.
  - Mirror file extension selection now calls `getFileExt(item)` instead of
    assuming every V2-shaped capture is an MP4, which keeps image captures from
    profile/search responses from being mislabeled.
- Verified with `node --check src\core.js`. Generated `dist/` output was
  rebuilt locally via an equivalent Node one-liner because `python` was not on
  PATH in the shell.

## 2026-04-24 Follow-up: Mirror Running Filters

- Integrated Mirror Mode filters into the running Mirror view so `Min likes`,
  `Include keywords`, and `Exclude keywords` remain editable after Mirror Mode
  has started.
- The start-card Mirror controls and running-view Mirror controls now sync to
  the same `browseFetchFilters` state. Changes made while Mirror Mode is
  running apply immediately to future captures and update the live filter
  summary.
- The running-view controls use unique `sdl-mirror-*` IDs to avoid duplicate
  DOM IDs while preserving the existing `sdl-bf-*` setup controls.

## 2026-04-24 Follow-up: Discover & Download Work-In-Progress

Conversation summary:

- User requested a new first-panel mode named **Discover & Download**. The
  intent is similar to Mirror Mode's live download behavior, but active rather
  than passive: scan Explore/Top feeds, discover new creators, fetch each
  creator's posts and characters, and download matching content as it is found.
- Requested configurable filters:
  - Include keywords.
  - Exclude keywords.
  - Min likes / max likes.
  - Sora 1 or Sora 2.
  - Explore vs Top, where Top is Sora 2 only.
  - Quick-win filters using data already available.
- User later clarified UI behavior:
  - Discover should choose either Sora 1 or Sora 2, not both.
  - Explore/Top should become a button/toggle, not a dropdown.
  - Top should be disabled/greyed out for Sora 1.
  - Filters should not be duplicated awkwardly between the start view and
    running view. Prefer full filters before start; running view can keep only
    likes-range controls if needed.

Implementation progress in `src/core.js`:

- Added a real `discover` start mode next to `regular`, `creator`, and
  `mirror`.
- Reused the existing Browse & Fetch / Mirror downloader pipeline:
  - Separate root folder: `discover_download/`.
  - Separate append-only manifest: `discover_manifest.json`.
  - Uses the same queue, file writing, prompt sidecars, de-dupe, and worker
    control path as Mirror Mode.
- Added Discover-specific state:
  - `discoverRunning`, `discoverLoopPromise`, `discoverRunToken`,
    `discoverDrainPromise`.
  - `discoverSeenCreators`, `discoverCreatorQueue`, and `discoverStats`.
  - Run-token guard prevents old polling loops from mutating a new run after
    stop/restart.
- Added Discover filters to `browseFetchFilters`:
  - `version`, `feed`, `minLikes`, `maxLikes`, `include`, `exclude`,
    `dateFrom`, `dateTo`, `ratios`, `includeChars`, `maxCreators`,
    `keepPolling`, `saveTxt`.
- Added a first-panel Discover card with controls for version, feed, likes,
  max creators, include/exclude keywords, date range, aspect ratios, character
  inclusion, polling, prompt sidecars, and folder selection.
- Added a running-state Discover view by reusing the Mirror running screen:
  - Dynamic labels switch between Mirror and Discover.
  - Discover running summary shows saved count, creator discovery count, queue,
    failures, and active filters.
  - Running view was adjusted to show likes range for Discover and hide the
    Mirror include/exclude textareas.
- Added endpoint/probe logging for Discover, including status, response keys,
  and item-array counts.
- Built `dist/SoraVault.user.js` and `dist/chrome-extension/content.js` from
  `src/core.js` using the Node equivalent of `build.py`, because `python` was
  not available on PATH in this shell.
- Verification performed after implementation iterations:
  - `node --check src\core.js`
  - `node --check dist\chrome-extension\content.js`
  - `node --check dist\SoraVault.user.js`
  - `git diff --check`

Important endpoint discoveries and corrections:

- Initial guessed Sora 2 endpoints failed:
  - `/backend/project_y/explore?limit=20`
  - `/backend/project_y/feed?limit=20`
  - `/backend/project_y/discover?limit=20`
  - These produced HTTP 404/500.
- Attempting `/backend/search` directly for Discover produced HTTP 405. It is
  still useful for Mirror/profile-search passive capture, but not as the direct
  Discover feed fetch.
- User captured the concrete Sora 2 Explore feed endpoint:

```text
GET /backend/project_y/feed?limit=8&cut=nf2
```

- Sora 2 Explore response shape:

```js
{
  items: [
    {
      post: {
        id,
        posted_at,
        updated_at,
        like_count,
        view_count,
        text,
        attachments: [
          {
            id,
            generation_id,
            generation_type,
            url,
            downloadable_url,
            download_urls: { watermark, no_watermark, endcard_watermark },
            width,
            height,
            duration_s,
            task_id,
            encodings: {
              source: { path, size, duration_secs, ssim },
              source_wm: { path, size, duration_secs, ssim },
              thumbnail: { path },
              md: { path, size },
              ld: { path, size },
              gif: { path }
            }
          }
        ],
        permalink,
        discovery_phrase,
        srt_url,
        vtt_url
      },
      profile: {
        user_id,
        username,
        follower_count,
        post_count,
        likes_received_count,
        character_count,
        permalink,
        display_name
      },
      reposter_profile
    }
  ],
  cursor,
  debug_info
}
```

- User captured the concrete Sora 1 Explore feed endpoint:

```text
GET /backend/feed/home?limit=24&after=<encoded cursor>
```

- Sora 1 Explore response shape:

```js
{
  data: [
    {
      id,
      task_id,
      created_at,
      deleted_at,
      url,
      seed,
      can_download,
      download_status,
      is_favorite,
      is_liked,
      is_public,
      like_count,
      encodings: {
        source: { path, size, width, height, duration_secs, ssim, codec },
        md: { path, size, width, height, duration_secs, ssim, codec },
        ld: { path, size, width, height, duration_secs, ssim, codec },
        thumbnail: { path },
        link_thumbnail: { path },
        spritesheet: { path },
        source_wm,
        md_wm,
        ld_wm,
        endcard_wm
      },
      width,
      height,
      n_frames,
      prompt,
      title,
      actions,
      operation,
      model,
      user: { id, username },
      task_type,
      quality
    }
  ],
  last_id,
  has_more
}
```

- Current `src/core.js` was updated to use:
  - Sora 2 Explore: `/backend/project_y/feed?limit=8&cut=nf2` with `cursor`.
  - Sora 1 Explore: `/backend/feed/home?limit=24` with `after`.
  - Sora 2 Top currently has two unverified probe candidates:
    - `/backend/project_y/feed?limit=8&cut=top`
    - `/backend/project_y/feed?limit=8&cut=nf2&feed=top`

Historical WIP status before the follow-up fixes:

- Sora 2 Discover was close because its endpoint and response shape matched
  existing `ingestV2Page()` expectations.
- Sora 1 Discover initially needed parser and pagination work because the direct
  feed response is not the same shape as regular backup
  `/backend/v2/list_tasks`.
- The follow-up completed the Sora 1 feed parser path by sending feed rows
  through the opportunistic generation normalizer.

Completed in follow-up:

- Sora 1 Discover feed selection is now explicit:
  - Explore/default uses `/backend/feed/home?limit=24`.
  - Videos only uses `/backend/feed/videos?limit=24`.
  - Images only uses `/backend/feed/images?limit=24`.
  - The selected media type is enforced in Browse&Fetch filters so Sora 1
    videos-only and images-only runs do not save the wrong type.
- Sora 1 feed rows are parsed through the opportunistic generation normalizer,
  which already prefers `encodings.source.path`, then `downloadable_url`,
  `download_urls.watermark`, and finally the display `url`/download fallback.
- Sora 1 creator discovery is enabled for Discover & Download:
  - Feed `user` objects are queued as creators.
  - Creator libraries are fetched via `POST /backend/search` with
    `{ "user_id": "<id-or-username>", "query": "" }`.
  - Sora 1 creators use source `v1_discover_creator` and Sora 1 folder paths.
- The Discover card now uses Sora-version-specific controls:
  - Sora 1 shows Explore / Videos / Images segmented buttons.
  - Sora 2 shows an Explore default with a Top-only checkbox.
  - Sora 2-only character crawling controls are hidden for Sora 1.
- Discover running view now exposes live background activity:
  - Current feed/creator/character operation.
  - Creator queue, media queue, workers, feed pages, screened/matched/filtered
    counts, known/duplicate counts, and recent per-creator queued/filtered
    summaries.
  - Aggregates include average screened/queued media per completed creator.
- Sora 1 direct feed probes now preserve backend auth/runtime headers from all
  `/backend/` traffic, including the Sora sentinel header, not only
  `/backend/project_y/`. Feed probes also set a matching referrer for
  `/explore`, `/explore/images`, and `/explore/videos`.
- Follow-up correction: Sora 1 feed probes now use the live page `fetch` path
  for `/backend/feed/*` instead of raw `_fetch`, while suppressing duplicate
  self-ingest. This lets Sora's own frontend wrapper attach a fresh
  `openai-sentinel-token` per feed request when available. Learned sentinel
  presence is logged as "token hidden"; the token value is intentionally never
  written to the panel log.
- Second sentinel correction: Discover now warms the selected Sora 1 route in a
  hidden same-origin iframe (`/explore`, `/explore/images`, `/explore/videos`)
  and uses that frame's `fetch` for feed requests. Chrome content scripts now
  run in all same-origin frames, but subframes do not render a visible panel;
  they only capture and post feed header presence back to the top frame.

Remaining non-release ideas:

- Lock down the exact Sora 2 Top endpoint if Sora changes the current probe
  behavior.
- Further simplify Discover running filters if there is another UI pass.
- Add per-creator "Top N" support:
  - User specifically wants "top 10" per creator, potentially per character.
  - This likely requires fetching the creator's full library first, sorting by
    `likeCount`, then queueing only top N posts.
  - Need to decide whether top N applies to:
    - Creator posts only.
    - Each character separately.
    - Creator posts + character posts combined.
  - Also decide whether "top N" should be based only on posts that pass keyword,
    date, ratio, and likes filters.
- Add tests or local validation harness for parsers:
  - A small fixture-based JS test would prevent endpoint-shape regressions.
  - Include fixtures for Sora 2 `project_y/feed`, Sora 1 `feed/home`, and older
    `/backend/search` wrapper rows.
  - At minimum, expose pure helper functions for normalizing feed items and run
    them with `node --check` plus simple assertions.
- Reduce log noise:
  - Keep useful endpoint/status logging while Discover is beta.
  - Avoid logging every page as a large repetitive probe once the endpoint is
    confirmed working.
- Review manifest semantics:
  - Discover uses separate `discover_manifest.json`, but confirm switching
    between Sora 1/Sora 2 or Explore/Top in the same folder behaves as expected.
  - Confirm manifest entries include enough metadata to audit origin:
    `mode`, feed type, creator, author, captured path, like count, folder,
    filename.
- Review creator discovery boundaries:
  - Sora 2 feed items expose `profile`; Discover queues these creators and then
    fetches creator posts/characters through existing Creator Backup logic.
  - Sora 1 feed items expose `user`, but Sora 1 should not trigger Sora 2
    creator fetches. Keep creator discovery disabled for Sora 1 unless a
    reliable Sora 1 public creator endpoint is identified.
- Review performance/rate-limit behavior:
  - Direct feed polling + creator crawling + media downloads can create a lot
    of requests. Confirm default Balanced (4 workers) is acceptable.
  - Consider separate limits for feed pages, creator fetch workers, and media
    download workers.
- Confirm folder structure:
  - Current Discover root is `discover_download/`.
  - Desired likely structure:
    - `discover_download/sora2_explore/`
    - `discover_download/sora2_top/`
    - `discover_download/sora2_creators/<creator>/`
    - `discover_download/sora2_creators/<creator>/characters/<character>/`
    - `discover_download/sora1_explore/`
- [x] Update README/CHANGELOG after the feature is validated in-browser.

## 2026-04-25 Final 3.0 Release Notes

Release documentation update:

- `CHANGELOG.md` now contains the final `3.0.0` release section with a
  non-technical opening, full feature summary, Discover & Download notes,
  UI rehaul notes, and bug fixes.
- `README.md` now presents SoraVault as version 3.0 and the final release,
  with Discover & Download added beside Regular Backup, Creator Backup, and
  Mirror Mode.
- The public docs call out the most important Discover limitation: Discover
  supports only the Sora version currently being browsed, Sora 1 or Sora 2.
  Users must choose the matching version before starting discovery.
- `claude.md` has been updated so Discover & Download is no longer described as
  a placeholder.

Final release scope:

- Complete UI rehaul around exclusive modes.
- Regular Backup with Sora 1, Sora 2, drafts, likes, cameos, cameo drafts, and
  owned characters.
- Creator Backup with validated public Sora 2 creator chips, persistence, posts,
  character posts, and appearances.
- Mirror Mode with passive browse capture and running-view filters.
- Discover & Download with active feed discovery, creator discovery, filters,
  dedicated folder/manifest, and running status.
- Character draft and character appearance endpoint fixes.
- Mirror `/backend/search` profile capture fixes.
- Worker pool retuning and download stop behavior fixes.
- README/CHANGELOG final-release messaging for the Sora shutdown.

Final caveats to keep visible:

- SoraVault depends on live Sora APIs and media URLs. It will not work after
  those are unavailable.
- Watermark removal remains optional, disabled by default, and backed by the
  third-party `soravdl.com` proxy.
- Discover & Download uses direct downloads and does not use watermark removal.
