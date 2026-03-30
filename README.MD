# <sub><img src="soravault-logo-square.png" height="35"></sub>  SoraVault

**Your Sora library is about to disappear. Vault it.**

Sora is shutting down. OpenAI hasn't released an export tool yet.
SoraVault saves your entire library - videos, images, and prompts
in original quality - in minutes, not hours.

> "We'll share more soon, including timelines for the app and API
> and details on preserving your work." - OpenAI, March 24, 2026

**Don't wait for "soon." Your creations deserve better.**

---

## ⚡ What makes SoraVault different

| Feature | SoraVault | OpenAI Official Export | Manual Download | Other Tools |
|---------|-----------|------------------------|-----------------|-------------|
| FREE | ✅ | ✅ | ✅ | ❌ (only limited) |
| Videos (Sora v2 — Profile & Draft) | ✅ | ✅ (mixed with all ChatGPT data) | ❌ (one by one) | ❌ |
| Images (Sora v1) | ✅ | ✅ (mixed with all ChatGPT data) | ❌ (one by one) | Partial |
| Original quality (full-res renders) | ✅ | ✅ | ✅ | ❌ (compressed) |
| Prompt saved as .txt sidecar | ✅ | ❌ | ❌ | ❌ |
| Bulk download (entire library) | ✅ | ✅ (one ZIP, no filters) | ❌ | Partial |
| Smart filters (ratio, quality, date, keyword) | ✅ | ❌ | ❌ | ❌ |
| Instant — no waiting period | ✅ | ❌ (days of waiting) | ✅ | ❌ |
| No link expiry | ✅ | ❌ (link expires in 24h) | ✅ | — |
| API interception (not scraping) | ✅ | — | — | ❌ |
| Parallel downloads (5x speed) | ✅ | ❌ | ❌ | ❌ |
| No per-file save dialog | ✅ | ✅ | ❌ | ❌ |
| Rate-limit protection | ✅ | — | — | ❌ |

---

## 🎬 See it in action

[![SoraVault Demo](thumbnail.png)](https://www.youtube.com/watch?v=vwLxNlZiFc8)
*1 minute. No fluff. Just the tool doing its thing.*

🎵 *Soundtrack: NENI by Bastian RENN — [Spotify Link]*

---

## 🚀 Quick Start

### Option A: Tampermonkey Script (Free)

1. Install [Tampermonkey](https://tampermonkey.net) for your browser
2. Click [Install SoraVault Script](raw-link-to-script.user.js)
3. Go to [sora.chatgpt.com](https://sora.chatgpt.com)
4. Click the SoraVault panel → Scan → Filter → Download

### Option B: Standalone Desktop App (Mac, Windows, Linux)

No browser needed. No extensions. Coming next week.

---

## 🔍 Features in Detail

### Full Library Support
- **Sora v2 Videos** — Profile videos AND Draft videos, full resolution
- **Sora v1 Images** — your complete image library from classic Sora
- **Prompts as .txt sidecars** — every file gets its matching prompt

### Intelligent Data Capture
- **API Interception** — reads raw JSON responses before the page processes them
- **Deep Library Scan** — auto-scrolls through lazy-loaded content
- **Smart Patience System** — stops automatically when no new content loads
- **Duplicate Prevention** — session-aware deduplication

### Granular Filter Engine
- 🔎 Live full-text search across all prompts
- 📐 Aspect ratio chips (16:9, 9:16, 1:1, etc.)
- 🖼️ Quality filter (1080p, original renders)
- 🎨 Operation filter (generate / extend / edit)
- 📅 Date range picker
- 🔢 Index range (e.g., items 10–50 only)
- 📊 Real-time counter: "Collected 120 — Filtered 45"

### Archive-Grade Downloads
- **Original source files** from OpenAI servers (not preview thumbnails)
- **Prompt sidecar** — every file gets a matching .txt with its full prompt
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

## 💬 FAQ

**Q: Can't I just use OpenAI's official export?**
A: Yes, but there are real limitations.
The official export (Settings → Data Controls → Export) sends a ZIP to your
email — but it takes days to arrive, the download link expires after 24 hours,
it bundles your Sora content together with all your other ChatGPT data in one
unorganized package, and it saves no prompt metadata.
SoraVault runs instantly, saves every prompt as a .txt sidecar, and lets you
filter exactly what you want before downloading.

**Q: Is this legal?**
A: You're downloading your own content from your own account.
This tool only accesses data you're already authorized to see.

**Q: Does it save videos AND images?**
A: Yes. Sora v2 videos (both Profile and Draft) and all Sora v1 images.
Each file gets its prompt saved as a matching .txt sidecar.

**Q: Will this work after Sora shuts down?**
A: No. This tool reads from Sora's live servers.
That's why you should run it NOW.

**Q: I have 500+ files. How long does it take?**
A: With default settings (5 parallel downloads), expect ~2-3 minutes
for a full library scan + download. Depends on connection speed.

**Q: Why Tampermonkey and not a browser extension?**
A: Tampermonkey is actually easier to install and use than sideloading
a CRX extension (which requires Developer Mode and shows browser
warnings). One click to install, auto-updates, zero nag screens.

**Q: What about the standalone app?**
A: A native desktop app (Mac, Windows, Linux) is releasing next week.
No browser or extensions needed. Same features, even simpler UX.

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
[LinkedIn](https://www.linkedin.com/in/-sebastian-haas/) · [X](https://x.com/charjou) · [Instagram](https://www.instagram.com/charju_/)*