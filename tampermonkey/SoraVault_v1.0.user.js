// ==UserScript==
// @name         SoraVault
// @namespace    https://github.com/charyou/SoraVault
// @version      1.0.0
// @description  Bulk backup Sora content — images, videos, drafts. Filter by keyword, ratio, date or count. Free your memories before Sora closes.
// @author       Sebastian Haas (charyou)
// @homepageURL  https://github.com/charyou/SoraVault
// @supportURL   https://github.com/charyou/SoraVault/issues
// @license      © 2026 Sebastian Haas – Personal use only; no redistribution or resale. See https://github.com/charyou/SoraVault/blob/main/LICENSE
// @match        https://sora.chatgpt.com/*
// @match        https://sora.com/*
// @match        https://www.sora.com/*
// @grant        GM_download
// @grant        unsafeWindow
// @connect      videos.openai.com
// @connect      sora.chatgpt.com
// @connect      api.github.com
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // =====================================================================
    // CONFIG & RELEASE INFO
    // =====================================================================
    const VERSION      = '1.0';
    const RELEASE_DATE = '2026-30-30';   // hardcoded release date
    const GITHUB_REPO  = 'charyou/SoraVault';
    const SORA_SHUTDOWN = new Date('2026-04-26T00:00:00Z');

    const CFG = {
        SCROLL_PATIENCE:    150,
        SCROLL_STEP_MS:     120,
        SCROLL_INITIAL_MS:  1000,
        PARALLEL_DOWNLOADS: 2,
        DOWNLOAD_TXT:       true,
        FILENAME_TEMPLATE:  '{date}_{prompt}_{genId}',
        PROMPT_MAX_LEN:     80,
    };

    // Per-category subfolder names (no config needed — fully automatic)
    const SUBFOLDERS = {
        v1:         'soravault_images_library',
        v2_profile: 'soravault_videos_profile',
        v2_drafts:  'soravault_videos_draft',
    };

    const SPEED_PRESETS = [
        { workers: 2, delay: 300 },
        { workers: 4, delay: 150 },
        { workers: 8, delay:  60 },
    ];

    // Storytelling messages shown during scan (rotated every ~4 seconds)
    const SCAN_STORIES = [
        { icon: '🎬', text: 'I started with Sora when it first dropped. Hundreds of prompts, late nights, that one image that randomly got 1,000+ likes. All of that matters.' },
        { icon: '💾', text: 'OpenAI\'s "export"? A full ChatGPT data dump. ZIP link valid 24 hours. Good luck finding your Sora files in 3 years of chat history.' },
        { icon: '🔍', text: 'Some prompts took hours to get right. The wording, the style, the weird happy accidents. That\'s not data. That\'s your creative memory.' },
        { icon: '⏳', text: 'I built SoraVault in a weekend because I refused to lose 1,800+ images I actually cared about. Turns out I\'m not the only one.' },
        { icon: '🏛️', text: 'The live-action Naruto. The fake movie poster with world leaders. The memes that made my friends cry laughing. No expiring ZIP is taking that from me.' },
        { icon: '🔐', text: 'Everything goes straight to your hard drive. No cloud, no account, no tracking. Your files, your folder, done.' },
        { icon: '💡', text: 'After this: filters let you pick by date, keyword, or aspect ratio. Download everything or just the gems.' },
        { icon: '🧡', text: 'This tool is free. If it saves your library, a coffee or a GitHub star is the best way to say thanks.' },
    ];

    // =====================================================================
    // STATE
    // =====================================================================
    const collected       = new Map();
    let oaiDeviceId       = null;
    let oaiLanguage       = 'en-US';
    const storedV2Headers = {};
    let isRunning         = false;
    let stopRequested     = false;
    let completedCount    = 0;
    let failedCount       = 0;
    let totalToDownload   = 0;
    let speedIdx          = 0;
    let uiState           = 'init';
    let scanStoryTimer    = null;
    let scanStoryIdx      = 0;
    let skipWaitRequested = false;
    let lastSaveTxt       = false;
    let lastFilterSnap    = [];   // snapshot of active filters at download time

    const filters = {
        keyword: '', ratios: new Set(), dateFrom: '', dateTo: '',
        qualities: new Set(), operations: new Set(), nItems: '', nDirection: 'last',
    };

    // =====================================================================
    // UTILITIES
    // =====================================================================
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

    function shutdownDaysDelta() {
        const now  = new Date();
        const diff = Math.round((now - SORA_SHUTDOWN) / 86400000);
        return diff; // positive = past, negative = future
    }

    // =====================================================================
    // MODE DETECTION
    // =====================================================================
    function detectMode() {
        const p = location.pathname;
        if (p.startsWith('/library'))  return 'v1';
        if (p.startsWith('/profile'))  return 'v2_profile';
        if (p.startsWith('/drafts'))   return 'v2_drafts';
        return 'unknown';
    }

    function isV2() { const m = detectMode(); return m === 'v2_profile' || m === 'v2_drafts'; }

    // =====================================================================
    // FETCH INTERCEPT
    // =====================================================================
    const _fetch = unsafeWindow.fetch.bind(unsafeWindow);

    unsafeWindow.fetch = async function (...args) {
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
                response.clone().json().then(ingestV1Page).catch(() => {});
            else if (url.includes('/backend/project_y/profile_feed/') ||
                     url.includes('/backend/project_y/profile/drafts/v2'))
                response.clone().json().then(d => ingestV2Page(d, url)).catch(() => {});
        }
        return response;
    };

    const _xhrOpen = unsafeWindow.XMLHttpRequest.prototype.open;
    const _xhrSend = unsafeWindow.XMLHttpRequest.prototype.send;
    const _xhrSetH = unsafeWindow.XMLHttpRequest.prototype.setRequestHeader;
    unsafeWindow.XMLHttpRequest.prototype.setRequestHeader = function (n, v) {
        if (n?.toLowerCase() === 'oai-device-id') { oaiDeviceId = v; refreshAuthBadge(); }
        if (n?.toLowerCase() === 'oai-language')  oaiLanguage = v;
        if (this._sv_url && this._sv_url.includes('/backend/project_y/')) {
            const SKIP = new Set(['content-type','accept-encoding','accept-language',
                                  'cache-control','pragma','origin','content-length']);
            if (!SKIP.has(n?.toLowerCase())) storedV2Headers[n.toLowerCase()] = v;
        }
        return _xhrSetH.apply(this, arguments);
    };
    unsafeWindow.XMLHttpRequest.prototype.open = function (m, u, ...r) {
        this._sv_url = u || '';
        return _xhrOpen.apply(this, [m, u, ...r]);
    };
    unsafeWindow.XMLHttpRequest.prototype.send = function (...a) {
        if ((this._sv_url || '').includes('/list_tasks'))
            this.addEventListener('load', function () {
                if (this.status === 200) try { ingestV1Page(JSON.parse(this.responseText)); } catch(e) {}
            });
        return _xhrSend.apply(this, a);
    };

    // =====================================================================
    // DATA INGESTION — v1 (Images / Library)
    // =====================================================================
    function ingestV1Page(data) {
        const tasks = data?.task_responses ?? data?.tasks ?? [];
        if (!Array.isArray(tasks)) return;
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
                const pngUrl = (gen.url ?? '').replace(/&amp;/g, '&');
                if (!pngUrl) return;
                if (!pngUrl.includes('_src_') && !/\.png/i.test(pngUrl.split('?')[0])) return;
                const gw = gen.width  ?? task.width  ?? null;
                const gh = gen.height ?? task.height ?? null;
                let ratio = null;
                if (gw && gh) { const g = gcd(gw, gh); ratio = `${gw/g}:${gh/g}`; }
                collected.set(genId, {
                    mode: 'v1', genId, taskId, date, prompt, pngUrl,
                    width: gw, height: gh, ratio,
                    quality:   gen.quality   ?? task.quality   ?? null,
                    operation: gen.operation ?? task.operation ?? null,
                    model:     gen.model     ?? task.model     ?? null,
                    seed:      gen.seed      ?? null,
                    taskType:  gen.task_type ?? task.type      ?? null,
                    nVariants,
                });
                added++;
            });
        });
        if (added > 0) { log(`+${added} intercepted → ${collected.size} total`); refreshScanCount(); }
        return { hasMore: data.has_more, lastId: data.last_id };
    }

    // =====================================================================
    // DATA INGESTION — v2 (Videos / Profile + Drafts)
    // =====================================================================
    function ingestV2Page(data, url) {
        const isDrafts = url && url.includes('/profile/drafts/');
        const items = data?.items ?? [];
        if (!Array.isArray(items)) return { hasMore: false, nextCursor: null };
        let added = 0;

        items.forEach(item => {
            if (isDrafts) {
                const genId = item.id ?? item.generation_id ?? '';
                if (!genId || collected.has(genId)) return;
                const date = item.created_at
                    ? new Date(item.created_at * 1000).toISOString().slice(0, 10) : '';
                const dlUrl = item.download_urls?.no_watermark
                           ?? item.download_urls?.watermark
                           ?? item.downloadable_url
                           ?? item.url ?? null;
                const downloadUrl = dlUrl && dlUrl.trim() ? dlUrl : null;
                const thumb = item.encodings?.thumbnail;
                const thumbUrl = thumb && typeof thumb === 'object' ? (thumb.url ?? null)
                               : (typeof thumb === 'string' ? thumb : null);
                const gw = item.width ?? null, gh = item.height ?? null;
                let ratio = null;
                if (gw && gh) { const g = gcd(gw, gh); ratio = `${gw/g}:${gh/g}`; }
                collected.set(genId, {
                    mode: 'v2', source: 'drafts', genId,
                    taskId: item.task_id ?? '', postId: null,
                    date, prompt: item.prompt ?? item.title ?? '',
                    downloadUrl, previewUrl: item.url ?? null, thumbUrl,
                    width: gw, height: gh, ratio,
                    duration: item.duration_s ?? null, model: null,
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

                if (added === 0 && items.indexOf(item) === 0) {
                    console.log('[SoraVault] profile att sample:', JSON.stringify(att).slice(0, 600));
                }

                const encSrc = att.encodings?.source;
                const encSrcUrl = encSrc && typeof encSrc === 'object'
                    ? (encSrc.url ?? null)
                    : (typeof encSrc === 'string' ? encSrc : null);

                const attUrl = att.download_urls?.no_watermark
                            ?? att.download_urls?.watermark
                            ?? att.downloadable_url
                            ?? encSrcUrl
                            ?? (typeof att === 'string' ? att : att.url) ?? null;
                const downloadUrl = attUrl && attUrl.trim() ? attUrl : null;
                const gw = att.width ?? null, gh = att.height ?? null;
                let ratio = null;
                if (gw && gh) { const g = gcd(gw, gh); ratio = `${gw/g}:${gh/g}`; }
                collected.set(postId, {
                    mode: 'v2', source: 'profile',
                    genId:  att.id ?? att.generation_id ?? postId,
                    taskId: att.task_id ?? null,
                    postId,
                    date, prompt: post.text ?? post.caption ?? '',
                    downloadUrl, previewUrl: att.url ?? null,
                    thumbUrl: post.preview_image_url ?? null,
                    width: gw, height: gh, ratio,
                    duration: att.duration_s ?? null, model: null,
                });
                added++;
            }
        });

        if (added > 0) { log(`+${added} intercepted → ${collected.size} total`); refreshScanCount(); }
        const nextCursor = data.cursor ?? null;
        return { hasMore: !!nextCursor, nextCursor };
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

    function snapshotActiveFilters() {
        const parts = [];
        if (filters.keyword.trim()) parts.push(`keyword: "${filters.keyword.trim()}"`);
        if (filters.dateFrom)       parts.push(`from ${filters.dateFrom}`);
        if (filters.dateTo)         parts.push(`to ${filters.dateTo}`);
        if (filters.ratios.size)    parts.push(`ratio: ${[...filters.ratios].join(', ')}`);
        if (filters.qualities.size) parts.push(`quality: ${[...filters.qualities].join(', ')}`);
        if (filters.operations.size)parts.push(`op: ${[...filters.operations].join(', ')}`);
        if (filters.nItems.trim())  parts.push(`${filters.nDirection} ${filters.nItems}`);
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
        return h;
    }

    async function fetchAllViaApi() {
        const mode = detectMode();
        if      (mode === 'v1')         await fetchAllV1();
        else if (mode === 'v2_profile') await fetchAllV2('/backend/project_y/profile_feed/me?limit=8&cut=nf2');
        else if (mode === 'v2_drafts')  await fetchAllV2('/backend/project_y/profile/drafts/v2?limit=15');
        else log('Unknown page — API scan skipped, scroll-intercept only');
    }

    async function fetchAllV1() {
        log('Fetching via list_tasks…');
        let afterId = null, hasMore = true, page = 0;
        while (hasMore && !stopRequested) {
            page++;
            const qs  = `limit=20${afterId ? `&after=${encodeURIComponent(afterId)}` : ''}`;
            const url = `${location.origin}/backend/v2/list_tasks?${qs}`;
            let data;
            try {
                const r = await _fetch(url, { credentials: 'include', headers: buildHeaders() });
                if (!r.ok) { log(`HTTP ${r.status} p${page}${r.status === 401 ? ' — scroll first' : ''}`); break; }
                data = await r.json();
            } catch(e) { log(`Fetch error p${page}: ${e.message}`); break; }
            const result = ingestV1Page(data);
            hasMore = result?.hasMore ?? false;
            afterId = result?.lastId  ?? null;
            log(`Page ${page}: ${collected.size} items${hasMore ? '…' : ' ✓'}`);
            if (hasMore && afterId) await sleep(200);
        }
    }

    async function fetchAllV2(baseEndpoint) {
        const label = baseEndpoint.split('/').pop().split('?')[0];
        log(`Fetching v2 ${label}…`);
        const base = `${location.origin}${baseEndpoint}`;
        let cursor = null, hasMore = true, page = 0;
        while (hasMore && !stopRequested) {
            page++;
            const url = cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
            let data;
            try {
                const r = await _fetch(url, { credentials: 'include', headers: buildHeaders() });
                if (!r.ok) { log(`HTTP ${r.status} p${page}`); break; }
                data = await r.json();
            } catch(e) { log(`Fetch error p${page}: ${e.message}`); break; }
            const result = ingestV2Page(data, url);
            hasMore = result?.hasMore ?? false;
            cursor  = result?.nextCursor ?? null;
            log(`Page ${page}: ${collected.size} items${hasMore ? '…' : ' ✓'}`);
            if (hasMore && cursor) await sleep(300);
        }
    }

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
                if (d?.url) return d.url.replace(/&amp;/g, '&');
            }
        } catch(e) {}
        return item.pngUrl;
    }

    function extractUrlFromTree(tree) {
        const nodes = Array.isArray(tree) ? tree : [tree];
        for (const node of nodes) {
            const post = node?.post ?? node;
            for (const att of (post?.attachments ?? [])) {
                const u = att.download_urls?.no_watermark ?? att.downloadable_url ?? att.url;
                if (u) return u;
            }
        }
        return null;
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
            `Generation ID  : ${item.genId || item.postId || ''}`,
            `Task ID        : ${item.taskId || ''}`,
            `Date           : ${item.date}`,
        ];
        if (item.mode === 'v2') {
            if (item.postId)              lines.push(`Post ID        : ${item.postId}`);
            if (item.source)              lines.push(`Source         : ${item.source}`);
            if (item.duration != null)    lines.push(`Duration       : ${item.duration}s`);
        }
        if (item.width && item.height) {
            lines.push(`Resolution     : ${item.width} × ${item.height} px`);
            lines.push(`Aspect ratio   : ${item.ratio || '?'}`);
        }
        if (item.quality)   lines.push(`Quality        : ${item.quality}`);
        if (item.operation) lines.push(`Operation      : ${item.operation}`);
        if (item.model)     lines.push(`Model          : ${item.model}`);
        if (item.seed)      lines.push(`Seed           : ${item.seed}`);
        if (item.taskType)  lines.push(`Type           : ${item.taskType}`);
        if (item.nVariants) lines.push(`Variants gen.  : ${item.nVariants}`);
        lines.push('', '── Prompt ─────────────────────────────────────────────────', item.prompt || '(none)');
        return lines.join('\n');
    }

    // =====================================================================
    // FILE HELPERS
    // =====================================================================
    function getSubfolderName(item) {
        if (item.mode === 'v1')               return SUBFOLDERS.v1;
        if (item.source === 'drafts')         return SUBFOLDERS.v2_drafts;
        return SUBFOLDERS.v2_profile;
    }

    async function downloadFileFS(url, filename, dir) {
        try {
            const r = await _fetch(url);
            if (!r.ok) return false;
            const blob = await r.blob();
            const fh = await dir.getFileHandle(filename, { create: true });
            const w  = await fh.createWritable();
            await w.write(blob); await w.close();
            return true;
        } catch(e) { return false; }
    }

    async function downloadTextFileFS(content, filename, dir) {
        try {
            const fh = await dir.getFileHandle(filename, { create: true });
            const w  = await fh.createWritable();
            await w.write(content); await w.close();
            return true;
        } catch(e) { return false; }
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

    function showScrollWaiting(show) {
        const el = document.getElementById('sdl-scroll-wait');
        if (el) el.style.display = show ? '' : 'none';
    }

    function updateScrollWaitCount(secs) {
        const el = document.getElementById('sdl-scroll-wait-secs');
        if (el) el.textContent = secs > 0 ? `${secs}s` : '…';
    }

    function updateShutdownBadge() {
        const el = document.getElementById('sdl-shutdown-badge');
        if (!el) return;
        const delta = shutdownDaysDelta();
        if (delta >= 0) {
            el.textContent = `Sora closed ${delta} day${delta !== 1 ? 's' : ''} ago`;
            el.title = 'Sora shut down on April 28, 2025';
        } else {
            const left = Math.abs(delta);
            el.textContent = `${left} day${left !== 1 ? 's' : ''} left`;
            el.title = 'Sora shuts down on April 28, 2025 — save your work now';
        }
    }

    // =====================================================================
    // VERSION CHECK (async, non-blocking)
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
                if (badge) {
                    badge.textContent = `v${tag} available`;
                    badge.style.display = '';
                    badge.title = `New version ${tag} is available on GitHub`;
                }
            }
        } catch(e) { /* silently ignore — update check is best-effort */ }
    }

    // =====================================================================
    // SCAN & DOWNLOAD
    // =====================================================================
    async function startScan() {
        if (isRunning) return;
        const mode = detectMode();
        if (mode === 'unknown') {
            setStatus('Navigate to /library (images) or /profile, /drafts (videos) first');
            return;
        }
        isRunning = true; stopRequested = false; skipWaitRequested = false;
        collected.clear(); completedCount = 0; failedCount = 0;
        resetFilters();
        setState('scanning');
        startScanStories();
        await Promise.all([fetchAllViaApi(), fastScroll()]);
        stopScanStories();
        isRunning = false;
        if (collected.size === 0) {
            setState('init');
            setStatus('Nothing found — make sure you are on the right page');
        } else {
            const word = isV2() ? 'videos' : 'images';
            log(`Scan complete — ${collected.size} ${word} found`);
            setState('ready');
            rebuildAllChips();
            recomputeSelection();
        }
    }

    async function fastScroll() {
        const patience  = parseInt(readConfig('SCROLL_PATIENCE'))  || CFG.SCROLL_PATIENCE;
        const stepMs    = parseInt(readConfig('SCROLL_STEP_MS'))    || CFG.SCROLL_STEP_MS;
        const initialMs = parseInt(readConfig('SCROLL_INITIAL_MS')) || CFG.SCROLL_INITIAL_MS;
        skipWaitRequested = false;
        window.scrollTo(0, 0);
        await sleep(initialMs);
        const step = Math.floor(window.innerHeight * 1.5);
        let lastH = 0, same = 0;
        const WAIT_THRESHOLD = 10; // after this many same-height steps, show the waiting indicator
        for (let i = 0; i < 9999 && !stopRequested; i++) {
            window.scrollBy({ top: step, behavior: 'instant' });
            await sleep(stepMs);
            const h = document.documentElement.scrollHeight;
            if (h === lastH) {
                same++;
                if (same === WAIT_THRESHOLD) showScrollWaiting(true);
                if (same >= WAIT_THRESHOLD) {
                    const remaining = patience - same;
                    const secs = Math.max(0, Math.round(remaining * stepMs / 1000));
                    updateScrollWaitCount(secs);
                }
                if (same >= patience || skipWaitRequested) break;
            } else {
                if (same >= WAIT_THRESHOLD) showScrollWaiting(false);
                same = 0; lastH = h;
            }
        }
        showScrollWaiting(false);
        window.scrollTo(0, 0);
    }

    async function startDownload() {
        if (isRunning) return;
        const items = getFilteredItems();
        if (items.length === 0) return;

        let baseDir;
        try { baseDir = await window.showDirectoryPicker({ mode: 'readwrite' }); }
        catch(e) { log('Folder selection cancelled.'); return; }

        isRunning = true; stopRequested = false;
        completedCount = 0; failedCount = 0;
        totalToDownload = items.length;
        const saveTxt = readConfigBool('DOWNLOAD_TXT', CFG.DOWNLOAD_TXT);
        lastSaveTxt = saveTxt;
        lastFilterSnap = snapshotActiveFilters();

        const word = items.some(i => i.mode === 'v2') ? 'videos' : 'images';
        log(`Downloading ${totalToDownload} ${word}${saveTxt ? ' + TXT' : ''}…`);

        const totalEl = document.getElementById('sdl-dl-total');
        if (totalEl) totalEl.textContent = totalToDownload;
        setState('downloading');
        updateDownloadProgress();

        // Create per-category subdirectories lazily
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
                const url = await getDownloadUrl(item);
                const targetDir = await getSubDir(item);
                if (!url) {
                    failedCount++;
                    log(`No URL: ${item.genId || item.postId}`);
                    updateDownloadProgress(dlStart);
                    continue;
                }
                const base = buildBase(item);
                const ext  = item.mode === 'v2' ? '.mp4' : '.png';
                log(`[${i+1}/${totalToDownload}] ${base.slice(0, 55)}…`);
                const ok = await downloadFileFS(url, base + ext, targetDir);
                if (ok) completedCount++;
                else { failedCount++; log(`Failed: ${item.genId || item.postId}`); }
                if (saveTxt) {
                    await sleep(60);
                    await downloadTextFileFS(buildTxtContent(item), base + '.txt', targetDir);
                }
                updateDownloadProgress(dlStart);
                await sleep(SPEED_PRESETS[speedIdx].delay);
            }
        }

        while (idx < items.length && !stopRequested) {
            const conc = Math.min(items.length - idx, SPEED_PRESETS[speedIdx].workers);
            await Promise.all(Array.from({ length: conc }, () => worker()));
        }

        isRunning = false;

        if (stopRequested) {
            log(`Stopped — ${completedCount} saved, ${failedCount} failed`);
            setState('ready');
        } else {
            log(`All done — ${completedCount} saved${failedCount > 0 ? `, ${failedCount} failed` : ''} ✓`);
            showEndScreen(saveTxt);
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
    // END SCREEN
    // =====================================================================
    function computeTimeSaved(count, withTxt) {
        const secsPerItem = withTxt ? 120 : 20;   // 2 min with txt, 20 sec without
        const total = count * secsPerItem;
        if (total >= 3600) {
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            return `${h} HOUR${h > 1 ? 'S' : ''} and ${m} minute${m !== 1 ? 's' : ''}`;
        }
        if (total >= 60) {
            const m = Math.round(total / 60);
            return `${m} minute${m !== 1 ? 's' : ''}`;
        }
        return `${total} second${total !== 1 ? 's' : ''}`;
    }

    function showEndScreen(saveTxt) {
        setState('done');

        const timeStr = computeTimeSaved(completedCount, saveTxt);

        // Hero title — count + time saved as the headline
        const titleEl = document.querySelector('.sdl-done-title');
        if (titleEl) {
            const word = [...collected.values()].some(i => i.mode === 'v2') ? 'videos' : 'images';
            titleEl.textContent = `${completedCount} ${word} saved. ~${timeStr} back.`;
        }

        // Subtitle — emotional payoff, not time-saved (that's in the title now)
        const savedEl = document.getElementById('sdl-done-saved');
        if (savedEl) {
            const promptsNote = saveTxt ? 'Every prompt. Every experiment. ' : '';
            savedEl.textContent = `${promptsNote}Saved to your hard drive.`;
        }

        // Stats row
        const statsEl = document.getElementById('sdl-done-stats');
        if (statsEl) {
            const statItems = [];
            statItems.push(`<div class="sdl-done-stat"><span class="sdl-done-stat-n">${completedCount}</span><span>downloaded</span></div>`);
            if (saveTxt) statItems.push(`<div class="sdl-done-stat sdl-done-stat-ok"><span class="sdl-done-stat-n">✓</span><span>prompts saved</span></div>`);
            if (failedCount > 0) statItems.push(`<div class="sdl-done-stat sdl-done-stat-err"><span class="sdl-done-stat-n">${failedCount}</span><span>failed</span></div>`);
            statsEl.innerHTML = statItems.join('<div class="sdl-done-stat-sep"></div>');
        }

        // Active filters
        const filtersEl = document.getElementById('sdl-done-filters');
        if (filtersEl) {
            if (lastFilterSnap.length > 0) {
                filtersEl.style.display = '';
                document.getElementById('sdl-done-filter-list').textContent = lastFilterSnap.join(' · ');
            } else {
                filtersEl.style.display = 'none';
            }
        }

        // Coffee section — dynamic copy anchored to time saved
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
            init:        'Navigate to /library (images) or /profile, /drafts (videos)',
            scanning:    'Scanning — stop anytime to download what\'s found so far',
            ready:       '',
            downloading: 'Saving files to your folder…',
            done:        '',
        }[s] || '');
        syncExpertSections();
        updateModeBadge();
    }

    function syncExpertSections() {
        const sc = document.getElementById('sdl-exp-scroll');
        const tp = document.getElementById('sdl-exp-template');
        if (sc) sc.style.display = (uiState === 'init' || uiState === 'scanning') ? '' : 'none';
        if (tp) tp.style.display = (uiState === 'ready') ? '' : 'none';
    }

    function updateModeBadge() {
        const el = document.getElementById('sdl-mode-badge');
        if (!el) return;
        const labels = { v1: '📷 Library', v2_profile: '🎬 Profile', v2_drafts: '📋 Drafts' };
        el.textContent = labels[detectMode()] || '';
        if (uiState === 'init') {
            const btn = document.getElementById('sdl-scan');
            if (btn) btn.textContent = isV2() ? 'Scan Videos' : 'Scan Library';
        }
    }

    // =====================================================================
    // SPA NAVIGATION
    // =====================================================================
    (() => {
        const wrap = fn => function(...a) { fn.apply(this, a); setTimeout(updateModeBadge, 120); };
        history.pushState    = wrap(history.pushState);
        history.replaceState = wrap(history.replaceState);
        window.addEventListener('popstate', () => setTimeout(updateModeBadge, 120));
    })();

    // =====================================================================
    // FILTER LOGIC
    // =====================================================================
    function resetFilters() {
        filters.keyword = ''; filters.ratios.clear(); filters.dateFrom = ''; filters.dateTo = '';
        filters.qualities.clear(); filters.operations.clear(); filters.nItems = ''; filters.nDirection = 'last';
    }

    function resetFilterInputs() {
        ['sdl-f-keyword', 'sdl-f-date-from', 'sdl-f-date-to', 'sdl-f-n-items'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        document.querySelectorAll('#sdl-filter-drawer .sdl-chip.active').forEach(c => c.classList.remove('active'));
        syncNDirButtons();
    }

    function rebuildAllChips() {
        rebuildChips('sdl-f-ratios',     'ratios',     getDistinctValues('ratio'));
        rebuildChips('sdl-f-qualities',  'qualities',  getDistinctValues('quality'));
        rebuildChips('sdl-f-operations', 'operations', getDistinctValues('operation'));
    }

    function rebuildChips(containerId, filterKey, values) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        if (!values.length) { container.innerHTML = '<span class="sdl-chip-empty">none detected</span>'; return; }
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

    function recomputeSelection() {
        const selected = getFilteredItems().length;
        const total    = collected.size;
        const hasV2    = [...collected.values()].some(i => i.mode === 'v2');
        const word     = hasV2 ? 'videos' : 'images';
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
            + (filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0);
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
        const done = completedCount + failedCount;
        const nEl  = document.getElementById('sdl-dl-count');
        const bar  = document.getElementById('sdl-dl-bar');
        const dEl  = document.getElementById('sdl-dl-done');
        const fEl  = document.getElementById('sdl-dl-failed');
        const eta  = document.getElementById('sdl-dl-eta');
        const fWrap = document.getElementById('sdl-fail-wrap');
        if (nEl) nEl.textContent = completedCount;
        if (dEl) dEl.textContent = completedCount;
        if (fEl) {
            fEl.textContent = failedCount;
            if (fWrap) fWrap.style.color = failedCount > 0 ? '#f87171' : '';
        }
        if (bar && totalToDownload > 0)
            bar.style.width = (done / totalToDownload * 100) + '%';
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

    function readConfig(key)           { const e = document.getElementById('sdl-cfg-' + key); return e ? e.value : null; }
    function readConfigBool(key, def)  { const e = document.getElementById('sdl-cfg-' + key); return e ? e.checked : def; }

    function refreshAuthBadge() {
        const el = document.getElementById('sdl-auth');
        if (!el) return;
        if (oaiDeviceId) { el.classList.add('authed'); el.title = 'Auth captured ✓'; }
        else { el.classList.remove('authed'); el.title = 'Waiting for auth — scroll the page'; }
    }

    function setSpeedIdx(i) {
        speedIdx = i;
        document.querySelectorAll('.sdl-speed-seg').forEach(el =>
            el.classList.toggle('active', parseInt(el.dataset.spd) === i));
        const hints   = ['2 workers - 300 ms delay - safe', '4 workers - 150 ms delay - low risk', '8 workers - 60 ms delay - ban risk!'];
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
  width:308px; max-height:calc(100vh - 32px);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;
  font-size:13px; color:rgba(255,255,255,0.82);
  background:rgba(10,10,10,0.97);
  backdrop-filter:blur(30px); -webkit-backdrop-filter:blur(30px);
  border:0.5px solid rgba(255,255,255,0.1); border-radius:18px;
  box-shadow:0 24px 64px rgba(0,0,0,0.75),inset 0 1px 0 rgba(255,255,255,0.05);
  display:flex; flex-direction:column; overflow:hidden;
}
#sdl.collapsed { border-radius:14px; }
#sdl-header {
  display:flex; align-items:center; gap:8px;
  padding:11px 13px 10px; border-bottom:0.5px solid rgba(255,255,255,0.06);
  user-select:none; flex-shrink:0;
}
#sdl-logo {
  width:26px; height:26px; border-radius:7px; flex-shrink:0;
  object-fit:cover; image-rendering:auto;
  background:rgba(255,255,255,0.06);
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
#sdl-mode-badge {
  font-size:10px; color:rgba(255,255,255,0.35);
  flex:1; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;
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
  transition:color 0.15s; font-weight:300;
}
.sdl-hd-btn:hover { color:rgba(255,255,255,0.62); }
#sdl-body { overflow-y:auto; padding:13px; flex:1; min-height:0; }
#sdl-body::-webkit-scrollbar { width:3px; }
#sdl-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:2px; }
#sdl-status {
  font-size:11px; color:rgba(255,255,255,0.3);
  text-align:center; margin-bottom:12px; line-height:1.5;
}
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
.sdl-stats { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:12px; }
.sdl-stat { display:flex; align-items:center; gap:4px; font-size:11px; color:rgba(255,255,255,0.26); }
.sdl-stat-n { color:rgba(255,255,255,0.68); font-weight:500; font-variant-numeric:tabular-nums; }
.sdl-stat-sep { width:1px; height:10px; background:rgba(255,255,255,0.09); }
.sdl-quick {
  display:flex; align-items:center; gap:10px; margin-bottom:11px; padding-bottom:11px;
  border-bottom:0.5px solid rgba(255,255,255,0.06);
}
.sdl-quick-lbl { font-size:11px; color:rgba(255,255,255,0.32); flex:1; line-height:1.35; cursor:default; }
.sdl-quick-lbl span { font-size:10px; color:rgba(255,255,255,0.18); display:block; margin-top:1px; }
.sdl-toggle { position:relative; width:32px; height:18px; flex-shrink:0; cursor:pointer; display:block; }
.sdl-toggle input { opacity:0; width:0; height:0; position:absolute; }
.sdl-toggle-track { position:absolute; inset:0; background:rgba(255,255,255,0.1); border-radius:999px; transition:background 0.2s; }
.sdl-toggle input:checked + .sdl-toggle-track { background:rgba(52,211,153,0.65); }
.sdl-toggle-thumb { position:absolute; top:3px; left:3px; width:12px; height:12px; border-radius:50%; background:rgba(255,255,255,0.9); transition:transform 0.2s; pointer-events:none; }
.sdl-toggle input:checked ~ .sdl-toggle-thumb { transform:translateX(14px); }
#sdl-counter-pill {
  display:block; text-align:center; margin-bottom:10px; font-size:11px; color:rgba(255,255,255,0.28);
  background:rgba(255,255,255,0.04); border:0.5px solid rgba(255,255,255,0.08);
  border-radius:9px; padding:7px 10px; transition:background 0.2s,color 0.2s;
}
#sdl-counter-pill.filtered { background:rgba(99,102,241,0.12); border-color:rgba(99,102,241,0.3); color:rgba(165,170,255,0.85); }
#sdl-counter-pill.flash { animation:sdlFlash 0.3s ease; }
@keyframes sdlFlash { 0%,100%{opacity:1} 50%{opacity:0.55} }
/* Filter disclosure */
.sdl-disc {
  display:flex; align-items:center; gap:7px; cursor:pointer; margin-bottom:10px;
  font-size:11px; color:rgba(255,255,255,0.22); user-select:none; transition:color 0.15s;
}
.sdl-disc:hover { color:rgba(255,255,255,0.5); }
.sdl-disc-line { flex:1; height:0.5px; background:rgba(255,255,255,0.07); }
.sdl-disc-badge {
  font-size:9.5px; padding:1.5px 7px; border-radius:20px; background:rgba(255,255,255,0.06);
  color:rgba(255,255,255,0.3); transition:background 0.2s,color 0.2s;
}
.sdl-disc-badge.active { background:rgba(99,102,241,0.2); color:rgba(165,170,255,0.9); }
.sdl-disc-arrow { font-size:8px; transition:transform 0.2s; display:inline-block; }
.sdl-disc.open .sdl-disc-arrow { transform:rotate(180deg); }
.sdl-drawer { display:none; flex-direction:column; gap:0; margin-bottom:10px; }
.sdl-drawer.open { display:flex; }
/* Filter internals */
.sdl-f-sec { margin-bottom:11px; }
.sdl-f-lbl { font-size:9.5px; color:rgba(255,255,255,0.2); text-transform:uppercase; letter-spacing:0.08em; display:block; margin-bottom:6px; }
.sdl-f-inp {
  width:100%; box-sizing:border-box;
  background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.65); border:0.5px solid rgba(255,255,255,0.09);
  border-radius:8px; padding:6px 9px; font-size:12px; outline:none;
}
.sdl-f-inp:focus { border-color:rgba(255,255,255,0.2); }
.sdl-f-row { display:flex; gap:6px; }
.sdl-f-row .sdl-f-inp { flex:1; }
.sdl-seg-row { display:flex; gap:4px; }
.sdl-seg {
  flex:1; text-align:center; padding:5px 0; border-radius:7px;
  background:rgba(255,255,255,0.05); font-size:11px; color:rgba(255,255,255,0.3);
  cursor:pointer; transition:all 0.15s; border:0.5px solid rgba(255,255,255,0.08);
}
.sdl-seg:hover { background:rgba(255,255,255,0.09); }
.sdl-seg.active { background:rgba(99,102,241,0.15); border-color:rgba(99,102,241,0.3); color:rgba(165,170,255,0.9); }
.sdl-chips { display:flex; flex-wrap:wrap; gap:4px; }
.sdl-chip {
  padding:3px 9px; border-radius:20px; background:rgba(255,255,255,0.06);
  border:0.5px solid rgba(255,255,255,0.09); color:rgba(255,255,255,0.42);
  font-size:11px; cursor:pointer; transition:all 0.15s;
}
.sdl-chip:hover { background:rgba(255,255,255,0.1); color:rgba(255,255,255,0.7); }
.sdl-chip.active { background:rgba(99,102,241,0.18); border-color:rgba(99,102,241,0.35); color:rgba(165,170,255,0.9); }
.sdl-chip-empty { font-size:11px; color:rgba(255,255,255,0.18); font-style:italic; }
#sdl-filter-reset {
  display:block; font-size:10.5px; color:rgba(255,255,255,0.22); cursor:pointer;
  text-align:right; margin-top:2px; text-decoration:none;
}
#sdl-filter-reset:hover { color:rgba(255,255,255,0.55); }
/* Speed */
.sdl-speed { margin:2px 0 10px; }
.sdl-speed-lbl { font-size:10px; color:rgba(255,255,255,0.2); text-transform:uppercase; letter-spacing:0.07em; margin-bottom:7px; display:block; }
.sdl-speed-segs { display:flex; gap:5px; margin-bottom:6px; }
.sdl-speed-seg {
  flex:1; display:flex; flex-direction:column; align-items:center; padding:8px 4px;
  border-radius:10px; background:rgba(255,255,255,0.04); border:0.5px solid rgba(255,255,255,0.08);
  cursor:pointer; transition:all 0.15s; gap:2px;
}
.sdl-speed-seg:hover { background:rgba(255,255,255,0.08); }
.spd-std.active  { background:rgba(52,211,153,0.1);  border-color:rgba(52,211,153,0.3); }
.spd-fast.active { background:rgba(251,191,36,0.1);  border-color:rgba(251,191,36,0.3); }
.spd-rip.active  { background:rgba(248,113,113,0.1); border-color:rgba(248,113,113,0.3); }
.s-icon { font-size:12px; }
.s-lbl  { font-size:11px; font-weight:500; }
.s-risk { font-size:9px; color:rgba(255,255,255,0.28); }
.sdl-speed-hint { font-size:9.5px; color:rgba(255,255,255,0.22); text-align:center; }
.sdl-speed-hint.warn   { color:rgba(251,191,36,0.65); }
.sdl-speed-hint.danger { color:rgba(248,113,113,0.65); }
/* Coffee nudge */
.sdl-coffee {
  margin-bottom:12px; padding:13px 12px; border-radius:13px;
  background:rgba(251,191,36,0.07);
  border:0.5px solid rgba(251,191,36,0.2);
  display:flex; flex-direction:column; align-items:center; gap:8px; text-align:center;
}
.sdl-coffee-icon { font-size:22px; line-height:1; }
.sdl-coffee-msg {
  font-size:11px; color:rgba(255,255,255,0.55); line-height:1.55;
  max-width:220px; margin:0;
}
.sdl-coffee-msg strong { color:rgba(255,255,255,0.78); font-weight:500; }
.sdl-coffee-btn {
  display:inline-flex; align-items:center; gap:6px;
  background:#FFDD00; color:#0a0a0a;
  border:none; border-radius:20px; padding:8px 18px;
  font-size:12px; font-weight:700; text-decoration:none; cursor:pointer;
  transition:opacity 0.15s,transform 0.1s; letter-spacing:0.01em;
  -webkit-font-smoothing:antialiased;
}
.sdl-coffee-btn:hover { opacity:0.88; }
.sdl-coffee-btn:active { transform:scale(0.97); }
/* Settings + expert */
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
  width:100%; box-sizing:border-box; outline:none; margin-top:5px;
}
.sdl-inp-wide:focus { border-color:rgba(255,255,255,0.22); }
.sdl-tpl-tokens { font-size:9px; color:rgba(255,255,255,0.2); line-height:1.9; margin-bottom:4px; }
#sdl-log {
  background:rgba(255,255,255,0.025); border:0.5px solid rgba(255,255,255,0.06);
  border-radius:9px; padding:9px 11px; font-size:10.5px; font-family:"SF Mono",ui-monospace,monospace;
  line-height:1.75; max-height:90px; overflow-y:auto; white-space:pre-wrap; word-break:break-all;
  color:rgba(255,255,255,0.35); margin-bottom:10px;
}
#sdl-log::-webkit-scrollbar { width:3px; }
#sdl-log::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:2px; }
#sdl-patience-info { font-size:9.5px; color:rgba(255,255,255,0.2); line-height:1.7; margin-top:4px; display:block; }
#sdl-toast {
  position:fixed; bottom:24px; right:16px; background:rgba(18,18,18,0.96); backdrop-filter:blur(20px);
  border:0.5px solid rgba(255,255,255,0.1); border-radius:10px; padding:9px 15px;
  font-size:12px; color:rgba(255,255,255,0.75); z-index:2147483646; pointer-events:none;
  opacity:0; transform:translateY(8px); transition:opacity 0.25s,transform 0.25s;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
}
#sdl-toast.tin  { opacity:1; transform:translateY(0); }
#sdl-toast.tout { opacity:0; transform:translateY(8px); }
/* Scanning story */
#sdl-scan-story {
  margin-top:4px; margin-bottom:14px; padding:12px 13px; border-radius:11px;
  background:rgba(255,255,255,0.03); border:0.5px solid rgba(255,255,255,0.06);
  text-align:center;
}
#sdl-story-icon { font-size:18px; display:block; margin-bottom:7px; }
#sdl-story-text {
  font-size:11px; color:rgba(255,255,255,0.42); line-height:1.6;
  transition:opacity 0.35s ease; margin:0;
}
#sdl-shutdown-badge {
  display:inline-block; margin-top:10px; font-size:9.5px;
  color:rgba(255,255,255,0.22); background:rgba(255,255,255,0.04);
  border:0.5px solid rgba(255,255,255,0.07); border-radius:20px; padding:3px 10px;
}
/* Scroll waiting indicator */
#sdl-scroll-wait {
  margin-bottom:10px; padding:10px 12px; border-radius:10px;
  background:rgba(251,191,36,0.06); border:0.5px solid rgba(251,191,36,0.15);
  text-align:center;
}
.sdl-scroll-wait-text {
  font-size:10.5px; color:rgba(255,255,255,0.35); line-height:1.5; margin-bottom:8px;
}
#sdl-scroll-wait-secs {
  color:rgba(251,191,36,0.7); font-variant-numeric:tabular-nums; font-weight:500;
}
#sdl-skip-wait { font-size:11px; padding:7px 12px; }
/* Done / End screen */
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
.sdl-done-title {
  font-size:15px; font-weight:600; color:rgba(255,255,255,0.9); margin-bottom:6px; line-height:1.35;
}
.sdl-done-saved {
  font-size:11.5px; color:rgba(255,255,255,0.38); line-height:1.55;
}
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
.sdl-done-thanks {
  text-align:center; margin-bottom:14px;
  padding:14px 12px; border-radius:12px;
  background:rgba(255,255,255,0.025); border:0.5px solid rgba(255,255,255,0.06);
  display:none; /* removed from flow — kept for compat */
}
.sdl-done-thanks-big {
  font-size:14px; font-weight:600; color:rgba(255,255,255,0.82); margin-bottom:8px;
}
.sdl-done-thanks-sub {
  font-size:11px; color:rgba(255,255,255,0.32); line-height:1.65; margin:0 0 5px;
}
.sdl-done-thanks-teaser {
  font-size:10.5px; color:rgba(255,255,255,0.2); line-height:1.55; margin:8px 0 0;
  padding-top:8px; border-top:0.5px solid rgba(255,255,255,0.05);
}
.sdl-done-secondary {
  display:flex; align-items:center; justify-content:center; gap:8px;
  margin-bottom:10px; font-size:11px; color:rgba(255,255,255,0.2);
}
.sdl-done-github-link {
  color:rgba(255,255,255,0.35); text-decoration:none;
  transition:color 0.15s;
}
.sdl-done-github-link:hover { color:rgba(255,255,255,0.65); }
.sdl-done-sep { color:rgba(255,255,255,0.12); }
.sdl-done-teaser { color:rgba(255,255,255,0.18); font-size:10.5px; }
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
       src="https://raw.githubusercontent.com/${GITHUB_REPO}/main/assets/soravault-logo-square.png"
       alt="SoraVault" referrerpolicy="no-referrer">
  <span id="sdl-logo-fb">🔐</span>
  <span id="sdl-title">SoraVault</span>
  <span id="sdl-update-badge"></span>
  <span id="sdl-mode-badge"></span>
  <div id="sdl-header-right">
    <div id="sdl-auth" title="Waiting for auth..."></div>
    <a class="sdl-hd-btn" href="https://buymeacoffee.com/soravault" target="_blank"
       rel="noopener noreferrer" title="Support SoraVault on Buy Me a Coffee"
       style="text-decoration:none;font-size:14px;">☕</a>
    <button class="sdl-hd-btn" id="sdl-gear" title="Settings">&#x2699;</button>
    <button class="sdl-hd-btn" id="sdl-min"  title="Minimise">&#x2014;</button>
  </div>
