# <sub><img src="assets/soravault-logo-square.png" height="35"></sub> SoraVault 2.0 – Bulk Export & Backup Tool for OpenAI Sora

**Your Sora library is about to disappear. Vault it.**
 
Sora is shutting down. OpenAI hasn't released an export tool yet.
SoraVault is a free, API-driven tool to bulk export your OpenAI Sora library. Easily download Sora videos, backup your generated images, save liked content, and extract all original text prompts in minutes, not hours.

> "We'll share more soon, including timelines for the app and API
> and details on preserving your work." - OpenAI, March 24, 2026

**Don't wait for "soon." Your creations deserve better.**

---

## ⚡ What makes SoraVault different

| Feature | SoraVault 2.0 | OpenAI Official Export | Manual Download | Other Tools |
|---------|-----------|------------------------|-----------------|-------------|
| FREE | ✅ | ✅ | ✅ | ❌ (only limited) |
| Videos (Sora v2 — Profile) | ✅ | ✅ (mixed with all ChatGPT data) | ❌ (one by one) | ❌ |
| Videos (Sora v2 — Draft) | ✅ | ❌ | ❌ (one by one) | ❌ |
| Images (Sora v1) | ✅ | ✅ (mixed with all ChatGPT data) | ❌ (one by one) | Partial |
| **NEW: "Liked" Content (v1 & v2)** | ✅ | ❌ | ❌ | ❌ |
| Original quality (full-res renders) | ✅ | ✅ | ✅ | ❌ (compressed) |
| Prompt saved as .txt sidecar | ✅ | ❌ | ❌ | ❌ |
| **NEW: Raw JSON metadata export** | ✅ | ❌ | ❌ | ❌ |
| Bulk download (entire library) | ✅ | ✅ (one ZIP, no filters) | ❌ | Partial |
| Smart filters (author, ratio, quality, date) | ✅ | ❌ | ❌ | ❌ |
| Instant — no waiting period | ✅ | ❌ (days of waiting) | ✅ | ❌ |
| No link expiry | ✅ | ❌ (link expires in 24h) | ✅ | — |
| API-Driven (No page scrolling required) | ✅ | — | — | ❌ |
| Parallel downloads (5x speed) | ✅ | ❌ | ❌ | ❌ |
| Granular auto-folder sorting | ✅ | ❌ | ❌ | ❌ |

---

## 🎬 See it in action

