# soravdl.com Proxy API — Response Reference

## Endpoint

```
GET https://soravdl.com/api/proxy/video/{videoId}
Headers: Accept: video/*,*/*;q=0.8
```

`videoId` must match `/^s_[A-Za-z0-9_-]+$/` — invalid formats get an instant 404 without hitting upstream.

---

## Fetch Pattern (with message extraction)

```js
async function fetchProxyResponse(videoId) {
    const url = `https://soravdl.com/api/proxy/video/${encodeURIComponent(videoId)}`;
    let response;
    try {
        response = await fetch(url, { headers: { accept: 'video/*,*/*;q=0.8' } });
    } catch (e) {
        // Network error (offline, CORS block, DNS failure)
        return { ok: false, status: 0, message: e.message };
    }

    if (!response.ok) {
        // Read the JSON error body — soravdl always returns { error, message }
        let message = `HTTP ${response.status}`;
        try {
            const json = await response.json();
            message = json.message || json.error || message;
        } catch (_) {}
        return { ok: false, status: response.status, message };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    return { ok: true, status: 200, bytes };
}
```

---

## Known Responses

| Status | When | JSON body |
|--------|------|-----------|
| `200`  | Video fetched OK | Binary MP4/WebM (no JSON) |
| `404`  | Invalid video ID format | `{"message":"The route api/proxy/video/… could not be found."}` |
| `405`  | Wrong HTTP method | `{"message":"The POST method is not supported… Supported methods: GET, HEAD."}` |
| `408`  | **soravdl's upstream (Sora) timed out** | `{"error":"Request timeout","message":"External source did not respond in time."}` |
| `429`  | Rate limited (60 req/min) | Laravel default; check `retry-after` header |
| `5xx`  | soravdl server error | Varies |

**Timing note:** soravdl's internal timeout is ~5–6 s. Each 408 response takes that long, so retrying multiplies dead wait.

---

## 408 Handling — Fast-Disable

A 408 means Sora's servers are not responding fast enough for soravdl's proxy. This is **session-wide** — every video will 408, not just this one.

**Do NOT retry on 408.** Instead, disable the proxy immediately and fall back to direct downloads.

Without this, the worst case is:

```
6 retries × 6 s timeout + backoff delays = ~48 s per video
3 videos × 48 s = ~144 s of dead wait before proxy is disabled
```

With fast-disable on first 408: ~5 s total, then direct downloads for all remaining videos.

```js
if (status === 408) {
    disableProxyForSession();
    log('Watermark proxy unavailable (Sora upstream timeout); switching to direct downloads');
    return fallbackToDirectDownload();
}
```

---

## Rate Limits

Response headers on every request:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: N
```

Respect `retry-after` header on 429. Use exponential backoff. In SoraVault, `WATERMARK_FETCH_MAX_ATTEMPTS` handles this for non-408 retryable statuses.
