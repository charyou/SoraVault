# Sora API – Comprehensive Reverse Engineering Documentation

> **Status:** Living document · Foundation for SoraVault Desktop V2  
> **Sources:** HAR analysis, field inspector logs, SoraVault.js v1.0.1 runtime observations, SoraVault Desktop v1 codebase, SoraProbe v1.0 automated test results (2026-03-31), **Manual HAR capture batch 2 (2026-03-31): Cast-In, Likes, Remixes**  
> **Scope:** `sora.chatgpt.com` — Sora v1 (image library) + Sora v2 (video platform)  
> **Last updated:** 2026-03-31 — **v4 (HAR-batch-2-validated)**  
> **Classification:** Unofficial reverse engineering — no warranty, subject to change without notice

---

## Table of Contents

1. [Platform Architecture Overview](#1-platform-architecture-overview)
2. [Authentication & Token Flow](#2-authentication--token-flow)
3. [Core Request Headers](#3-core-request-headers)
4. [Content Storage Backend (Azure)](#4-content-storage-backend-azure)
5. [Sora v1 API — Image Library](#5-sora-v1-api--image-library)
6. [Sora v2 API — Video Platform](#6-sora-v2-api--video-platform)
7. [Data Models — Full Field Inventory](#7-data-models--full-field-inventory)
8. [Pagination Systems](#8-pagination-systems)
9. [URL Construction & Download Flows](#9-url-construction--download-flows)
10. [Remixes & Remix Chain](#10-remixes--remix-chain)
11. [Cast-In (Cameo)](#11-cast-in-cameo)
12. [Likes & Social Interactions](#12-likes--social-interactions)
13. [Generation Pipeline](#13-generation-pipeline)
14. [Sentinel Authentication for Write Actions](#14-sentinel-authentication-for-write-actions)
15. [SoraVault.js — Implementation Reference](#15-soravaultjs--implementation-reference)
16. [SoraVault Desktop V1 — Implementation Reference](#16-soravault-desktop-v1--implementation-reference)
17. [SoraVault Desktop V2 — Requirements & Gap Analysis](#17-soravault-desktop-v2--requirements--gap-analysis)
18. [Known Unknowns & Test Plan](#18-known-unknowns--test-plan)

---

## 1. Platform Architecture Overview

Sora operates as two distinct sub-platforms sharing a single domain:

```
sora.chatgpt.com
├── /library            → Sora v1 (Image generation archive)
│   └── Backend: /backend/v2/...
│
├── /profile            → Sora v2 (Public video feed, your posts)
├── /drafts             → Sora v2 (Private unpublished videos)
├── /p/{s_id}           → Sora v2 (Individual post view)
├── /d/{gen_id}         → Sora v2 (Individual draft / generation view)
└── Backend: /backend/project_y/...
```

### Infrastructure Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| CDN / WAF | Cloudflare | All requests proxied through CF |
| Static assets | `sora-cdn.oaistatic.com` | CSS, JS, fonts |
| API origin | OpenAI servers | Returns `x-sora-request-id`, `openai-organization` headers |
| Media storage | Azure Blob Storage | `videos.openai.com/az/files/` |
| OG previews | `ogimg.chatgpt.com` | Social sharing preview images (NOT useful for download) |

### Key Distinction: v1 vs v2

| Aspect | Sora v1 (Images) | Sora v2 (Videos) |
|--------|-------------------|-------------------|
| Page | `/library` | `/profile`, `/drafts`, `/p/`, `/d/` |
| API prefix | `/backend/v2/` | `/backend/project_y/` |
| Content unit | Task → Generations (1 prompt → N images) | Post or Draft (1 generation → 1 video) |
| ID format | `task_01abc...` / `gen_01xyz...` | `s_68f0e9cd...` (post) / `gen_01...` (draft) |
| Pagination | Offset-based (`after={last_id}`) | Cursor-based (base64-encoded) |
| Auth method | Cookie + `oai-device-id` | Cookie + `oai-device-id` (same) |
| Download URL source | Dedicated endpoint: `/backend/generations/{genId}/download` | Embedded in feed response: `download_urls.no_watermark` |
| Media format | PNG images | MP4 videos (+ GIF/thumbnail derivatives) |

**Both v1 and v2 may be accessible simultaneously** — a user can have content in both the image library and the video platform. A complete backup tool must handle both.

---

## 2. Authentication & Token Flow

### 2.1 Two Authentication Strategies

Sora uses two different authentication mechanisms depending on context:

#### Strategy A: Browser Context (SoraVault.js / Tampermonkey)

The browser-based approach relies on:

1. **HTTP-only session cookie** — set on login, sent automatically with `credentials: 'include'`. Never accessible via JavaScript.
2. **`oai-device-id`** — a UUID4 tied to the browser session. Sent as a custom request header.
3. **`oai-language`** — locale string (e.g. `en-US`).

No `Authorization: Bearer` header is used. The session cookie IS the auth.

**Capture flow (SoraVault.js):**
```
Browser starts loading sora.chatgpt.com
        │
        ▼
Tampermonkey injects SoraVault at document-start
        │
        ▼
SoraVault wraps unsafeWindow.fetch AND XHR.setRequestHeader
        │
        ▼
Sora's own JS loads and makes API calls
        │
        ▼
SoraVault intercept fires BEFORE the request leaves
│  reads oai-device-id from the outgoing headers
│  for /backend/project_y/* URLs: also captures ALL non-standard headers
        ▼
oaiDeviceId captured → stored in memory
        │
        ▼
SoraVault makes its own API calls using:
  • credentials: 'include'  (sends the session cookie)
  • oai-device-id: {captured value}
  • oai-language: {captured value}
  • all other captured headers for v2 requests
```

**Auth status indicators:**
- 🟡 Amber = waiting (no device ID captured yet)
- 🟢 Green = captured, ready to make autonomous API calls

**Important:** If navigating directly to `/profile` or `/drafts` without scrolling, Sora may not have made any API calls yet and `oai-device-id` will be `null`. Scrolling triggers Sora's feed requests and captures the header.

#### Strategy B: Electron Desktop App (SoraVault Desktop)

The Electron approach uses an actual Bearer token:

1. **Login Window** opens `https://sora.chatgpt.com` in a BrowserWindow with `partition: 'persist:sora'` (persistent cookies).
2. After login + OAuth redirect completes, the app executes JavaScript in the page context to fetch the access token:
   ```javascript
   const res = await fetch('/api/auth/session', { credentials: 'include' });
   const data = await res.json();
   return data?.accessToken || null;
   ```
3. The token is a **JWT** starting with `ey...`. The app decodes it to extract:
   - `exp` — expiry timestamp
   - `https://api.openai.com/profile` → `email`
   - `https://api.openai.com/auth` → `chatgpt_user_id`
4. Subsequent API calls use `Authorization: Bearer {accessToken}` header.
5. The `oai-device-id` is **generated locally** (`crypto.randomUUID()`) and persisted in settings.

**Token lifecycle:**
- Token is valid for a limited time (extracted from JWT `exp` claim)
- No auto-refresh mechanism exists in Desktop V1 — user must re-login when token expires
- Token validity is checked via `Date.now() < expiresAt`

**Key difference:** The browser approach piggybacks on Sora's existing session cookie (infinite-ish lifetime while browser is open). The desktop approach uses an explicit JWT that expires. Desktop V2 should implement token auto-refresh.

### 2.2 Session Bootstrapping Endpoints

These fire on every page load and are part of the auth lifecycle:

| Endpoint | Purpose | Used by SoraVault? |
|----------|---------|---------------------|
| `GET /api/auth/session` | Returns session info including `accessToken` JWT | Desktop only (token extraction) |
| `GET /backend/authenticate` | Validates session server-side | No |
| `GET /backend/billing/subscriptions` | Plan info | No |
| `GET /backend/project_y/v2/me` | Full user profile object | No (but useful for V2) |
| `GET /backend/parameters` | Feature flags / config | No |
| `GET /backend/models?nf2=true` | Available generation models | No |
| `GET /backend/project_y/initialize_async` | Initializes session state (cameo profiles, etc.) | No |

**⚠️ Auth Split (confirmed by SoraProbe):** Endpoints under `/backend/project_y/*` work with **cookie auth only** (no Bearer token needed in browser context). Non-project_y endpoints (`/backend/models`, `/backend/parameters`, `/backend/billing/subscriptions`, `/backend/nf/pending/v2`) require `Authorization: Bearer {jwt}` and return **HTTP 401** with `"Missing bearer authentication in header"` when called with cookies alone. The browser sends the Bearer token automatically (Sora's JS includes it), but Tampermonkey scripts must capture and replay it via the `storedV2Headers` mechanism.

### 2.3 Token Refresh Strategy for Desktop V2

**Current weakness:** Desktop V1 has no token refresh. When the JWT expires, the scan/download fails with HTTP 401.

**✅ CONFIRMED (SoraProbe 2026-03-31):** Calling `/api/auth/session` repeatedly returns the **same JWT** with the **same expiry** — the endpoint does NOT issue a fresh token. However, the session itself lives much longer than the JWT:

| Value | Lifetime | Source |
|-------|----------|--------|
| JWT `exp` claim | ~8 days from issuance | `accessToken` field |
| Session `expires` | ~3 months from issuance | `expires` field |
| Session cookie | Tied to browser session | HTTP-only cookie |

**This means:** The session cookie remains valid long after the JWT expires. To get a fresh JWT, the login BrowserWindow must **reload `sora.chatgpt.com`** (triggering OpenAI's auth flow to issue a new JWT), then re-extract via `/api/auth/session`.

**Recommended approach for V2:**
1. Before each API call, check `Date.now() < (expiresAt - 120000)` (2-minute buffer)
2. If expiring soon, **reload the login BrowserWindow's webContents** (`webContents.loadURL('https://sora.chatgpt.com')`)
3. Wait for page load, then re-execute the token extraction script
4. If the reload still returns an expired token, the session has died — prompt user to re-login
5. Log remaining token validity in the UI status bar

**Session endpoint extra fields (confirmed):**
```json
{
  "accessToken": "ey...",
  "user": {
    "id": "user-...",
    "name": "...",
    "email": "...",
    "image": "https://lh3.googleusercontent.com/...",
    "picture": "https://lh3.googleusercontent.com/...",
    "idp": "google-oauth2",
    "iat": 1774816394,
    "mfa": false,
    "lastAuthorizationCheck": 1774968585
  },
  "expires": "2026-06-29T14:50:40.456Z",
  "internalApiBase": null
}
```

---

## 3. Core Request Headers

### 3.1 Required Headers

Every API call to `sora.chatgpt.com/backend/*` requires:

| Header | Value | Notes |
|--------|-------|-------|
| `oai-device-id` | UUID4 | Per-device session token. Must match cookie session (browser) or be any valid UUID (desktop). |
| `oai-language` | `en-US` | Locale. |
| `accept` | `*/*` | Standard. |
| `referer` | Current page URL | Server validates this matches expected paths. Userscript uses `location.href`; desktop uses `https://sora.chatgpt.com/library`. |
| `credentials` | `include` (fetch option) | Browser only — sends session cookie. |
| `Authorization` | `Bearer {jwt}` | Desktop only — explicit token auth. |

### 3.2 Additional Headers Captured by SoraVault.js

For `/backend/project_y/*` requests, SoraVault.js captures ALL non-standard headers from Sora's own requests (excluding `content-type`, `accept-encoding`, `accept-language`, `cache-control`, `pragma`, `origin`, `content-length`). These stored headers are replayed on SoraVault's own requests.

**Why this matters:** Sora's frontend may send additional headers that the server expects. The blanket capture approach ensures compatibility without needing to know the exact header set.

### 3.3 Browser UA Headers (Optional)

Present in real browser requests but not strictly required:
- `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform` — Client Hints
- `sec-fetch-dest: empty`, `sec-fetch-mode: cors`, `sec-fetch-site: same-origin`
- `dnt: 1` (if Do Not Track enabled)

### 3.4 Desktop Headers

The desktop app constructs a realistic browser User-Agent:
```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0
```
It also sends `Origin: https://sora.chatgpt.com` and `Accept-Language: de,de-DE;q=0.9,en;q=0.8`.

---

## 4. Content Storage Backend (Azure)

All video and image content is served from Azure Blob Storage:

```
https://videos.openai.com/az/files/{path}?{sas_params}
```

URLs are **pre-signed** — you fetch them directly with a plain HTTP GET, **no auth headers needed**.

### 4.1 URL Patterns

Six distinct URL patterns exist for video/image content, plus two additional patterns for profile assets:

#### A) Raw / Full-Quality Download (no watermark)
```
https://videos.openai.com/az/files/{uuid}%2Fraw?{sas}
```
Decoded path: `{uuid}/raw`

**This is the highest quality, watermark-free video file.** The UUID is the generation UUID (`00000000-xxxx-xxxx-xxxx-xxxxxxxxxxxx` format), without any hash prefix.

#### B) Preview / Stream (Medium Quality)
```
https://videos.openai.com/az/files/{hash}_{uuid}%2Fdrvs%2Fmd%2Fraw?{sas}
```
Decoded path: `{hash}_{uuid}/drvs/md/raw`

Used for in-browser streaming. Supports HTTP/206 Partial Content (range requests). The `{hash}` is a content-derived identifier that differs from the UUID.

#### C) Thumbnail (Static Image)
```
{hash}_{uuid}%2Fdrvs%2Fthumbnail%2Fraw?{sas}
```

#### D) Low-Definition Stream
```
{hash}_{uuid}%2Fdrvs%2Fld%2Fraw?{sas}
```

#### E) Animated GIF Preview
```
{hash}_{uuid}%2Fdrvs%2Fgif%2Fraw?{sas}
```
(From `encodings.gif`)

#### F) Link Thumbnail / Unfurl Preview ✅ NEW
```
{hash}_{uuid}%2Fdrvs%2Flink_thumbnail%2Fraw?{sas}
```
Used specifically for social link preview cards (Open Graph / unfurl). This is the `encodings.unfurl` derivative. Different from the static `thumbnail` derivative — optimised for link card dimensions.

#### G) v1 Image URLs
```
https://videos.openai.com/az/files/{hash}_{uuid}/_src_/{...}?{sas}
```
The `_src_` path pattern identifies v1 image preview URLs. These are NOT the final download quality — use the download endpoint instead.

#### H) Profile Picture / vg-assets ✅ NEW
```
https://videos.openai.com/az/vg-assets/project-y/profile/{user_id}/{short_hash}#{file_id}#thumbnail.jpeg?{sas}
```

Decoded example:
```
project-y/profile/user-1tRSOHXQxgZtEj9GFqsHOvnF/02bc16c82d938b5#file_00000000743061f7b0df8366b7c8342e#thumbnail.jpeg
```

Used for **regular user profile pictures** uploaded to Sora v2. The `profile_picture_file_id` field on the profile object encodes the `{short_hash}#file_{id}#thumbnail` portion. Uses `ac=oaivgprodscus` datacenter (separate from video content datacenters).

**Profile picture URL format by user type:**

| User type | `profile_picture_url` format | `profile_picture_file_id` |
|-----------|------------------------------|---------------------------|
| `can_cameo: true` (cameo-enabled) | `az/files/{uuid}/raw` — same namespace as videos | `file_{hex}` |
| Regular user (uploaded photo) | `az/vg-assets/project-y/profile/{user_id}/...#thumbnail.jpeg` | `{short_hash}#file_{id}#thumbnail` |
| Default placeholder | `cdn.openai.com/sora/images/profile_placeholder_v4.png` | `null` |

Cameo-enabled users have their profile picture stored as a raw video-format file (same Azure namespace as generated content), because it doubles as the cameo reference image.

### 4.2 SAS Token Parameters

| Parameter | Example | Meaning |
|-----------|---------|---------|
| `se` | `2026-04-01T00:00:00Z` | Blob expiry. **~3 days** from generation. |
| `sp` | `r` | Permission: read-only. |
| `sv` | `2026-02-06` | Azure Storage API version. |
| `sr` | `b` | Resource type: blob. |
| `skoid` | `aa5ddad1-...` | Service Key Object ID. |
| `sktid` | `a48cca56-...` | Service Key Tenant ID (OpenAI's Azure tenant). |
| `skt` | `2026-03-29T12:59:28Z` | Service Key validity start. |
| `ske` | `2026-04-05T13:04:28Z` | Service Key expiry. **~1 week** window. |
| `sks` | `b` | Service Key scope. |
| `skv` | `2026-02-06` | Service Key API version. |
| `sig` | `{base64_hmac}` | HMAC-SHA256 signature. Cannot be forged. |
| `ac` | `oaisdsorprsouthcentralus` | Azure datacenter / account hint. |

### 4.3 Critical Timing Constraints

- **`se` (blob expiry):** ~3 days from response time → **download promptly after scan**
- **`ske` (key expiry):** ~1 week → URLs from a scan session remain valid ~1 week, but the blob itself may expire in 3 days
- **You cannot regenerate or extend SAS tokens.** They are server-issued. If a URL expires, you must re-call the feed endpoint to get a fresh URL.

**Implication for Desktop V2:** If a user scans now but downloads later, URLs may be expired. V2 should either:
1. Download immediately after scan (current V1 approach)
2. Re-fetch fresh URLs at download time by calling the feed/tree endpoint again
3. Store the generation ID and re-resolve URLs on demand

### 4.4 Azure Datacenters

Observed `ac` values (multiple US regions for redundancy):

**Video/image content (`az/files/`):**
- `oaisdsorprsouthcentralus`
- `oaisdsorprnorthcentralus`
- `oaisdsorprwestus`
- `oaisdsorprwestus2`
- `oaisdmntprsouthcentralus`
- `oaisdmntprcentralus`

**Profile pictures (`az/vg-assets/`):**
- `oaivgprodscus`

**Subtitle files (`srt_url`, `vtt_url`):**
- `oaisdmntprsouthcentralus`
- `oaisdmntprcentralus`

---

## 5. Sora v1 API — Image Library

**Base path:** `/backend/v2/`  
**Page:** `sora.chatgpt.com/library`

### 5.1 List Tasks (Image Feed)

```
GET /backend/v2/list_tasks?limit=20&after={last_id}
```

**Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 20 | Items per page. |
| `after` | string | (omit) | Offset pagination: `id` of last task from previous page. |

**Response:**

```json
{
  "task_responses": [
    {
      "id": "task_01abc...",
      "prompt": "a fox in a moonlit forest",
      "created_at": "2025-11-12T14:32:01.234Z",
      "type": "txt2img",
      "width": 1024,
      "height": 1024,
      "quality": "high",
      "operation": "generate",
      "model": "sora-1.0",
      "n_variants": 4,
      "generations": [
        {
          "id": "gen_01xyz...",
          "url": "https://videos.openai.com/az/files/{hash}_{uuid}/_src_/.../...",
          "width": 1024,
          "height": 1024,
          "quality": "high",
          "operation": "generate",
          "model": "sora-1.0",
          "seed": 1234567890,
          "task_type": "txt2img",
          "deleted_at": null,
          "download_status": "ready",
          "cf_thumbnail_url": "...",
          "is_favorite": false,
          "is_archived": false,
          "can_download": true,
          "n_frames": 1,
          "like_count": 0
        }
      ]
    }
  ],
  "has_more": true,
  "last_id": "task_01abc..."
}
```

**Alternative response key:** Some responses use `tasks` instead of `task_responses`. SoraVault handles both: `data.task_responses ?? data.tasks`.

**Pagination:** Offset-based. Pass `after={last_id}` from previous response. Stop when `has_more === false`.

**Skip conditions (from SoraVault.js):**
- `gen.deleted_at` is truthy → skip
- `gen.download_status` exists and is NOT `"ready"` → skip
- `gen.url` is empty → skip
- `gen.url` does not contain `_src_` and does not match `.png` → skip

### 5.2 Download URL (v1 Images)

```
GET /backend/generations/{genId}/download
```

**Response:**
```json
{
  "url": "https://videos.openai.com/az/files/...?{sas_params}"
}
```

Returns a fresh SAS-signed URL for direct download. **This is the primary download method for v1 images**, because the `url` field in `list_tasks` is a preview URL (`_src_` pattern), not the full-quality download URL.

**Desktop V1 also checks for `download_url` key** as fallback:
```javascript
return data.url || data.download_url || null;
```

**Rate limiting:** Desktop V1 handles HTTP 429 by reading `retry-after` header and waiting. No 429s have been observed in practice, but the handler exists.

### 5.3 Recent Tasks ✅ NEW

```
GET /backend/v2/recent_tasks?limit=20&before={task_id}
```

Separate from `list_tasks`. Uses **reverse pagination** (`before=` instead of `after=`) — returns tasks created before the given task ID. Fires on v1 library page load alongside `list_tasks`. Purpose: likely used to display recently submitted tasks (new content at top) while `list_tasks` provides the full archive pagination.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `limit` | int | Items per page |
| `before` | string | Reverse offset: task_id of oldest task from previous page |

Response schema is assumed identical to `list_tasks` — same `task_responses`/`tasks` key with `has_more` and `last_id`.

### 5.4 Collections & Favorites (V1 Likes System) ✅ NEW

V1 has its own favorites/likes system using a dedicated collections API at `/backend/collections/`. This is **entirely separate** from the v2 likes system.

#### List All Collections
```
GET /backend/collections?limit=100
```
Returns the user's collections metadata. `social_favorites` is one collection type.

#### List Liked Generations (V1)
```
GET /backend/collections/social_favorites/generations?limit=10
GET /backend/collections/social_favorites/generations?limit=10&after={gen_id}
```
Offset-paginated using `after={gen_id}` — same pattern as `list_tasks`. Returns generations the user has favorited/liked in the v1 image library.

#### Like a V1 Generation (Add to Favorites)
```
POST /backend/collections/social_favorites/generations
Body: { "generation_id": "gen_01kn28ke5xebpvt933p4g2hey2" }
```

**Response:**
```json
{
  "id": "collgen_01kn29agbyf7wbprkk82bngyp3",
  "collection_id": "coll_01jn8j5x22f3rv3da5n4t691wp",
  "generation_id": "gen_01kn28ke5xebpvt933p4g2hey2"
}
```

The `collection_id` is a persistent user-specific collection ID. The `collgen_` ID is the membership record.

#### Unlike a V1 Generation (Remove from Favorites)
```
DELETE /backend/collections/social_favorites/generations/{gen_id}
Response: HTTP 204 No Content
```

The `gen_id` is the generation ID (same as the `generation_id` field in the POST body), **not** the `collgen_` membership ID.

### 5.5 V1 Notifications ✅ NEW

```
GET /backend/notif?limit=10
GET /backend/notif?limit=20&before={task_id}
```

V1-specific notification system — **different from** the v2 `/backend/nf/pending/v2` endpoint. Uses reverse pagination with `before={task_id}`.

### 5.6 V1 View Tracking ✅ NEW

```
POST /backend/views
```

V1 equivalent of v2's `POST /backend/project_y/viewed`. Request body schema TBD — fires when viewing v1 image details.

### 5.7 V1 Presets ✅ NEW

```
GET /backend/presets
```

Returns generation presets available for v1 image generation. Schema TBD.

### 5.8 Platform Status ✅ NEW

```
GET /backend/status
```

Returns platform operational status. Fires on v1 page load. Response schema TBD.

---

## 6. Sora v2 API — Video Platform

**Base path:** `/backend/project_y/`  
**Pages:** `sora.chatgpt.com/profile`, `/drafts`, `/p/{id}`, `/d/{id}`

### 6.1 Profile Feed (Your Published Videos)

```
GET /backend/project_y/profile_feed/me?limit=8&cut=nf2
GET /backend/project_y/profile_feed/me?limit=8&cut=nf2&cursor={base64_cursor}
```

**Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 8 | Items per page (browser default). |
| `cut` | string | `nf2` | Required flag — likely "new feed v2". |
| `cursor` | string | (omit) | Base64-encoded pagination cursor. |

**Response:**
```json
{
  "items": [
    {
      "post": { /* Post object — see §7.3 */ },
      "profile": { /* Author's profile object */ },
      "reposter_profile": null
    }
  ],
  "cursor": "eyJraW5kIjoic3YyX2NyZWF0ZWRfYXQi..."
}
```

**Pagination:** `cursor` is `null` when all items returned. Do not construct manually.

### 6.2 Drafts Feed (All Generated Videos)

```
GET /backend/project_y/profile/drafts/v2?limit=15
GET /backend/project_y/profile/drafts/v2?limit=15&cursor={base64_cursor}
```

**Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 15 | Items per page (browser default). |
| `cursor` | string | (omit) | Base64-encoded compound cursor. |

**Response:**
```json
{
  "items": [ { /* Draft item — see §7.1 */ } ],
  "cursor": "eyJoYWJpZGV4X2N1..."
}
```

**Pagination:** `cursor` is `null` on last page.

### 6.3 Post Detail / Tree

```
GET /backend/project_y/post/{s_id}/tree?limit=20&max_depth=1
```

Fetches full detail for a single post including all variants and metadata. Triggered when a user opens a video (`/p/{s_id}`). **Used as fallback by SoraVault.js** to get download URLs for profile feed items that don't carry them directly.

| Param | Type | Description |
|-------|------|-------------|
| `s_id` | string | Post ID (e.g. `s_68f0e9cd...`) |
| `limit` | int | Max child nodes to return. |
| `max_depth` | int | Tree traversal depth (1 = immediate children only). |

**✅ Response structure (confirmed by SoraProbe 2026-03-31):**

The response is a **single object** (NOT an array):

```json
{
  "post": { /* Full Post object — see §7.3 */ },
  "profile": { /* Author's profile object */ },
  "reposter_profile": null,
  "children": { /* Child posts / replies object */ },
  "cursor": null
}
```

| Field | Type | Notes |
|-------|------|-------|
| `post` | object | Full post object with 30+ keys (same schema as profile feed posts) |
| `profile` | object | Author's full profile object |
| `reposter_profile` | object/null | null if original post |
| `children` | object | Contains child/reply posts (separate from `remix_posts`) |
| `cursor` | string/null | Pagination cursor for children; null when all returned |

**Download URL extraction from tree (confirmed working):**
```javascript
const tree = responseBody; // single object, NOT array
const post = tree.post;    // always under .post key
for (const att of (post?.attachments ?? [])) {
    const u = att.download_urls?.no_watermark
           ?? att.download_urls?.watermark
           ?? att.downloadable_url
           ?? att.url;
    if (u) return u;
}
```

**⚠️ SoraVault.js update needed:** The current `extractUrlFromTree` uses `Array.isArray(tree) ? tree : [tree]` which works but is overly defensive. The response is always a single object with a `.post` key.

### 6.3a Post Detail (Without Tree)

```
GET /backend/project_y/post/{s_id}
```

**✅ Confirmed (SoraProbe sniffer):** Sora's frontend also calls the post endpoint **without** the `/tree` suffix. This was observed on `/p/` page loads. Response schema TBD but likely returns just the post object without the children/cursor wrapper.

### 6.4 Download Endpoint (v2) — TELEMETRY ONLY

```
GET /backend/project_y/download/{s_id}
```

**Returns:** `{}` (2-byte response, `content-length: 2`)

**This endpoint does NOT return a download URL.** It is a server-side telemetry/logging call that records a download event. The actual URL is already in the post data via `downloadable_url` (preferred) or `download_urls.watermark`.

**⚠️ Updated note:** The original documentation stated "via `download_urls.no_watermark`" but SoraProbe confirmed this field is **null** on all sampled items. Use `downloadable_url` as the primary download source.

**Do not use for fetching download URLs.**

### 6.5 User Profile

```
GET /backend/project_y/v2/me
```

Returns the full profile object for the authenticated user. Useful for getting user ID, display name, avatar, and account capabilities.

**✅ Confirmed schema (SoraProbe 2026-03-31):**

Response is a wrapper with two top-level keys:

```json
{
  "profile": { /* Full profile object — 37+ fields */ },
  "my_info": { /* Account-level info */ }
}
```

**`profile` sub-object keys:** `user_id`, `username`, `profile_picture_url`, `profile_picture_id`, `profile_picture_file_id`, `is_default_profile_picture`, `cover_photo_url`, `verified`, `follower_count`, `following_count`, `post_count`, `reply_count`, `likes_received_count`, `remix_count`, `cameo_count`, `is_following`, `is_blocked`, `followed_by`, `plan_type`, `permalink`, `can_cameo`, `created_at`, `updated_at`, `banned_at`, `calpico_is_enabled`, `can_message`, `sora_who_can_message_me`, `chatgpt_who_can_message_me`, `is_public_figure`, `public_figure_name`, `character_count`, `owner_profile`, `social_context`, `verification_info`, `display_name`, `location`, `description`, `birthday`, `website`, `work`, `schools`, `follows_you`

**`my_info` sub-object keys:** `is_phone_number_verified`, `is_underage`, `has_imported_contacts`, `signup_date`, `email`, `invite_url`, `invite_message`, `invite_code`, `invites_remaining`, `num_redemption_gens`

### 6.6 Other User's Profile Feed

```
GET /backend/project_y/profile_feed/{username}?limit=8&cut=nf2
```

**⚠️ INFERRED, NOT CONFIRMED.** The URL pattern `profile_feed/{username}` is assumed by analogy with `profile_feed/me`. Test needed.

### 6.7 Mailbox / Notifications

```
GET /backend/project_y/mailbox?limit=20        → Full notification inbox
GET /backend/nf/pending/v2                      → Pending notification count (⚠️ requires Bearer token)
GET /backend/nf/check                           → Marks notifications as seen
```

These fire on page load. Contain interaction data (likes, replies, follows).

**✅ Confirmed (SoraProbe):** `/backend/project_y/mailbox?limit=20` returns `{ items: Array, cursor: string }` with cursor-based pagination. `/backend/nf/pending/v2` returns 401 without Bearer token (not under `project_y` prefix — see §2.2 auth split note).

### 6.8 Remix Feed ✅ NEW

```
GET /backend/project_y/post/{s_id}/remix_feed?cursor={base64_cursor}
```

**✅ Confirmed (SoraProbe sniffer 2026-03-31):** This is the **dedicated endpoint for listing remixes** of a post. Discovered via passive network capture — Sora's frontend calls it when viewing a post with remixes.

Uses cursor-based pagination (same base64 compound cursor pattern as other v2 feeds).

**Key finding:** The `remix_posts` array on the Post object (§7.3) is **always empty** in tree/feed responses even when `remix_count > 0`. You MUST use this endpoint to retrieve actual remix listings. Example: a post with `remix_count: 11` had `remix_posts: []` in the tree response.

### 6.9 Like / Unlike a Post ✅ NEW

```
POST /backend/project_y/post/{s_id}/like        → Like a post
```

**✅ Confirmed (SoraProbe 2026-03-31):** GET returns HTTP 405 (Method Not Allowed), confirming the endpoint exists and requires POST. Other probed patterns (`/likes`, `/react`, `/like/{id}`) all returned 404.

**Request body and unlike mechanism:** TBD — need to capture an actual like action in HAR. Unlike is likely either `DELETE /post/{id}/like` or `POST /post/{id}/unlike`.

### 6.10 Liked Posts Feed ✅ UPDATED

**Two confirmed endpoints exist for v2 liked posts:**

#### Primary (frontend-observed):
```
GET /backend/project_y/profile/{user_id}/post_listing/likes?limit=8
```
This is what the **actual Sora frontend calls** when navigating to the likes tab on a profile page. Uses the user's ID (from `/v2/me` → `profile.user_id`), not the string `me`.

**Example:** `GET /backend/project_y/profile/user-wlE66DNQNRNKZe6FzsIFEuXp/post_listing/likes?limit=8`

#### Secondary (SoraProbe-confirmed):
```
GET /backend/project_y/profile_feed/me?filter=liked&limit=5&cut=nf2
```
This variant was confirmed working (HTTP 200, `{ items: Array, cursor: string }`) by SoraProbe. It may be an alias or an older/internal route.

**Recommendation:** Use `profile/{user_id}/post_listing/likes` as the primary implementation, with `profile_feed/me?filter=liked` as fallback. Both return cursor-paginated post feed items in the standard `{ items, cursor }` structure.

### 6.11 Following / Followers ✅ NEW

```
GET /backend/project_y/profile/following?limit=5     → Users the current user follows
GET /backend/project_y/profile/followers?limit=5     → Users following the current user
```

**✅ Confirmed (SoraProbe 2026-03-31):** Both return HTTP 200. Response is a full profile object (37+ field profile schema — same as cameo_profiles items and `/v2/me` profile). Note the path is `/profile/following` NOT `/me/following`.

**Endpoints that DON'T work (404):** `/project_y/follow`, `/project_y/me/following`, `/project_y/me/followers`.

### 6.12 Individual Draft Fetch ✅ NEW

```
GET /backend/project_y/profile/drafts/v2/{gen_id}
```

**✅ Confirmed (SoraProbe sniffer):** Sora's frontend calls this when viewing a single draft at `/d/{gen_id}`. Returns the individual draft item object. Avoids needing to paginate through the full drafts feed.

### 6.13 View Tracking (Telemetry) ✅ UPDATED

```
POST /backend/project_y/viewed
```

**✅ Confirmed (SoraProbe sniffer + HAR batch 2):** Fires when a user views a post. Increments `view_count` and `unique_view_count` on the post.

**Full request body schema (confirmed):**
```json
{
  "rich_views": {
    "views": [
      {
        "id": "s_69c837fa1be88191a4aff04fc97b2ca1",
        "first_view_time": 1774970835.014,
        "exit_view_time": 1774970838.608,
        "loop_count": 0,
        "watch_time": 3.5169999599456787,
        "dwell_time": 3.5940001010894775,
        "is_head_cache": null,
        "ranking_session_id": null,
        "source": null,
        "feed_position": null
      }
    ]
  }
}
```

Multiple view sessions for the same post can be **batched in a single request** — each loop/re-watch is a separate entry in the `views` array. The `id` is the post's `s_` ID. The `watch_time` (seconds actually watched) differs from `dwell_time` (total time on page).

### 6.14 Session Initialization

```
GET /backend/project_y/initialize_async
```

Fires on every page load. **✅ Full response captured (SoraProbe 2026-03-31):**

```json
{
  "composer_profiles": [ /* Array(25) — available cameo/composer profiles */ ],
  "max_cameos": 3,
  "unread_draft_count": 0,
  "can_upload": true,
  "last_read_ts": 1774964131.626963,
  "unread_notifs": 0,
  "total_unread_rooms": 0,
  "notification_type_counts": { /* counts by notification type */ },
  "drafts_badge_count": 0,
  "styles": [ /* Array(11) — available style presets */ ],
  "referring_profile": null,
  "selectable_feeds": [ /* Array(3) — available feed types */ ],
  "mood_selector_selectable": true,
  "app_url": "...",
  "max_stitch_frames": 300,
  "max_bulk_tasks": 4,
  "holiday_gens_remaining": null,
  "app_strings": { /* UI string localization */ }
}
```

**Key fields for SoraVault V2:**
- `composer_profiles` (25 items) — this is where cameo profiles live; each item is a full profile object
- `styles` (11 items) — available style presets for generation
- `selectable_feeds` (3 items) — available feed types
- `max_stitch_frames: 300` — max frames for video stitching/extending
- `max_bulk_tasks: 4` — max concurrent generation tasks
- `max_cameos: 3` — max cameo profiles per generation

---

## 7. Data Models — Full Field Inventory

### 7.1 Draft Item

Direct item in `/profile/drafts/v2` response array. All fields at top level.

| Field | Type | Example | Status | Notes |
|-------|------|---------|--------|-------|
| `id` | string | `"gen_01kczts1..."` | ✅ Confirmed | Generation ID |
| `generation_id` | string | (same as id) | ✅ Confirmed | Redundant alias of `id` |
| `task_id` | string | `"task_01kczte..."` | ✅ Confirmed | Parent task |
| `kind` | string | `"sora_draft"` | ✅ Confirmed | Values: `"sora_draft"`, `"sora_content_violation"` (blocked content) |
| `url` | string | Azure preview URL | ✅ Confirmed | Medium quality stream (`drvs/md/raw`) |
| `downloadable_url` | string | Azure URL | ✅ Confirmed | **Primary download source** — full quality `{uuid}/raw` URL. `download_urls.no_watermark` is null |
| `download_urls` | object | See §7.6 | ✅ Confirmed | Contains `watermark`, `no_watermark` (null!), `endcard_watermark` |
| `width` | number | 1920 | ✅ Confirmed | Pixel width |
| `height` | number | 1080 | ✅ Confirmed | Pixel height |
| `duration_s` | number | 5.0 | ✅ Confirmed | Duration in seconds (float) |
| `generation_type` | string | `"video_gen"` | ✅ Confirmed | Value: `"video_gen"` (null on some older/blocked items) |
| `created_at` | number | 1766566282.17 | ✅ Confirmed | Unix timestamp (float, seconds) |
| `prompt` | string | Full prompt | ✅ Confirmed | Generation prompt |
| `title` | string | null | ✅ Confirmed | Optional title (often null) |
| `encodings` | object | See §7.5 | ✅ Confirmed | Multi-quality derivatives |
| `draft_reviewed` | boolean | false | ✅ Confirmed | Whether draft has been reviewed |
| `creation_config` | object | See §7.1a | ✅ Confirmed | Full generation config including remix/cameo |
| `can_remix` | boolean | true | ✅ Confirmed | User can remix this |
| `can_extend` | boolean | false | ✅ Confirmed | User can extend this video |
| `can_storyboard` | boolean | true | ✅ Confirmed | Can create storyboard |
| `has_children` | boolean | false | ✅ Confirmed | Has remix/variation children |
| `storyboard_id` | string/null | null | ✅ Confirmed | Storyboard membership |
| `can_create_character` | boolean | true | ✅ Confirmed | Whether a cameo profile can be created from this content |
| `post_visibility` | string | — | ⚠️ Partial | Not populated in observed samples. May use different field name or only in specific contexts |
| `post` | object/null | Post object or null | ✅ Confirmed | Associated post if published |
| `unwrap` | object | `{ kind: "winter_2025" }` | ✅ Confirmed | Seasonal/promotional campaign tag. Flags content from holiday generation events. |
| `shot_data` | object | TBD | ⚠️ Partial | Storyboard shot metadata |
| `operations` | array | [] | ✅ Confirmed | Edit operations applied |
| `rooted_project` | object | TBD | ⚠️ Partial | Parent project context |
| `tags` | array | [] | ✅ Confirmed | Empty in observed samples |

#### 7.1a creation_config (Sub-object on Draft Item)

| Field | Type | Status | Notes |
|-------|------|--------|-------|
| `remix_target_post` | object/null | ✅ Confirmed | **KEY FOR REMIX CHAIN** — source post if this is a remix |
| `style` | object/null | ⚠️ Partial | Applied style preset |
| `inpaint_image` | object/null | ⚠️ Partial | Reference image for inpainting |
| `reference_inpaint_items` | array | ⚠️ Partial | Reference items used |
| `prompt` | string | ✅ Confirmed | Duplicates parent prompt |
| `task_id` | string | ✅ Confirmed | Duplicates parent task_id |
| `cameo_profiles` | array | ✅ Confirmed | **KEY FOR CAST-IN** — cameo subjects used |
| `orientation` | string | ✅ Confirmed | "landscape" / "portrait" / "square" |
| `n_frames` | number | ✅ Confirmed | Frame count requested |
| `storyboard_id` | string/null | ✅ Confirmed | Parent storyboard |
| `editing_config` | object/null | ⚠️ Partial | Editor configuration |

### 7.2 Profile Feed Item Wrapper

Wrapper object in `profile_feed/me` response array:

| Field | Type | Notes |
|-------|------|-------|
| `post` | object | The post itself (§7.3) |
| `profile` | object | Author's profile |
| `reposter_profile` | object/null | Repost source profile (null if original) |

### 7.3 Post Object (Full Schema)

From `item.post` in profile feed:

| Field | Type | Status | Notes |
|-------|------|--------|-------|
| `id` | string | ✅ | Post ID: `"s_68f0e9cd..."` |
| `shared_by` | object | ✅ | Who shared (if repost) |
| `is_owner` | boolean | ✅ | Whether viewer is the owner |
| `workspace_id` | string | ⚠️ | TBD |
| `posted_to_public` | boolean | ✅ | Visibility flag |
| `post_locations` | array | ✅ | Where it was posted |
| `posted_at` | number | ✅ | Unix timestamp (when posted publicly) |
| `updated_at` | number | ✅ | Unix timestamp |
| `like_count` | number | ✅ | Total likes |
| `recursive_reply_count` | number | ✅ | Includes nested replies |
| `reply_count` | number | ✅ | Direct replies only |
| `view_count` | number | ✅ | Total views |
| `unique_view_count` | number | ✅ | Deduplicated views |
| `share_count` | number | ✅ | Shares |
| `repost_count` | number | ✅ | Reposts |
| `remix_count` | number | ✅ | Times remixed |
| `user_liked` | boolean | ✅ | Current viewer has liked |
| `user_disliked` | boolean | ✅ | Current viewer has disliked |
| `has_reposted` | boolean | ✅ | Current viewer has reposted |
| `dislike_count` | number | ✅ | |
| `source` | string | ⚠️ | TBD |
| `story_type` | string | ⚠️ | TBD |
| `text` | string | ✅ | Raw text/caption |
| `caption` | string | ✅ | Formatted caption (may differ from text) |
| `cover_photo_url` | string/null | ✅ | null in observed samples |
| `preview_image_url` | string | ✅ | OG image URL (`ogimg.chatgpt.com`) — NOT for download |
| `attachments` | array | ✅ | **MAIN VIDEO DATA** — see §7.4 |
| `repost_of_post_id` | string/null | ✅ | null if original |
| `repost_of_user_id` | string/null | ✅ | null if original |
| `original_poster` | object/null | ✅ | Original poster profile if repost |
| `parent_post_id` | string/null | ✅ | null if root post |
| `root_post_id` | string/null | ✅ | null if root post |
| `parent_path` | array | ✅ | Ancestor post IDs |
| `tombstoned_at` | string/null | ✅ | null if not deleted |
| `permalink` | string | ✅ | Full URL, e.g. `"https://sora.chatgpt.com/p/s_..."` |
| `share_ref` | string | ✅ | Share reference token |
| `permissions` | object | ⚠️ | What current user can do — schema unknown |
| `text_facets` | array | ✅ | Rich text annotations (mentions, links) |
| `cameo_profiles` | array | ✅ | **Cast-in subjects used** |
| `disabled_cameo_user_ids` | array | ⚠️ | Users who opted out of cameo |
| `rooms` | array | ⚠️ | TBD |
| `groups` | array | ⚠️ | TBD |
| `verifications` | array | ✅ | Verification badges |
| `verification_info` | object | ✅ | Badge detail |
| `audience_description` | string | ⚠️ | TBD |
| `topic_labels` | array | ✅ | Content categorization tags |
| `remix_posts` | array/**null** | ✅ | **Remixes of this post** — **ALWAYS null/empty in all feed/tree responses** even when `remix_count > 0`. Use `/post/{id}/remix_feed` instead. |
| `ancestors` | array/**null** | ✅ | Parent post chain — confirmed null in most responses |
| `parent_post` | object/null | ✅ | **Immediate parent post — full `{ post, profile, reposter_profile }` wrapper**, NOT a bare post. Access via `.parent_post.post.id` |
| `emoji` | string | ✅ | Single emoji assigned to post. e.g. `"🍎"`, `"🖕"` |
| `is_featured` | boolean/**null** | ✅ | `null` in most observed samples |
| `visibility` | string/**null** | ✅ | `null` on most observed; use `permissions.share_setting` instead |
| `discovery_phrase` | string | ✅ | Short text used for content discovery. e.g. `"sam altman middle finger"`, `"steve jobs impersonation"` |
| `srt_url` | string/null | ✅ | **Populated when `attachments[0].has_captions === true`**. Azure SAS URL to `.srt` subtitle file. |
| `vtt_url` | string/null | ✅ | **Populated when `attachments[0].has_captions === true`**. Azure SAS URL to `.vtt` WebVTT subtitle file. |
| `permissions` | object | ✅ | **Full schema confirmed** — see §7.3a |
| `ranking_session_id` | string/**null** | ✅ | Feed ranking session — `null` when accessed via post detail |

### 7.3a Permissions Object (Sub-object on Post) ✅ NEW

```json
{
  "can_read": true,
  "can_write": false,
  "can_delete": false,
  "can_remix": true,
  "share_setting": "public"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `can_read` | boolean | Whether current viewer can read this post |
| `can_write` | boolean | Whether current viewer can edit |
| `can_delete` | boolean | Whether current viewer can delete |
| `can_remix` | boolean | Whether current viewer can remix |
| `share_setting` | string | `"public"` / `"private"` / `"unlisted"` — **use this instead of `post.visibility`** which is always null |

### 7.4 Attachment / Video Object

This is `post.attachments[0]` in a profile post.

**✅ FULLY CONFIRMED (SoraProbe 2026-03-31)** — Complete field inventory from live API responses across multiple posts:

| Field | Type | Example | Status | Notes |
|-------|------|---------|--------|-------|
| `id` | string | `"s_69c98a57...-attachment-0"` | ✅ Confirmed | Composite ID: `{post_id}-attachment-{index}` |
| `tags` | array | `[...]` (length 1) | ✅ Confirmed | Non-empty — contains content tags |
| `kind` | string | `"sora"` | ✅ Confirmed | Content type identifier |
| `generation_id` | string | `"gen_01k7pjrn..."` | ✅ Confirmed | Links back to the generation |
| `generation_type` | string | `"video_gen"` | ✅ Confirmed | Generation type |
| `url` | string | Azure `drvs/md/raw` URL | ✅ Confirmed | Medium quality stream (preview) |
| `downloadable_url` | string | Azure `{uuid}/raw` URL | ✅ Confirmed | **Primary download URL** — full quality |
| `download_urls` | object | See §7.6 | ✅ Confirmed | Contains `watermark`, `no_watermark`, `endcard_watermark` |
| `width` | number | 352 | ✅ Confirmed | Pixel width |
| `height` | number | 640 | ✅ Confirmed | Pixel height |
| `duration_s` | number | 10.1 | ✅ Confirmed | Duration in seconds (float) |
| `n_frames` | number | 300 | ✅ Confirmed | Total frame count |
| `prompt` | null | null | ✅ Confirmed | Always null on attachment (prompt lives on post.text/caption) |
| `task_id` | string | `"task_01k7pjn2..."` | ✅ Confirmed | Parent task |
| `output_blocked` | boolean | false | ✅ Confirmed | Whether content was blocked by safety filters |
| `title` | null | null | ✅ Confirmed | Always null in observed samples |
| `source` | null | null | ✅ Confirmed | Always null in observed samples |
| `encodings` | object | See §7.5 | ✅ Confirmed | Full 8-key encoding set (see note below) |
| `asset_pointer` | null | null | ✅ Confirmed | Possibly for cross-platform asset linking |
| `conversation_id` | null | null | ✅ Confirmed | Possibly for ChatGPT integration |
| `can_create_character` | boolean | true | ✅ Confirmed | Whether a cameo profile can be created from this |
| `style` | null | null | ✅ Confirmed | Applied style preset (null if none) |
| `has_captions` | boolean | true | ✅ Confirmed | Whether captions/subtitles exist for this video |

**⚠️ CRITICAL: `download_urls.no_watermark` is NULL on profile feed attachments.** In both posts sampled, only `download_urls.watermark` was populated. `downloadable_url` had the same Azure raw URL as the watermark field.

**Corrected URL resolution priority for profile posts:**
```
att.download_urls?.no_watermark        ← may be null!
  ?? att.download_urls?.watermark      ← ACTUALLY populated (Azure {uuid}/raw)
  ?? att.downloadable_url              ← ALSO populated (same as watermark)
  ?? att.encodings?.source?.url        ← on attachments: has { url } key (see §7.5a)
  ?? att.url                           ← medium quality stream (drvs/md/raw)
  ?? (typeof att === 'string' ? att : null)
```

**Note on `encodings` in attachments vs drafts:** On **attachments** (inside posts), encodings sub-objects use `{ url }` format. On **drafts**, they use `{ path, size, duration_secs, ssim }` format — see §7.5a.

### 7.5 Encodings Object

Present on both drafts items and attachments, but with **different internal structure**.

#### 7.5a Encodings on Attachments (inside Posts)

Same 8-key structure, each sub-object contains a `url` field:

```json
{
  "source":      { "url": "https://videos.openai.com/az/..." },
  "source_wm":   { "url": "..." },
  "endcard_wm":  { "url": "..." },
  "thumbnail":   { "url": "..." },
  "unfurl":      { "url": "..." },
  "md":          { "url": "..." },
  "ld":          { "url": "..." },
  "gif":         { "url": "..." }
}
```

#### 7.5b Encodings on Drafts and nf/pending Tasks

**✅ Confirmed different key name from attachments (SoraProbe + HAR batch 2):** On drafts and on task objects returned from `nf/pending/v2`, each sub-object uses `path` as the key — NOT `url`. However, the **value type differs by context:**

| Source | Key | Value |
|--------|-----|-------|
| `/profile/drafts/v2` items | `path` | **Internal storage path** — NOT a usable URL. Do not attempt to download. |
| `nf/pending/v2` task attachments (inside `remix_target_post`, `creation_config`) | `path` | **Full Azure SAS URL** — directly downloadable. |

**Detection rule:** Check if the value starts with `https://` — if yes, it's a usable URL regardless of key name. If it looks like a relative path, it's an internal reference.

```json
{
  "source":      { "path": "https://videos.openai.com/az/files/...?{sas}", "size": 4730462, "duration_secs": 10.1, "ssim": 0.9965627 },
  "source_wm":   { "path": "https://...", "size": 4730462, "duration_secs": 10.1, "ssim": 0.9965627 },
  "endcard_wm":  null,
  "thumbnail":   { "path": "https://...", "size": null, "ssim": null },
  "unfurl":      { "path": "https://.../drvs/link_thumbnail/raw?{sas}", "size": null, "ssim": null },
  "md":          { "path": "https://...", "size": 1141173, "ssim": 0.9910161 },
  "ld":          { "path": "https://...", "size": 767004, "ssim": 0.9900098 },
  "gif":         { "path": "https://...", "size": null, "ssim": null }
}
```

**Fields per encoding sub-object:**

| Context | Key name | Value type | Notes |
|---------|----------|------------|-------|
| **Attachment** (post/tree) | `url` | Azure SAS URL | Directly downloadable |
| **nf/pending task** embedded attachment | `path` | Azure SAS URL | Directly downloadable despite key name |
| **Draft** (`/drafts/v2`) | `path` | Internal storage path | Not a URL; use `downloadable_url` instead |

| Key | Purpose | Notes |
|-----|---------|-------|
| `source` | Original / full quality | Same URL as `downloadable_url` in most contexts |
| `source_wm` | Original + watermark | Often same URL as source |
| `endcard_wm` | Endcard watermark variant | Often `null` on drafts |
| `thumbnail` | Static poster image | Uses `drvs/thumbnail/raw` derivative |
| `unfurl` | Social link preview card | Uses `drvs/link_thumbnail/raw` derivative — different from `thumbnail` |
| `md` | Medium quality stream | Used for in-browser playback |
| `ld` | Low quality stream | |
| `gif` | Animated GIF preview | |

### 7.6 Download URLs Object

Present on drafts items and on attachment objects:

```json
{
  "watermark":          "https://videos.openai.com/az/files/...",
  "no_watermark":       null,
  "endcard_watermark":  "https://videos.openai.com/az/files/..."
}
```

**⚠️ CRITICAL FINDING (SoraProbe 2026-03-31):** `no_watermark` was **NULL** on all sampled items — both profile feed attachments and drafts. Only `watermark` and `endcard_watermark` were populated. The `downloadable_url` field (at the attachment/draft level) contained the same Azure `{uuid}/raw` URL as `download_urls.watermark`.

**Open question:** Does `no_watermark` ever get populated? Possible explanations:
1. It may be a plan-tier feature (e.g. only for Pro subscribers)
2. It may be deprecated and `downloadable_url` is the replacement
3. It may only populate in certain API contexts (e.g. tree endpoint but not feed)

**Recommended download URL resolution (updated):**
```
download_urls.no_watermark        ← CHECK FIRST but expect null
  ?? downloadable_url             ← MOST RELIABLE — always populated
  ?? download_urls.watermark      ← Same URL as downloadable_url
  ?? url                          ← LAST RESORT — medium quality only
```

### 7.7 v1 Generation Object (from list_tasks)

Fields on each generation within a task:

| Field | Type | Status | Notes |
|-------|------|--------|-------|
| `id` | string | ✅ | `"gen_01xyz..."` |
| `url` | string | ✅ | Preview URL (`_src_` pattern) |
| `width` | number | ✅ | |
| `height` | number | ✅ | |
| `quality` | string | ✅ | "high", "standard", etc. |
| `operation` | string | ✅ | "generate", "edit", etc. |
| `model` | string | ✅ | "sora-1.0" |
| `seed` | number | ✅ | Reproducibility seed |
| `task_type` | string | ✅ | "txt2img" etc. |
| `deleted_at` | string/null | ✅ | null if not deleted |
| `download_status` | string | ✅ | "ready" when downloadable |
| `cf_thumbnail_url` | string | ✅ | Cloudflare-cached thumbnail |
| `is_favorite` | boolean | ✅ | From Desktop V1 normalization |
| `is_archived` | boolean | ✅ | From Desktop V1 normalization |
| `can_download` | boolean | ✅ | From Desktop V1 normalization |
| `n_frames` | number | ✅ | Frame count |
| `like_count` | number | ✅ | From Desktop V1 normalization |

### 7.8 v1 Task Object (from list_tasks)

| Field | Type | Status | Notes |
|-------|------|--------|-------|
| `id` | string | ✅ | `"task_01abc..."` |
| `prompt` | string | ✅ | |
| `created_at` | string | ✅ | ISO timestamp |
| `type` | string | ✅ | "txt2img" etc. |
| `width` | number | ✅ | |
| `height` | number | ✅ | |
| `quality` | string | ✅ | |
| `operation` | string | ✅ | |
| `model` | string | ✅ | |
| `n_variants` | number | ✅ | How many images were generated |
| `generations` | array | ✅ | Array of Generation objects (§7.7) |

---

## 8. Pagination Systems

| API | System | Request Field | End Condition | Delay |
|-----|--------|---------------|---------------|-------|
| v1 `list_tasks` | Offset (ID-based) | `after={last_id}` | `has_more === false` | 200ms (JS), 400ms (Desktop) |
| v2 profile feed | Cursor (timestamp) | `cursor={base64}` | `cursor === null` | 300ms |
| v2 drafts | Cursor (compound) | `cursor={base64}` | `cursor === null` | 300ms |
| v2 post tree | Limit only | — | — | — |

### 8.1 v1 Pagination

Simple offset: each response returns `last_id` and `has_more`. Pass `after={last_id}` on next request.

### 8.2 v2 Profile Feed Cursor (Decoded)

```json
{ "kind": "sv2_created_at", "created_at": 1760618957.02966 }
```

A timestamp-based cursor. The feed is ordered by creation time; the cursor means "give me everything older than this timestamp."

### 8.3 v2 Drafts Cursor (Decoded)

```json
{
  "habidex_cursor": "cnM3OjYyY2JmMzI5LWJmMTctNDEwMy05YTcyLTBmMWY0MmMxN2FiNTpkT3ZybEFjOj...",
  "projects_cursor": ""
}
```

A compound cursor with two internal streams:
- `habidex_cursor` — opaque server-side pagination token for videos
- `projects_cursor` — tracks a "projects" dimension, currently unused (empty string)

**Never construct cursors manually.** Always use the value returned by the previous response.

---

## 9. URL Construction & Download Flows

### 9.1 v1 Image Download Flow

```
list_tasks response
    │
    │  gen.url = preview URL (/_src_/ pattern, medium quality)
    │  gen.id  = generation ID
    ▼
GET /backend/generations/{genId}/download
    │
    │  Response: { "url": "https://videos.openai.com/az/files/...?{sas}" }
    ▼
Direct HTTP GET to Azure URL (no auth headers)
    │
    ▼
PNG file bytes → save to disk
```

**Fallback:** If the download endpoint fails, SoraVault.js falls back to the preview URL from `gen.url`.

### 9.2 v2 Draft Download Flow

```
drafts/v2 response
    │
    │  item.download_urls.no_watermark  ← CHECK FIRST but may be null!
    │  item.downloadable_url            ← MOST RELIABLE (full quality, {uuid}/raw)
    │  item.download_urls.watermark     ← fallback (same URL as downloadable_url)
    │  item.url                         ← fallback (preview quality drvs/md/raw)
    ▼
Direct HTTP GET to Azure URL (no auth headers)
    │
    ▼
MP4 file bytes → save to disk
```

**⚠️ Updated based on SoraProbe results:** `no_watermark` is null on all observed drafts. `downloadable_url` is the primary reliable source.

### 9.3 v2 Profile Post Download Flow

```
profile_feed/me response
    │
    │  item.post.attachments[0]
    │    .download_urls?.no_watermark  ← CHECK but may be null!
    │    .downloadable_url             ← MOST RELIABLE (Azure {uuid}/raw)
    │    .download_urls?.watermark     ← fallback (same URL)
    │    .encodings?.source?.url       ← fallback (attachment encodings have url)
    │    .url                          ← fallback (preview quality drvs/md/raw)
    ▼
If ALL above are null/empty:
    │
    ▼
GET /backend/project_y/post/{postId}/tree?limit=20&max_depth=1
    │
    │  Response: { post: { attachments: [...] }, profile, children, cursor }
    │  Extract URL from tree.post.attachments[0] using same fallback chain
    ▼
Direct HTTP GET to Azure URL
    │
    ▼
MP4 file bytes → save to disk
```

**⚠️ Updated based on SoraProbe results:** `no_watermark` was null on all sampled profile posts. `downloadable_url` was the first populated field. Tree endpoint also confirmed working as fallback — returns a single object with `.post.attachments[0]`.

### 9.4 File Extension Logic

| Content | Extension | Detection |
|---------|-----------|-----------|
| v1 images | `.png` | Always PNG |
| v2 videos | `.mp4` | Always MP4 |
| TXT sidecar | `.txt` | Contains metadata (prompt, IDs, resolution, etc.) |

**Desktop V2 consideration:** Should detect actual content type from response headers (`Content-Type`) rather than assuming extension. Some edge cases may involve WebM or other formats.

---

## 10. Remixes & Remix Chain

### 10.1 What is Known

Remixes are new generations that use an existing post as a base. The remix chain connects a remix back to its original source.

**On the Post object (§7.3):**
- `remix_count: number` — how many times this post has been remixed
- `remix_posts: array|null` — **ALWAYS null or empty in all feed/tree responses**, even when `remix_count > 0`. Use `/post/{id}/remix_feed` endpoint.
- `parent_post_id: string|null` — if this post IS a remix, the source post ID
- `root_post_id: string|null` — the ultimate root of the remix chain
- `parent_path: array|null` — ancestor post IDs forming the full chain (can be null)
- `parent_post: object|null` — **full `{ post, profile, reposter_profile }` wrapper** (not a bare post). Access inner post via `parent_post.post`
- `ancestors: array|null` — parent post chain (can be null)

**On the Draft item (§7.1):**
- `can_remix: boolean` — whether user can remix this
- `has_children: boolean` — has remix/variation children
- `creation_config.remix_target_post: object/null` — if this draft IS a remix, contains the source post

### 10.2 Accessing the Remix Chain

**Direction 1: "What was this remixed FROM?" (Upstream chain)**

For a given video, check:
1. Draft: `creation_config.remix_target_post` — **full `{ post, profile, reposter_profile }` wrapper** containing the source post. Access the post itself via `.remix_target_post.post`. Confirmed from `nf/pending/v2` response.
2. Post: `parent_post_id` — ID of the immediate parent post
3. Post: `root_post_id` — ID of the chain root
4. Post: `parent_path` — full ancestor ID array (may be null)
5. Post: `parent_post` — full `{ post, profile, reposter_profile }` wrapper (access via `.parent_post.post`)

**To download the source of a remix:**
1. Get the `parent_post_id` from the remix post
2. Call `GET /backend/project_y/post/{parent_post_id}/tree?limit=20&max_depth=1`
3. Extract the download URL from `tree.post.attachments[0]`

**Direction 2: "What remixes exist OF this post?" (Downstream)**

**✅ CONFIRMED (SoraProbe 2026-03-31):** The `remix_posts` array on the Post object is **ALWAYS EMPTY** in feed/tree responses, even when `remix_count > 0`. Example: a post with `remix_count: 11` had `remix_posts: []`.

**Use the dedicated remix feed endpoint instead:**
```
GET /backend/project_y/post/{s_id}/remix_feed?cursor={base64_cursor}
```

This endpoint is cursor-paginated and returns the actual remix posts. Discovered via passive network capture — Sora's frontend calls it when displaying remixes on a post page.

### 10.3 Remix Chain for SoraVault Desktop V2

**Implementation plan:**
1. When scanning drafts, check each item's `creation_config.remix_target_post`
2. If present, store the source post ID and any embedded data
3. Optionally fetch the source post via tree endpoint to get its download URL
4. In the exported index JSON, include a `remix_source` field linking back to the parent

**Tests needed:**
- ~~Record a HAR while viewing a known remix → inspect `creation_config.remix_target_post` schema~~ **✅ DONE — full `{ post, profile, reposter_profile }` wrapper confirmed via `nf/pending/v2`**
- ~~Record a HAR while viewing a heavily-remixed post → check if `remix_posts` is paginated~~ **✅ DONE — always null; use `remix_feed` endpoint**
- Test if `parent_post` and `ancestors` are populated in the feed response or only in the tree response — `parent_post` confirmed populated in `nf/pending` embedded posts; `ancestors` remains null
- Determine multi-level remix chain depth — `parent_post_id` and `root_post_id` both point to root for one-level remixes; test with 3+ level chain

---

## 11. Cast-In (Cameo)

### 11.1 Overview

"Cast-in" (internally called "cameo") is Sora's feature for inserting a specific person's likeness into a video. **Two distinct mechanisms exist**, both submitting via `POST /backend/nf/create` but using different parameters. Neither sends `cameo_ids` in the observed requests — that field was always `null`.

### 11.2 Mechanism A: @mention Cast-In ✅ CONFIRMED

The primary mechanism uses **`@username` syntax in the prompt string**. No explicit `cameo_ids` are passed:

```json
{
  "kind": "video",
  "prompt": "@steakfake @t2xx2 @dakreekcraft they run toward the screen, screen exploding",
  "cameo_ids": null,
  "cameo_replacements": null,
  "inpaint_items": []
}
```

The server resolves `@username` → profile server-side and populates `creation_config.cameo_profiles` in the resulting task object with full 37-field profile objects. Only users with `can_cameo: true` on their profile are eligible. The `initialize_async` endpoint returns `composer_profiles: Array(25)` — these are the picker tiles shown in the cast-in UI.

**Key stat fields on cameo-eligible profiles (live data observed):**
- `dakreekcraft`: `cameo_count: 446,185`, `can_cameo: true`, `character_count: 0`
- `steakfake`: `cameo_count: 1,029,363`, `can_cameo: true`
- `t2xx2`: `cameo_count: 355,333`, `can_cameo: true`
- `max_cameos: 3` — maximum cast-in subjects per generation (from `initialize_async`)

### 11.3 Mechanism B: Reference Image Cast-In ✅ NEW

The second mechanism uses **`inpaint_items`** with a `reference_id` to specify an uploaded photo as the cameo source. This is the "create new character with reference / mark people" flow:

```json
{
  "kind": "video",
  "prompt": "...",
  "cameo_ids": null,
  "inpaint_items": [
    {
      "kind": "reference",
      "reference_id": "ref_69c98b29a1c081919bd89117f919c9e5"
    }
  ]
}
```

The `reference_id` format: `ref_` + 32 hex characters. The endpoint that creates this reference object (and issues the `ref_` ID) fires before the generation request — it is not yet documented. The `inpaint_items` array accepts multiple items for multiple reference inputs.

### 11.4 Cast-In Data on Content Objects

**On Post object (§7.3):**
- `cameo_profiles: array|null` — profile objects used in the post. **Can be null**, not just `[]`.
- `disabled_cameo_user_ids: array|null` — users who opted out. **Can be null**.

**On Draft item (§7.1):**
- `creation_config.cameo_profiles: array` — cameo subjects resolved from @mentions. Always an array (may be empty).
- `can_create_character: boolean` — whether a cameo profile can be created from this content.

**On User profile object:**
- `can_cameo: boolean` — user is eligible for @mention cast-in
- `cameo_count: number` — times this profile has been used as a cameo subject
- `character_count: number` — number of cast-in characters created by this user

### 11.5 cameo_profiles Item Schema ✅ CONFIRMED (updated)

Each item is a **full 37-field user profile object** — identical schema to `/v2/me`, `profile/following`, feed wrapper profiles. Live example:

```json
{
  "user_id": "user-RsKdjUJuQQFxzHDL95653kdw",
  "username": "dakreekcraft",
  "display_name": "KreekCraft",
  "description": "fake ai roblox streamer",
  "profile_picture_url": "https://videos.openai.com/az/files/00000000-5e00-61f7-ba59-df19e325f0fe%2Fraw?{sas}",
  "profile_picture_file_id": "file_000000005e0061f7ba59df19e325f0fe",
  "is_default_profile_picture": false,
  "can_cameo": true,
  "cameo_count": 446185,
  "character_count": 0,
  "follower_count": 25339,
  "following_count": 2,
  "post_count": 4,
  "remix_count": 987,
  "likes_received_count": 657833,
  "permalink": "https://sora.chatgpt.com/profile/dakreekcraft",
  "calpico_is_enabled": true,
  "sora_who_can_message_me": "followees_only"
}
```

**Profile picture URL split:** Cameo-enabled users (`can_cameo: true`) have their profile picture stored in the **`az/files/{uuid}/raw`** namespace (same as generated video content) — because it doubles as their cameo reference image. The `profile_picture_file_id` is a simple `file_{hex}` ID. Regular users use the `vg-assets` format (see §4.1 Pattern H).

### 11.6 Accessing Cast-In Data from Content

**From drafts:** Scan `profile/drafts/v2` → check `item.creation_config.cameo_profiles`. Each item is a full profile object — store directly.

**From profile posts:** Scan `profile_feed/me` → check `item.post.cameo_profiles`. May be `null` even if the video used cast-in.

**From `initialize_async`:** `composer_profiles: Array(25)` — available cameo profiles for the picker UI. `max_cameos: 3`.

### 11.7 Tests Still Needed

| Test | Action | What to capture |
|------|--------|-----------------|
| **Reference creation** | Upload photo in cast-in UI, mark as character | POST endpoint that creates `ref_` IDs — request/response schema |
| **Cameo profile management** | Navigate to cameo settings in Sora UI | Creation/update endpoint — probed 404s: `/cameo/profiles`, `/cameo/me`, `/characters`, `/cast/profiles`, `/v2/me/cameo` |
| **`cameo_ids` usage** | Investigate if `cameo_ids` field is ever non-null | When/if `cameo_ids` vs @mention is the active path |

---

## 12. Likes & Social Interactions

### 12.1 Data Available on Post Object

All social interaction counters are available on every Post object (§7.3):

| Field | Type | Description |
|-------|------|-------------|
| `like_count` | number | Total likes received |
| `user_liked` | boolean | Whether current user has liked |
| `dislike_count` | number | Total dislikes |
| `user_disliked` | boolean | Whether current user has disliked |
| `repost_count` | number | Times reposted |
| `has_reposted` | boolean | Current user has reposted |
| `share_count` | number | Times shared |
| `view_count` | number | Total views |
| `unique_view_count` | number | Deduplicated views |
| `reply_count` | number | Direct replies |
| `recursive_reply_count` | number | All nested replies |
| `remix_count` | number | Times remixed |

### 12.2 V1 Likes — Collections API ✅ NEW

V1 (image library) uses a **completely separate likes system** via the `/backend/collections/` namespace. This has nothing to do with the v2 `post/{id}/like` endpoint.

#### Like a V1 Generation (Add to Favorites)
```
POST /backend/collections/social_favorites/generations
Body: { "generation_id": "gen_01kn28ke5xebpvt933p4g2hey2" }
```

**Response:**
```json
{
  "id": "collgen_01kn29agbyf7wbprkk82bngyp3",
  "collection_id": "coll_01jn8j5x22f3rv3da5n4t691wp",
  "generation_id": "gen_01kn28ke5xebpvt933p4g2hey2"
}
```

The `collection_id` is a **persistent user-level ID** for the user's `social_favorites` collection. The `collgen_` ID is the individual membership record.

#### Unlike a V1 Generation (Remove from Favorites)
```
DELETE /backend/collections/social_favorites/generations/{gen_id}
Response: HTTP 204 No Content
```

The path param is the **generation ID** (same as the `generation_id` body field used when liking), **not** the `collgen_` membership ID.

#### List V1 Liked Generations
```
GET /backend/collections/social_favorites/generations?limit=10
GET /backend/collections/social_favorites/generations?limit=10&after={gen_id}
```

Offset-paginated with `after={gen_id}` — same pattern as `list_tasks`. Response schema is assumed to be `{ generations: [...], has_more: bool, last_id: string }` following v1 conventions.

**⚠️ Note on sentinel:** Both the POST (like) and DELETE (unlike) are preceded by a `POST /backend-api/sentinel/req` call. Write actions require a valid sentinel token — see §14.

### 12.3 V2 Like/Unlike ✅ CONFIRMED

#### Like a V2 Post
```
POST /backend/project_y/post/{s_id}/like
Body: { "kind": "like" }
```

**Response:** The **full updated Post object** — all 30+ fields including updated `like_count` and `user_liked: true`. Confirmed from HAR: `like_count` increments immediately.

#### Unlike a V2 Post (Strongly Inferred)
```
POST /backend/project_y/post/{s_id}/like
Body: { "kind": "unlike" }
```

**Basis:** The `kind` discriminator pattern (`{ "kind": "like" }`) strongly implies unlike uses the same endpoint with `kind: "unlike"`. The `user_disliked` field on the post object suggests `{ "kind": "dislike" }` also exists. **This is inferred, not HAR-confirmed** — a HAR of actually clicking unlike is still needed.

#### Sentinel requirement
Every like action is preceded by `POST /backend-api/sentinel/req` with `flow: "sora_2_like_post"`. The sentinel token must be obtained before calling the like endpoint or the request will fail.

### 12.4 V2 Liked Posts Feed ✅ UPDATED

**Two confirmed endpoints:**

#### Primary (frontend-observed, HAR-confirmed):
```
GET /backend/project_y/profile/{user_id}/post_listing/likes?limit=8
```
Uses the user's ID from `/v2/me` → `profile.user_id`. This is what Sora's frontend calls when navigating to the likes tab.

#### Secondary (SoraProbe-confirmed):
```
GET /backend/project_y/profile_feed/me?filter=liked&limit=5&cut=nf2
```
Returns `{ items: Array, cursor: string }` — same structure as the regular profile feed. May be an alias or earlier implementation. **Implement both; use the `post_listing/likes` path as primary.**

### 12.5 Tests Still Needed

| Test | Action | What to capture |
|------|--------|-----------------|
| **Unlike a V2 post** | Click like button on a post you've liked | HTTP method, URL, body — confirm `kind: "unlike"` hypothesis |
| **Dislike a post** | Click dislike button | Body — confirm `kind: "dislike"` or different endpoint |
| **Notification of new like** | Have another account like one of your posts | Inspect `/backend/project_y/mailbox` response for like notification object schema |
| **V1 liked feed response** | Scroll the v1 favorites page | Capture full response body of `/collections/social_favorites/generations` with items |

---

## 13. Generation Pipeline

### 13.1 Generation Endpoint ✅ CONFIRMED

```
POST /backend/nf/create
```

**⚠️ This endpoint is under `/backend/nf/` — NOT under `/backend/project_y/`.** It is the same namespace as `nf/pending/v2` and `nf/check`. Requires a valid Cloudflare sentinel token (see §14) — requests without one return HTTP 400.

### 13.2 Full Request Body Schema ✅ CONFIRMED

```json
{
  "kind": "video",
  "prompt": "He says \"Sam Altman promised we can backup our data\"",
  "title": null,
  "orientation": "portrait",
  "size": "small",
  "n_frames": 300,
  "inpaint_items": [],
  "remix_target_id": "s_69c837fa1be88191a4aff04fc97b2ca1",
  "reroll_target_id": null,
  "project_config": null,
  "trim_config": null,
  "metadata": null,
  "use_image_as_first_frame": false,
  "cameo_ids": null,
  "cameo_replacements": null,
  "model": "sy_8",
  "style_id": "high_def",
  "audio_caption": null,
  "audio_transcript": null,
  "video_caption": null,
  "i2v_reference_instruction": null,
  "remix_prompt_template": null,
  "storyboard_id": null
}
```

**Field reference:**

| Field | Type | Notes |
|-------|------|-------|
| `kind` | string | `"video"` for video generation |
| `prompt` | string | Full text prompt including @mentions for cast-in |
| `title` | string/null | Optional title |
| `orientation` | string | `"portrait"` / `"landscape"` / `"square"` |
| `size` | string | Resolution preset: `"small"` / `"medium"` / `"large"` (exact values TBD) |
| `n_frames` | number | Frame count: `300` = 10s at 30fps |
| `inpaint_items` | array | Reference image items: `[{ "kind": "reference", "reference_id": "ref_..." }]` |
| `remix_target_id` | string/null | Post `s_` ID to remix from; null if not a remix |
| `reroll_target_id` | string/null | Post ID to reroll (regenerate); null if not a reroll |
| `cameo_ids` | array/null | **Always null in observed requests** — cast-in uses @mention in prompt instead |
| `cameo_replacements` | array/null | Always null in observed requests |
| `model` | string | Model identifier: `"sy_8"` observed. Format: `sy_{version}` |
| `style_id` | string/null | Style preset ID: `"high_def"`, `"kpop"`, `"cartoon2"`, `"news"`, `"selfie3"`, `"handheld"`, `"animated"`, `"sitcom"` — null if no style |
| `use_image_as_first_frame` | boolean | For image-to-video: use provided image as first frame |
| `audio_caption` | string/null | TBD |
| `audio_transcript` | string/null | TBD |
| `video_caption` | string/null | TBD |
| `i2v_reference_instruction` | string/null | Image-to-video reference instruction |
| `remix_prompt_template` | string/null | TBD — may be used for template-based remixes |
| `project_config` | object/null | TBD |
| `trim_config` | object/null | For video trimming operations |
| `storyboard_id` | string/null | Parent storyboard ID if part of a storyboard |

### 13.3 Generation Flow

```
User submits prompt in Sora UI
       │
       ▼
POST /backend-api/sentinel/req   ← REQUIRED first — get sentinel token
       │
       ▼
POST /backend/nf/create          ← Submit generation with sentinel token
       │                            Returns HTTP 400 if sentinel missing/invalid
       │                            Returns task object on success
       ▼
Task runs asynchronously on OpenAI's GPU cluster
       │
       ▼
GET /backend/nf/pending/v2       ← UI polls every ~2s for task status
       │                            Returns array of in-progress tasks
       │                            Each task has progress_pct (0.0–1.0)
       │                            When complete: generations[] populated
       ▼
New draft appears in GET /backend/project_y/profile/drafts/v2
```

### 13.4 nf/pending/v2 Task Object Schema ✅ CONFIRMED

```json
{
  "id": "task_01kn28krhqf1ham2nx633k7yt6",
  "task_type": "video_gen",
  "status": "running",
  "failure_reason": null,
  "prompt": "...",
  "title": null,
  "progress_pct": 0.4,
  "generations": [],
  "creation_config": {
    "remix_target_post": null,
    "style": {
      "id": "high_def",
      "display_name": "High-def",
      "image_url": "https://cdn.openai.com/sora/images/styles/high_def.jpg",
      "orientation": null
    },
    "inpaint_image": null,
    "reference_inpaint_items": null,
    "prompt": "...",
    "task_id": null,
    "cameo_profiles": [ /* full profile objects for @mentioned users */ ],
    "orientation": "portrait",
    "n_frames": 300,
    "storyboard_id": null,
    "editing_config": null
  }
}
```

When status is `"running"`, `generations` is empty. When complete, it populates with the generation objects (same schema as drafts items). The `creation_config.remix_target_post` is null for original generations and a full `{ post, profile, reposter_profile }` wrapper for remixes.

### 13.5 Supporting Endpoints

```
GET /backend/models?nf2=true     → list available generation models (v2 context)
GET /backend/models              → list available generation models (v1 context, no flag)
GET /backend/parameters          → feature flags (max duration, resolution caps, plan limits)
```

### 13.6 Still TBD

- `size` valid values beyond `"small"` — `"medium"`, `"large"` assumed; exact strings unconfirmed
- Full `model` ID list — `"sy_8"` observed; other versions unknown
- Polling interval — ~2 seconds observed but not measured precisely
- Video extension endpoint for `can_extend` items
- Storyboard creation/management endpoints
- `reroll_target_id` usage — when a reroll (regenerate same prompt) is triggered

---

## 14. Sentinel Authentication for Write Actions ✅ NEW

### 14.1 What Is the Sentinel

Cloudflare's **Turnstile / bot-protection challenge** is embedded in the Sora frontend via `chatgpt.com/backend-api/sentinel/`. All write actions (generation, like, unlike) require a valid sentinel token obtained immediately before the write request. Without it, the API returns **HTTP 400**.

### 14.2 Flow

```
Before any write action:
       │
       ▼
GET  https://chatgpt.com/backend-api/sentinel/sdk.js
GET  https://chatgpt.com/backend-api/sentinel/frame.html?sv={version}
       │
       ▼
POST https://chatgpt.com/backend-api/sentinel/req
Body: { "p": "{base64_challenge_payload}", "id": "{uuid}", "flow": "{action_type}" }
       │
       ▼
Response: { "persona": "chatgpt-noauth", "token": "gAAAAA...{sentinel_token}" }
       │
       ▼
Perform write action (POST /nf/create, POST /post/{id}/like, etc.)
The sentinel token is included automatically as a cookie or request header
```

### 14.3 Observed `flow` Values

| Flow value | Triggered by |
|------------|-------------|
| `sora_2_like_post` | Clicking like on a v2 post |
| `sora_view_tracking` | Viewing a post (view telemetry) |
| `sora_view_detail` | Opening a post detail page |

The generation flow name is not yet captured (the HAR captures the `nf/create` body but not the preceding sentinel's `flow` value).

### 14.4 Implications for SoraVault Desktop V2

SoraVault Desktop V1 and V2 are **read-only tools** (scan + download) — they do not perform write actions. Therefore the sentinel system does not affect SoraVault's core scanning functionality.

**Exception:** If V2 adds social features (auto-liking, following), the sentinel flow would need to be implemented. Electron's native Chromium runtime handles Turnstile challenges transparently when operating in a real BrowserWindow — the sentinel SDK fires automatically during page interactions.

---

## 15. SoraVault.js — Implementation Reference

### 16.1 Architecture

SoraVault.js (v1.0.1) runs as a Tampermonkey userscript injected at `document-start`. It operates in two parallel streams:

```
                    User clicks "Scan"
                         │
              ┌──────────┴───────────┐
              │                      │
              ▼                      ▼
        fetchAllViaApi()        fastScroll()
        (autonomous API calls)   (scroll page → trigger Sora's own fetches)
              │                      │
              │  ingestV1Page()      │  Sora's fetch → intercepted →
              │  ingestV2Page()      │  ingestV1Page() / ingestV2Page()
              │                      │
              └──────────┬───────────┘
                         │
                    collected Map
                    (key: genId or postId)
                         │
                    User clicks "Download"
                         │
                    getDownloadUrl(item)
                    ├── v1: /backend/generations/{genId}/download
                    └── v2: download_urls.no_watermark → fallback: /post/{id}/tree
                         │
                    Parallel workers → FileSystem API or GM_download → Disk
```

### 15.2 Key Behaviors

**Mode detection:** Based on URL path:
- `/library` → v1 (images)
- `/profile` → v2_profile (published videos)
- `/drafts` → v2_drafts (all drafts)

**Header capture:** The fetch wrapper captures not just `oai-device-id` but ALL non-standard headers from v2 API requests. These are stored in `storedV2Headers` and replayed.

**Dual ingestion:** Both the autonomous API scan and the scroll-triggered intercept feed into the same `collected` Map, deduplicated by key (genId for v1/drafts, postId for profile).

**Subfolder routing:**
- v1 images → `soravault_images_library/`
- v2 profile → `soravault_videos_profile/`
- v2 drafts → `soravault_videos_draft/`

**Download methods:**
1. **File System Access API** (Chrome/Edge) — folder picker, direct writes
2. **GM_download** (Tampermonkey fallback) — uses browser download manager

**Speed presets:**
| Level | Workers | Delay |
|-------|---------|-------|
| 0 (default) | 2 | 300ms |
| 1 | 4 | 150ms |
| 2 | 8 | 60ms |

### 15.3 Filter System

SoraVault.js has a comprehensive filter system:
- **Keyword** — comma-separated, must ALL match (AND logic) against prompt
- **Aspect ratio** — chip-based multi-select from detected ratios
- **Date range** — from/to date pickers
- **Quality** — chip-based (v1 only: "high", "standard", etc.)
- **Operation** — chip-based (v1 only: "generate", "edit", etc.)
- **Count** — first N or last N items

### 15.4 TXT Sidecar Format

```
Generation ID  : gen_01xyz...
Task ID        : task_01abc...
Date           : 2025-11-12
Post ID        : s_68f0e9cd...     (v2 only)
Source         : drafts              (v2 only)
Duration       : 5.0s               (v2 only)
Resolution     : 1920 × 1080 px
Aspect ratio   : 16:9
Quality        : high                (v1 only)
Operation      : generate            (v1 only)
Model          : sora-1.0            (v1 only)
Seed           : 1234567890          (v1 only)
Type           : txt2img             (v1 only)
Variants gen.  : 4                   (v1 only)

── Prompt ─────────────────────────────────────────────────
a fox in a moonlit forest
```

---

## 16. SoraVault Desktop V1 — Implementation Reference

### 16.1 Architecture

Electron app with main process (Node.js) + renderer (HTML/CSS/JS). Communication via IPC.

**Current scope:** v1 images only. No v2 video support.

### 16.2 Auth Differences from Userscript

| Aspect | Userscript | Desktop V1 |
|--------|-----------|------------|
| Auth method | Cookie piggyback | JWT Bearer token |
| Token source | Intercepted `oai-device-id` | `/api/auth/session` → `accessToken` |
| Device ID | Captured from Sora | Generated locally (`crypto.randomUUID()`) |
| Token persistence | Session (in-memory) | Settings JSON on disk |
| Token refresh | N/A (session cookie) | **None — must re-login** |
| Login flow | User already logged in to Sora | Opens Sora in BrowserWindow, waits for OAuth |

### 16.3 Token Extraction (Desktop)

After login page loads, the app tries to extract the token at multiple retry intervals (1.5s, 4s, 8s):

```javascript
const res = await fetch('/api/auth/session', { credentials: 'include' });
const data = await res.json();
return data?.accessToken || null;  // JWT starting with "ey..."
```

The JWT is decoded to extract email, user ID, and expiry. Token extraction also fires on `did-navigate` and `did-navigate-in-page` events (Google OAuth redirect flow).

### 16.4 API Calls (Desktop)

Desktop uses raw `https.request()` (Node.js) instead of `fetch()`:
- `httpGet(url, headers)` → returns `{ status, headers, body }` (string)
- `httpGetBuffer(url, headers)` → returns `{ status, body }` (Buffer) — with redirect handling

Handles HTTP 429 with `retry-after` header.

### 16.5 Data Normalization (Desktop)

Desktop normalizes v1 generations into a flat structure:

```json
{
  "gen_id": "gen_01xyz...",
  "task_id": "task_01abc...",
  "date": "2025-11-12",
  "prompt": "...",
  "url": "https://videos.openai.com/...",
  "cf_thumbnail": "...",
  "width": 1024,
  "height": 1024,
  "ratio": "1:1",
  "quality": "high",
  "operation": "generate",
  "model": "sora-1.0",
  "seed": 1234567890,
  "task_type": "txt2img",
  "n_variants": 4,
  "is_favorite": false,
  "is_archived": false,
  "can_download": true,
  "n_frames": 1,
  "like_count": 0,
  "downloaded": true,
  "local_path": "/path/to/file.png"
}
```

**Note:** Desktop V1 captures additional fields not in the userscript: `cf_thumbnail`, `is_favorite`, `is_archived`, `can_download`, `n_frames`, `like_count`.

### 16.6 Index File (Desktop)

After download, Desktop V1 writes an index JSON:

```json
{
  "fetched_at": "2026-03-31T12:00:00.000Z",
  "total": 1800,
  "downloaded": 1795,
  "failed": 5,
  "generations": [ /* array of normalized items */ ]
}
```

### 16.7 Known Bugs / Limitations in Desktop V1

1. **v1 only** — no v2 (video) support at all
2. **No token auto-refresh** — user must re-login when JWT expires
3. **No download resume** — if download is interrupted, must re-download everything
4. **Index written at end** — if app crashes during download, no index is saved
5. **No sync** — `sync:start` IPC handler is a stub returning "Not yet implemented"
6. **Always saves as .png** — no content-type detection
7. **No filter system** — downloads everything (no keyword/date/ratio filters)

---

## 17. SoraVault Desktop V2 — Requirements & Gap Analysis

### 17.1 Feature Requirements (Updated Post-Probe)

| Feature | V1 Status | V2 Target | Probe Status |
|---------|-----------|-----------|--------------|
| v1 image scan | ✅ Working | ✅ Keep | — |
| v1 image download | ✅ Working | ✅ Keep | — |
| v2 drafts scan | ❌ Missing | ✅ Add | ✅ Endpoint + schema confirmed |
| v2 profile scan | ❌ Missing | ✅ Add | ✅ Endpoint + attachment schema confirmed |
| v2 video download | ❌ Missing | ✅ Add | ✅ `downloadable_url` confirmed as primary source |
| Token auto-refresh | ❌ Missing | ✅ Add | ⚠️ Needs page reload, not just re-call session endpoint |
| Download resume | ❌ Missing | ✅ Add | — |
| Incremental sync | ❌ Stub | ✅ Implement | — |
| Filter system | ❌ Missing | ✅ Port from userscript | ✅ `kind` field confirmed for content violation filtering |
| Remix chain data | ❌ Missing | ✅ Add | ✅ `remix_feed` endpoint discovered; `remix_posts` always empty |
| Cast-in data | ❌ Missing | ⚠️ Best-effort | ✅ Schema confirmed — full profile objects |
| Likes data | ❌ Missing | ⚠️ Best-effort | ✅ V1: `collections/social_favorites` (POST/DELETE). V2: `post_listing/likes` + `filter=liked`. Like body `{ "kind": "like" }` confirmed |
| Progressive index writes | ❌ Missing | ✅ Add | — |
| Content-type detection | ❌ Missing | ✅ Add | — |
| Single draft fetch | ❌ Missing | ✅ Add | ✅ `/drafts/v2/{gen_id}` confirmed |
| Following/followers | ❌ Missing | ⚠️ Optional | ✅ `/profile/following` and `/profile/followers` confirmed |
| V1 favorites/likes scan | ❌ Missing | ⚠️ Optional | ✅ `collections/social_favorites/generations` — offset-paginated, full CRUD |
| SRT/VTT subtitle download | ❌ Missing | ⚠️ Optional | ✅ `srt_url`/`vtt_url` populated when `has_captions: true` on attachment |

### 17.2 API Endpoints Needed

| Endpoint | Purpose | Confidence |
|----------|---------|------------|
| `GET /backend/v2/list_tasks` | v1 image scan | ✅ Fully known |
| `GET /backend/v2/recent_tasks` | v1 recent tasks | ✅ Confirmed (HAR batch 2) |
| `GET /backend/generations/{genId}/download` | v1 download URL | ✅ Fully known |
| `GET /backend/collections/social_favorites/generations` | v1 liked items list | ✅ Confirmed (HAR batch 2) |
| `POST /backend/collections/social_favorites/generations` | v1 like | ✅ Confirmed (HAR) — body: `{ generation_id }` |
| `DELETE /backend/collections/social_favorites/generations/{gen_id}` | v1 unlike | ✅ Confirmed (HAR) — HTTP 204 |
| `GET /backend/project_y/profile_feed/me` | v2 profile scan | ✅ Fully known (SoraProbe confirmed) |
| `GET /backend/project_y/profile/{user_id}/post_listing/likes` | v2 liked posts (primary) | ✅ Confirmed (HAR batch 2) |
| `GET /backend/project_y/profile_feed/me?filter=liked` | v2 liked posts (alias) | ✅ Confirmed (SoraProbe) |
| `GET /backend/project_y/profile/drafts/v2` | v2 drafts scan | ✅ Fully known (SoraProbe confirmed) |
| `GET /backend/project_y/profile/drafts/v2/{gen_id}` | v2 single draft fetch | ✅ Confirmed (SoraProbe sniffer) |
| `GET /backend/project_y/post/{id}/tree` | v2 post detail + download URL | ✅ Confirmed — `{ post, profile, reposter_profile, children, cursor }` |
| `GET /backend/project_y/post/{id}` | v2 post detail (no children) | ✅ Confirmed (SoraProbe sniffer) |
| `GET /backend/project_y/post/{id}/remix_feed` | v2 remix listing | ✅ Confirmed (SoraProbe sniffer) |
| `POST /backend/project_y/post/{id}/like` | Like a v2 post | ✅ Confirmed (HAR) — body: `{ "kind": "like" }`, returns full post object |
| `GET /backend/project_y/profile/following` | Following list | ✅ Confirmed (SoraProbe) |
| `GET /backend/project_y/profile/followers` | Followers list | ✅ Confirmed (SoraProbe) |
| `GET /api/auth/session` | Token extraction (NOT refresh) | ✅ Confirmed — same JWT returned on repeat calls |
| `GET /backend/project_y/v2/me` | User profile | ✅ Confirmed — `{ profile, my_info }` |
| `GET /backend/project_y/initialize_async` | Session init / cameo / styles | ✅ Confirmed — 18 top-level keys |
| `GET /backend/project_y/mailbox` | Notifications | ✅ Confirmed — `{ items, cursor }` |
| `POST /backend/project_y/viewed` | View tracking | ✅ Confirmed (HAR) — full body schema in §6.13 |
| `POST /backend/nf/create` | Video generation | ✅ Confirmed (HAR batch 2) — full body schema in §13.2 |

### 17.3 Normalized Data Model for V2

Desktop V2 should normalize all content (v1 + v2) into a unified structure:

```json
{
  "id": "gen_01xyz...",
  "platform": "v1",
  "type": "image",
  
  "gen_id": "gen_01xyz...",
  "task_id": "task_01abc...",
  "post_id": null,
  
  "date": "2025-11-12",
  "created_at": 1731420721.234,
  "prompt": "a fox in a moonlit forest",
  "title": null,
  
  "width": 1024,
  "height": 1024,
  "ratio": "1:1",
  "duration_s": null,
  
  "quality": "high",
  "operation": "generate",
  "model": "sora-1.0",
  "seed": 1234567890,
  "task_type": "txt2img",
  "n_variants": 4,
  "orientation": null,
  
  "download_url": "https://videos.openai.com/...",
  "preview_url": "https://videos.openai.com/...",
  "thumbnail_url": "https://videos.openai.com/...",
  
  "download_urls_raw": {
    "watermark": "...",
    "no_watermark": "...",
    "endcard_watermark": "..."
  },
  
  "encodings_raw": { /* full encodings object */ },
  
  "social": {
    "like_count": 0,
    "view_count": 0,
    "remix_count": 0,
    "share_count": 0,
    "posted_to_public": false,
    "is_featured": false
  },
  
  "remix": {
    "is_remix": false,
    "parent_post_id": null,
    "root_post_id": null,
    "parent_path": [],
    "remix_target_post": null,
    "can_remix": true,
    "has_children": false
  },
  
  "cameo": {
    "cameo_profiles": [],
    "can_create_character": false
  },
  
  "meta": {
    "source": "drafts",
    "visibility": "private",
    "storyboard_id": null,
    "can_extend": false,
    "creation_config_raw": { /* full creation_config */ }
  },
  
  "local": {
    "downloaded": false,
    "local_path": null,
    "downloaded_at": null,
    "file_size": null
  }
}
```

### 17.4 Implementation Priorities (Updated Post-Probe)

1. **P0 — Core scan + download for v2 drafts**
   - Add `fetchAllV2Drafts()` using drafts endpoint
   - Parse draft items into normalized model
   - **⚠️ Use `downloadable_url` as primary download source** — `download_urls.no_watermark` is null on all observed items
   - `encodings.source.path` on `/drafts/v2` items is an internal storage path, NOT a URL — do not use for download
   - Encodings on `nf/pending` task attachments use `path` key but value IS a SAS URL — check `https://` prefix to distinguish

2. **P0 — Core scan + download for v2 profile**
   - Add `fetchAllV2Profile()` using profile_feed endpoint
   - Parse profile items into normalized model
   - **⚠️ Updated fallback chain:** `downloadable_url` → `download_urls.watermark` → tree endpoint
   - Tree endpoint returns `{ post, profile, reposter_profile, children, cursor }` — access via `tree.post.attachments[0]`

3. **P1 — Token auto-refresh**
   - `/api/auth/session` does NOT issue fresh JWTs — same token returned on repeated calls
   - **Must reload the login BrowserWindow** (`webContents.loadURL()`) to trigger new JWT issuance
   - Session cookie lives ~3 months, JWT only ~8 days
   - Check `Date.now() < (expiresAt - 120000)` before each API call

4. **P1 — Progressive index writes**
   - Write index after each page/batch, not only at end
   - Enables resume after crash

5. **P2 — Incremental sync**
   - Load existing index
   - Scan API
   - Diff: new items only
   - Download delta

6. **P2 — Filter system**
   - Port keyword, ratio, date, count filters from userscript
   - New filter option: `kind` — can filter out `"sora_content_violation"` items

7. **P2 — Remix chain enrichment**
   - Parse `creation_config.remix_target_post` and `parent_post_id`
   - **Use `GET /post/{id}/remix_feed`** for downstream remix listing — `remix_posts` array is always empty
   - Optionally fetch parent post for full chain via tree endpoint

8. **P3 — Cast-in / likes data**
   - `cameo_profiles` items are full profile objects (37+ fields) — store directly
   - Cast-in uses @mention in prompt (`cameo_ids: null`) — no separate cameo ID resolution needed
   - Social counters already available on post objects
   - **V1 liked items:** use `GET /collections/social_favorites/generations` — offset-paginated, same pattern as list_tasks
   - **V2 liked posts:** use `GET /profile/{user_id}/post_listing/likes` (primary) or `profile_feed/me?filter=liked` (alias)
   - **V2 like action:** `POST /post/{id}/like` with body `{ "kind": "like" }` — confirmed working
   - **SRT/VTT subtitles:** download `srt_url` and `vtt_url` when `attachment.has_captions === true`

---

## 18. Known Unknowns & Test Plan

### 18.1 Summary Table

| # | Topic | Status | Priority | Result |
|---|-------|--------|----------|--------|
| 1 | `post.attachments[0]` full schema | ✅ Confirmed | **P0** | 22 fields mapped. See §7.4 |
| 2 | Profile feed download URL field name | ✅ Confirmed | **P0** | `download_urls.no_watermark` is **NULL**. Use `downloadable_url`. See §7.6 |
| 3 | `/post/{id}/tree` response body | ✅ Confirmed | **P1** | Single object `{ post, profile, reposter_profile, children, cursor }`. See §6.3 |
| 4 | Token refresh via `/api/auth/session` | ✅ Confirmed | **P1** | Same JWT returned — NO auto-refresh. Need page reload. See §2.3 |
| 5 | `encodings.source` on drafts | ✅ Confirmed | P2 | `path` key = internal path (not URL) on `/drafts/v2`; = SAS URL on `nf/pending` tasks. See §7.5b |
| 6 | `remix_posts` always empty | ✅ Confirmed | P2 | Always null/empty even with remix_count=11. Use `/post/{id}/remix_feed`. See §6.8 |
| 7 | Dedicated remix listing endpoint | ✅ Confirmed | P2 | `GET /post/{id}/remix_feed?cursor=...` confirmed via sniffer. See §6.8 |
| 8 | `remix_target_post` full schema | ✅ Confirmed | P2 | **HAR batch 2**: Full `{ post, profile, reposter_profile }` wrapper — same structure as all other post embeds. See §10.2 |
| 9 | `cameo_profiles` item schema | ✅ Confirmed | P3 | Full 37-field profile object. See §11.5 |
| 10 | Cameo profile creation endpoint | ⚠️ Partial | P3 | `initialize_async` has `composer_profiles` (25) + `max_cameos`. Creation endpoint TBD — probed 404s. See §11.7 |
| 11 | `initialize_async` response body | ✅ Confirmed | P3 | 18 top-level keys. See §6.14 |
| 12 | V2 Like/Unlike endpoint + body | ✅ Confirmed | P3 | **HAR batch 2**: `POST /post/{id}/like` body `{ "kind": "like" }`, returns full Post object. See §12.3 |
| 13 | V2 liked posts endpoint | ✅ Confirmed | P3 | **HAR batch 2**: Primary: `profile/{user_id}/post_listing/likes`. Alias: `profile_feed/me?filter=liked`. See §12.4 |
| 14 | V1 likes/favorites system | ✅ Confirmed | P3 | **HAR batch 2**: Entirely separate `collections/social_favorites` API. POST + DELETE confirmed. See §12.2 |
| 15 | V2 like request body | ✅ Confirmed | P3 | **HAR batch 2**: `{ "kind": "like" }` — sentinel token required first. See §12.3 |
| 16 | Generation endpoint URL + body | ✅ Confirmed | P2 | **HAR batch 2**: `POST /backend/nf/create` — full 19-field body confirmed. See §13.2 |
| 17 | `permissions` object schema | ✅ Confirmed | Low | **HAR batch 2**: `{ can_read, can_write, can_delete, can_remix, share_setting }`. See §7.3a |
| 18 | `srt_url` / `vtt_url` population | ✅ Confirmed | Low | **HAR batch 2**: Populated when `attachment.has_captions === true`. Azure SAS URLs. See §7.3 |
| 19 | `discovery_phrase` and `emoji` | ✅ Confirmed | Low | **HAR batch 2**: Both populated on public posts. See §7.3 |
| 20 | Cast-in @mention mechanism | ✅ Confirmed | P2 | **HAR batch 2**: `cameo_ids: null`, cast-in via @username in prompt. See §11.2 |
| 21 | `inpaint_items` reference cast-in | ✅ Confirmed | P2 | **HAR batch 2**: `{ kind: "reference", reference_id: "ref_..." }` in `inpaint_items`. See §11.3 |
| 22 | vg-assets URL pattern | ✅ Confirmed | Low | **HAR batch 2**: `az/vg-assets/project-y/profile/{user_id}/...#thumbnail.jpeg`. See §4.1H |
| 23 | `unfurl` uses `link_thumbnail` derivative | ✅ Confirmed | Low | **HAR batch 2**: `drvs/link_thumbnail/raw` — separate from `drvs/thumbnail/raw`. See §4.1F |
| 24 | Sentinel required for write actions | ✅ Confirmed | P2 | **HAR batch 2**: `POST /backend-api/sentinel/req` must succeed before nf/create or like. See §14 |
| 25 | `encodings.path` in `nf/pending` = URL | ✅ Confirmed | P2 | **HAR batch 2**: On nf/pending tasks, `path` key holds full SAS URL (unlike drafts). See §7.5b |
| 26 | `parent_post` wrapper structure | ✅ Confirmed | P2 | **HAR batch 2**: Full `{ post, profile, reposter_profile }` wrapper — access via `.parent_post.post`. See §7.3 |
| 27 | Model ID format | ✅ Confirmed | Low | **HAR batch 2**: `"sy_8"` observed. Format: `sy_{version}`. |
| 28 | `size` resolution preset strings | ⚠️ Partial | Low | **HAR batch 2**: `"small"` observed. `"medium"`, `"large"` assumed — not confirmed. |
| 29 | `viewed` request body | ✅ Confirmed | Low | **HAR batch 2**: `{ rich_views: { views: [{ id, first_view_time, exit_view_time, loop_count, watch_time, dwell_time, ... }] } }`. See §6.13 |
| 30 | V1 notifications system (`/backend/notif`) | ✅ Confirmed | Low | **HAR batch 2**: Separate from v2 nf endpoints. Reverse pagination `before={task_id}`. |
| 31 | `remix_target_post` null vs not-null | ✅ Confirmed | P2 | **HAR batch 2**: `null` on non-remix tasks; full post wrapper on remix tasks. Two live examples observed. |
| 32 | Follow/Unfollow action endpoints | 🔲 TBD | Low | GET confirmed for lists; POST follow action not captured |
| 33 | Reply endpoint and thread structure | 🔲 TBD | Low | Not tested |
| 34 | Public user feed (other users) | 🔲 TBD | Low | Not tested |
| 35 | Search / discovery feed | 🔲 TBD | Low | Not tested |
| 36 | Storyboard creation/management | 🔲 TBD | Low | Not tested |
| 37 | Video extend endpoint | 🔲 TBD | Low | Not tested |
| 38 | `unwrap` object purpose | ✅ Confirmed | Low | `{ kind: "winter_2025" }` — seasonal/promotional campaign tag |
| 39 | `shot_data` schema | ⏭️ Skipped | Low | No storyboard items captured |
| 40 | Rate limiting behavior | ⚠️ Partial | P2 | No 429 after 5 rapid requests. No rate-limit headers present. |
| 41 | WebSocket / SSE for real-time | ⚠️ Partial | Low | Cannot inspect from userscript. Needs DevTools WS tab. |
| 42 | `visibility` valid values | ✅ Confirmed | Low | **HAR batch 2**: Use `permissions.share_setting` instead — `"public"` / `"private"` / `"unlisted"`. `visibility` field remains null. |
| 43 | `kind` field values on draft items | ✅ Confirmed | Low | `"sora_draft"`, `"sora_content_violation"` |
| 44 | `generation_type` field values | ✅ Confirmed | Low | `"video_gen"`, `"editor_stitch"` (HAR batch 2) — null on some older items |

### 18.1a New Endpoints Discovered

**From SoraProbe sniffer (batch 1, 2026-03-31):**

| Endpoint | Method | Discovered On | Notes |
|----------|--------|---------------|-------|
| `/backend/project_y/post/{id}/remix_feed` | GET | `/p/` page | Dedicated remix listing, cursor-paginated |
| `/backend/project_y/post/{id}` | GET | `/p/` page | Single post fetch (without `/tree`) |
| `/backend/project_y/profile/drafts/v2/{gen_id}` | GET | `/d/` page | Individual draft fetch by ID |
| `/backend/project_y/viewed` | POST | `/p/` page | View tracking telemetry |
| `/backend/authenticate` | GET | Page load | Session validation (fires every load) |
| `/backend/nf/check` | GET | Page load | Marks notifications as seen |

**From HAR batch 2 (2026-03-31):**

| Endpoint | Method | Discovered In | Notes |
|----------|--------|---------------|-------|
| `/backend/nf/create` | POST | Remix + Cast-In HAR | **Generation endpoint** — full 19-field body schema confirmed. See §13.2 |
| `/backend/collections/social_favorites/generations` | GET / POST | V1 Like HAR | V1 favorites — list, add (body: `{ generation_id }`), confirmed 200 |
| `/backend/collections/social_favorites/generations/{gen_id}` | DELETE | V1 Like HAR | V1 unlike — HTTP 204 |
| `/backend/collections?limit=100` | GET | V1 Like Page HAR | List all collections metadata |
| `/backend/notif?limit=10` | GET | V1 Like Page HAR | V1 notification system — reverse pagination `before={task_id}` |
| `/backend/v2/recent_tasks?limit=20&before={task_id}` | GET | V1 Like Page HAR | Reverse-paginated task list — separate from `list_tasks` |
| `/backend/presets` | GET | V1 Like Page HAR | V1 generation presets |
| `/backend/status` | GET | V1 Like Page HAR | Platform operational status |
| `/backend/views` | POST | V1 Like Page HAR | V1 view tracking (counterpart to v2's `project_y/viewed`) |
| `/backend/project_y/profile/{user_id}/post_listing/likes` | GET | V2 Like Profile HAR | Actual liked-posts tab endpoint used by frontend |
| `https://chatgpt.com/backend-api/sentinel/req` | POST | All write action HARs | Cloudflare Turnstile challenge — required before any write |

### 18.2 HAR Test Protocol

To fill in the unknowns, use this repeatable process:

1. Open Chrome DevTools → Network tab
2. Check "Preserve log"
3. Perform the specific action (see "How to Test" column)
4. Filter network log by `backend/`
5. For each new endpoint:
   - Document: URL, HTTP method, request headers, request body
   - Document: Response status, response headers, response body (full JSON)
6. For existing endpoints with new data:
   - Compare against documented schema
   - Note new fields, changed types, or missing fields
7. Update this document with findings

### 18.3 Structured HAR Test for Remix Chain ✅ COMPLETE

**✅ Test 1: "What was this remixed FROM?" — CONFIRMED (HAR batch 2)**
  - `creation_config.remix_target_post` is a full `{ post, profile, reposter_profile }` wrapper — confirmed from `nf/pending/v2` response on running remix task
  - `parent_post_id` and `root_post_id` confirmed on the embedded post (both point to root for one-level remix)
  - `parent_post` on the Post object is also a full `{ post, profile, reposter_profile }` wrapper — access via `.parent_post.post.id`
  - `parent_path` is an array of ancestor s_IDs (e.g. `["s_69c82a36..."]` for one-level remix)

**✅ Test 2: "What remixes exist OF this post?" — CONFIRMED (SoraProbe)**
  - `remix_posts` is always `null` or `[]` in all feed/tree responses, even with `remix_count: 12`
  - Use `GET /backend/project_y/post/{id}/remix_feed?cursor=...` — cursor-paginated

**✅ Test 3: "Can I download the original of a remix?" — CONFIRMED**
  - `remix_target_post.post.attachments[0].downloadable_url` is fully populated — direct Azure SAS URL

**✅ Test 4: Remix generation request body — CONFIRMED (HAR batch 2)**
  - Use `remix_target_id: "{s_id}"` in the `nf/create` body — NOT a nested object
  - `cameo_ids` is null even for cast-in remixes — @mention handles it in prompt

**Still TBD:**
  - Multi-level chain (3+ levels) — confirm `root_post_id` stays fixed and `parent_path` grows
  - `ancestors` array — confirmed null in most contexts; when (if ever) is it populated?

### 18.4 Structured HAR Test for Cast-In ✅ MOSTLY COMPLETE

**✅ Test 1: "What cameo profiles are on my content?" — CONFIRMED (HAR batch 2)**
  - Found in `nf/pending/v2` task `creation_config.cameo_profiles` (live, running tasks)
  - Also in `drafts.creation_config.cameo_profiles` on completed drafts
  - Each item is a full 37-field profile object with live stats (`cameo_count`, `can_cameo`, etc.)

**✅ Test 2: "How are cameo subjects specified?" — CONFIRMED (HAR batch 2)**
  - Mechanism A: `@username` in prompt text — `cameo_ids: null`, server resolves internally
  - Mechanism B: `inpaint_items: [{ kind: "reference", reference_id: "ref_..." }]` — for uploaded reference photos
  - `max_cameos: 3` per generation (from `initialize_async`)

**✅ Test 3: "My own cameo profile" — CONFIRMED**
  - `initialize_async` returns `composer_profiles: Array(25)` — picker tiles
  - `/v2/me` returns `profile.can_cameo`, `profile.cameo_count`, `profile.character_count`

**Still TBD:**
  - Reference object creation endpoint — the POST that generates `ref_` IDs before generation
  - Cameo profile management endpoint — probed 404s: `/cameo/profiles`, `/cameo/me`, `/characters`, `/cast/profiles`, `/v2/me/cameo`

### 18.5 Structured HAR Test for Likes ✅ MOSTLY COMPLETE

**✅ Test 1: "Like a V2 post" — CONFIRMED (HAR batch 2)**
  - `POST /backend/project_y/post/{id}/like` with body `{ "kind": "like" }`
  - Returns full updated Post object (`user_liked: true`, incremented `like_count`)
  - Requires sentinel token from `POST /backend-api/sentinel/req` with `flow: "sora_2_like_post"` first

**✅ Test 2: "Like a V1 generation" — CONFIRMED (HAR batch 2)**
  - `POST /backend/collections/social_favorites/generations` with body `{ "generation_id": "gen_01..." }`
  - Returns `{ id: "collgen_...", collection_id: "coll_...", generation_id: "gen_..." }`
  - Unlike: `DELETE /backend/collections/social_favorites/generations/{gen_id}` → HTTP 204

**✅ Test 3: "View my V2 liked posts" — CONFIRMED**
  - Primary: `GET /backend/project_y/profile/{user_id}/post_listing/likes?limit=8`
  - Alias: `GET /backend/project_y/profile_feed/me?filter=liked&limit=5&cut=nf2`
  - Both cursor-paginated, same `{ items, cursor }` structure as profile feed

**✅ Test 4: "View my V1 liked items" — CONFIRMED (HAR batch 2)**
  - `GET /backend/collections/social_favorites/generations?limit=10&after={gen_id}`
  - Offset-paginated with `after=` — same pattern as `list_tasks`

**Still TBD:**
  - **V2 unlike** — confirm `{ "kind": "unlike" }` body hypothesis
  - **V2 dislike** — confirm `{ "kind": "dislike" }` body hypothesis  
  - **Like notification object** — mailbox schema for like events
  - **V1 liked feed response schema** — full response body not captured (response bodies not present in v1 like page HAR for `social_favorites` calls)

---

## Appendix A: Filename Template Tokens

Both SoraVault.js and Desktop V1 support these tokens:

| Token | Source | v1 | v2 |
|-------|--------|----|----|
| `{date}` | ISO date (YYYY-MM-DD) | ✅ | ✅ |
| `{prompt}` | Slugified prompt | ✅ | ✅ |
| `{genId}` | Generation ID | ✅ | ✅ (or postId) |
| `{taskId}` | Task ID | ✅ | ⚠️ (may be empty) |
| `{width}` | Pixel width | ✅ | ✅ |
| `{height}` | Pixel height | ✅ | ✅ |
| `{ratio}` | Aspect ratio (e.g. "16x9") | ✅ | ✅ |
| `{quality}` | Quality tier | ✅ | ❌ (not in v2) |
| `{operation}` | Operation type | ✅ | ❌ (not in v2) |
| `{model}` | Model name | ✅ | ❌ (not in v2) |
| `{seed}` | Generation seed | ✅ | ❌ (not in v2) |
| `{duration}` | Video duration | ❌ | ✅ |

---

## Appendix B: Domain Allowlist

SoraVault needs network access to these domains:

| Domain | Purpose |
|--------|---------|
| `sora.chatgpt.com` | All API calls |
| `videos.openai.com` | Media downloads (Azure Blob Storage) |
| `api.github.com` | Version check + donors list |
| `ogimg.chatgpt.com` | OG preview images (not used for download) |
| `sora-cdn.oaistatic.com` | Static assets (CSS, JS, fonts) |

---

## Appendix C: Error Handling Reference

| HTTP Code | Meaning | Action |
|-----------|---------|--------|
| 200 | Success | Process response |
| 206 | Partial Content | Stream/range request success (Azure videos) |
| 401 | Unauthorized | Token expired → re-login |
| 403 | Forbidden | Session invalid or device ID mismatch |
| 429 | Rate Limited | Wait `retry-after` seconds, then retry |
| 500+ | Server Error | Retry with backoff |

---

*SoraProbe v1.0 automated testing (2026-03-31) resolved 17 of the original 29 known unknowns and discovered 6 new endpoints. HAR batch 2 manual capture (2026-03-31) resolved 17 further items, confirmed the complete generation endpoint + body schema, discovered the V1 collections/likes system, confirmed cast-in mechanisms, and corrected the liked-posts endpoint. Running total: 44 items tracked, 37 confirmed, 7 remaining TBD.*

*This document is the foundation for SoraVault Desktop V2. All confirmed schemas come from SoraVault.js v1.0.1 runtime observations, SoraVault Desktop V1 codebase analysis, SoraProbe v1.0 automated API probing, and manual HAR capture (Cast-In, Likes, Remixes — 2026-03-31).*