[![SoraVault - Bulk exporting OpenAI Sora videos](assets/videothumbnail.png)](https://youtu.be/IK6nezdehF4)

*1 minute. No fluff. Just the tool doing its thing.*

🎵 *Soundtrack: PULLING by Bastian RENN — [Upcoming on Spotify]*

---

## 🚀 Quick Start

### Option A: Tampermonkey Script (Free)

1. Install [Tampermonkey](https://tampermonkey.net) for your browser. 
> **What is Tampermonkey and is it safe?** > Tampermonkey is a highly trusted browser extension with over 10 million users on the official Chrome and Firefox web stores. It acts as a safe manager that lets you run custom, open-source code on specific websites. It is completely safe—you can read every line of SoraVault's code before installing it, and the script is strictly sandboxed to only run on `sora.chatgpt.com`.
> In your extension tab: Be sure to enable "developer mode", go to details of Tampermonkey and enable "allow user scripts"
2. Open the [SoraVault v2.0 Script](tampermonkey/SoraVault_v2_0.user.js) file here on GitHub.
3. Click the **"Raw"** button (top right of the code window). Tampermonkey will auto-detect the script and prompt you to install it. *(Alternatively, download the file and drag & drop it into your browser).* 4. Go to [sora.chatgpt.com](https://sora.chatgpt.com).
5. Use the SoraVault panel on the page: **Scan** → **Filter** (optional) → **Download**.


### Option B: Chrome / Edge Extension (for installation in dev mode)

[SoraVault 2 - Chrome Extension - Pre-Release](SoraVault 2 - Chrome Extension - Pre-Release (Feature Identical to Tampermonkey).zip)

1. Unzip the file into any folder of choice. 
2. In Chrome/Edge, go to your extension tab, activate developer mode (it's a small toggle switch, usually located in the top right corner).
3. Click the "Load unpacked" button that has now appeared at the top left of the page.
4. Browse to and select the folder where you unzipped the extension files in Step 1.
5. The SoraVault 2 extension should now appear in your list of installed extensions and is ready to use! Never delete that folder while in use.
6. For any future updates, just export the new zip to the same folder, go back to your extension tab, scroll down to SoraVault and press "Reload script"
   
<img src="assets/sora-app.png" height="565">

---

## 🔍 Features in Detail

### Full Library Support
- **Sora v2 Videos** — Profile videos AND Draft videos, full resolution.
- **Sora v1 Images** — Your complete image library from classic Sora.
- **Liked Content** — Backup your favorite videos and images from other creators (v1 and v2).
- **Export Formats** — Toggle between saving media, prompt `.txt` sidecars, and raw `.json` payload metadata.

### Intelligent Data Capture
- **API-Driven Architecture** — V2.0 operates entirely via API interception and background calls. No more clunky auto-scrolling or relying on page elements.
- **Independent Pipelines** — Manage scanning sources independently (v1 library, v1 liked, v2 profile, v2 drafts, v2 liked).
- **Skip Errors** — Automatically detects and skips items flagged as `sora_error` or `sora_content_violation`.
- **Hardcoded Auth (Optional)** — Advanced users can hardcode their `BEARER_TOKEN` in the config to bypass manual interception.

### Granular Filter Engine
- 🔎 Live full-text search across all prompts
- 🚫 **Author Exclusion** — Easily filter out specific creators when backing up your "Liked" feed. For example, yourself.
- 📐 Aspect ratio chips (16:9, 9:16, 1:1, etc.)
- 🖼️ Quality filter (1080p, original renders)
- 🎨 Operation filter (generate / extend / edit)
- 📅 Date range picker
- 🔢 Index range (e.g., items 10–50 only)

### Archive-Grade Downloads
- **Original source files** from OpenAI servers (not preview thumbnails)
- **Granular Auto-Sorting** — Content is automatically sorted into 6 smart subfolders: `sora_v1_images`, `sora_v1_videos`, `sora_v1_liked`, `sora_v2_profile`, `sora_v2_drafts`, and `sora_v2_liked`.
- **Smart naming** — `{date}_{prompt}_{genId}` with auto-truncation
- **Custom output folder** via File System Access API (one permission, zero popups)

### Performance
- Up to 5 parallel downloads (configurable)
- Built-in rate-limit protection
- Visual progress bar + detailed log
- Safe abort at any time

---

## 🛡️ Privacy & Security

- **100% local** — no data leaves your browser
- **No accounts** — no login, no tracking, no analytics
- **Source available** — read every line of code yourself

---

## 💬 Frequently Asked Questions (FAQ)

**Q: How do I backup my unpublished Sora drafts?**
A: You can backup your Sora drafts using SoraVault. While OpenAI’s official data export currently only includes published profile videos, SoraVault connects directly to your v2 drafts pipeline via API and downloads them in full resolution, along with their text prompts.

**Q: Can't I just use OpenAI's official ChatGPT data export?**
A: Yes, but it has severe limitations for video creators. The official export (Settings → Data Controls → Export) bundles your Sora content with all ChatGPT text conversations, takes days to process, the link expires in 24 hours, it strips out prompt metadata, and **crucially, it does not export your v2 Drafts**. SoraVault solves this by running instantly and sorting your media into dedicated folders.

**Q: How to export Sora videos in their original, uncompressed resolution?**
A: Simply run SoraVault and leave the "Quality" filter on its default setting. The tool automatically fetches the raw, uncompressed `.mp4` files directly from OpenAI's CDN servers, bypassing the compressed preview thumbnails shown on the web interface.

**Q: Is there a way to download my "Liked" videos from other creators?**
A: Yes! SoraVault 2.0 introduced a dedicated "Liked Content" scanner. It will automatically comb through both your v1 Favorites and v2 Liked feeds, allowing you to save videos generated by other creators to your local drive before the platform shuts down.

**Q: Is SoraVault a web scraper or an API downloader?**
A: SoraVault is a fully API-driven downloader. Version 2.0 replaced legacy screen-scraping with direct API interception. This means it doesn't need to manually scroll your page; it communicates directly with OpenAI's backend, making it up to 5x faster and significantly more reliable.

**Q: Is it safe to use? Is this legal?**
A: Yes and yes. You are only downloading your own generated content and data you are already authorized to access while logged into your own account. SoraVault is 100% open-source, runs entirely locally in your browser via Tampermonkey, and sends zero data to third parties.

**Q: Will this tool still work after OpenAI shuts down Sora?**
A: No. SoraVault relies on reading data directly from Sora's live servers. Once the servers are taken offline, this tool will stop working. **You must run your backup before the official shutdown date.**

**Q: I have 500+ files. How long does it take?**
A: Because v2.0 is fully API-driven, it takes only under 2 minutes to scan your library. With default settings (5 parallel downloads), expect ~10 minutes for the download phase. Depends on connection speed.

**Q: Why Tampermonkey and not a browser extension?**
A: Tampermonkey is actually easier to install and use than sideloading a CRX extension (which requires Developer Mode and shows browser warnings). One click to install, auto-updates, zero nag screens.

**Q: What about the standalone app?**
A: A native desktop app (Mac, Windows, Linux) is potentially releasing next week. No browser or extensions needed. Same features, even simpler UX.

**Q: Is this a Sora scraper or Sora downloader?**
A: SoraVault acts as a complete Sora video downloader and library backup tool, capturing everything via API rather than traditional screen scraping.

---

## ☕ Support This Project

If SoraVault saved your library, consider buying me a coffee:

**[☕ buymeacoffee.com/soravault →](https://buymeacoffee.com/soravault)**

This is a passion project born from the "oh shit, my stuff is about to vanish" moment.
Every coffee helps and is deeply appreciated.

---

## 📄 License

SoraVault – Custom License
Copyright (c) 2026 Sebastian Haas (github.com/charyou)

Permission is granted to use this software for personal, non-commercial purposes.
Personal modifications are permitted for private use.

Contributions (pull requests) to the original repository are welcome and encouraged.

The following are NOT permitted without explicit written permission from the author:
- Redistribution of this software or modified versions, in any form
- Commercial use, resale, or monetization of this software or derivatives
- Publishing or distributing modified versions under a different name or identity

Any public reference to this software must include clear attribution to the original
author (Sebastian Haas) and a link to https://github.com/charyou/SoraVault.

This software is provided as-is, without warranty of any kind.

---

*Built with urgency and care by Sebastian —
 [X](https://x.com/charjou) 