</div>

<div id="sdl-body">
  <div id="sdl-status"></div>

  <!-- ─── STATE: init ─────────────────────────────────────── -->
  <div id="sdl-s-init">
    <button class="sdl-btn sdl-btn-primary" id="sdl-scan">Scan Library</button>
  </div>

  <!-- ─── STATE: scanning ─────────────────────────────────── -->
  <div id="sdl-s-scanning" style="display:none">
    <div class="sdl-big-count">
      <span class="n" id="sdl-scan-count">0</span>
      <span class="lbl" id="sdl-scan-lbl">items found so far</span>
    </div>
    <div class="sdl-prog"><div class="sdl-prog-bar ind"></div></div>

    <div id="sdl-scan-story">
      <span id="sdl-story-icon">🔍</span>
      <p id="sdl-story-text">Connecting to your Sora library…</p>
      <span id="sdl-shutdown-badge">loading…</span>
    </div>

    <div id="sdl-scroll-wait" style="display:none">
      <div class="sdl-scroll-wait-text">
        Scrolled to the end. Waiting for new items… <span id="sdl-scroll-wait-secs"></span>
      </div>
      <button class="sdl-btn sdl-btn-secondary" id="sdl-skip-wait">
        Skip wait — proceed with what's found
      </button>
    </div>

    <button class="sdl-btn sdl-btn-stop" id="sdl-stop-scan">Stop</button>
  </div>

  <!-- ─── STATE: ready ────────────────────────────────────── -->
  <div id="sdl-s-ready" style="display:none">
    <div class="sdl-quick">
      <label class="sdl-quick-lbl" for="sdl-cfg-DOWNLOAD_TXT">
        Save .txt sidecar<span>prompt + metadata per file</span>
      </label>
      <label class="sdl-toggle">
        <input type="checkbox" id="sdl-cfg-DOWNLOAD_TXT" ${CFG.DOWNLOAD_TXT ? 'checked' : ''}>
        <div class="sdl-toggle-track"></div>
        <div class="sdl-toggle-thumb"></div>
      </label>
    </div>

    <div id="sdl-counter-pill">&#x2014;</div>
    <button class="sdl-btn sdl-btn-primary" id="sdl-dl" disabled>Download All</button>
    <button class="sdl-btn sdl-btn-secondary" id="sdl-rescan">&#x21ba;&#x2002;Rescan</button>

    <div class="sdl-disc" id="sdl-filter-disc">
      <span class="sdl-disc-line"></span>
      <span>Filters</span>
      <span class="sdl-disc-badge" id="sdl-filter-badge">none active</span>
      <span class="sdl-disc-arrow">&#x25bc;</span>
      <span class="sdl-disc-line"></span>
    </div>
    <div class="sdl-drawer" id="sdl-filter-drawer">
      <div class="sdl-f-sec">
        <span class="sdl-f-lbl">Keyword in prompt</span>
        <input class="sdl-f-inp" id="sdl-f-keyword" type="text" placeholder="comma-separated, all must match">
      </div>
      <div class="sdl-f-sec">
        <span class="sdl-f-lbl">Last / First N items</span>
        <div class="sdl-seg-row">
          <div class="sdl-seg active" id="sdl-n-last">&#x2193; Last</div>
          <div class="sdl-seg"        id="sdl-n-first">&#x2191; First</div>
        </div>
        <input class="sdl-f-inp" id="sdl-f-n-items" type="number" min="1"
               placeholder="N &#x2014; leave empty for all" style="margin-top:4px">
      </div>
      <div class="sdl-f-sec">
        <span class="sdl-f-lbl">Aspect ratio</span>
        <div class="sdl-chips" id="sdl-f-ratios"></div>
      </div>
      <div class="sdl-f-sec">
        <span class="sdl-f-lbl">Quality</span>
        <div class="sdl-chips" id="sdl-f-qualities"></div>
      </div>
      <div class="sdl-f-sec">
        <span class="sdl-f-lbl">Operation</span>
        <div class="sdl-chips" id="sdl-f-operations"></div>
      </div>
      <div class="sdl-f-sec">
        <span class="sdl-f-lbl">Date range</span>
        <div class="sdl-f-row">
          <input class="sdl-f-inp" id="sdl-f-date-from" type="date" title="From">
          <input class="sdl-f-inp" id="sdl-f-date-to"   type="date" title="To">
        </div>
      </div>
      <a id="sdl-filter-reset">Reset all filters</a>
    </div>
  </div>

  <!-- ─── STATE: downloading ──────────────────────────────── -->
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
      <div class="sdl-stat">
        <span class="sdl-stat-n" id="sdl-dl-done">0</span><span>done</span>
      </div>
      <div class="sdl-stat-sep"></div>
      <div class="sdl-stat" id="sdl-fail-wrap">
        <span class="sdl-stat-n" id="sdl-dl-failed">0</span><span>failed</span>
      </div>
      <div class="sdl-stat-sep"></div>
      <div class="sdl-stat"><span id="sdl-dl-eta"></span></div>
    </div>

    <div class="sdl-speed">
      <span class="sdl-speed-lbl">Download speed</span>
      <div class="sdl-speed-segs">
        <div class="sdl-speed-seg spd-std active" data-spd="0">
          <span class="s-icon">&#x25cf;</span>
          <span class="s-lbl">Standard</span>
          <span class="s-risk">Safe</span>
        </div>
        <div class="sdl-speed-seg spd-fast" data-spd="1">
          <span class="s-icon">&#x25ce;</span>
          <span class="s-lbl">Faster</span>
          <span class="s-risk">Low risk</span>
        </div>
        <div class="sdl-speed-seg spd-rip" data-spd="2">
          <span class="s-icon">&#x25c9;</span>
          <span class="s-lbl">Very fast</span>
          <span class="s-risk">Ban risk!</span>
        </div>
      </div>
      <div class="sdl-speed-hint">2 workers - 300 ms delay - safe</div>
    </div>
    <button class="sdl-btn sdl-btn-stop" id="sdl-stop-dl">Stop</button>
  </div>

  <!-- ─── STATE: done ─────────────────────────────────────── -->
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
        <strong>I built this in a weekend so nobody has to lose their work.</strong><br>
        It's free, it stays free. If it saved your library, a coffee means the world.
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
      <span class="sdl-done-teaser">Desktop app coming soon</span>
    </div>

    <button class="sdl-btn sdl-btn-secondary" id="sdl-done-back">← Back to library</button>

  </div>

  <!-- ─── SETTINGS DRAWER (gear icon) ─────────────────────── -->
  <div class="sdl-drawer" id="sdl-settings-drawer">
    <div class="sdl-sec-title first">Download folders (automatic)</div>
    <div style="font-size:10.5px;color:rgba(255,255,255,0.25);line-height:1.7;padding:2px 0 6px">
      📷 Images → <code style="color:rgba(255,255,255,0.4)">soravault_images_library</code><br>
      🎬 Profile → <code style="color:rgba(255,255,255,0.4)">soravault_videos_profile</code><br>
      📋 Drafts → <code style="color:rgba(255,255,255,0.4)">soravault_videos_draft</code>
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
    <div id="sdl-exp-scroll">
      <div class="sdl-sec-title first">Scroll settings</div>
      <div class="sdl-setting">
        <div class="sdl-setting-lbl">
          Patience (steps)
          <span class="sdl-setting-sub">same-height steps before stop</span>
        </div>
        <input type="number" class="sdl-inp-sm" id="sdl-cfg-SCROLL_PATIENCE"
               value="${CFG.SCROLL_PATIENCE}" min="10" max="2000">
      </div>
      <div class="sdl-setting">
        <div class="sdl-setting-lbl">Step delay (ms)</div>
        <input type="number" class="sdl-inp-sm" id="sdl-cfg-SCROLL_STEP_MS"
               value="${CFG.SCROLL_STEP_MS}" min="50" max="1000">
      </div>
      <div class="sdl-setting">
        <div class="sdl-setting-lbl">Initial wait (ms)</div>
        <input type="number" class="sdl-inp-sm" id="sdl-cfg-SCROLL_INITIAL_MS"
               value="${CFG.SCROLL_INITIAL_MS}" min="100" max="5000">
      </div>
      <span id="sdl-patience-info"></span>
    </div>

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

    <div class="sdl-sec-title">Log</div>
    <div id="sdl-log">Ready.</div>
    <button class="sdl-btn sdl-btn-secondary" id="sdl-clear"
            style="font-size:11.5px;padding:7px 14px">Clear &amp; reset</button>
  </div>
