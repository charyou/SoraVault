# SoraVault — Chrome Extension

Bulk backup your Sora content (images, videos, drafts, liked) directly to your hard drive. API-driven, no scrolling needed.

## Install (Developer Mode)

1. Unzip this folder
2. Open **chrome://extensions**
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `SoraVault-Extension` folder
5. Navigate to [sora.com](https://sora.com) — the panel appears automatically

## Usage

1. Open any Sora page (the URL just needs to match `sora.com/*`)
2. Wait for the auth dot to turn **green** (captured from Sora's own requests)
3. Select your sources (Library, Likes, Videos, Drafts, Liked)
4. Click **Scan All** — runs entirely via the API, no scrolling required
5. Once the scan completes, use **Filters** to narrow your selection
6. Click **Download All** → choose a folder → files save with subfolders per source

## File Layout

```
your-chosen-folder/
├── sora_v1_images/      ← V1 images (PNG)
├── sora_v1_videos/      ← V1 videos (MP4)
├── sora_v1_liked/       ← V1 liked content
├── sora_v2_profile/     ← V2 published posts (MP4)
├── sora_v2_drafts/      ← V2 drafts (MP4)
└── sora_v2_liked/       ← V2 liked videos (MP4)
```

Each file optionally accompanied by a `.txt` sidecar with the full prompt and metadata.

## Notes vs. Tampermonkey version

- **File System Access API** (Chrome 86+) is used for folder-picker downloads — same as TM version
- **GM_download** has been replaced with anchor/blob fallback (used only if File System API is unavailable)
- The extension logo is bundled inside the extension — no external asset request needed
- Auth headers are captured from Sora's own `fetch`/XHR calls by running in `MAIN` world

## Architecture

| File | World | Purpose |
|---|---|---|
| `bridge.js` | ISOLATED | Injects `<meta>` with extension base URL |
| `content.js` | MAIN | Full SoraVault logic; intercepts `window.fetch` / XHR |
| `background.js` | Service Worker | `chrome.downloads` relay (fallback) |

## License

© 2026 Sebastian Haas — Personal use only; no redistribution or resale.  
See [LICENSE](https://github.com/charyou/SoraVault/blob/main/LICENSE)
