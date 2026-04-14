/**
 * SoraVault 2.0 — content.js
 * Chrome Extension port of the Tampermonkey userscript.
 *
 * Runs in MAIN world so it can intercept window.fetch and window.XMLHttpRequest.
 * Asset URLs are resolved via the bridge.js meta tag injection.
 *
 * Original: https://github.com/charyou/SoraVault
 * Author: Sebastian Haas (charyou)
 * License: © 2026 Sebastian Haas – Personal use only; no redistribution or resale.
 */
(function () {
    'use strict';

    // =====================================================================
    // CHROME EXTENSION — resolve asset URL via bridge meta tag
    // =====================================================================
    const _EXT_BASE = document.querySelector('meta[name="soravault-ext-base"]')?.content ?? '';
    const LOGO_URL = _EXT_BASE
        ? _EXT_BASE + 'assets/soravault-logo-square.png'
        : `https://raw.githubusercontent.com/charyou/SoraVault/main/assets/soravault-logo-square.png`;

    // =====================================================================
    // CONFIG & RELEASE INFO
    // =====================================================================
    const VERSION      = '2.0.0';
    const RELEASE_DATE = '2026-04-01';
    const GITHUB_REPO  = 'charyou/SoraVault';
    const SORA_SHUTDOWN = new Date('2026-04-26T00:00:00Z');

    const CFG = {
        PARALLEL_DOWNLOADS: 2,
        DOWNLOAD_TXT:       true,
        FILENAME_TEMPLATE:  '{date}_{prompt}_{genId}',
        PROMPT_MAX_LEN:     80,
        BEARER_TOKEN:       '', // <-- You can paste your "eyJ..." token here if you want to hardcode it
    };

    // =====================================================================
    // SCAN SOURCES  — single source of truth for all source-aware logic
    // =====================================================================
    const SCAN_SOURCES = [
        { id: 'v1_library', icon: '📷', label: 'Library',  sub: 'V1 image library',    group: 'v1' },
        { id: 'v1_liked',   icon: '♡',  label: 'Likes',    sub: 'V1 favorites',         group: 'v1' },
        { id: 'v2_profile', icon: '🎬', label: 'Videos',   sub: 'V2 published posts',   group: 'v2' },
        { id: 'v2_drafts',  icon: '📋', label: 'Drafts',   sub: 'V2 all generated',     group: 'v2' },
        { id: 'v2_liked',   icon: '♡',  label: 'Liked',    sub: 'V2 liked videos',      group: 'v2' },
    ];

    // Per-category subfolder names — keyed by source ID
    const SUBFOLDERS = {
        v1_library: 'sora_v1_images',
        v1_videos:  'sora_v1_videos',
        v1_liked:   'sora_v1_liked',
        v2_profile: 'sora_v2_profile',
        v2_drafts:  'sora_v2_drafts',
        v2_liked:   'sora_v2_liked',
    };

    const SPEED_PRESETS = [
        { workers: 2, delay: 300 },
        { workers: 4, delay: 150 },
        { workers: 8, delay:  60 },
    ];

    const SCAN_STORIES = [
        { icon: '🎬', text: 'I started with Sora when it first dropped. Hundreds of prompts, late nights, that one image that randomly got 1,000+ likes. All of that matters.' },
        { icon: '💾', text: 'OpenAI\'s "export"? A full ChatGPT data dump. ZIP link valid 24 hours. Good luck finding your Sora files in 3 years of chat history.' },
        { icon: '🔍', text: 'Some prompts took hours to get right. The wording, the style, the weird happy accidents. That\'s not data. That\'s your creative memory.' },
        { icon: '⏳', text: 'I built SoraVault in a weekend because I refused to lose 1,800+ images I actually cared about. Turns out I\'m not the only one.' },
        { icon: '🏛️', text: 'The live-action Naruto. The fake movie poster. The memes that made my friends cry laughing. No expiring ZIP is taking that from me.' },
        { icon: '🔐', text: 'Everything goes straight to your hard drive. No cloud, no account, no tracking. Your files, your folder, done.' },
        { icon: '💡', text: 'After this: filters let you pick by date, keyword, or aspect ratio. Download everything or just the gems.' },
        { icon: '🧡', text: 'This tool is free. If it saves your library, a coffee or a GitHub star is the best way to say thanks.' },
    ];

    // =====================================================================
    // STATE
    // =====================================================================
    const collected        = new Map();
    let oaiDeviceId        = null;
    let oaiLanguage        = 'en-US';
    const storedV2Headers  = {};
    let isRunning          = false;
    let stopRequested      = false;
    let completedCount     = 0;
    let failedCount        = 0;
    let totalToDownload    = 0;
    let speedIdx           = 0;
    let uiState            = 'init';
    let scanStoryTimer     = null;
    let scanStoryIdx       = 0;
    let lastSaveTxt        = false;
    let lastSaveMedia      = true;
    let lastSaveJSON       = false;
    let lastFilterSnap     = [];
    let dlMethod           = 'fs';
    let baseDir            = null;
    let cachedUserId       = null;

    // Geo-blocking
    let isV2Supported      = true;
    let geoCheckInitDone   = false;

    // Source enable/disable state — all enabled by default
    const enabledSources = new Set(SCAN_SOURCES.map(s => s.id));

    // Per-source scan status
    const srcStatus = {};
    SCAN_SOURCES.forEach(s => { srcStatus[s.id] = 'idle'; });

    const filters = {
        keyword: '', ratios: new Set(), dateFrom: '', dateTo: '',
        qualities: new Set(), operations: new Set(), nItems: '', nDirection: 'last',
        authorExclude: '',   // exclude by author (likes); empty = no filter
    };

    // =====================================================================
    // UTILITIES
    // =====================================================================
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

    function shutdownDaysDelta() {
        const now  = new Date();
        const diff = Math.round((now - SORA_SHUTDOWN) / 86400000);
        return diff;
    }

    // =====================================================================
    // FETCH INTERCEPT  — captures auth headers from Sora's own requests
    // =====================================================================
    const _fetch = window.fetch.bind(window);

    window.fetch = async function (...args) {
        const [resource, options] = args;
        const url  = typeof resource === 'string' ? resource : (resource?.url ?? '');
        const hdrs = options?.headers ?? {};
        const getH = n => {
            if (hdrs instanceof Headers) return hdrs.get(n);
            const k = Object.keys(hdrs).find(k => k.toLowerCase() === n.toLowerCase());
            return k ? hdrs[k] : null;
        };
        const devId = getH('oai-device-id'), lang = getH('oai-language');
        if (devId) { oaiDeviceId = devId; refreshAuthBadge(); }
        if (lang)  oaiLanguage = lang;

        if (url.includes('/backend/project_y/')) {
            const SKIP = new Set(['content-type','accept-encoding','accept-language',
                                  'cache-control','pragma','origin','content-length']);
            const keys = hdrs instanceof Headers ? [...hdrs.keys()] : Object.keys(hdrs || {});
            keys.forEach(k => {
                if (!SKIP.has(k.toLowerCase())) {
                    const v = getH(k);
                    if (v) storedV2Headers[k.toLowerCase()] = v;
                }
            });
        }

        const response = await _fetch(...args);
        if (response.ok) {
            if (url.includes('/list_tasks'))
                response.clone().json().then(d => ingestV1Page(d, 'v1_library')).catch(() => {});
            else if (url.includes('/backend/project_y/profile_feed/'))
                response.clone().json().then(d => ingestV2Page(d, url, 'v2_profile')).catch(() => {});
            else if (url.includes('/backend/project_y/profile/drafts/v2'))
                response.clone().json().then(d => ingestV2Page(d, url, 'v2_drafts')).catch(() => {});
        }
        return response;
    };

    // XHR intercept (same auth capture)
    const _xhrOpen = window.XMLHttpRequest.prototype.open;
    const _xhrSend = window.XMLHttpRequest.prototype.send;
    const _xhrSetH = window.XMLHttpRequest.prototype.setRequestHeader;
    window.XMLHttpRequest.prototype.setRequestHeader = function (n, v) {
        if (n?.toLowerCase() === 'oai-device-id') { oaiDeviceId = v; refreshAuthBadge(); }
        if (n?.toLowerCase() === 'oai-language')  oaiLanguage = v;
        if (this._sv_url && this._sv_url.includes('/backend/project_y/')) {
            const SKIP = new Set(['content-type','accept-encoding','accept-language',
                                  'cache-control','pragma','origin','content-length']);
            if (!SKIP.has(n?.toLowerCase())) storedV2Headers[n.toLowerCase()] = v;
        }
        return _xhrSetH.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.open = function (m, u, ...r) {
        this._sv_url = u || '';
        return _xhrOpen.apply(this, [m, u, ...r]);
    };
    window.XMLHttpRequest.prototype.send = function (...a) {
        if ((this._sv_url || '').includes('/list_tasks'))
            this.addEventListener('load', function () {
                if (this.status === 200) try { ingestV1Page(JSON.parse(this.responseText), 'v1_library'); } catch(e) {}
            });
        return _xhrSend.apply(this, a);
    };

    // =====================================================================
    // DATA INGESTION — V1 (Images + Videos)
    // =====================================================================
    function ingestV1Page(data, sourceId = 'v1_library') {
        const tasks = data?.task_responses ?? data?.tasks ?? [];
        if (!Array.isArray(tasks)) return { hasMore: false, lastId: null };
        let added = 0;
        tasks.forEach(task => {
            const prompt    = task.prompt ?? '';
            const date      = (task.created_at ?? '').slice(0, 10);
            const taskId    = task.id ?? '';
            const nVariants = task.n_variants ?? 1;
            (task.generations ?? []).forEach(gen => {
                const genId = gen.id ?? '';
                if (!genId || collected.has(genId)) return;
                if (gen.deleted_at) return;
                if (gen.download_status && gen.download_status !== 'ready') return;
                const previewUrl = (gen.url ?? '').replace(/&amp;/g, '&');
                const gw = gen.width  ?? task.width  ?? null;
                const gh = gen.height ?? task.height ?? null;
                let ratio = null;
                if (gw && gh) { const g = gcd(gw, gh); ratio = `${gw/g}:${gh/g}`; }
                const taskType = (gen.task_type ?? task.type ?? '').toLowerCase();
                const isVideo  = taskType.includes('vid') || (gen.n_frames ?? 1) > 1;
                collected.set(genId, {
                    mode: 'v1', source: sourceId, genId, taskId, date, prompt,
                    pngUrl: previewUrl,
                    width: gw, height: gh, ratio,
                    quality:   gen.quality   ?? task.quality   ?? null,
                    operation: gen.operation ?? task.operation ?? null,
                    model:     gen.model     ?? task.model     ?? null,
                    seed:      gen.seed      ?? null,
                    taskType,
                    nVariants,
                    isVideo,
                    _raw: { task_id: taskId, task_prompt: prompt, ...gen },
                });
                added++;
            });
        });
        if (added > 0) { log(`+${added} → ${collected.size} total`); refreshScanCount(); }
        return { hasMore: data.has_more === true, lastId: data.last_id ?? null };
    }

    // =====================================================================
    // DATA INGESTION — V1 Liked
    // =====================================================================
    function ingestV1LikedPage(data) {
        const items = data?.data;
        if (!Array.isArray(items)) return { hasMore: false, lastId: null };

        let added = 0;
        items.forEach(gen => {
            const genId = gen.id ?? '';
            if (!genId || collected.has(genId)) return;
            if (gen.deleted_at) return;
            if (gen.download_status && gen.download_status !== 'ready') return;
            if (!gen.url) return;

            const previewUrl = gen.url.replace(/&amp;/g, '&');
            const gw = gen.width  ?? null;
            const gh = gen.height ?? null;
            let ratio = null;
            if (gw && gh) { const g = gcd(gw, gh); ratio = `${gw/g}:${gh/g}`; }

            const taskType = (gen.task_type ?? '').toLowerCase();
            const isVideo  = taskType.includes('vid') || (gen.n_frames ?? 1) > 1;
            const author   = gen.user?.username ?? null;

            collected.set(genId, {
                mode: 'v1', source: 'v1_liked', genId,
                taskId:    gen.task_id    ?? '',
                date:      (gen.created_at ?? '').slice(0, 10),
                prompt:    gen.prompt     ?? '',
                pngUrl:    previewUrl,
                width: gw, height: gh, ratio,
                quality:   gen.quality   ?? null,
                operation: gen.operation ?? null,
                model:     gen.model     ?? null,
                seed:      gen.seed      ?? null,
                taskType,
                nVariants: gen.n_variants ?? 1,
                isVideo,
                author,
                likeCount: gen.like_count    ?? null,
                canDownload: gen.can_download ?? null,
                _raw: gen,
            });
            added++;
        });

        if (added > 0) { log(`+${added} v1 liked → ${collected.size} total`); refreshScanCount(); }

        const hasMore = data.has_more === true;
        const lastId  = data.last_id ?? null;
        return { hasMore: hasMore && !!lastId, lastId };
    }

    // =====================================================================
    // DATA INGESTION — V2 (Videos / Profile + Drafts + Liked)
    // =====================================================================
    function ingestV2Page(data, url, sourceId) {
        const isDrafts = sourceId === 'v2_drafts' ||
                         (!sourceId && url && url.includes('/profile/drafts/'));
        const effectiveSource = sourceId ?? (isDrafts ? 'v2_drafts' : 'v2_profile');
        const items = data?.items ?? [];
        if (!Array.isArray(items)) return { hasMore: false, nextCursor: null };
        let added = 0;

        const check = (v, label) => {
            if (v && typeof v === 'string' && v.trim()) {
                console.log('✅ Treffer:', label);
                return v;
            }
            return undefined;
        };

        items.forEach(item => {
            if (isDrafts) {
                const genId = item.id ?? item.generation_id ?? '';
                if (item.kind === 'sora_error' || item.kind === 'sora_content_violation') return;
                if (!genId || collected.has(genId)) return;
                const date = item.created_at
                    ? new Date(item.created_at * 1000).toISOString().slice(0, 10) : '';
                const dlUrl = check(item.encodings?.source?.path, "Encodings Source")
                           ?? check(item.downloadable_url, "Downloadable URL")
                           ?? check(item.download_urls?.watermark, "Watermark URL")
                           ?? check(item.url, "Standard URL")
                           ?? null;
                console.log("Final ausgewählt (Draft):", dlUrl);
                const downloadUrl = dlUrl?.trim() ? dlUrl : null;
                const thumb = item.encodings?.thumbnail;
                const thumbUrl = thumb && typeof thumb === 'object' ? (thumb.url ?? null)
                               : (typeof thumb === 'string' ? thumb : null);
                const gw = item.width ?? null, gh = item.height ?? null;
                let ratio = null;
                if (gw && gh) { const g = gcd(gw, gh); ratio = `${gw/g}:${gh/g}`; }
                collected.set(genId, {
                    mode: 'v2', source: effectiveSource, genId,
                    taskId: item.task_id ?? '', postId: null,
                    date, prompt: item.prompt ?? item.title ?? '',
                    downloadUrl, previewUrl: item.url ?? null, thumbUrl,
                    width: gw, height: gh, ratio,
                    duration: item.duration_s ?? null, model: null,
                    _raw: item,
                });
                added++;
            } else {
                const post = item.post;
                if (!post) return;
                const postId = post.id ?? '';
                if (!postId || collected.has(postId)) return;
                const date = post.posted_at
                    ? new Date(post.posted_at * 1000).toISOString().slice(0, 10)
                    : (post.updated_at
                        ? new Date(post.updated_at * 1000).toISOString().slice(0, 10) : '');
                const att = (post.attachments ?? [])[0] ?? {};
                const encSrc = att.encodings?.source;
                const encSrcUrl = encSrc && typeof encSrc === 'object' ? (encSrc.url ?? null)
                                : (typeof encSrc === 'string' ? encSrc : null);
                const attUrl = check(att.encodings?.source?.path, "Encodings Source")
                            ?? check(att.downloadable_url, "Downloadable URL")
                            ?? check(att.download_urls?.watermark, "Watermark URL")
                            ?? check(encSrcUrl, "Encodings Source URL")
                            ?? check(att.url, "Standard URL")
                            ?? null;
                console.log("Final ausgewählt (Profile):", attUrl);
                const downloadUrl = attUrl?.trim() ? attUrl : null;
                const gw = att.width ?? null, gh = att.height ?? null;
                let ratio = null;
                if (gw && gh) { const g = gcd(gw, gh); ratio = `${gw/g}:${gh/g}`; }
                collected.set(postId, {
                    mode: 'v2', source: effectiveSource,
                    genId:    att.id ?? att.generation_id ?? postId,
                    taskId:   att.task_id ?? null,
                    postId,
                    date, prompt: post.text ?? post.caption ?? '',
                    downloadUrl, previewUrl: att.url ?? null,
                    thumbUrl: post.preview_image_url ?? null,
                    width: gw, height: gh, ratio,
                    duration: att.duration_s ?? null, model: null,
                    isLiked:  post.user_liked === true,
                    _raw: { post, profile: item.profile },
                });
                added++;
            }
        });

        if (added > 0) { log(`+${added} → ${collected.size} total`); refreshScanCount(); }
        const nextCursor = data.cursor ?? null;
        return { hasMore: nextCursor != null, nextCursor };
    }

    function refreshScanCount() {
        const el = document.getElementById('sdl-scan-count');
        if (el) el.textContent = collected.size;
    }

    // =====================================================================
    // FILTER ENGINE
    // =====================================================================
    function getFilteredItems() {
        let result = [...collected.values()];
        if (filters.keyword.trim()) {
            const terms = filters.keyword.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
            result = result.filter(i => terms.every(t => (i.prompt || '').toLowerCase().includes(t)));
        }
        if (filters.authorExclude.trim()) {
            const needle = filters.authorExclude.trim().toLowerCase();
            result = result.filter(i => (i.author ?? '').toLowerCase() !== needle);
        }
        if (filters.ratios.size     > 0) result = result.filter(i => i.ratio     && filters.ratios.has(i.ratio));
        if (filters.qualities.size  > 0) result = result.filter(i => i.quality   && filters.qualities.has(i.quality));
        if (filters.operations.size > 0) result = result.filter(i => i.operation && filters.operations.has(i.operation));
        if (filters.dateFrom) result = result.filter(i => i.date >= filters.dateFrom);
        if (filters.dateTo)   result = result.filter(i => i.date <= filters.dateTo);
        const n = parseInt(filters.nItems);
        if (!isNaN(n) && n >= 1)
            result = filters.nDirection === 'last' ? result.slice(0, n) : result.slice(-n);
        return result;
    }

    function getDistinctValues(key) {
        const vals = new Set();
        collected.forEach(item => { if (item[key]) vals.add(item[key]); });
        return [...vals].sort();
    }

    function getDistinctValuesByMode(key, mode) {
        const vals = new Set();
        collected.forEach(item => {
            if (mode && item.mode !== mode) return;
            if (item[key]) vals.add(item[key]);
        });
        return [...vals].sort();
    }

    function snapshotActiveFilters() {
        const parts = [];
        if (filters.keyword.trim())       parts.push(`keyword: "${filters.keyword.trim()}"`);
        if (filters.authorExclude.trim()) parts.push(`excl. author: "${filters.authorExclude.trim()}"`);
        if (filters.dateFrom)             parts.push(`from ${filters.dateFrom}`);
        if (filters.dateTo)               parts.push(`to ${filters.dateTo}`);
        if (filters.ratios.size)          parts.push(`ratio: ${[...filters.ratios].join(', ')}`);
        if (filters.qualities.size)       parts.push(`quality: ${[...filters.qualities].join(', ')}`);
        if (filters.operations.size)      parts.push(`op: ${[...filters.operations].join(', ')}`);
        if (filters.nItems.trim())        parts.push(`${filters.nDirection} ${filters.nItems}`);
        return parts;
    }

    // =====================================================================
    // NETWORK HELPERS
    // =====================================================================
    function buildHeaders(extra = {}) {
        const h = { ...storedV2Headers,
                    'accept': '*/*', 'oai-language': oaiLanguage,
                    'referer': location.href, ...extra };
        if (oaiDeviceId) h['oai-device-id'] = oaiDeviceId;
        if (CFG.BEARER_TOKEN) {
            h['authorization'] = `Bearer ${CFG.BEARER_TOKEN}`;
        }
        return h;
    }

    async function fetchWithRetry(url, opts, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const r = await _fetch(url, opts);
                if (r.status === 429) {
                    const wait = (parseInt(r.headers.get('retry-after') || '10')) * 1000;
                    log(`Rate limited — waiting ${Math.round(wait / 1000)}s…`);
                    await sleep(wait);
                    continue;
                }
                
                // INSTANT GEO-BLOCK CHECK
                if (r.status === 400) {
                    let blocked = false;
                    const cloned = r.clone();
                    try {
                        const text = await cloned.text();
                        if (text.toLowerCase().includes('unsupported_country') || text.toLowerCase().includes('unsupported_region')) {
                            blocked = true;
                        }
                    } catch(e) {}
                    
                    if (blocked) {
                        log('Geo-blocked! Aborting retries.');
                        if (isV2Supported !== false) {
                            isV2Supported = false;
                            applyV2GeoBlock();
                        }
                        return null; // Don't retry, fail immediately
                    }
                }

                if (r.ok) return r;
                if (r.status === 401) {
                    log(`401 (attempt ${attempt}/${maxRetries}) — auth may not be ready yet`);
                } else {
                    log(`HTTP ${r.status} (attempt ${attempt}/${maxRetries})`);
                }
            } catch(e) {
                log(`Fetch error (attempt ${attempt}/${maxRetries}): ${e.message}`);
            }
            if (attempt < maxRetries) await sleep(600 * attempt);
        }
        return null;
    }

    // =====================================================================
    // GEO-BLOCK DETECTION
    // =====================================================================
    async function preflightV2Check() {
        if (!CFG.BEARER_TOKEN) {
            try {
                const sessionRes = await _fetch('/api/auth/session');
                if (sessionRes.ok) {
                    const sessionData = await sessionRes.json();
                    if (sessionData && sessionData.accessToken) {
                        CFG.BEARER_TOKEN = sessionData.accessToken;
                    }
                }
            } catch (e) {}
        }
        
        if (!oaiDeviceId && !CFG.BEARER_TOKEN) return; // skip if STILL no auth

        try {
            const r = await _fetch(
                `${location.origin}/backend/project_y/profile_feed/me?limit=1&cut=nf2`,
                { credentials: 'include', headers: buildHeaders({ 'oai-language': 'en-US' }) }
            );
            // ... (keep the rest of your existing 400 check logic here) ...
            if (r.status === 400) {
                let blocked = false;
                try {
                    const body = await r.clone().json();
                    const bodyStr = JSON.stringify(body).toLowerCase();
                    if (bodyStr.includes('unsupported_country') || bodyStr.includes('unsupported_region')) {
                        blocked = true;
                    }
                } catch(e) {
                    // try text fallback
                    try {
                        const text = await r.text();
                        if (text.toLowerCase().includes('unsupported_country') || text.toLowerCase().includes('unsupported_region')) {
                            blocked = true;
                        }
                    } catch(e2) {}
                }
                if (blocked) {
                    if (isV2Supported !== false) {
                        isV2Supported = false;
                        applyV2GeoBlock();
                    }
                    return;
                }
            }
            // If ok or non-400 error, assume supported
            if (isV2Supported !== true) {
                isV2Supported = true;
                applyV2GeoBlock();
            }
        } catch(e) { /* network error — leave current state */ }
    }

    function applyV2GeoBlock() {
        const v2Ids = ['v2_profile', 'v2_drafts', 'v2_liked'];
        v2Ids.forEach(id => {
            const cb  = document.getElementById('sdl-src-cb-' + id);
            const row = document.getElementById('sdl-src-row-' + id);
            if (!cb || !row) return;

            if (!isV2Supported) {
                cb.disabled = true;
                cb.checked  = false;
                enabledSources.delete(id);
                row.style.opacity = '0.4';
                row.title = 'Geo-blocked';
                if (!row.querySelector('.sdl-geo-tag')) {
                    const tag = document.createElement('span');
                    tag.className   = 'sdl-geo-tag';
                    tag.textContent = 'Geo-blocked';
                    row.appendChild(tag);
                }
            } else {
                cb.disabled = false;
                row.style.opacity = '';
                row.title = '';
                const tag = row.querySelector('.sdl-geo-tag');
                if (tag) tag.remove();
            }
        });

        const notice = document.getElementById('sdl-v2-geo-notice');
        const badge  = document.getElementById('sdl-v2-status-badge');
        if (notice) {
            if (!isV2Supported) {
                notice.textContent  = '⚠ Geo-restricted · Flick your VPN on to scan Sora 2';
                notice.className    = 'sdl-v2-notice sdl-v2-notice-blocked';
                notice.style.display = '';
            } else {
                notice.textContent  = '✓ Access confirmed · you can download everything including all your Sora 1 footage';
                notice.className    = 'sdl-v2-notice sdl-v2-notice-ok';
                notice.style.display = '';
            }
        }
        if (badge) {
            badge.textContent = isV2Supported ? '✓ available' : '⚠ geo-blocked · Enable a VPN to US to access Sora 2';
            badge.className   = 'sdl-src-group-badge ' + (isV2Supported ? 'badge-ok' : 'badge-blocked');
        }
        updateScanButton();
    }

    // =====================================================================
    // API SCAN — FETCHERS
    // =====================================================================
    async function fetchAllV1() {
        log('── V1 Images / Videos ──');
        let afterId = null, hasMore = true, page = 0;
        while (hasMore && !stopRequested) {
            page++;
            const qs  = `limit=20${afterId ? `&after=${encodeURIComponent(afterId)}` : ''}`;
            const url = `${location.origin}/backend/v2/list_tasks?${qs}`;
            const r   = await fetchWithRetry(url, { credentials: 'include', headers: buildHeaders() });
            if (!r) { setSrcStatus('v1_library', 'error'); return; }
            let data;
            try { data = await r.json(); }
            catch(e) { log('V1: JSON parse error'); setSrcStatus('v1_library', 'error'); return; }
            const result = ingestV1Page(data, 'v1_library');
            hasMore = result.hasMore;
            afterId = result.lastId;
            log(`V1 p${page}: ${collected.size} items${hasMore ? '…' : ' ✓'}`);
            if (hasMore && !afterId) { log('⚠ has_more=true but last_id missing — stopping'); break; }
            if (hasMore) await sleep(30);
        }
        setSrcStatus('v1_library', stopRequested ? 'skipped' : 'done');
    }

    async function fetchAllV1Liked() {
        log('── V1 Liked ──');
        let afterId = null, hasMore = true, page = 0;
        while (hasMore && !stopRequested) {
            page++;
            const qs  = `limit=10${afterId ? `&after=${encodeURIComponent(afterId)}` : ''}`;
            const url = `${location.origin}/backend/collections/social_favorites/generations?${qs}`;
            const r   = await fetchWithRetry(url, { credentials: 'include', headers: buildHeaders() });
            if (!r) { setSrcStatus('v1_liked', 'error'); return; }
            let data;
            try { data = await r.json(); }
            catch(e) { log('V1 liked: JSON parse error'); setSrcStatus('v1_liked', 'error'); return; }
            const result = ingestV1LikedPage(data);
            hasMore = result.hasMore;
            afterId = result.lastId;
            log(`V1 liked p${page}: ${collected.size} items${hasMore ? '…' : ' ✓'}`);
            if (hasMore && !afterId) { log('⚠ V1 liked: has_more but no last_id — stopping'); break; }
            if (hasMore) await sleep(50);
        }
        setSrcStatus('v1_liked', stopRequested ? 'skipped' : 'done');
    }

    async function fetchAllV2(baseEndpoint, sourceId) {
        log(`── ${sourceId} ──`);
        const base = `${location.origin}${baseEndpoint}`;
        let cursor = null, hasMore = true, page = 0;
        while (hasMore && !stopRequested) {
            page++;
            const url = cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
            const r   = await fetchWithRetry(url, { credentials: 'include', headers: buildHeaders() });
            if (!r) { setSrcStatus(sourceId, 'error'); return; }
            let data;
            try { data = await r.json(); }
            catch(e) { log(`${sourceId}: JSON parse error`); setSrcStatus(sourceId, 'error'); return; }
            const result = ingestV2Page(data, url, sourceId);
            hasMore = result.nextCursor != null;
            cursor  = result.nextCursor;
            log(`${sourceId} p${page}: ${collected.size} items${hasMore ? '…' : ' ✓'}`);
            if (hasMore) await sleep(60);
        }
        setSrcStatus(sourceId, stopRequested ? 'skipped' : 'done');
    }

    async function fetchAllV2Liked() {
        log('── V2 Liked ──');
        if (!cachedUserId) {
            const r = await fetchWithRetry(
                `${location.origin}/backend/project_y/v2/me`,
                { credentials: 'include', headers: buildHeaders() }
            );
            if (!r) { log('V2 liked: could not fetch /v2/me'); setSrcStatus('v2_liked', 'error'); return; }
            try {
                const d = await r.json();
                cachedUserId = d?.profile?.user_id ?? null;
            } catch(e) {
                log('V2 liked: /v2/me parse error');
                setSrcStatus('v2_liked', 'error');
                return;
            }
            if (!cachedUserId) { log('V2 liked: no user_id in /v2/me'); setSrcStatus('v2_liked', 'error'); return; }
            log(`V2 liked: user_id captured`);
        }
        await fetchAllV2(
            `/backend/project_y/profile/${cachedUserId}/post_listing/likes?limit=8`,
            'v2_liked'
        );
    }

    // Orchestrator
    async function fetchSelectedSources() {
        if (!CFG.BEARER_TOKEN) {
            try {
                const sessionRes = await _fetch('/api/auth/session');
                if (sessionRes.ok) {
                    const sessionData = await sessionRes.json();
                    if (sessionData && sessionData.accessToken) {
                        CFG.BEARER_TOKEN = sessionData.accessToken;
                        log('✅ Access token automatically fetched');
                    }
                }
            } catch (e) {
                log('⚠ Could not auto-fetch access token');
            }
        }

        for (let w = 0; !oaiDeviceId && w < 40 && !stopRequested; w++) await sleep(250);
        if (!oaiDeviceId) log('⚠ Auth headers not yet captured — requests may return 401');

        const FETCH_MAP = {
            v1_library: fetchAllV1,
            v1_liked:   fetchAllV1Liked,
            v2_profile: () => fetchAllV2('/backend/project_y/profile_feed/me?limit=8&cut=nf2', 'v2_profile'),
            v2_drafts:  () => fetchAllV2('/backend/project_y/profile/drafts/v2?limit=15', 'v2_drafts'),
            v2_liked:   fetchAllV2Liked,
        };

        for (const src of SCAN_SOURCES) {
            if (stopRequested) break;
            if (!enabledSources.has(src.id)) {
                setSrcStatus(src.id, 'skipped');
                continue;
            }
            setSrcStatus(src.id, 'active');
            await FETCH_MAP[src.id]();
        }
    }

    // =====================================================================
    // DOWNLOAD HELPERS
    // =====================================================================
    async function getDownloadUrl(item) {
        if (item.mode === 'v2') {
            if (item.downloadUrl) return item.downloadUrl;
            if (item.postId) {
                try {
                    const r = await _fetch(
                        `${location.origin}/backend/project_y/post/${item.postId}/tree?limit=20&max_depth=1`,
                        { credentials: 'include', headers: buildHeaders() }
                    );
                    if (r.ok) {
                        const tree = await r.json();
                        const url  = extractUrlFromTree(tree);
                        if (url) return url;
                    }
                } catch(e) {}
            }
            return item.previewUrl ?? null;
        }
        try {
            const r = await _fetch(
                `${location.origin}/backend/generations/${item.genId}/download`,
                { credentials: 'include', headers: buildHeaders() }
            );
            if (r.ok) {
                const d = await r.json();
                const url = d?.url ?? d?.download_url ?? null;
                if (url) return url.replace(/&amp;/g, '&');
            }
        } catch(e) {}
        return item.pngUrl ?? null;
    }

    function extractUrlFromTree(tree) {
        const post = tree?.post ?? tree;
        for (const att of (post?.attachments ?? [])) {
            const u = att.downloadable_url
                   ?? att.download_urls?.watermark
                   ?? att.download_urls?.no_watermark
                   ?? att.url;
            if (u) return u;
        }
        return null;
    }

    function getSubfolderName(item) {
        if (item.mode === 'v1') {
            if (item.source === 'v1_liked') return SUBFOLDERS.v1_liked;
            return item.isVideo ? SUBFOLDERS.v1_videos : SUBFOLDERS.v1_library;
        }
        return SUBFOLDERS[item.source] ?? SUBFOLDERS.v2_profile;
    }

    function getFileExt(item) {
        if (item.mode === 'v2')  return '.mp4';
        if (item.isVideo)        return '.mp4';
        return '.png';
    }

    // =====================================================================
    // FILENAME & TXT BUILDERS
    // =====================================================================
    function slugify(str, maxLen) {
        return str.replace(/[\r\n\t]+/g, ' ')
            .replace(/[^\w\s\-äöüÄÖÜ]/g, ' ')
            .replace(/\s+/g, '_').replace(/_+/g, '_')
            .replace(/^_|_$/g, '').slice(0, maxLen).replace(/_+$/, '');
    }

    function buildBase(item) {
        const tpl = readConfig('FILENAME_TEMPLATE') || CFG.FILENAME_TEMPLATE;
        const mx  = parseInt(readConfig('PROMPT_MAX_LEN')) || CFG.PROMPT_MAX_LEN;
        return tpl
            .replace('{date}',      item.date        || 'unknown')
            .replace('{prompt}',    slugify(item.prompt || '', mx))
            .replace('{genId}',     item.genId       || item.postId || '')
            .replace('{taskId}',    item.taskId      || item.postId || '')
            .replace('{width}',     item.width       ?? '')
            .replace('{height}',    item.height      ?? '')
            .replace('{ratio}',     (item.ratio || '').replace(':', 'x'))
            .replace('{quality}',   item.quality     || '')
            .replace('{operation}', item.operation   || '')
            .replace('{model}',     item.model       || '')
            .replace('{seed}',      item.seed        ?? '')
            .replace('{duration}',  item.duration != null ? `${item.duration}s` : '')
            .replace(/_+/g, '_').replace(/^_|_$/g, '');
    }

    function buildTxtContent(item) {
        const lines = [
            `Source         : ${item.source || ''}`,
            `Generation ID  : ${item.genId || item.postId || ''}`,
            `Task ID        : ${item.taskId || ''}`,
            `Date           : ${item.date}`,
        ];
        if (item.mode === 'v2') {
            if (item.postId)           lines.push(`Post ID        : ${item.postId}`);
            if (item.duration != null) lines.push(`Duration       : ${item.duration}s`);
        }
        if (item.isVideo && item.mode === 'v1') lines.push(`Type           : V1 Video`);
        if (item.author)                        lines.push(`Author         : ${item.author}`);
        if (item.width && item.height) {
            lines.push(`Resolution     : ${item.width} × ${item.height} px`);
            lines.push(`Aspect ratio   : ${item.ratio || '?'}`);
        }
        if (item.quality)   lines.push(`Quality        : ${item.quality}`);
        if (item.operation) lines.push(`Operation      : ${item.operation}`);
        if (item.model)     lines.push(`Model          : ${item.model}`);
        if (item.seed)      lines.push(`Seed           : ${item.seed}`);
        if (item.taskType)  lines.push(`Task type      : ${item.taskType}`);
        if (item.nVariants) lines.push(`Variants gen.  : ${item.nVariants}`);
        if (item.isLiked)   lines.push(`Liked          : yes`);
        lines.push('', '── Prompt ─────────────────────────────────────────────────', item.prompt || '(none)');
        return lines.join('\n');
    }

    // =====================================================================
    // JSON EXPORT
    // =====================================================================
    async function exportJSON(silent = false) {
        const items = [...collected.values()];
        const payload = {
            soravault_version: VERSION,
            exported_at:       new Date().toISOString(),
            scan_sources:      SCAN_SOURCES.filter(s => enabledSources.has(s.id)).map(s => s.id),
            total:             items.length,
            items,
        };
        const json     = JSON.stringify(payload, null, 2);
        const filename = `soravault_manifest_${new Date().toISOString().slice(0, 10)}.json`;
        const blob     = new Blob([json], { type: 'application/json;charset=utf-8' });

        if (baseDir) {
            try {
                const fh = await baseDir.getFileHandle(filename, { create: true });
                const w  = await fh.createWritable();
                await w.write(blob); await w.close();
                log(`JSON manifest saved: ${filename}`);
                if (!silent) showToast('JSON manifest saved ✓');
                return;
            } catch(e) { /* fall through */ }
        }

        const url = URL.createObjectURL(blob);
        {
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 3000);
        }
        log(`JSON manifest saved: ${filename}`);
        if (!silent) showToast('JSON manifest saved ✓');
    }

    // =====================================================================
    // FILE SYSTEM HELPERS
    // =====================================================================
    async function downloadFileFS(url, filename, dir) {
        let blob;
        // 1) Try native fetch first
        try {
            const r = await _fetch(url);
            if (r.ok) blob = await r.blob();
            else log(`⚠ fetch ${r.status} for ${filename}`);
        } catch(e) {
            log(`⚠ fetch error for ${filename}: ${e.message}`);
        }
        if (!blob) return false;
        // 2) Write blob to chosen folder (auto-truncate on path-too-long errors)
        for (let maxLen = filename.length; maxLen >= 40; maxLen = Math.min(maxLen - 30, Math.floor(maxLen * 0.7))) {
            const fn = truncFilename(filename, maxLen);
            try {
                const fh = await dir.getFileHandle(fn, { create: true });
                const w  = await fh.createWritable();
                await w.write(blob); await w.close();
                if (fn !== filename) log(`✂ Saved with shorter name: ${fn}`);
                return true;
            } catch(e) {
                if (fn.length <= 40) {
                    log(`⚠ Write failed for ${fn}: ${e.message}`);
                    return false;
                }
                log(`↻ Path too long (${fn.length} chars), shortening filename…`);
            }
        }
        return false;
    }

    function truncFilename(name, maxLen) {
        if (name.length <= maxLen) return name;
        const dot = name.lastIndexOf('.');
        const ext = dot > 0 ? name.slice(dot) : '';
        return name.slice(0, maxLen - ext.length).replace(/_+$/, '') + ext;
    }

    async function downloadTextFileFS(content, filename, dir) {
        for (let maxLen = filename.length; maxLen >= 40; maxLen = Math.min(maxLen - 30, Math.floor(maxLen * 0.7))) {
            const fn = truncFilename(filename, maxLen);
            try {
                const fh = await dir.getFileHandle(fn, { create: true });
                const w  = await fh.createWritable();
                await w.write(content); await w.close();
                return true;
            } catch(e) {
                if (fn.length <= 40) return false;
            }
        }
        return false;
    }

    // Fallback download via anchor click (used when File System API unavailable)
    async function downloadFileGM(url, subfolder, filename) {
        try {
            const r = await _fetch(url);
            if (!r.ok) return false;
            const blob    = await r.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a       = document.createElement('a');
            a.href        = blobUrl;
            a.download    = filename; // subfolders not supported via anchor
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
            return true;
        } catch(e) {
            log('Anchor download error: ' + e.message);
            return false;
        }
    }

    async function downloadTextFileGM(content, subfolder, filename) {
        try {
            const blob    = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const blobUrl = URL.createObjectURL(blob);
            const a       = document.createElement('a');
            a.href        = blobUrl;
            a.download    = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
            return true;
        } catch(e) {
            return false;
        }
    }

    // =====================================================================
    // SOURCE STATUS
    // =====================================================================
    function setSrcStatus(id, status) {
        srcStatus[id] = status;
        renderSrcProgress();
    }

    function renderSrcProgress() {
        const el = document.getElementById('sdl-src-progress');
        if (!el) return;
        const STATUS_ICON = { pending: '○', active: '◉', done: '✓', error: '✕', skipped: '—', idle: '○' };
        const STATUS_CLS  = { pending: '', active: 'sp-active', done: 'sp-done', error: 'sp-err', skipped: 'sp-skip', idle: '' };
        el.innerHTML = SCAN_SOURCES.map(src => {
            if (!enabledSources.has(src.id)) return '';
            const st = srcStatus[src.id] ?? 'pending';
            return `<div class="sp-item ${STATUS_CLS[st]}">
                <span class="sp-icon">${src.icon}</span>
                <span class="sp-lbl">${src.label}</span>
                <span class="sp-st">${STATUS_ICON[st]}</span>
            </div>`;
        }).join('');
    }

    function updateScanButton() {
        const btn = document.getElementById('sdl-scan');
        if (!btn) return;
        const availableCount = SCAN_SOURCES.filter(s => {
            const cb = document.getElementById('sdl-src-cb-' + s.id);
            return !cb || !cb.disabled;
        }).length;
        const n = enabledSources.size;
        btn.disabled = n === 0;
        btn.textContent = n >= availableCount ? 'Scan All' : `Scan (${n} source${n !== 1 ? 's' : ''})`;
    }

    // =====================================================================
    // SCAN STORYTELLING
    // =====================================================================
    function startScanStories() {
        scanStoryIdx = 0;
        showScanStory(0);
        scanStoryTimer = setInterval(() => {
            scanStoryIdx = (scanStoryIdx + 1) % SCAN_STORIES.length;
            showScanStory(scanStoryIdx);
        }, 4200);
    }

    function stopScanStories() {
        if (scanStoryTimer) { clearInterval(scanStoryTimer); scanStoryTimer = null; }
    }

    function showScanStory(idx) {
        const iconEl = document.getElementById('sdl-story-icon');
        const textEl = document.getElementById('sdl-story-text');
        if (!iconEl || !textEl) return;
        const s = SCAN_STORIES[idx];
        iconEl.textContent = s.icon;
        textEl.style.opacity = '0';
        setTimeout(() => { textEl.textContent = s.text; textEl.style.opacity = '1'; }, 180);
    }

    function updateShutdownBadge() {
        const el = document.getElementById('sdl-shutdown-badge');
        if (!el) return;
        const delta = shutdownDaysDelta();
        if (delta >= 0) {
            el.textContent = `Sora closed ${delta} day${delta !== 1 ? 's' : ''} ago`;
        } else {
            const left = Math.abs(delta);
            el.textContent = `${left} day${left !== 1 ? 's' : ''} left`;
        }
    }

    // =====================================================================
    // TOAST
    // =====================================================================
    let toastTimer = null;
    function showToast(msg, ms = 2400) {
        const el = document.getElementById('sdl-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('tout'); el.classList.add('tin');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            el.classList.remove('tin'); el.classList.add('tout');
        }, ms);
    }

    // =====================================================================
    // VERSION CHECK
    // =====================================================================
    async function checkForUpdate() {
        try {
            const r = await _fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });
            if (!r.ok) return;
            const data = await r.json();
            const tag  = (data.tag_name || '').replace(/^v/i, '');
            if (tag && tag !== VERSION) {
                const badge = document.getElementById('sdl-update-badge');
                if (badge) { badge.textContent = `v${tag} available`; badge.style.display = ''; }
            }
        } catch(e) {}
    }

    // =====================================================================
    // SCAN
    // =====================================================================
    async function startScan() {
        if (isRunning) return;
        if (enabledSources.size === 0) {
            setStatus('Select at least one source to scan');
            return;
        }
        isRunning = true; stopRequested = false;
        collected.clear(); completedCount = 0; failedCount = 0;
        cachedUserId = null;
        resetFilters();

        SCAN_SOURCES.forEach(s => setSrcStatus(s.id, enabledSources.has(s.id) ? 'pending' : 'idle'));

        setState('scanning');
        startScanStories();
        await fetchSelectedSources();
        stopScanStories();
        isRunning = false;

        if (collected.size === 0) {
            setState('init');
            setStatus('Nothing found — check source selection and auth (amber dot = not ready)');
        } else {
            const n    = collected.size;
            const word = getContentWord();
            log(`Scan complete — ${n} ${word} found`);
            setState('ready');
            rebuildAllChips();
            recomputeSelection();
        }
    }

    function stopAll() {
        stopRequested = true; isRunning = false;
        stopScanStories();
        log('Stopped.');
        if (collected.size > 0) { setState('ready'); rebuildAllChips(); recomputeSelection(); }
        else setState('init');
    }

    // =====================================================================
    // DOWNLOAD
    // =====================================================================
    async function startDownload() {
        if (isRunning) return;
        const items = getFilteredItems();
        if (items.length === 0) return;

        const saveMedia = readConfigBool('SAVE_MEDIA', true);
        const saveTxt   = readConfigBool('DOWNLOAD_TXT', CFG.DOWNLOAD_TXT);
        const saveJSON  = readConfigBool('SAVE_JSON', false);

        if (!saveMedia && !saveTxt && !saveJSON) {
            showToast('Enable at least one output format ↑');
            return;
        }

        const hasFS = typeof window.showDirectoryPicker === 'function';
        const hasGM = false; // Chrome extension: anchor download fallback only

        baseDir = null;

        if (saveMedia || saveTxt) {
            if (hasFS) {
                try {
                    baseDir = await window.showDirectoryPicker({ mode: 'readwrite' });
                    dlMethod = 'fs';
                } catch(e) {
                    log('Folder selection cancelled.');
                    return;
                }
            } else if (hasGM) {
                dlMethod = 'gm';
                log('ℹ Folder picker not available — using anchor download fallback');
            } else {
                log('⚠ No download method available (use Chrome/Edge).');
                setStatus('File System API unavailable — use Chrome 86+ — see log');
                return;
            }
        }

        isRunning = true; stopRequested = false;
        completedCount = 0; failedCount = 0;
        totalToDownload = items.length;
        lastSaveTxt    = saveTxt;
        lastSaveMedia  = saveMedia;
        lastSaveJSON   = saveJSON;
        lastFilterSnap = snapshotActiveFilters();

        const word = getContentWord();
        let logParts = [`Downloading ${totalToDownload} ${word}`];
        if (saveTxt)   logParts.push('+TXT');
        if (saveJSON)  logParts.push('+JSON');
        if (!saveMedia) logParts = [`Processing ${totalToDownload} ${word} (no media)`];
        log(logParts.join(' ') + '…');

        const totalEl = document.getElementById('sdl-dl-total');
        if (totalEl) totalEl.textContent = totalToDownload;
        setState('downloading');
        updateDownloadProgress();

        const subDirCache = {};
        async function getSubDir(item) {
            const name = getSubfolderName(item);
            if (!subDirCache[name]) {
                try { subDirCache[name] = await baseDir.getDirectoryHandle(name, { create: true }); }
                catch(e) { log(`Could not create subfolder "${name}", using root.`); subDirCache[name] = baseDir; }
            }
            return subDirCache[name];
        }

        const dlStart = Date.now();
        let idx = 0;

        async function worker() {
            while (idx < items.length && !stopRequested) {
                const i = idx++, item = items[i];
                const base = buildBase(item);
                const ext  = getFileExt(item);
                log(`[${i+1}/${totalToDownload}] ${base.slice(0, 55)}…`);

                let mediaOk = true;

                if (saveMedia) {
                    const url = await getDownloadUrl(item);
                    if (!url) {
                        failedCount++;
                        log(`No URL: ${item.genId || item.postId}`);
                        updateDownloadProgress(dlStart);
                        continue;
                    }
                    if (dlMethod === 'fs') {
                        const targetDir = await getSubDir(item);
                        mediaOk = await downloadFileFS(url, base + ext, targetDir);
                    } else {
                        mediaOk = await downloadFileGM(url, getSubfolderName(item), base + ext);
                    }
                }

                if (saveTxt) {
                    await sleep(60);
                    const content = buildTxtContent(item);
                    if (dlMethod === 'fs' && baseDir) {
                        const targetDir = await getSubDir(item);
                        await downloadTextFileFS(content, base + '.txt', targetDir);
                    } else if (dlMethod === 'gm') {
                        await downloadTextFileGM(content, getSubfolderName(item), base + '.txt');
                    }
                }

                if (saveMedia && !mediaOk) {
                    failedCount++;
                    log(`Failed: ${item.genId || item.postId}`);
                } else {
                    completedCount++;
                }

                updateDownloadProgress(dlStart);
                await sleep(SPEED_PRESETS[speedIdx].delay);
            }
        }

        while (idx < items.length && !stopRequested) {
            const maxWorkers = dlMethod === 'gm'
                ? Math.min(2, SPEED_PRESETS[speedIdx].workers)
                : SPEED_PRESETS[speedIdx].workers;
            const conc = Math.min(items.length - idx, maxWorkers);
            await Promise.all(Array.from({ length: conc }, () => worker()));
        }

        isRunning = false;

        if (stopRequested) {
            log(`Stopped — ${completedCount} saved, ${failedCount} failed`);
            setState('ready');
        } else {
            // Auto-export JSON manifest if enabled
            if (saveJSON) {
                log('Saving JSON manifest…');
                await exportJSON(true);
                showToast('JSON manifest saved ✓');
            }
            log(`All done — ${completedCount} saved${failedCount > 0 ? `, ${failedCount} failed` : ''} ✓`);
            showEndScreen(saveTxt, saveMedia, saveJSON);
        }
    }

    // =====================================================================
    // END SCREEN
    // =====================================================================
    function computeTimeSaved(count, withTxt) {
        const secsPerItem = withTxt ? 120 : 20;
        const total = count * secsPerItem;
        if (total >= 3600) {
            const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60);
            return `${h} HOUR${h > 1 ? 'S' : ''} and ${m} minute${m !== 1 ? 's' : ''}`;
        }
        if (total >= 60) { const m = Math.round(total / 60); return `${m} minute${m !== 1 ? 's' : ''}`; }
        return `${total} second${total !== 1 ? 's' : ''}`;
    }

    function showEndScreen(saveTxt, saveMedia, saveJSON) {
        setState('done');
        const timeStr = computeTimeSaved(completedCount, saveTxt);
        const word    = getContentWord();
        const titleEl = document.querySelector('.sdl-done-title');
        if (titleEl) titleEl.textContent = `${completedCount} ${word} saved. ~${timeStr} back.`;
        const savedEl = document.getElementById('sdl-done-saved');
        if (savedEl) {
            savedEl.textContent = (saveTxt ? 'Every prompt. Every experiment. ' : '') + 'Saved to your hard drive.';
        }
        const statsEl = document.getElementById('sdl-done-stats');
        if (statsEl) {
            const statItems = [];
            if (saveMedia) {
                statItems.push(`<div class="sdl-done-stat"><span class="sdl-done-stat-n">${completedCount}</span><span>saved</span></div>`);
                if (failedCount > 0) statItems.push(`<div class="sdl-done-stat sdl-done-stat-err"><span class="sdl-done-stat-n">${failedCount}</span><span>failed</span></div>`);
            }
            if (saveTxt)  statItems.push(`<div class="sdl-done-stat sdl-done-stat-ok"><span class="sdl-done-stat-n">✓</span><span>prompts</span></div>`);
            if (saveJSON) statItems.push(`<div class="sdl-done-stat sdl-done-stat-ok"><span class="sdl-done-stat-n">✓</span><span>manifest</span></div>`);
            statsEl.innerHTML = statItems.join('<div class="sdl-done-stat-sep"></div>');
        }
        const filtersEl = document.getElementById('sdl-done-filters');
        if (filtersEl) {
            if (lastFilterSnap.length > 0) {
                filtersEl.style.display = '';
                document.getElementById('sdl-done-filter-list').textContent = lastFilterSnap.join(' · ');
            } else {
                filtersEl.style.display = 'none';
            }
        }
        const coffeeMsg = document.querySelector('#sdl-s-done .sdl-coffee-msg');
        if (coffeeMsg) {
            coffeeMsg.innerHTML = `<strong>You just saved ~${timeStr} of manual work.</strong><br>` +
                `If that's worth a coffee to you — it means the world.`;
        }
    }

    // =====================================================================
    // STATE MACHINE
    // =====================================================================
    function setState(s) {
        uiState = s;
        ['init', 'scanning', 'ready', 'downloading', 'done'].forEach(id => {
            const el = document.getElementById('sdl-s-' + id);
            if (el) el.style.display = id === s ? '' : 'none';
        });
        setStatus({
            init:        '',
            scanning:    'API scan running — stop anytime to download what\'s found',
            ready:       '',
            downloading: dlMethod === 'gm'
                ? 'Saving via browser download → default Downloads folder'
                : 'Saving files to your folder…',
            done: '',
        }[s] || '');
        syncExpertSections();
    }

    function syncExpertSections() {
        const tp = document.getElementById('sdl-exp-template');
        if (tp) tp.style.display = (uiState === 'ready') ? '' : 'none';
    }

    // =====================================================================
    // FILTER LOGIC
    // =====================================================================
    function resetFilters() {
        filters.keyword = ''; filters.ratios.clear(); filters.dateFrom = ''; filters.dateTo = '';
        filters.qualities.clear(); filters.operations.clear(); filters.nItems = ''; filters.nDirection = 'last';
        filters.authorExclude = '';
    }

    function resetFilterInputs() {
        ['sdl-f-keyword', 'sdl-f-author', 'sdl-f-date-from', 'sdl-f-date-to', 'sdl-f-n-items'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        document.querySelectorAll('#sdl-filter-drawer .sdl-chip.active').forEach(c => c.classList.remove('active'));
        syncNDirButtons();
    }

    function rebuildAllChips() {
        rebuildChips('sdl-f-v1-ratios',     'ratios',     getDistinctValuesByMode('ratio', 'v1'));
        rebuildChips('sdl-f-v1-qualities',  'qualities',  getDistinctValuesByMode('quality', 'v1'));
        rebuildChips('sdl-f-v1-operations', 'operations', getDistinctValuesByMode('operation', 'v1'));
        rebuildChips('sdl-f-v2-ratios',     'ratios',     getDistinctValuesByMode('ratio', 'v2'));
        rebuildChips('sdl-f-v2-qualities',  'qualities',  getDistinctValuesByMode('quality', 'v2'));
    }

    function rebuildChips(containerId, filterKey, values) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        if (!values.length) { container.innerHTML = '<span class="sdl-chip-empty">—</span>'; return; }
        values.forEach(val => {
            const chip = document.createElement('button');
            chip.className = 'sdl-chip';
            chip.textContent = val;
            if (filters[filterKey].has(val)) chip.classList.add('active');
            chip.addEventListener('click', () => {
                filters[filterKey].has(val) ? filters[filterKey].delete(val) : filters[filterKey].add(val);
                chip.classList.toggle('active', filters[filterKey].has(val));
                recomputeSelection();
            });
            container.appendChild(chip);
        });
    }

    function getContentWord() {
        const vals = [...collected.values()];
        const hasV2      = vals.some(i => i.mode === 'v2');
        const hasVideos  = vals.some(i => i.mode === 'v1' && i.isVideo);
        const hasImages  = vals.some(i => i.mode === 'v1' && !i.isVideo);
        if ((hasV2 || hasVideos) && hasImages) return 'items';
        if (hasV2 || hasVideos) return 'videos';
        return 'images';
    }

    function recomputeSelection() {
        const selected = getFilteredItems().length;
        const total    = collected.size;
        const word     = getContentWord();
        const pill     = document.getElementById('sdl-counter-pill');
        if (pill) {
            const filtered = selected < total;
            pill.textContent = filtered ? `${selected} / ${total} selected` : `${total} ${word}`;
            pill.classList.toggle('filtered', filtered);
            pill.classList.remove('flash'); void pill.offsetWidth; pill.classList.add('flash');
        }
        const dlBtn = document.getElementById('sdl-dl');
        if (dlBtn) {
            dlBtn.disabled = selected === 0;
            dlBtn.textContent = selected === total
                ? `Download All  (${selected})`
                : `Download Selection  (${selected})`;
        }
        updateFilterBadge();
    }

    function updateFilterBadge() {
        const badge = document.getElementById('sdl-filter-badge');
        if (!badge) return;
        const count = (filters.keyword.trim() ? 1 : 0) + (filters.nItems.trim() ? 1 : 0)
            + filters.ratios.size + filters.qualities.size + filters.operations.size
            + (filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0)
            + (filters.authorExclude.trim() ? 1 : 0);
        badge.textContent = count > 0 ? `${count} active` : 'none active';
        badge.classList.toggle('active', count > 0);
    }

    function syncNDirButtons() {
        document.getElementById('sdl-n-last')?.classList.toggle('active',  filters.nDirection === 'last');
        document.getElementById('sdl-n-first')?.classList.toggle('active', filters.nDirection === 'first');
    }

    // =====================================================================
    // UI HELPERS
    // =====================================================================
    function setStatus(text) {
        const el = document.getElementById('sdl-status');
        if (!el) return;
        el.textContent   = text;
        el.style.display = text ? '' : 'none';
    }

    function updateDownloadProgress(dlStart) {
        const done  = completedCount + failedCount;
        const nEl   = document.getElementById('sdl-dl-count');
        const bar   = document.getElementById('sdl-dl-bar');
        const dEl   = document.getElementById('sdl-dl-done');
        const fEl   = document.getElementById('sdl-dl-failed');
        const eta   = document.getElementById('sdl-dl-eta');
        const fWrap = document.getElementById('sdl-fail-wrap');
        if (nEl) nEl.textContent = completedCount;
        if (dEl) dEl.textContent = completedCount;
        if (fEl) { fEl.textContent = failedCount; if (fWrap) fWrap.style.color = failedCount > 0 ? '#f87171' : ''; }
        if (bar && totalToDownload > 0) bar.style.width = (done / totalToDownload * 100) + '%';
        if (eta && dlStart && completedCount > 0) {
            const elapsed   = (Date.now() - dlStart) / 1000;
            const rate      = completedCount / elapsed;
            const remaining = totalToDownload - completedCount - failedCount;
            if (rate > 0 && remaining > 0) {
                const secs = Math.round(remaining / rate);
                eta.textContent = secs < 60 ? `~${secs}s left` : `~${Math.round(secs/60)}min left`;
            }
        }
    }

    function log(msg) {
        const el = document.getElementById('sdl-log');
        if (el) el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + el.textContent;
    }

    function readConfig(key)          { const e = document.getElementById('sdl-cfg-' + key); return e ? e.value : null; }
    function readConfigBool(key, def) { const e = document.getElementById('sdl-cfg-' + key); return e ? e.checked : def; }

    function refreshAuthBadge() {
        const el = document.getElementById('sdl-auth');
        if (!el) return;
        if (oaiDeviceId) {
            el.classList.add('authed'); el.title = 'Auth captured ✓';
            if (!geoCheckInitDone) { geoCheckInitDone = true; preflightV2Check(); }
        } else {
            el.classList.remove('authed'); el.title = 'Waiting — keep this Sora tab open';
        }
    }

    function setSpeedIdx(i) {
        speedIdx = i;
        document.querySelectorAll('.sdl-speed-seg').forEach(el =>
            el.classList.toggle('active', parseInt(el.dataset.spd) === i));
        const hints   = ['2 workers · 300 ms delay · safe', '4 workers · 150 ms delay · aggressive', '8 workers · 60 ms delay · ban risk!'];
        const classes = ['', 'warn', 'danger'];
        document.querySelectorAll('.sdl-speed-hint').forEach(h => {
            h.textContent = hints[i]; h.className = 'sdl-speed-hint ' + classes[i];
        });
    }

    // =====================================================================
    // STYLES
    // =====================================================================
    const STYLE = `
#sdl {
  position:fixed; top:16px; right:16px; z-index:2147483647;
  width:430px; min-width:300px; max-width:720px;
  max-height:calc(100vh - 32px);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;
  font-size:13px; color:rgba(255,255,255,0.82);
  background:rgba(10,10,10,0.97);
  backdrop-filter:blur(30px); -webkit-backdrop-filter:blur(30px);
  border:0.5px solid rgba(255,255,255,0.1); border-radius:18px;
  box-shadow:0 24px 64px rgba(0,0,0,0.75),inset 0 1px 0 rgba(255,255,255,0.05);
  display:flex; flex-direction:column; overflow:hidden;
  resize:horizontal;
  user-select:none;
}
#sdl.collapsed {
  border-radius:14px;
  width:auto !important; min-width:0; resize:none;
}
#sdl.collapsed #sdl-body { display:none; }
#sdl.collapsed #sdl-title,
#sdl.collapsed #sdl-update-badge { display:none; }
#sdl.collapsed #sdl-header-right > *:not(#sdl-min) { display:none; }

#sdl-header {
  display:flex; align-items:center; gap:8px;
  padding:11px 13px 10px; border-bottom:0.5px solid rgba(255,255,255,0.06);
  flex-shrink:0; cursor:grab;
}
#sdl-header:active { cursor:grabbing; }
#sdl.collapsed #sdl-header { border-bottom:none; cursor:grab; }

#sdl-logo {
  width:26px; height:26px; border-radius:7px; flex-shrink:0;
  object-fit:cover; background:rgba(255,255,255,0.06);
}
#sdl-logo-fb {
  width:26px; height:26px; border-radius:7px; flex-shrink:0;
  background:rgba(255,255,255,0.06); display:none;
  align-items:center; justify-content:center; font-size:16px;
}
#sdl-title { font-size:13px; font-weight:600; color:rgba(255,255,255,0.85); flex-shrink:0; }
#sdl-update-badge {
  display:none; font-size:9px; padding:2px 6px; border-radius:20px;
  background:rgba(99,102,241,0.25); border:0.5px solid rgba(99,102,241,0.4);
  color:rgba(165,170,255,0.9); cursor:default; white-space:nowrap;
}
#sdl-header-right { margin-left:auto; display:flex; align-items:center; gap:3px; }
#sdl-auth {
  width:7px; height:7px; border-radius:50%; background:rgba(251,191,36,0.8); flex-shrink:0;
  transition:background 0.4s,box-shadow 0.4s,transform 0.3s; cursor:default;
}
#sdl-auth.authed { background:#34d399; box-shadow:0 0 8px rgba(52,211,153,0.55); animation:sdlPulse 0.6s ease-out; }
@keyframes sdlPulse { 0%{transform:scale(1)} 40%{transform:scale(1.8)} 100%{transform:scale(1)} }
.sdl-hd-btn {
  background:none; border:none; color:rgba(255,255,255,0.22); font-size:15px; line-height:1;
  cursor:pointer; padding:2px 5px; border-radius:4px; flex-shrink:0;
  transition:color 0.15s; font-weight:300; user-select:none;
}
.sdl-hd-btn:hover { color:rgba(255,255,255,0.62); }

/* GitHub Icon Styling */
.sdl-gh-link {
  display:flex; align-items:center; justify-content:center;
  width:15px; height:15px; color:rgba(255,255,255,0.22);
  text-decoration:none; transition:color 0.15s, transform 0.1s;
  flex-shrink:0; margin:0 2px;
}
.sdl-gh-link:hover {
  color:rgba(255,255,255,0.62);
  transform:scale(1.05);
}
.sdl-gh-link svg { width:100%; height:100%; }

#sdl-body { overflow-y:auto; padding:13px; flex:1; min-height:0; user-select:text; }#sdl-body::-webkit-scrollbar { width:3px; }
#sdl-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:2px; }
#sdl-status {
  font-size:11px; color:rgba(255,255,255,0.3);
  text-align:center; margin-bottom:12px; line-height:1.5; display:none;
}

/* ── Source groups ─────────────────────────────────────────────── */
.sdl-src-groups { margin-bottom:12px; display:flex; flex-direction:column; gap:10px; }
.sdl-src-group {
  background:rgba(255,255,255,0.025); border:0.5px solid rgba(255,255,255,0.07);
  border-radius:12px; overflow:hidden;
}
.sdl-src-group-hd {
  display:flex; align-items:center; gap:7px;
  padding:7px 12px 6px;
  font-size:10.5px; font-weight:600; color:rgba(255,255,255,0.45);
  text-transform:uppercase; letter-spacing:0.07em;
  background:rgba(255,255,255,0.03);
  border-bottom:0.5px solid rgba(255,255,255,0.06);
  user-select:none;
}
.sdl-src-group-badge {
  font-size:9px; padding:1.5px 7px; border-radius:20px; font-weight:500;
  letter-spacing:0.03em; text-transform:none;
}
.badge-ok      { background:rgba(52,211,153,0.12); color:rgba(52,211,153,0.85); border:0.5px solid rgba(52,211,153,0.2); }
.badge-blocked { background:rgba(251,191,36,0.1);  color:rgba(251,191,36,0.8);  border:0.5px solid rgba(251,191,36,0.2); }
.badge-checking{ background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.35);border:0.5px solid rgba(255,255,255,0.1); }

.sdl-v2-notice {
  padding:6px 12px 5px; font-size:10px; line-height:1.45;
  border-bottom:0.5px solid rgba(255,255,255,0.05);
}
.sdl-v2-notice-blocked { color:rgba(251,191,36,0.75); background:rgba(251,191,36,0.05); display:none; }
.sdl-v2-notice-ok      { color:rgba(52,211,153,0.7);  background:rgba(52,211,153,0.04); display:none; }

.sdl-src-row {
  display:flex; align-items:center; gap:10px;
  padding:8px 12px; cursor:pointer;
  border-bottom:0.5px solid rgba(255,255,255,0.04);
  transition:background 0.12s;
  user-select:none;
}
.sdl-src-row:last-child { border-bottom:none; }
.sdl-src-row:hover { background:rgba(255,255,255,0.035); }
.sdl-src-row input[type="checkbox"] {
  width:15px; height:15px; flex-shrink:0; cursor:pointer;
  accent-color:#34d399;
}
.sdl-src-icon { font-size:14px; line-height:1; flex-shrink:0; }
.sdl-src-name { font-size:12px; font-weight:500; color:rgba(255,255,255,0.72); flex:1; }
.sdl-src-sub  { font-size:10px; color:rgba(255,255,255,0.22); white-space:nowrap; }
.sdl-geo-tag  {
  font-size:9px; padding:1.5px 6px; border-radius:20px;
  background:rgba(251,191,36,0.1); color:rgba(251,191,36,0.7);
  border:0.5px solid rgba(251,191,36,0.18); white-space:nowrap;
}

#sdl-src-note {
  font-size:10px; color:rgba(255,255,255,0.18); text-align:center;
  margin-bottom:11px; line-height:1.5;
}

/* Source progress (scanning state) */
#sdl-src-progress {
  display:flex; flex-wrap:wrap; gap:4px; margin-bottom:12px;
}
.sp-item {
  display:flex; align-items:center; gap:4px;
  padding:3px 9px; border-radius:20px;
  background:rgba(255,255,255,0.04); border:0.5px solid rgba(255,255,255,0.08);
  font-size:11px; color:rgba(255,255,255,0.3);
}
.sp-item .sp-icon { font-size:12px; line-height:1; }
.sp-item .sp-lbl { color:rgba(255,255,255,0.4); }
.sp-item .sp-st { font-size:10px; color:rgba(255,255,255,0.2); }
.sp-item.sp-active {
  background:rgba(251,191,36,0.08); border-color:rgba(251,191,36,0.25); color:rgba(251,191,36,0.8);
}
.sp-item.sp-active .sp-lbl { color:rgba(251,191,36,0.85); }
.sp-item.sp-active .sp-st  { color:rgba(251,191,36,0.6); animation:sdlBlink 1s infinite; }
@keyframes sdlBlink { 0%,100%{opacity:1} 50%{opacity:0.3} }
.sp-item.sp-done { background:rgba(52,211,153,0.07); border-color:rgba(52,211,153,0.2); }
.sp-item.sp-done .sp-lbl { color:rgba(52,211,153,0.8); }
.sp-item.sp-done .sp-st  { color:rgba(52,211,153,0.6); }
.sp-item.sp-err  { background:rgba(248,113,113,0.08); border-color:rgba(248,113,113,0.2); }
.sp-item.sp-err  .sp-lbl { color:#f87171; }

/* Big count */
.sdl-big-count { text-align:center; margin-bottom:12px; }
.sdl-big-count .n {
  font-size:44px; font-weight:600; color:rgba(255,255,255,0.9);
  line-height:1; font-variant-numeric:tabular-nums; display:block;
}
.sdl-big-count .n .sub { font-size:22px; color:rgba(255,255,255,0.22); font-weight:400; }
.sdl-big-count .lbl { font-size:11px; color:rgba(255,255,255,0.28); display:block; margin-top:4px; letter-spacing:0.04em; }
.sdl-prog { height:2px; background:rgba(255,255,255,0.07); border-radius:999px; overflow:hidden; margin-bottom:12px; }
.sdl-prog-bar { height:100%; border-radius:999px; background:rgba(255,255,255,0.72); transition:width 0.35s ease; }
.sdl-prog-bar.ind { width:45%; background:linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent); background-size:200% 100%; animation:sdlShimmer 1.5s infinite; }
@keyframes sdlShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

/* Buttons */
.sdl-btn {
  display:block; width:100%; padding:10px 14px; margin-bottom:6px; border:none; border-radius:11px;
  cursor:pointer; font-size:12.5px; font-weight:500; letter-spacing:0.01em;
  text-align:center; -webkit-font-smoothing:antialiased;
  transition:opacity 0.14s,transform 0.1s; position:relative;
}
.sdl-btn:not(:disabled):active { transform:scale(0.98); }
.sdl-btn:disabled { opacity:0.22; cursor:not-allowed; }
.sdl-btn-primary { background:rgba(255,255,255,0.92); color:#0a0a0a; }
.sdl-btn-primary:not(:disabled):hover { opacity:0.84; }
.sdl-btn-secondary { background:rgba(255,255,255,0.055); color:rgba(255,255,255,0.62); border:0.5px solid rgba(255,255,255,0.09); }
.sdl-btn-secondary:not(:disabled):hover { background:rgba(255,255,255,0.09); }
.sdl-btn-stop { background:rgba(248,113,113,0.1); color:#fca5a5; border:0.5px solid rgba(248,113,113,0.18); }
.sdl-btn-stop:not(:disabled):hover { background:rgba(248,113,113,0.18); }
.sdl-btn-ghost { background:none; color:rgba(255,255,255,0.3); border:0.5px solid rgba(255,255,255,0.08); font-size:11.5px; padding:7px 14px; }
.sdl-btn-ghost:not(:disabled):hover { color:rgba(255,255,255,0.6); border-color:rgba(255,255,255,0.18); }

/* Stats row */
.sdl-stats { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:12px; }
.sdl-stat { display:flex; align-items:center; gap:4px; font-size:11px; color:rgba(255,255,255,0.26); }
.sdl-stat-n { color:rgba(255,255,255,0.68); font-weight:500; font-variant-numeric:tabular-nums; }
.sdl-stat-sep { width:1px; height:10px; background:rgba(255,255,255,0.09); }

/* Export toggles */
.sdl-export-toggles {
  background:rgba(255,255,255,0.025); border:0.5px solid rgba(255,255,255,0.07);
  border-radius:12px; margin-bottom:12px; overflow:hidden;
}
.sdl-export-row {
  display:flex; align-items:center; padding:8px 13px;
  border-bottom:0.5px solid rgba(255,255,255,0.05);
  transition:background 0.1s;
}
.sdl-export-row:last-child { border-bottom:none; }
.sdl-export-row:hover { background:rgba(255,255,255,0.02); }
.sdl-export-lbl {
  font-size:11.5px; color:rgba(255,255,255,0.58); flex:1; cursor:default; line-height:1.3;
}
.sdl-export-lbl span { font-size:10px; color:rgba(255,255,255,0.22); display:block; margin-top:1px; }

/* Toggle */
.sdl-toggle { position:relative; width:32px; height:18px; flex-shrink:0; cursor:pointer; display:block; }
.sdl-toggle input { opacity:0; width:0; height:0; position:absolute; }
.sdl-toggle-track { position:absolute; inset:0; background:rgba(255,255,255,0.1); border-radius:999px; transition:background 0.2s; }
.sdl-toggle input:checked + .sdl-toggle-track { background:rgba(52,211,153,0.65); }
.sdl-toggle-thumb { position:absolute; top:3px; left:3px; width:12px; height:12px; border-radius:50%; background:rgba(255,255,255,0.9); transition:transform 0.2s; pointer-events:none; }
.sdl-toggle input:checked ~ .sdl-toggle-thumb { transform:translateX(14px); }

/* Counter pill */
#sdl-counter-pill {
  display:block; text-align:center; margin-bottom:10px; font-size:11px; color:rgba(255,255,255,0.28);
  background:rgba(255,255,255,0.04); border:0.5px solid rgba(255,255,255,0.08);
  border-radius:9px; padding:7px 10px; transition:background 0.2s,color 0.2s;
}
#sdl-counter-pill.filtered { background:rgba(99,102,241,0.12); border-color:rgba(99,102,241,0.3); color:rgba(165,170,255,0.85); }
#sdl-counter-pill.flash { animation:sdlFlash 0.3s ease; }
@keyframes sdlFlash { 0%,100%{opacity:1} 50%{opacity:0.55} }

/* Filter disclosure — more prominent */
.sdl-disc {
  display:flex; align-items:center; gap:7px; cursor:pointer; margin-bottom:8px;
  font-size:12px; font-weight:500; color:rgba(255,255,255,0.42); user-select:none;
  transition:color 0.15s; padding:6px 0;
}
.sdl-disc:hover { color:rgba(255,255,255,0.7); }
.sdl-disc-line { flex:1; height:0.5px; background:rgba(255,255,255,0.09); }
.sdl-disc-badge {
  font-size:9.5px; padding:2px 8px; border-radius:20px; background:rgba(255,255,255,0.07);
  color:rgba(255,255,255,0.35); transition:background 0.2s,color 0.2s; font-weight:400;
}
.sdl-disc-badge.active { background:rgba(99,102,241,0.22); color:rgba(165,170,255,0.9); }
.sdl-disc-arrow { font-size:8px; transition:transform 0.2s; display:inline-block; }
.sdl-disc.open .sdl-disc-arrow { transform:rotate(180deg); }
.sdl-drawer { display:none; flex-direction:column; gap:0; margin-bottom:10px; }
.sdl-drawer.open { display:flex; }

/* Filter sections */
.sdl-f-sec { margin-bottom:10px; }
.sdl-f-lbl { font-size:9.5px; color:rgba(255,255,255,0.22); text-transform:uppercase; letter-spacing:0.08em; display:block; margin-bottom:5px; }
.sdl-f-inp {
  width:100%; box-sizing:border-box;
  background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.65); border:0.5px solid rgba(255,255,255,0.09);
  border-radius:8px; padding:6px 9px; font-size:12px; outline:none; user-select:text;
}
.sdl-f-inp:focus { border-color:rgba(255,255,255,0.22); }
.sdl-f-row { display:flex; gap:5px; }
.sdl-f-row .sdl-f-inp { flex:1; }

/* Filter 2-col grid */
.sdl-f-grid2 {
  display:grid; grid-template-columns:1fr 1fr; gap:0 14px; margin-bottom:10px;
}
.sdl-f-grid2 .sdl-f-sec { margin-bottom:8px; }

/* Filter group header */
.sdl-f-group-hd {
  font-size:9.5px; color:rgba(255,255,255,0.28); text-transform:uppercase;
  letter-spacing:0.06em; font-weight:600; margin-bottom:7px; padding-bottom:6px;
  border-bottom:0.5px solid rgba(255,255,255,0.06);
}

/* N-direction row */
.sdl-f-n-row { display:flex; gap:5px; align-items:center; margin-bottom:5px; }
.sdl-seg-row { display:flex; gap:4px; margin-bottom:4px; }
.sdl-seg {
  flex:1; text-align:center; padding:5px 0; border-radius:7px;
  background:rgba(255,255,255,0.05); font-size:11px; color:rgba(255,255,255,0.3);
  cursor:pointer; transition:all 0.15s; border:0.5px solid rgba(255,255,255,0.08);
  user-select:none;
}
.sdl-seg:hover { background:rgba(255,255,255,0.09); }
.sdl-seg.active { background:rgba(99,102,241,0.15); border-color:rgba(99,102,241,0.3); color:rgba(165,170,255,0.9); }

.sdl-chips { display:flex; flex-wrap:wrap; gap:3px; }
.sdl-chip {
  padding:2.5px 8px; border-radius:20px; background:rgba(255,255,255,0.06);
  border:0.5px solid rgba(255,255,255,0.09); color:rgba(255,255,255,0.42);
  font-size:11px; cursor:pointer; transition:all 0.15s;
}
.sdl-chip:hover { background:rgba(255,255,255,0.1); color:rgba(255,255,255,0.7); }
.sdl-chip.active { background:rgba(99,102,241,0.18); border-color:rgba(99,102,241,0.35); color:rgba(165,170,255,0.9); }
.sdl-chip-empty { font-size:11px; color:rgba(255,255,255,0.15); font-style:italic; }
#sdl-filter-reset {
  display:block; font-size:10.5px; color:rgba(255,255,255,0.22); cursor:pointer;
  text-align:right; margin-top:4px; text-decoration:none;
}
#sdl-filter-reset:hover { color:rgba(255,255,255,0.55); }

.sdl-f-divider {
  height:0.5px; background:rgba(255,255,255,0.06); margin:6px 0 10px;
  grid-column: 1 / -1;
}

/* Speed */
.sdl-speed { margin:2px 0 10px; }
.sdl-speed-lbl { font-size:10px; color:rgba(255,255,255,0.2); text-transform:uppercase; letter-spacing:0.07em; margin-bottom:7px; display:block; }
.sdl-speed-segs { display:flex; gap:5px; margin-bottom:6px; }
.sdl-speed-seg {
  flex:1; display:flex; flex-direction:column; align-items:center; padding:8px 4px;
  border-radius:10px; background:rgba(255,255,255,0.04); border:0.5px solid rgba(255,255,255,0.08);
  cursor:pointer; transition:all 0.15s; gap:2px; user-select:none;
}
.sdl-speed-seg:hover { background:rgba(255,255,255,0.08); }
.spd-std.active  { background:rgba(52,211,153,0.1);  border-color:rgba(52,211,153,0.3); }
.spd-fast.active { background:rgba(251,191,36,0.1);  border-color:rgba(251,191,36,0.3); }
.spd-rip.active  { background:rgba(248,113,113,0.1); border-color:rgba(248,113,113,0.3); }
.s-icon { font-size:12px; } .s-lbl { font-size:11px; font-weight:500; } .s-risk { font-size:9px; color:rgba(255,255,255,0.28); }
.sdl-speed-hint { font-size:9.5px; color:rgba(255,255,255,0.22); text-align:center; }
.sdl-speed-hint.warn   { color:rgba(251,191,36,0.65); }
.sdl-speed-hint.danger { color:rgba(248,113,113,0.65); }

/* Coffee */
.sdl-coffee {
  margin-bottom:12px; padding:13px 12px; border-radius:13px;
  background:rgba(251,191,36,0.07); border:0.5px solid rgba(251,191,36,0.2);
  display:flex; flex-direction:column; align-items:center; gap:8px; text-align:center;
}
.sdl-coffee-icon { font-size:22px; line-height:1; }
.sdl-coffee-msg { font-size:11px; color:rgba(255,255,255,0.55); line-height:1.55; max-width:260px; margin:0; }
.sdl-coffee-msg strong { color:rgba(255,255,255,0.78); font-weight:500; }
.sdl-coffee-btn {
  display:inline-flex; align-items:center; gap:6px;
  background:#FFDD00; color:#0a0a0a; border:none; border-radius:20px; padding:8px 18px;
  font-size:12px; font-weight:700; text-decoration:none; cursor:pointer;
  transition:opacity 0.15s,transform 0.1s; letter-spacing:0.01em; -webkit-font-smoothing:antialiased;
}
.sdl-coffee-btn:hover { opacity:0.88; }
.sdl-coffee-btn:active { transform:scale(0.97); }

/* Settings drawer */
#sdl-expert-foot {
  display:flex; align-items:center; gap:8px; margin-top:12px; padding-top:10px;
  border-top:0.5px solid rgba(255,255,255,0.05); cursor:pointer; color:rgba(255,255,255,0.16);
  font-size:10px; letter-spacing:0.05em; text-transform:uppercase; user-select:none; transition:color 0.15s;
}
#sdl-expert-foot:hover { color:rgba(255,255,255,0.4); }
#sdl-expert-foot .exp-line { flex:1; height:0.5px; background:rgba(255,255,255,0.05); }
#sdl-expert-foot .exp-arrow { font-size:8px; transition:transform 0.2s; display:inline-block; }
#sdl-expert-foot.open .exp-arrow { transform:rotate(180deg); }
.sdl-sec-title {
  font-size:9.5px; color:rgba(255,255,255,0.18); text-transform:uppercase; letter-spacing:0.08em;
  margin:13px 0 8px; padding-top:12px; border-top:0.5px solid rgba(255,255,255,0.05);
}
.sdl-sec-title.first { margin-top:4px; border-top:none; padding-top:0; }
.sdl-setting { display:flex; align-items:center; justify-content:space-between; margin-bottom:9px; }
.sdl-setting-lbl { font-size:11px; color:rgba(255,255,255,0.3); line-height:1.3; }
.sdl-setting-sub { font-size:9.5px; color:rgba(255,255,255,0.16); display:block; margin-top:1px; }
.sdl-inp-sm {
  background:rgba(255,255,255,0.055); color:rgba(255,255,255,0.68); border:0.5px solid rgba(255,255,255,0.09);
  border-radius:7px; padding:5px 9px; font-size:12px; width:64px; text-align:center; outline:none;
}
.sdl-inp-sm:focus { border-color:rgba(255,255,255,0.22); }
.sdl-inp-wide {
  background:rgba(255,255,255,0.055); color:rgba(255,255,255,0.58); border:0.5px solid rgba(255,255,255,0.09);
  border-radius:7px; padding:5px 9px; font-size:10.5px; font-family:"SF Mono",ui-monospace,monospace;
  width:100%; box-sizing:border-box; outline:none; margin-top:5px; user-select:text;
}
.sdl-inp-wide:focus { border-color:rgba(255,255,255,0.22); }
.sdl-tpl-tokens { font-size:9px; color:rgba(255,255,255,0.2); line-height:1.9; margin-bottom:4px; }
#sdl-log {
  background:rgba(255,255,255,0.025); border:0.5px solid rgba(255,255,255,0.06);
  border-radius:9px; padding:9px 11px; font-size:10.5px; font-family:"SF Mono",ui-monospace,monospace;
  line-height:1.75; max-height:90px; overflow-y:auto; white-space:pre-wrap; word-break:break-all;
  color:rgba(255,255,255,0.35); margin-bottom:10px; user-select:text;
}
#sdl-log::-webkit-scrollbar { width:3px; }
#sdl-log::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:2px; }

/* Scan story */
#sdl-scan-story {
  margin-top:4px; margin-bottom:14px; padding:12px 13px; border-radius:11px;
  background:rgba(255,255,255,0.03); border:0.5px solid rgba(255,255,255,0.06); text-align:center;
}
#sdl-story-icon { font-size:18px; display:block; margin-bottom:7px; }
#sdl-story-text { font-size:11px; color:rgba(255,255,255,0.42); line-height:1.6; transition:opacity 0.35s ease; margin:0; }
#sdl-shutdown-badge {
  display:inline-block; margin-top:10px; font-size:9.5px;
  color:rgba(255,255,255,0.22); background:rgba(255,255,255,0.04);
  border:0.5px solid rgba(255,255,255,0.07); border-radius:20px; padding:3px 10px;
}

/* Done screen */
#sdl-s-done { padding-bottom:4px; }
.sdl-done-hero {
  text-align:center; padding:18px 8px 14px;
  border-bottom:0.5px solid rgba(255,255,255,0.06); margin-bottom:14px;
}
.sdl-done-check {
  display:inline-flex; align-items:center; justify-content:center;
  width:42px; height:42px; border-radius:50%;
  background:rgba(52,211,153,0.12); border:1.5px solid rgba(52,211,153,0.35);
  font-size:20px; color:#34d399; margin-bottom:10px;
  animation:sdlCheckPop 0.45s cubic-bezier(0.175,0.885,0.32,1.275) forwards;
}
@keyframes sdlCheckPop { 0%{transform:scale(0);opacity:0} 100%{transform:scale(1);opacity:1} }
.sdl-done-title { font-size:15px; font-weight:600; color:rgba(255,255,255,0.9); margin-bottom:6px; line-height:1.35; }
.sdl-done-saved { font-size:11.5px; color:rgba(255,255,255,0.38); line-height:1.55; }
.sdl-done-stats {
  display:flex; align-items:center; justify-content:center; gap:10px;
  margin-bottom:14px; padding:10px 12px; border-radius:10px;
  background:rgba(255,255,255,0.03); border:0.5px solid rgba(255,255,255,0.07);
}
.sdl-done-stat { display:flex; align-items:center; gap:4px; font-size:11px; color:rgba(255,255,255,0.3); }
.sdl-done-stat-n { font-size:14px; font-weight:600; color:rgba(255,255,255,0.75); font-variant-numeric:tabular-nums; }
.sdl-done-stat-ok .sdl-done-stat-n { color:#34d399; }
.sdl-done-stat-err .sdl-done-stat-n { color:#f87171; }
.sdl-done-stat-sep { width:1px; height:14px; background:rgba(255,255,255,0.09); }
.sdl-done-filters {
  margin-bottom:12px; padding:8px 11px; border-radius:9px;
  background:rgba(99,102,241,0.07); border:0.5px solid rgba(99,102,241,0.2);
  font-size:10px; color:rgba(165,170,255,0.7); line-height:1.5;
}
.sdl-done-filters-lbl { color:rgba(255,255,255,0.2); display:block; margin-bottom:2px; font-size:9px; text-transform:uppercase; letter-spacing:0.07em; }
.sdl-done-secondary {
  display:flex; align-items:center; justify-content:center; gap:8px;
  margin-bottom:10px; font-size:11px; color:rgba(255,255,255,0.2);
}
.sdl-done-github-link { color:rgba(255,255,255,0.35); text-decoration:none; transition:color 0.15s; }
.sdl-done-github-link:hover { color:rgba(255,255,255,0.65); }
.sdl-done-sep { color:rgba(255,255,255,0.12); }

/* Toast */
#sdl-toast {
  position:fixed; bottom:24px; right:16px; background:rgba(18,18,18,0.96); backdrop-filter:blur(20px);
  border:0.5px solid rgba(255,255,255,0.1); border-radius:10px; padding:9px 15px;
  font-size:12px; color:rgba(255,255,255,0.75); z-index:2147483646; pointer-events:none;
  opacity:0; transform:translateY(8px); transition:opacity 0.25s,transform 0.25s;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
}
#sdl-toast.tin  { opacity:1; transform:translateY(0); }
#sdl-toast.tout { opacity:0; transform:translateY(8px); }
`;

    // =====================================================================
    // PANEL HTML
    // =====================================================================
    function createPanel() {
        if (document.getElementById('sdl')) return;

        const styleEl = document.createElement('style');
        styleEl.textContent = STYLE;
        document.head.appendChild(styleEl);

        const toast = document.createElement('div');
        toast.id = 'sdl-toast';
        document.body.appendChild(toast);

        const p = document.createElement('div');
        p.id = 'sdl';
        p.innerHTML = `
<div id="sdl-header">
  <img id="sdl-logo"
       src="${LOGO_URL}"
       alt="SoraVault" referrerpolicy="no-referrer">
  <span id="sdl-logo-fb">🔐</span>
  <span id="sdl-title">SoraVault 2.0</span>
  <span id="sdl-update-badge"></span>
  <div id="sdl-header-right">
        
    <div id="sdl-auth" title="Waiting for auth…"></div>
    
    <a class="sdl-hd-btn" href="https://buymeacoffee.com/soravault" target="_blank"
       rel="noopener noreferrer" title="Support SoraVault" style="text-decoration:none;font-size:14px;">☕</a>
    
    <a href="https://github.com/charyou/SoraVault" target="_blank" class="sdl-gh-link" title="View source on GitHub">
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z"></path>
        </svg>
    </a>    

       <button class="sdl-hd-btn" id="sdl-gear" title="Settings">&#x2699;</button>
    <button class="sdl-hd-btn" id="sdl-min"  title="Minimise">&#x2014;</button>
  </div>
</div>

<div id="sdl-body">
  <div id="sdl-status"></div>

  <!-- ─── STATE: init ──────────────────────────────────────── -->
  <div id="sdl-s-init">
    <div class="sdl-src-groups">

      <!-- Sora 1 -->
      <div class="sdl-src-group">
        <div class="sdl-src-group-hd">Sora 1</div>
        <label class="sdl-src-row" id="sdl-src-row-v1_library">
          <input type="checkbox" id="sdl-src-cb-v1_library" checked>
          <span class="sdl-src-icon">📷</span>
          <span class="sdl-src-name">Library</span>
          <span class="sdl-src-sub">V1 image library</span>
        </label>
        <label class="sdl-src-row" id="sdl-src-row-v1_liked">
          <input type="checkbox" id="sdl-src-cb-v1_liked" checked>
          <span class="sdl-src-icon">♡</span>
          <span class="sdl-src-name">Likes</span>
          <span class="sdl-src-sub">V1 favorites</span>
        </label>
      </div>

      <!-- Sora 2 -->
      <div class="sdl-src-group">
        <div class="sdl-src-group-hd">
          Sora 2
          <span class="sdl-src-group-badge badge-checking" id="sdl-v2-status-badge">checking…</span>
        </div>
        <div id="sdl-v2-geo-notice" class="sdl-v2-notice"></div>
        <label class="sdl-src-row" id="sdl-src-row-v2_profile">
          <input type="checkbox" id="sdl-src-cb-v2_profile" checked>
          <span class="sdl-src-icon">🎬</span>
          <span class="sdl-src-name">Videos</span>
          <span class="sdl-src-sub">V2 published posts</span>
        </label>
        <label class="sdl-src-row" id="sdl-src-row-v2_drafts">
          <input type="checkbox" id="sdl-src-cb-v2_drafts" checked>
          <span class="sdl-src-icon">📋</span>
          <span class="sdl-src-name">Drafts</span>
          <span class="sdl-src-sub">V2 all generated</span>
        </label>
        <label class="sdl-src-row" id="sdl-src-row-v2_liked">
          <input type="checkbox" id="sdl-src-cb-v2_liked" checked>
          <span class="sdl-src-icon">♡</span>
          <span class="sdl-src-name">Liked</span>
          <span class="sdl-src-sub">V2 liked videos</span>
        </label>
      </div>

    </div>

    <div id="sdl-src-note">Works from any Sora page · no scrolling needed</div>
    <button class="sdl-btn sdl-btn-primary" id="sdl-scan">Scan All</button>
    <div style="font-size:10px;color:rgba(255,255,255,0.16);text-align:center;margin-top:6px;line-height:1.5;">
      Runs as a Chrome Extension · File System API enabled
    </div>
  </div>

  <!-- ─── STATE: scanning ──────────────────────────────────── -->
  <div id="sdl-s-scanning" style="display:none">
    <div class="sdl-big-count">
      <span class="n" id="sdl-scan-count">0</span>
      <span class="lbl">items found so far</span>
    </div>
    <div class="sdl-prog"><div class="sdl-prog-bar ind"></div></div>
    <div id="sdl-src-progress"></div>
    <div id="sdl-scan-story">
      <span id="sdl-story-icon">🔍</span>
      <p id="sdl-story-text">Connecting to your Sora library…</p>
      <span id="sdl-shutdown-badge">loading…</span>
    </div>
    <button class="sdl-btn sdl-btn-stop" id="sdl-stop-scan">Stop</button>
  </div>

  <!-- ─── STATE: ready ─────────────────────────────────────── -->
  <div id="sdl-s-ready" style="display:none">

    <!-- Export toggles -->
    <div class="sdl-export-toggles">
      <div class="sdl-export-row">
        <span class="sdl-export-lbl">Save media<span>images &amp; videos to disk</span></span>
        <label class="sdl-toggle">
          <input type="checkbox" id="sdl-cfg-SAVE_MEDIA" checked>
          <div class="sdl-toggle-track"></div>
          <div class="sdl-toggle-thumb"></div>
        </label>
      </div>
      <div class="sdl-export-row">
        <span class="sdl-export-lbl">Save .txt sidecar<span>prompt + metadata per file</span></span>
        <label class="sdl-toggle">
          <input type="checkbox" id="sdl-cfg-DOWNLOAD_TXT" ${CFG.DOWNLOAD_TXT ? 'checked' : ''}>
          <div class="sdl-toggle-track"></div>
          <div class="sdl-toggle-thumb"></div>
        </label>
      </div>
      <div class="sdl-export-row">
        <span class="sdl-export-lbl">Save .json manifest<span>full metadata export</span></span>
        <label class="sdl-toggle">
          <input type="checkbox" id="sdl-cfg-SAVE_JSON" checked>
          <div class="sdl-toggle-track"></div>
          <div class="sdl-toggle-thumb"></div>
        </label>
      </div>
    </div>

    <div id="sdl-counter-pill">&#x2014;</div>
    <button class="sdl-btn sdl-btn-primary"   id="sdl-dl"     disabled>Download All</button>
    <button class="sdl-btn sdl-btn-secondary" id="sdl-rescan">&#x21ba;&#x2002;Rescan</button>

    <!-- Filter disclosure — more prominent -->
    <div class="sdl-disc" id="sdl-filter-disc">
      <span class="sdl-disc-line"></span>
      <span>&#x1F50D; Filters</span>
      <span class="sdl-disc-badge" id="sdl-filter-badge">none active</span>
      <span class="sdl-disc-arrow">&#x25bc;</span>
      <span class="sdl-disc-line"></span>
    </div>

    <div class="sdl-drawer" id="sdl-filter-drawer">

      <!-- Keyword (full width) -->
      <div class="sdl-f-sec">
        <span class="sdl-f-lbl">Keyword in prompt</span>
        <input class="sdl-f-inp" id="sdl-f-keyword" type="text" placeholder="comma-separated, all must match">
      </div>

      <!-- Date range + N items side by side -->
      <div class="sdl-f-grid2">
        <div class="sdl-f-sec">
          <span class="sdl-f-lbl">Date range</span>
          <div class="sdl-f-row">
            <input class="sdl-f-inp" id="sdl-f-date-from" type="date" title="From">
            <input class="sdl-f-inp" id="sdl-f-date-to"   type="date" title="To">
          </div>
        </div>
        <div class="sdl-f-sec">
          <span class="sdl-f-lbl">First / Last N</span>
          <div class="sdl-seg-row">
            <div class="sdl-seg active" id="sdl-n-last">&#x2193; Last</div>
            <div class="sdl-seg"        id="sdl-n-first">&#x2191; First</div>
          </div>
          <input class="sdl-f-inp" id="sdl-f-n-items" type="number" min="1" placeholder="N items — empty = all">
        </div>
      </div>

      <!-- V1 / V2 chip filters side by side -->
      <div class="sdl-f-grid2">
        <!-- V1 — Images -->
        <div>
          <div class="sdl-f-group-hd">📷 Sora 1 · Images</div>
          <div class="sdl-f-sec">
            <span class="sdl-f-lbl">Aspect ratio</span>
            <div class="sdl-chips" id="sdl-f-v1-ratios"></div>
          </div>
          <div class="sdl-f-sec">
            <span class="sdl-f-lbl">Quality</span>
            <div class="sdl-chips" id="sdl-f-v1-qualities"></div>
          </div>
          <div class="sdl-f-sec">
            <span class="sdl-f-lbl">Operation</span>
            <div class="sdl-chips" id="sdl-f-v1-operations"></div>
          </div>
        </div>
        <!-- V2 — Videos -->
        <div>
          <div class="sdl-f-group-hd">🎬 Sora 2 · Videos</div>
          <div class="sdl-f-sec">
            <span class="sdl-f-lbl">Aspect ratio</span>
            <div class="sdl-chips" id="sdl-f-v2-ratios"></div>
          </div>
          <div class="sdl-f-sec">
            <span class="sdl-f-lbl">Quality</span>
            <div class="sdl-chips" id="sdl-f-v2-qualities"></div>
          </div>
        </div>
      </div>

      <!-- Author exclude (full width) -->
      <div class="sdl-f-sec">
        <span class="sdl-f-lbl">Exclude author (likes only)</span>
        <input class="sdl-f-inp" id="sdl-f-author" type="text" placeholder="exact username to exclude, case-insensitive">
      </div>

      <a id="sdl-filter-reset">Reset all filters</a>
    </div>
  </div>

  <!-- ─── STATE: downloading ───────────────────────────────── -->
  <div id="sdl-s-downloading" style="display:none">
    <div class="sdl-coffee">
      <div class="sdl-coffee-icon">☕</div>
      <p class="sdl-coffee-msg">
        <strong>SoraVault is free</strong> — built in spare time so your creative work
        survives Sora's shutdown.<br>
        If it saved something precious, a coffee means the world.
      </p>
      <a class="sdl-coffee-btn"
         href="https://buymeacoffee.com/soravault"
         target="_blank" rel="noopener noreferrer">
        Buy me a coffee ☕
      </a>
    </div>
    <div class="sdl-big-count">
      <span class="n">
        <span id="sdl-dl-count">0</span><span class="sub"> / <span id="sdl-dl-total">0</span></span>
      </span>
      <span class="lbl">downloaded</span>
    </div>
    <div class="sdl-prog"><div class="sdl-prog-bar" id="sdl-dl-bar" style="width:0%"></div></div>
    <div class="sdl-stats">
      <div class="sdl-stat"><span class="sdl-stat-n" id="sdl-dl-done">0</span><span>done</span></div>
      <div class="sdl-stat-sep"></div>
      <div class="sdl-stat" id="sdl-fail-wrap"><span class="sdl-stat-n" id="sdl-dl-failed">0</span><span>failed</span></div>
      <div class="sdl-stat-sep"></div>
      <div class="sdl-stat"><span id="sdl-dl-eta"></span></div>
    </div>
    <div class="sdl-speed">
      <span class="sdl-speed-lbl">Download speed</span>
      <div class="sdl-speed-segs">
        <div class="sdl-speed-seg spd-std active" data-spd="0">
          <span class="s-icon">&#x25cf;</span><span class="s-lbl">Standard</span><span class="s-risk">Safe</span>
        </div>
        <div class="sdl-speed-seg spd-fast" data-spd="1">
          <span class="s-icon">&#x25ce;</span><span class="s-lbl">Faster</span><span class="s-risk">Low risk</span>
        </div>
        <div class="sdl-speed-seg spd-rip" data-spd="2">
          <span class="s-icon">&#x25c9;</span><span class="s-lbl">Very fast</span><span class="s-risk">Ban risk!</span>
        </div>
      </div>
      <div class="sdl-speed-hint">2 workers · 300 ms delay · safe</div>
    </div>
    <button class="sdl-btn sdl-btn-stop" id="sdl-stop-dl">Stop</button>
  </div>

  <!-- ─── STATE: done ──────────────────────────────────────── -->
  <div id="sdl-s-done" style="display:none">
    <div class="sdl-done-hero">
      <div class="sdl-done-check">✓</div>
      <div class="sdl-done-title">Your library is safe.</div>
      <div class="sdl-done-saved" id="sdl-done-saved">Computing time saved…</div>
    </div>
    <div class="sdl-done-stats" id="sdl-done-stats"></div>
    <div class="sdl-done-filters" id="sdl-done-filters" style="display:none">
      <span class="sdl-done-filters-lbl">Filters applied</span>
      <span id="sdl-done-filter-list"></span>
    </div>
    <div class="sdl-coffee">
      <div class="sdl-coffee-icon">☕</div>
      <p class="sdl-coffee-msg">
        <strong>I built this so nobody has to lose their work.</strong><br>
        It's free, it stays free. A coffee means the world.
      </p>
      <a class="sdl-coffee-btn"
         href="https://buymeacoffee.com/soravault"
         target="_blank" rel="noopener noreferrer">
        Buy me a coffee ☕
      </a>
    </div>
    <div class="sdl-done-secondary">
      <a class="sdl-done-github-link"
         href="https://github.com/${GITHUB_REPO}"
         target="_blank" rel="noopener noreferrer">
        ⭐ Star on GitHub
      </a>
      <span class="sdl-done-sep">·</span>
      <span style="color:rgba(255,255,255,0.18);font-size:10.5px;">Desktop app coming soon</span>
    </div>
    <button class="sdl-btn sdl-btn-secondary" id="sdl-done-back">← Back</button>
  </div>

  <!-- ─── SETTINGS DRAWER ──────────────────────────────────── -->
  <div class="sdl-drawer" id="sdl-settings-drawer">
    <div class="sdl-sec-title first">Download folders (automatic)</div>
    <div style="font-size:10.5px;color:rgba(255,255,255,0.25);line-height:1.9;padding:2px 0 6px">
      📷 V1 Images  → <code style="color:rgba(255,255,255,0.38)">sora_v1_images</code><br>
      🎬 V1 Videos  → <code style="color:rgba(255,255,255,0.38)">sora_v1_videos</code><br>
      ♡  V1 Liked   → <code style="color:rgba(255,255,255,0.38)">sora_v1_liked</code><br>
      🎬 V2 Profile → <code style="color:rgba(255,255,255,0.38)">sora_v2_profile</code><br>
      📋 V2 Drafts  → <code style="color:rgba(255,255,255,0.38)">sora_v2_drafts</code><br>
      ♡  V2 Liked   → <code style="color:rgba(255,255,255,0.38)">sora_v2_liked</code>
    </div>
    <div style="font-size:9.5px;color:rgba(255,255,255,0.16);line-height:1.6;padding:0 0 4px">
      <strong style="color:rgba(255,255,255,0.25)">Chrome/Edge:</strong> folder picker — you choose where<br>
      <strong style="color:rgba(255,255,255,0.25)">Fallback:</strong> Browser anchor download → Downloads folder
    </div>
  </div>

  <!-- ─── EXPERT SECTION ───────────────────────────────────── -->
  <div id="sdl-expert-foot">
    <span class="exp-line"></span>
    <span>&#x26a1; Expert settings</span>
    <span class="exp-arrow">&#x25bc;</span>
    <span class="exp-line"></span>
  </div>

  <div class="sdl-drawer" id="sdl-expert-drawer">
    <div id="sdl-exp-template">
      <div class="sdl-sec-title first">Filename template</div>
      <div class="sdl-tpl-tokens">{date} {prompt} {genId} {taskId} {width} {height} {ratio} {quality} {operation} {model} {seed} {duration}</div>
      <input type="text" class="sdl-inp-wide" id="sdl-cfg-FILENAME_TEMPLATE"
             value="${CFG.FILENAME_TEMPLATE}">
      <div class="sdl-setting" style="margin-top:8px">
        <span class="sdl-setting-lbl">Prompt max length</span>
        <input type="number" class="sdl-inp-sm" id="sdl-cfg-PROMPT_MAX_LEN"
               value="${CFG.PROMPT_MAX_LEN}" min="10" max="200">
      </div>
    </div>

    <div class="sdl-sec-title" style="margin-top:4px">Log</div>
    <div id="sdl-log">Ready.</div>
    <button class="sdl-btn sdl-btn-secondary" id="sdl-clear"
            style="font-size:11.5px;padding:7px 14px">Clear &amp; reset</button>
  </div>
</div>`;
        document.body.appendChild(p);

        // Logo fallback
        document.getElementById('sdl-logo').addEventListener('error', function () {
            this.style.display = 'none';
            document.getElementById('sdl-logo-fb').style.display = 'flex';
        });

        // ── Drag to move ─────────────────────────────────────────────────
        let dragState = null;
        const header = document.getElementById('sdl-header');
        header.addEventListener('mousedown', e => {
            // Don't drag when clicking buttons/links/inputs
            if (e.target.closest('button,a,input,label')) return;
            const rect = p.getBoundingClientRect();
            dragState = {
                startX:   e.clientX,
                startY:   e.clientY,
                origLeft: rect.left,
                origTop:  rect.top,
            };
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!dragState) return;
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;
            const newLeft = Math.max(0, Math.min(window.innerWidth  - p.offsetWidth,  dragState.origLeft + dx));
            const newTop  = Math.max(0, Math.min(window.innerHeight - p.offsetHeight, dragState.origTop  + dy));
            p.style.left  = newLeft + 'px';
            p.style.top   = newTop  + 'px';
            p.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { dragState = null; });

        // ── Minimize ─────────────────────────────────────────────────────
        let minimised = false;
        document.getElementById('sdl-min').addEventListener('click', () => {
            minimised = !minimised;
            p.classList.toggle('collapsed', minimised);
            document.getElementById('sdl-min').textContent = minimised ? '+' : '—';
            document.getElementById('sdl-min').title = minimised ? 'Expand' : 'Minimise';
        });

        // ── Source checkboxes ─────────────────────────────────────────────
        SCAN_SOURCES.forEach(src => {
            const cb = document.getElementById('sdl-src-cb-' + src.id);
            if (!cb) return;
            cb.addEventListener('change', () => {
                if (cb.checked) enabledSources.add(src.id);
                else enabledSources.delete(src.id);
                updateScanButton();
            });
        });

        // ── Settings / Expert drawers ──────────────────────────────────────
        document.getElementById('sdl-gear').addEventListener('click', () =>
            document.getElementById('sdl-settings-drawer').classList.toggle('open'));

        document.getElementById('sdl-expert-foot').addEventListener('click', () => {
            const foot = document.getElementById('sdl-expert-foot');
            const open = document.getElementById('sdl-expert-drawer').classList.toggle('open');
            foot.classList.toggle('open', open);
        });

        document.getElementById('sdl-filter-disc').addEventListener('click', () => {
            const disc = document.getElementById('sdl-filter-disc');
            const open = document.getElementById('sdl-filter-drawer').classList.toggle('open');
            disc.classList.toggle('open', open);
        });

        // ── Primary actions ───────────────────────────────────────────────
        document.getElementById('sdl-scan').addEventListener('click',      startScan);
        document.getElementById('sdl-stop-scan').addEventListener('click', stopAll);
        document.getElementById('sdl-stop-dl').addEventListener('click',   stopAll);
        document.getElementById('sdl-dl').addEventListener('click',        startDownload);

        document.getElementById('sdl-rescan').addEventListener('click', () => {
            collected.clear(); completedCount = 0; failedCount = 0;
            setState('init'); log('Cleared. Ready for new scan.');
        });

        document.getElementById('sdl-done-back').addEventListener('click', () => {
            setState('ready');
            rebuildAllChips();
            recomputeSelection();
        });

        document.getElementById('sdl-clear').addEventListener('click', () => {
            collected.clear(); completedCount = 0; failedCount = 0; totalToDownload = 0;
            resetFilters(); resetFilterInputs(); setState('init'); log('Cleared.');
        });

        // ── Speed ───────────────────────────────────────────────────────
        document.querySelectorAll('.sdl-speed-seg').forEach(seg =>
            seg.addEventListener('click', () => setSpeedIdx(parseInt(seg.dataset.spd))));

        // ── N-direction ─────────────────────────────────────────────────
        document.getElementById('sdl-n-last').addEventListener('click', () => {
            filters.nDirection = 'last'; syncNDirButtons(); recomputeSelection();
        });
        document.getElementById('sdl-n-first').addEventListener('click', () => {
            filters.nDirection = 'first'; syncNDirButtons(); recomputeSelection();
        });

        // ── Filter inputs ────────────────────────────────────────────────
        document.getElementById('sdl-f-keyword').addEventListener('input',    e => { filters.keyword       = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-f-author').addEventListener('input',     e => { filters.authorExclude = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-f-n-items').addEventListener('input',    e => { filters.nItems        = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-f-date-from').addEventListener('change', e => { filters.dateFrom      = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-f-date-to').addEventListener('change',   e => { filters.dateTo        = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-filter-reset').addEventListener('click', () => {
            resetFilters(); resetFilterInputs(); recomputeSelection(); rebuildAllChips();
        });

        // ── Async init ───────────────────────────────────────────────────
        setTimeout(checkForUpdate, 1500);
        updateShutdownBadge();
        updateScanButton();
        setState('init');

        // Geo-check: first attempt after page settles, then poll every 10s if blocked or initializing
        setTimeout(preflightV2Check, 2500);
        setInterval(() => {
            if (uiState === 'init' || !isV2Supported) {
                preflightV2Check();
            }
        }, 10000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createPanel);
    else setTimeout(createPanel, 500);

})();