</div>`;
        document.body.appendChild(p);

        // ── Logo fallback ────────────────────────────────────────────────────
        document.getElementById('sdl-logo').addEventListener('error', function () {
            this.style.display = 'none';
            document.getElementById('sdl-logo-fb').style.display = 'flex';
        });

        // ── Version check (async, non-blocking) ───────────────────────────
        setTimeout(checkForUpdate, 1500);

        // ── Shutdown badge ────────────────────────────────────────────────
        updateShutdownBadge();

        // ── Event listeners ──────────────────────────────────────────────────

        let minimised = false;
        document.getElementById('sdl-min').addEventListener('click', () => {
            minimised = !minimised;
            p.classList.toggle('collapsed', minimised);
            document.getElementById('sdl-min').textContent = minimised ? '+' : '—';
        });

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

        document.getElementById('sdl-scan').addEventListener('click',      startScan);
        document.getElementById('sdl-stop-scan').addEventListener('click', stopAll);
        document.getElementById('sdl-skip-wait').addEventListener('click', () => { skipWaitRequested = true; });
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

        document.querySelectorAll('.sdl-speed-seg').forEach(seg =>
            seg.addEventListener('click', () => setSpeedIdx(parseInt(seg.dataset.spd))));

        document.getElementById('sdl-n-last').addEventListener('click', () => {
            filters.nDirection = 'last'; syncNDirButtons(); recomputeSelection();
        });
        document.getElementById('sdl-n-first').addEventListener('click', () => {
            filters.nDirection = 'first'; syncNDirButtons(); recomputeSelection();
        });

        document.getElementById('sdl-f-keyword').addEventListener('input',  e => { filters.keyword = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-f-n-items').addEventListener('input',  e => { filters.nItems  = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-f-date-from').addEventListener('change', e => { filters.dateFrom = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-f-date-to').addEventListener('change',   e => { filters.dateTo   = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-filter-reset').addEventListener('click', () => {
            resetFilters(); resetFilterInputs(); recomputeSelection(); rebuildAllChips();
        });

        function updatePatienceInfo() {
            const el  = document.getElementById('sdl-patience-info');
            if (!el) return;
            const pat = parseInt(document.getElementById('sdl-cfg-SCROLL_PATIENCE')?.value) || CFG.SCROLL_PATIENCE;
            const ms  = parseInt(document.getElementById('sdl-cfg-SCROLL_STEP_MS')?.value)  || CFG.SCROLL_STEP_MS;
            el.textContent = `Max wait: ${pat} × ${ms} ms = ${(pat * ms / 1000).toFixed(1)}s`;
        }
        document.getElementById('sdl-cfg-SCROLL_PATIENCE').addEventListener('input', updatePatienceInfo);
        document.getElementById('sdl-cfg-SCROLL_STEP_MS').addEventListener('input', updatePatienceInfo);
        updatePatienceInfo();

        setState('init');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createPanel);
    else setTimeout(createPanel, 500);

})();
