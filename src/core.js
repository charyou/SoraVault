/*! 
  SoraVault 2.7

  MIT License
  Copyright © 2026 Sebastian Haas (charyou)
  
  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.

  THIRD-PARTY NOTICE:
  The watermark removal logic is based on code by Casey Jardin.

*/


(function () {
    'use strict';

    // =====================================================================
    // PLATFORM DETECTION — runtime environment switcher
    // =====================================================================
    const ENV = {
        isTM:  typeof GM_download === 'function',
        win:   typeof unsafeWindow !== 'undefined' ? unsafeWindow : window,
        hasGM: typeof GM_download === 'function',
        EXT_BASE: (() => {
            const meta = document.querySelector('meta[name="soravault-ext-base"]');
            return meta?.content || '';
        })(),
    };
    const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/charyou/SoraVault/main/';
    function assetUrl(path) {
        return ENV.EXT_BASE ? ENV.EXT_BASE + path : GITHUB_RAW_BASE + path;
    }
    function githubAssetUrl(path) {
        return GITHUB_RAW_BASE + path;
    }
    ENV.LOGO_URL = assetUrl('img/soravault-logo-square.png');
    ENV.LOGO_FALLBACK_URL = githubAssetUrl('img/soravault-logo-square.png');
    ENV.COFFEE_BIG_URL = assetUrl('img/coffeemug_big.png');
    ENV.COFFEE_BIG_FALLBACK_URL = githubAssetUrl('img/coffeemug_big.png');
    ENV.COFFEE_SMALL_URL = assetUrl('img/coffeemug_small.png');
    ENV.COFFEE_SMALL_FALLBACK_URL = githubAssetUrl('img/coffeemug_small.png');

    // =====================================================================
    // CONFIG & RELEASE INFO
    // =====================================================================
    const VERSION      = '2.7.2';
    const RELEASE_DATE = '2026-04-24';
    const GITHUB_REPO  = 'charyou/SoraVault';
    const SORA_SHUTDOWN = new Date('2026-04-26T00:00:00Z');

    const CFG = {
        PARALLEL_DOWNLOADS: 2,
        DOWNLOAD_TXT:       true,
        FILENAME_TEMPLATE:  '{genId}_{date}_{prompt}',
        PROMPT_MAX_LEN:     80,
        BEARER_TOKEN:       '', // <-- You can paste your "eyJ..." token here if you want to hardcode it
    };

    // Skip-existing thresholds — files below these sizes are treated as failed/corrupt and re-downloaded
    const SKIP_MIN_VIDEO_BYTES = 3 * 1024 * 1024;  // 3 MB — Sora videos are always larger
    const SKIP_MIN_IMAGE_BYTES = 1 * 1024 * 1024;  // 1 MB — catches placeholder/stub PNGs
    // Matches Sora ID tokens anywhere in a filename:
    //   gen_01kmpedcn9eehbfaz17wy1h1fx  (V1 generation IDs — prefix kept so lookup via item.genId hits)
    //   task_01…                         (V1 task IDs)
    //   s_xxxxx…                         (V2 post/shared IDs)
    //   bare 20+ char alnum runs         (fallback — e.g. custom templates)
    //   classic UUID                     (older V1 IDs)
    // The optional prefix makes prefixed and bare IDs match equally — at a given position the engine
    // greedily consumes `gen_`/`task_`/`s_` before the alnum run, so `gen_01…` tokenises as one unit.
    const EXISTING_ID_PATTERN  = /(?:gen_|task_|s_)?[A-Za-z0-9]{20,}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g;

    const SHARED_VIDEO_ID_PATTERN            = /^s_[A-Za-z0-9_-]+$/;
    const WATERMARK_FETCH_MAX_ATTEMPTS       = 3;
    const WATERMARK_FETCH_BASE_RETRY_MS      = 1200;
    const WATERMARK_FETCH_MAX_RETRY_MS       = 10000;
    const WATERMARK_PROXY_FAILURE_LIMIT      = 3;
    const MIN_VIDEO_BYTES_FALLBACK_THRESHOLD = 256 * 1024;
    const ESTIMATED_SIZE_FALLBACK_RATIO      = 0.2;

    // =====================================================================
    // BROWSE & FETCH (v2.6.0) — passive capture while browsing Sora
    // =====================================================================
    const BROWSE_FETCH_ROOT_NAMES          = { mirror: 'mirror_browse', discover: 'discover_download' };
    const BROWSE_FETCH_MANIFEST_FILES      = { mirror: 'mirror_manifest.json', discover: 'discover_manifest.json' };
    const BROWSE_FETCH_WORKERS             = 4;
    const BROWSE_FETCH_QUEUE_MAX           = 500;
    const BROWSE_FETCH_IDLE_SLEEP_MS       = 1500;
    const BROWSE_FETCH_MANIFEST_DEBOUNCE_MS = 8000;
    const DISCOVER_IDLE_SLEEP_MS           = 30000;

    // =====================================================================
    // SCAN SOURCES  — single source of truth for all source-aware logic
    // =====================================================================
    const SCAN_SOURCES = [
        { id: 'v1_library', icon: '📷', label: 'Library',  sub: 'V1 image library',    group: 'v1' },
        { id: 'v1_liked',   icon: '♡',  label: 'Likes',    sub: 'V1 liked content',         group: 'v1' },
        { id: 'v2_profile',       icon: '🎬',   label: 'Videos',        sub: 'V2 published posts',    group: 'v2' },
        { id: 'v2_drafts',        icon: '📋',   label: 'Drafts',        sub: 'V2 all generated',      group: 'v2' },
        { id: 'v2_liked',         icon: '♡',    label: 'Liked',         sub: 'V2 liked videos',       group: 'v2' },
        { id: 'v2_cameos',        icon: '👤',   label: 'Cameos',        sub: 'V2 posts featuring you', group: 'v2' },
        { id: 'v2_cameo_drafts',  icon: '👤📋', label: 'Cameo drafts',  sub: 'V2 drafts featuring you', group: 'v2' },
        { id: 'v2_my_characters', icon: '🎭',   label: 'Characters',    sub: 'V2 your characters (preview)', group: 'v2' },
    ];

    // Human-readable labels for filter chips — keyed by source ID
    const SOURCE_LABELS = {
        v1_library: 'Library',
        v1_liked:   'Likes (v1)',
        v2_profile:      'Videos',
        v2_drafts:       'Drafts',
        v2_liked:        'Liked',
        v2_cameos:       'Cameos',
        v2_cameo_drafts: 'Cameo drafts',
        v2_my_characters: 'Characters',
        v2_creator:      'Creators',
    };

    // Per-category subfolder names — keyed by source ID
    const SUBFOLDERS = {
        v1_library: 'sora_v1_images',
        v1_videos:  'sora_v1_videos',
        v1_liked:   'sora_v1_liked',
        v2_profile:      'sora_v2_profile',
        v2_drafts:       'sora_v2_drafts',
        v2_liked:        'sora_v2_liked',
        v2_cameos:       'sora_v2_cameos',
        v2_cameo_drafts: 'sora_v2_cameo_drafts',
        v2_my_characters: 'sora_v2_characters',
        v2_creator:      'sora_v2_creators',
    };

    const SPEED_PRESETS = [
        { workers: 2, delay:  60 },
        { workers: 4, delay: 120 },
        { workers: 6, delay:  90 },
        { workers: 8, delay:  60 },
    ];

    const SCAN_STORIES = [
        { icon: '01', text: 'Built by Sebastian in Munich after backing up 1,800+ Sora images of his own.' },
        { icon: '02', text: 'A passion project for creators who used Sora seriously and do not want to lose the work.' },
        { icon: '03', text: 'Files stay local. No account, no cloud sync, no tracking.' },
        { icon: '04', text: 'SoraVault keeps the useful metadata too, so old prompts remain searchable.' },
        { icon: '05', text: 'Made between client work, wedding planning, and one more feature that could not wait.' },
        { icon: '06', text: 'After the scan, filters let you download everything or only the parts that matter.' },
    ];

    // =====================================================================
    // STATE
    // =====================================================================
    const collected        = new Map();
    const workerActivities  = new Map(); // item-index → current activity phrase
    let activityRenderTimer  = null;
    let activityWarningTimer = null;
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
    let activeStartMode    = 'regular'; // regular | creator | mirror | discover
    let mirrorStatsTimer   = null;
    let scanStoryTimer     = null;
    let scanStoryIdx       = 0;
    let lastSaveTxt        = false;
    let lastSaveMedia      = true;
    let lastSaveJSON       = false;
    let lastFilterSnap     = [];
    let dlMethod           = 'fs';
    let baseDir            = null;
    let lastDownloadFolderName = '';
    let cachedUserId       = null;

    // Skip-existing state (per download run)
    let skipEnabled        = true;
    const existingFilesCache = new Map(); // subfolderName -> Map<idToken, { exts: Set<string>, sizes: Map<string, number> }>
    let skipSummary        = null;        // { bySource: {[srcId]: {mp4,png,txt}}, totalSkipped }
    let skipTemplateWarned = false;       // log the "keep {genId}" hint at most once per run

    // Pause state (download only)
    let isPaused           = false;
    let pauseGate          = Promise.resolve();
    let pauseResolver      = null;
    let downloadWorkerRetune = null;
    let activeDownloadWorkerCount = 0;

    // Watermark proxy state
    let watermarkRemovalEnabled        = true;
    let watermarkProxyDisabled         = false;
    let watermarkProxyFailureCount     = 0;
    let globalRateLimitCooldownUntilMs = 0;
    let watermarkRateLimitStreak       = 0;

    // Geo-blocking
    let isV2Supported      = true;
    let geoCheckInitDone   = false;

    // Browse & Fetch state
    let browseFetchEnabled        = false;
    let browseFetchMode           = 'mirror'; // mirror | discover
    let browseFetchBaseDir        = null;  // user-picked base dir
    let browseFetchRootDir        = null;  // cached mirror_browse subfolder handle
    const browseFetchDirCache     = new Map(); // "sora2_profile/charju/drafts" → DirHandle
    const browseFetchQueue        = [];
    const browseFetchSeen         = new Set();  // genId/postId
    let   browseFetchWorkersActive = 0;
    let   browseFetchStopRequested = false;
    const browseFetchStats        = { captured: 0, skipped: 0, failed: 0, dropped: 0 };
    const browseFetchFilters      = {
        minLikes: 0, maxLikes: null, include: [], exclude: [], saveTxt: true,
        version: 'v2', feed: 'explore', dateFrom: '', dateTo: '',
        v1Feed: 'home', ratios: new Set(), includeChars: true, maxCreators: 0, keepPolling: true,
    };
    const browseFetchManifest     = new Map();  // key → entry
    let   browseFetchManifestDirty = false;
    let   browseFetchManifestTimer = null;
    let   browseFetchManifestLoaded = false;
    const browseFetchDiscoveredEndpoints = new Set();

    // Discover & Download state
    let discoverRunning          = false;
    let discoverLoopPromise      = null;
    let discoverRunToken         = 0;
    let discoverDrainPromise     = null;
    const discoverSeenCreators   = new Map(); // userId/username -> { username, userId }
    const discoverCreatorQueue   = [];
    const discoverCreatorStats   = new Map();
    const discoverStats          = {
        pages: 0, creatorsFound: 0, creatorsDone: 0, creatorErrors: 0,
        feedItems: 0, creatorItems: 0, mediaScreened: 0, mediaQueued: 0,
        mediaFiltered: 0, mediaDuplicate: 0, mediaKnown: 0, mediaDropped: 0,
        videosQueued: 0, imagesQueued: 0, creatorsWithMedia: 0,
        current: 'Idle', lastEvent: '', currentCreator: '',
    };

    // Creator Fetch state
    let creatorFetchEnabled      = false;
    let creatorFetchIncludeChars = true;
    let creatorFetchPersist      = true;
    const creators = [];  // Array<{ username, userId, state: 'checking'|'valid'|'invalid'|'error', postCount, characterCount, error? }>

    // Source enable/disable state — all enabled by default except preview sources
    const enabledSources = new Set(SCAN_SOURCES.map(s => s.id));

    // Per-source scan status
    const srcStatus = {};
    SCAN_SOURCES.forEach(s => { srcStatus[s.id] = 'idle'; });

    const filters = {
        keyword: '', ratios: new Set(), dateFrom: '', dateTo: '',
        qualities: new Set(), operations: new Set(), nItems: '', nDirection: 'last',
        authorExclude: '',   // exclude by author (likes); empty = no filter
        filterSources: new Set(),  // empty = all sources; non-empty = only these
        onlyFavorites: false,      // v1 library only — filter to is_favorite === true
        minLikes: '', maxLikes: '',
    };

    // =====================================================================
    // UTILITIES
    // =====================================================================
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

    function readLikeCount(...sources) {
        const keys = [
            'like_count', 'likeCount', 'likes_count', 'likesCount',
            'num_likes', 'numLikes', 'favorite_count', 'favoriteCount',
        ];
        for (const src of sources) {
            if (!src || typeof src !== 'object') continue;
            for (const key of keys) {
                const n = Number(src[key]);
                if (Number.isFinite(n) && n >= 0) return n;
            }
            const stats = src.stats ?? src.metrics ?? src.counts ?? null;
            if (stats && typeof stats === 'object') {
                for (const key of keys) {
                    const n = Number(stats[key]);
                    if (Number.isFinite(n) && n >= 0) return n;
                }
            }
        }
        return null;
    }

    function shutdownDaysDelta() {
        const now  = new Date();
        const diff = Math.round((now - SORA_SHUTDOWN) / 86400000);
        return diff;
    }

    // =====================================================================
    // FETCH INTERCEPT  — captures auth headers from Sora's own requests
    // =====================================================================
    const _fetch = ENV.win.fetch.bind(ENV.win);

    ENV.win.fetch = async function (...args) {
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

        if (url.includes('/backend/')) {
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
        // Snapshot the page URL at intercept time — used to bucket browse-fetch captures by where the user was
        const capturedPath = (typeof location !== 'undefined') ? (location.pathname || '/') : '/';
        if (response.ok) {
            let handled = false;
            if (url.includes('/list_tasks')) {
                handled = true;
                response.clone().json().then(d => ingestV1Page(d, 'v1_library', capturedPath)).catch(() => {});
            }
            else if (url.includes('/backend/project_y/profile_feed/') && url.includes('cut=appearances')) {
                handled = true;
                response.clone().json().then(d => ingestV2Page(d, url, 'v2_cameos', capturedPath)).catch(() => {});
            }
            else if (url.includes('/backend/project_y/profile_feed/')) {
                handled = true;
                response.clone().json().then(d => ingestV2Page(d, url, 'v2_profile', capturedPath)).catch(() => {});
            }
            else if (url.includes('/backend/project_y/profile/drafts/cameos')) {
                handled = true;
                response.clone().json().then(d => ingestV2Page(d, url, 'v2_cameo_drafts', capturedPath)).catch(() => {});
            }
            else if (url.includes('/backend/project_y/profile/drafts/v2')) {
                handled = true;
                response.clone().json().then(d => ingestV2Page(d, url, 'v2_drafts', capturedPath)).catch(() => {});
            }
            // Opportunistic ingest — scan unknown Sora endpoints for capturable media when Browse & Fetch is on.
            if (!handled && browseFetchEnabled && /\/backend\//.test(url)) {
                response.clone().json().then(d => opportunisticIngest(d, url, capturedPath)).catch(() => {});
            }
        }
        return response;
    };

    // XHR intercept (same auth capture)
    const _xhrOpen = ENV.win.XMLHttpRequest.prototype.open;
    const _xhrSend = ENV.win.XMLHttpRequest.prototype.send;
    const _xhrSetH = ENV.win.XMLHttpRequest.prototype.setRequestHeader;
    ENV.win.XMLHttpRequest.prototype.setRequestHeader = function (n, v) {
        if (n?.toLowerCase() === 'oai-device-id') { oaiDeviceId = v; refreshAuthBadge(); }
        if (n?.toLowerCase() === 'oai-language')  oaiLanguage = v;
        if (this._sv_url && this._sv_url.includes('/backend/')) {
            const SKIP = new Set(['content-type','accept-encoding','accept-language',
                                  'cache-control','pragma','origin','content-length']);
            if (!SKIP.has(n?.toLowerCase())) storedV2Headers[n.toLowerCase()] = v;
        }
        return _xhrSetH.apply(this, arguments);
    };
    ENV.win.XMLHttpRequest.prototype.open = function (m, u, ...r) {
        this._sv_url = u || '';
        this._sv_path = (typeof location !== 'undefined') ? (location.pathname || '/') : '/';
        return _xhrOpen.apply(this, [m, u, ...r]);
    };
    ENV.win.XMLHttpRequest.prototype.send = function (...a) {
        const captured = this._sv_path || '/';
        if ((this._sv_url || '').includes('/list_tasks'))
            this.addEventListener('load', function () {
                if (this.status === 200) try { ingestV1Page(JSON.parse(this.responseText), 'v1_library', captured); } catch(e) {}
            });
        else if (browseFetchEnabled && /\/backend\//.test(this._sv_url || ''))
            this.addEventListener('load', function () {
                if (this.status === 200) try { opportunisticIngest(JSON.parse(this.responseText), this._sv_url || '', captured); } catch(e) {}
            });
        return _xhrSend.apply(this, a);
    };

    // =====================================================================
    // DATA INGESTION — V1 (Images + Videos)
    // =====================================================================
    function ingestV1Page(data, sourceId = 'v1_library', capturedPath = null) {
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
                const entry = {
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
                    isFavorite: gen.is_favorite === true,
                    likeCount: readLikeCount(gen, task),
                    _raw: { task_id: taskId, task_prompt: prompt, ...gen },
                };
                collected.set(genId, entry);
                maybeEnqueueBrowseFetch(entry, capturedPath);
                added++;
            });
        });
        if (added > 0) { log(`+${added} → ${collected.size} total`); refreshScanCount(); }
        return { hasMore: data.has_more === true, lastId: data.last_id ?? null };
    }

    // =====================================================================
    // DATA INGESTION — V1 Liked
    // =====================================================================
    function ingestV1LikedPage(data, capturedPath = null) {
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

            const entry = {
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
                likeCount: readLikeCount(gen),
                canDownload: gen.can_download ?? null,
                _raw: gen,
            };
            collected.set(genId, entry);
            maybeEnqueueBrowseFetch(entry, capturedPath);
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
    function ingestV2Page(data, url, sourceId, capturedPath = null, contextTag = null) {
        const isDrafts = sourceId === 'v2_drafts' || sourceId === 'v2_cameo_drafts' ||
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

        items.forEach(rawItem => {
            // Cameo/character draft endpoints can wrap the video object inside rawItem.draft.
            let item = rawItem;
            if (isDrafts && rawItem.draft && typeof rawItem.draft === 'object') {
                if (!rawItem.draft || typeof rawItem.draft !== 'object') return;
                item = rawItem.draft;
            }

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
                const entryD = {
                    mode: 'v2', source: effectiveSource, genId,
                    taskId: item.task_id ?? '', postId: null,
                    date, prompt: item.prompt ?? item.title ?? '',
                    downloadUrl, previewUrl: item.url ?? null, thumbUrl,
                    width: gw, height: gh, ratio,
                    duration: item.duration_s ?? null, model: null,
                    author: contextTag,
                    creatorUsername: contextTag,
                    _raw: item,
                };
                collected.set(genId, entryD);
                maybeEnqueueBrowseFetch(entryD, capturedPath);
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
                const entryP = {
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
                    likeCount: readLikeCount(post, item),
                    author:   sourceId === 'v2_my_characters'
                        ? (contextTag ?? item.profile?.username ?? null)
                        : (item.profile?.username ?? null),
                    creatorUsername: contextTag,
                    _raw: { post, profile: item.profile },
                };
                collected.set(postId, entryP);
                maybeEnqueueBrowseFetch(entryP, capturedPath);
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
    // BROWSE & FETCH (v2.6.0) — passive capture helpers
    // =====================================================================
    function browseFetchKey(item) {
        return item.genId || item.postId || null;
    }

    function getBrowseFetchRootName() {
        return BROWSE_FETCH_ROOT_NAMES[browseFetchMode] || BROWSE_FETCH_ROOT_NAMES.mirror;
    }

    function getBrowseFetchManifestFile() {
        return BROWSE_FETCH_MANIFEST_FILES[browseFetchMode] || BROWSE_FETCH_MANIFEST_FILES.mirror;
    }

    function getBrowseFetchWorkerLimit() {
        if (browseFetchMode !== 'discover') return BROWSE_FETCH_WORKERS;
        const preset = SPEED_PRESETS[speedIdx] ?? SPEED_PRESETS[1];
        return Math.max(1, preset.workers || BROWSE_FETCH_WORKERS);
    }

    function browseFetchFilterBlockReason(item) {
        const f = browseFetchFilters;
        if (f.version === 'v1' && item.mode !== 'v1') return 'version';
        if (f.version === 'v2' && item.mode !== 'v2') return 'version';
        if (browseFetchMode === 'discover' && f.version === 'v1') {
            if (f.v1Feed === 'videos' && item.isVideo !== true) return 'media type';
            if (f.v1Feed === 'images' && item.isVideo === true) return 'media type';
        }
        if (f.minLikes > 0) {
            const lc = Number.isFinite(item.likeCount) ? item.likeCount : 0;
            if (lc < f.minLikes) return 'min likes';
        }
        if (f.maxLikes != null && f.maxLikes >= 0) {
            const lc = Number.isFinite(item.likeCount) ? item.likeCount : null;
            if (lc == null || lc > f.maxLikes) return 'max likes';
        }
        if (f.dateFrom && (!item.date || item.date < f.dateFrom)) return 'date';
        if (f.dateTo && (!item.date || item.date > f.dateTo)) return 'date';
        if (f.ratios && f.ratios.size > 0 && (!item.ratio || !f.ratios.has(item.ratio))) return 'ratio';
        const prompt = (item.prompt || '').toLowerCase();
        if (f.exclude.length && f.exclude.some(t => prompt.includes(t))) return 'exclude keywords';
        if (f.include.length && !f.include.some(t => prompt.includes(t))) return 'include keywords';
        return null;
    }

    function matchesBrowseFetchFilter(item) {
        return browseFetchFilterBlockReason(item) == null;
    }

    function sanitiseSegment(s) {
        if (!s) return '';
        return String(s)
            .replace(/[\\/:*?"<>|]+/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^[._]+|[._]+$/g, '')
            .slice(0, 60);
    }

    // Build folder segments from the captured page path + item metadata.
    // First segment gets prefixed with sora1_/sora2_; creator-scoped post pages route by author.
    function browseFetchBuildSegments(item, pathname) {
        const prefix = item.mode === 'v1' ? 'sora1_' : 'sora2_';
        const raw = (pathname || '/').split('?')[0].split('#')[0];
        const parts = raw.split('/').map(sanitiseSegment).filter(Boolean);

        // Single-post page /p/{postId}: route to author's folder if known
        if (parts.length >= 1 && parts[0] === 'p' && item.author) {
            return [prefix + 'profile', sanitiseSegment(item.author), 'p'];
        }
        if (parts.length === 0) return [prefix + 'home'];
        parts[0] = prefix + parts[0];
        return parts;
    }

    async function browseFetchResolveDir(segments) {
        if (!browseFetchRootDir) return null;
        const cacheKey = segments.join('/');
        if (browseFetchDirCache.has(cacheKey)) return browseFetchDirCache.get(cacheKey);
        let dir = browseFetchRootDir;
        for (const seg of segments) {
            if (!seg) continue;
            try { dir = await dir.getDirectoryHandle(seg, { create: true }); }
            catch (e) { log(`⚠ Browse&Fetch: cannot create folder "${seg}": ${e.message}`); return null; }
        }
        browseFetchDirCache.set(cacheKey, dir);
        return dir;
    }

    function discoverCreatorLabelFromPath(pathname) {
        const parts = (pathname || '').split('/').map(sanitiseSegment).filter(Boolean);
        const idx = parts.indexOf('profile');
        return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
    }

    function discoverRememberMediaDecision(item, status, pathname) {
        if (!discoverRunning || browseFetchMode !== 'discover') return;
        discoverStats.mediaScreened++;
        const creatorLabel = item.creatorUsername || discoverCreatorLabelFromPath(pathname) ||
            (item.source === 'v1_discover_creator' ? item.author : null);
        const isCreatorItem = item.source === 'v2_creator' || item.source === 'v1_discover_creator' || !!creatorLabel;
        if (isCreatorItem) discoverStats.creatorItems++;
        else discoverStats.feedItems++;

        let creatorStats = null;
        if (isCreatorItem) {
            const key = creatorLabel || item.author || 'unknown';
            if (!discoverCreatorStats.has(key)) {
                discoverCreatorStats.set(key, { screened: 0, queued: 0, filtered: 0, duplicate: 0, known: 0, dropped: 0 });
            }
            creatorStats = discoverCreatorStats.get(key);
            creatorStats.screened++;
        }

        if (status === 'queued') {
            discoverStats.mediaQueued++;
            if (item.isVideo || item.mode === 'v2') discoverStats.videosQueued++;
            else discoverStats.imagesQueued++;
            if (creatorStats) {
                if (creatorStats.queued === 0) discoverStats.creatorsWithMedia++;
                creatorStats.queued++;
            }
        } else if (status && status.startsWith('filtered')) {
            discoverStats.mediaFiltered++;
            if (creatorStats) creatorStats.filtered++;
        } else if (status === 'duplicate') {
            discoverStats.mediaDuplicate++;
            if (creatorStats) creatorStats.duplicate++;
        } else if (status === 'known') {
            discoverStats.mediaKnown++;
            if (creatorStats) creatorStats.known++;
        } else if (status === 'dropped') {
            discoverStats.mediaDropped++;
            if (creatorStats) creatorStats.dropped++;
        }
        const label = creatorLabel ? `creator ${creatorLabel}` : 'feed';
        discoverStats.lastEvent = `${label}: ${status || 'seen'}${item.isVideo || item.mode === 'v2' ? ' video' : ' image'}`;
    }

    function maybeEnqueueBrowseFetch(item, pathname) {
        if (!browseFetchEnabled) return 'disabled';
        const key = browseFetchKey(item);
        if (!key) return 'no-key';
        if (browseFetchSeen.has(key)) {
            discoverRememberMediaDecision(item, 'duplicate', pathname);
            return 'duplicate';
        }
        if (browseFetchManifest.has(key)) {
            browseFetchSeen.add(key);
            discoverRememberMediaDecision(item, 'known', pathname);
            return 'known';
        }
        const filterReason = browseFetchFilterBlockReason(item);
        if (filterReason) {
            discoverRememberMediaDecision(item, `filtered:${filterReason}`, pathname);
            return `filtered:${filterReason}`;
        }
        if (browseFetchQueue.length >= BROWSE_FETCH_QUEUE_MAX) {
            browseFetchStats.dropped++;
            updateBrowseFetchBadge();
            discoverRememberMediaDecision(item, 'dropped', pathname);
            return 'dropped';
        }
        browseFetchSeen.add(key);
        browseFetchQueue.push({ item, pathname: pathname || '/' });
        browseFetchStats.captured++;
        discoverRememberMediaDecision(item, 'queued', pathname);
        updateBrowseFetchBadge();
        startBrowseFetchWorkers();
        return 'queued';
    }

    // Opportunistic walk — scan unknown /backend/ responses for post- or task-shaped objects.
    // Conservative: only inspect `items` / `data` / `posts` arrays; only one level deep.
    function opportunisticIngest(data, url, pathname) {
        if (!browseFetchEnabled || !data || typeof data !== 'object') return;
        try {
            const urlPath = (() => { try { return new URL(url, location.origin).pathname; } catch { return url; } })();
            if (!browseFetchDiscoveredEndpoints.has(urlPath)) {
                browseFetchDiscoveredEndpoints.add(urlPath);
                log(`📡 Browse&Fetch: noticed unknown endpoint ${urlPath}`);
            }
            const candidates = [];
            if (Array.isArray(data.items)) candidates.push(...data.items);
            if (Array.isArray(data.data))  candidates.push(...data.data);
            if (Array.isArray(data.posts)) candidates.push(...data.posts);
            if (Array.isArray(data.results)) candidates.push(...data.results);
            if (Array.isArray(data.generations)) candidates.push(...data.generations);
            if (!candidates.length) return;
            candidates.forEach(raw => {
                const entry = normaliseOpportunisticItem(raw);
                // Don't pollute `collected` (the active-scan list) with opportunistic finds — just enqueue.
                if (entry) maybeEnqueueBrowseFetch(entry, pathname);
            });
            if (discoverRunning) {
                discoverExtractCreators(data);
                scheduleDiscoverDrain();
                updateMirrorRunningStats();
            }
        } catch (e) { /* silent — opportunistic is best-effort */ }
    }

    // Pull a minimal entry out of an unknown-shape post/task object. Returns null if nothing usable.
    function normaliseOpportunisticItem(raw) {
        if (!raw || typeof raw !== 'object') return null;
        if (raw.generation && typeof raw.generation === 'object') {
            raw = raw.generation;
        }
        // v2 post-shaped
        const post = raw.post ?? raw;
        const att  = Array.isArray(post.attachments) ? post.attachments[0] : null;
        if (att && (att.downloadable_url || att.encodings?.source?.path || att.url)) {
            const postId = post.id ?? raw.id ?? '';
            if (!postId) return null;
            const dl = att.encodings?.source?.path ?? att.downloadable_url ?? att.download_urls?.watermark ?? att.url ?? null;
            const w = att.width ?? null, h = att.height ?? null;
            const ratio = (w && h) ? (() => { const g = gcd(w, h); return `${w/g}:${h/g}`; })() : null;
            const date = post.posted_at ? new Date(post.posted_at * 1000).toISOString().slice(0, 10)
                       : (post.updated_at ? new Date(post.updated_at * 1000).toISOString().slice(0, 10) : '');
            return {
                mode: 'v2', source: 'v2_opportunistic',
                genId: att.id ?? att.generation_id ?? postId, taskId: att.task_id ?? null,
                postId, date, prompt: post.text ?? post.caption ?? '',
                downloadUrl: dl?.trim() ? dl : null, previewUrl: att.url ?? null,
                width: w, height: h, ratio, duration: att.duration_s ?? null,
                isLiked: post.user_liked === true,
                likeCount: readLikeCount(post, raw),
                author: raw.profile?.username ?? post.author?.username ?? null,
                _raw: raw,
            };
        }
        // v1 generation-shaped
        if (raw.id && raw.url && (raw.task_id || raw.task_type || raw.created_at)) {
            const genId = raw.id;
            const w = raw.width ?? null, h = raw.height ?? null;
            const ratio = (w && h) ? (() => { const g = gcd(w, h); return `${w/g}:${h/g}`; })() : null;
            const taskType = (raw.task_type ?? '').toLowerCase();
            const isVideo  = taskType.includes('vid') || (raw.n_frames ?? 1) > 1;
            const directUrl = raw.encodings?.source?.path
                           ?? raw.downloadable_url
                           ?? raw.download_urls?.watermark
                           ?? null;
            return {
                mode: 'v1', source: 'v1_opportunistic', genId,
                taskId: raw.task_id ?? '',
                date: (raw.created_at ?? '').slice(0, 10),
                prompt: raw.prompt ?? '',
                pngUrl: String(raw.url).replace(/&amp;/g, '&'),
                downloadUrl: directUrl ? String(directUrl).replace(/&amp;/g, '&') : null,
                width: w, height: h, ratio,
                quality: raw.quality ?? null, operation: raw.operation ?? null,
                model: raw.model ?? null, seed: raw.seed ?? null,
                taskType, nVariants: raw.n_variants ?? 1, isVideo,
                author: raw.user?.username ?? null,
                likeCount: readLikeCount(raw),
                _raw: raw,
            };
        }
        return null;
    }

    // Manifest: load existing, append new, debounced write.
    async function browseFetchLoadManifest() {
        if (browseFetchManifestLoaded || !browseFetchRootDir) return;
        browseFetchManifestLoaded = true;
        try {
            const fh = await browseFetchRootDir.getFileHandle(getBrowseFetchManifestFile(), { create: false });
            const f  = await fh.getFile();
            const text = await f.text();
            const data = JSON.parse(text);
            const list = Array.isArray(data?.entries) ? data.entries : [];
            list.forEach(e => { if (e?.key) { browseFetchManifest.set(e.key, e); browseFetchSeen.add(e.key); } });
            log(`📡 Browse&Fetch: loaded manifest (${browseFetchManifest.size} existing entries)`);
        } catch (e) {
            if (e?.name !== 'NotFoundError') log(`⚠ Browse&Fetch: manifest read failed — ${e.message}`);
        }
    }

    function browseFetchScheduleManifestWrite() {
        browseFetchManifestDirty = true;
        if (browseFetchManifestTimer) return;
        browseFetchManifestTimer = setTimeout(async () => {
            browseFetchManifestTimer = null;
            if (!browseFetchManifestDirty) return;
            browseFetchManifestDirty = false;
            await browseFetchFlushManifest();
        }, BROWSE_FETCH_MANIFEST_DEBOUNCE_MS);
    }

    async function browseFetchFlushManifest() {
        if (!browseFetchRootDir) return;
        const payload = {
            version: 1,
            updated_at: new Date().toISOString(),
            count: browseFetchManifest.size,
            entries: [...browseFetchManifest.values()],
        };
        try {
            const fh = await browseFetchRootDir.getFileHandle(getBrowseFetchManifestFile(), { create: true });
            const w  = await fh.createWritable();
            await w.write(JSON.stringify(payload, null, 2));
            await w.close();
        } catch (e) { log(`⚠ Browse&Fetch: manifest write failed — ${e.message}`); }
    }

    // Worker loop — pops from queue, downloads, writes manifest entry.
    function startBrowseFetchWorkers() {
        if (!browseFetchEnabled || browseFetchStopRequested) return;
        while (browseFetchWorkersActive < getBrowseFetchWorkerLimit() && browseFetchQueue.length > 0) {
            browseFetchWorkersActive++;
            browseFetchWorkerLoop().finally(() => { browseFetchWorkersActive--; });
        }
    }

    async function browseFetchWorkerLoop() {
        while (browseFetchEnabled && !browseFetchStopRequested) {
            const job = browseFetchQueue.shift();
            if (!job) {
                // idle — let the worker exit; new captures will restart via startBrowseFetchWorkers
                return;
            }
            try { await browseFetchDownloadItem(job.item, job.pathname); }
            catch (e) {
                browseFetchStats.failed++;
                log(`⚠ Browse&Fetch: "${(job.item.prompt || job.item.genId || '?').slice(0, 40)}" — ${e.message}`);
            }
            updateBrowseFetchBadge();
        }
    }

    async function browseFetchDownloadItem(item, pathname) {
        const key = browseFetchKey(item);
        if (!key) return;
        if (browseFetchManifest.has(key)) { browseFetchStats.skipped++; return; }

        const segments = browseFetchBuildSegments(item, pathname);
        const dir = await browseFetchResolveDir(segments);
        if (!dir) throw new Error('folder unavailable');

        const url = await getDownloadUrl(item);
        if (!url) throw new Error('no download URL');

        const ext = getFileExt(item).replace(/^\./, '');
        const base = buildBase(item) || key;
        const filename = `${base}.${ext}`;

        const ok = await downloadFileFS(url, filename, dir);
        if (!ok) throw new Error('download failed');

        let txtFilename = null;
        if (browseFetchFilters.saveTxt) {
            txtFilename = `${base}.txt`;
            try { await downloadTextFileFS(buildTxtContent(item), txtFilename, dir); }
            catch (e) { /* non-fatal */ }
        }

        browseFetchManifest.set(key, {
            key,
            genId: item.genId || null,
            postId: item.postId || null,
            source: item.source,
            mode: item.mode,
            author: item.author || null,
            captured_at: new Date().toISOString(),
            captured_path: pathname || '/',
            folder: segments.join('/'),
            filename,
            txt: txtFilename,
            prompt: item.prompt || '',
            likeCount: item.likeCount ?? null,
        });
        browseFetchScheduleManifestWrite();
    }

    async function enableBrowseFetch(mode = 'mirror') {
        if (browseFetchEnabled) return browseFetchMode === mode;
        browseFetchMode = mode;
        browseFetchManifest.clear();
        browseFetchSeen.clear();
        browseFetchDirCache.clear();
        browseFetchManifestLoaded = false;
        if (!browseFetchBaseDir) {
            try { browseFetchBaseDir = await window.showDirectoryPicker(); }
            catch { return false; }
        }
        try { browseFetchRootDir = await browseFetchBaseDir.getDirectoryHandle(getBrowseFetchRootName(), { create: true }); }
        catch (e) { log(`⚠ Browse&Fetch: cannot open ${getBrowseFetchRootName()}/ — ${e.message}`); return false; }
        await browseFetchLoadManifest();
        browseFetchEnabled = true;
        browseFetchStopRequested = false;
        log(`📡 Browse&Fetch: ON → ${getBrowseFetchRootName()}/`);
        updateBrowseFetchBadge();
        return true;
    }

    async function disableBrowseFetch() {
        browseFetchEnabled = false;
        browseFetchStopRequested = true;
        if (browseFetchManifestTimer) {
            clearTimeout(browseFetchManifestTimer);
            browseFetchManifestTimer = null;
        }
        if (browseFetchManifestDirty) {
            browseFetchManifestDirty = false;
            await browseFetchFlushManifest();
        }
        log(`📡 Browse&Fetch: OFF — captured ${browseFetchStats.captured}, failed ${browseFetchStats.failed}, dropped ${browseFetchStats.dropped}`);
        updateBrowseFetchBadge();
    }

    function updateBrowseFetchBadge() {
        const panel = document.getElementById('sdl');
        if (panel) panel.classList.toggle('bf-on', browseFetchEnabled);
        const el = document.getElementById('sdl-bf-badge');
        if (!el) return;
        if (!browseFetchEnabled) { el.textContent = '📡 Off'; el.className = 'sdl-bf-badge'; return; }
        const queued = browseFetchQueue.length;
        const done = browseFetchManifest.size;
        const savedCount = document.getElementById('sdl-bf-saved-count');
        if (savedCount) savedCount.textContent = done.toLocaleString();
        el.textContent = queued > 0
            ? `📡 ${browseFetchStats.captured} captured · ${queued} queued`
            : `📡 ${done} saved`;
        el.className = 'sdl-bf-badge on';
        updateMirrorRunningStats();
    }

    // =====================================================================
    // FILTER ENGINE
    // =====================================================================
    function getFilteredItems() {
        let result = [...collected.values()];
        if (filters.filterSources.size > 0)
            result = result.filter(i => filters.filterSources.has(i.source));
        if (filters.onlyFavorites)
            result = result.filter(i => i.mode === 'v1' && i.isFavorite === true);
        const minLikes = parseInt(filters.minLikes);
        const maxLikes = parseInt(filters.maxLikes);
        const hasMinLikes = !isNaN(minLikes) && minLikes >= 0;
        const hasMaxLikes = !isNaN(maxLikes) && maxLikes >= 0;
        if (hasMinLikes || hasMaxLikes) {
            result = result.filter(i => {
                const lc = Number(i.likeCount);
                if (!Number.isFinite(lc)) return false;
                if (hasMinLikes && lc < minLikes) return false;
                if (hasMaxLikes && lc > maxLikes) return false;
                return true;
            });
        }
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

    // Like getDistinctValuesByMode but respects the active filterSources selection
    function getDistinctValuesByModeFiltered(key, mode) {
        const vals = new Set();
        collected.forEach(item => {
            if (mode && item.mode !== mode) return;
            if (filters.filterSources.size > 0 && !filters.filterSources.has(item.source)) return;
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
        if (filters.minLikes !== '')       parts.push(`min likes: ${filters.minLikes}`);
        if (filters.maxLikes !== '')       parts.push(`max likes: ${filters.maxLikes}`);
        if (filters.filterSources.size)    parts.push(`category: ${[...filters.filterSources].map(id => SOURCE_LABELS[id] || id).join(', ')}`);
        if (filters.onlyFavorites)         parts.push('favorites only');
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
        const v2Ids = ['v2_profile', 'v2_drafts', 'v2_liked', 'v2_cameos', 'v2_cameo_drafts', 'v2_my_characters'];
        v2Ids.forEach(id => {
            const cb  = document.getElementById('sdl-src-cb-' + id);
            const row = document.getElementById('sdl-src-row-' + id);
            if (!cb || !row) return;
            const tag = row.querySelector('.sdl-geo-tag');
            if (tag) tag.remove();

            if (!isV2Supported) {
                cb.disabled = true;
                cb.checked  = false;
                enabledSources.delete(id);
                row.style.opacity = '0.4';
                row.title = 'Geo-blocked';
            } else {
                cb.disabled = false;
                row.style.opacity = '';
                row.title = '';
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
        const creatorCard = document.getElementById('sdl-mode-creator');
        if (creatorCard) creatorCard.classList.toggle('v2-disabled', !isV2Supported);
        if (!isV2Supported && activeStartMode === 'creator') {
            activeStartMode = 'regular';
            document.querySelectorAll('.sdl-mode-card').forEach(card => {
                card.classList.toggle('active', card.dataset.mode === 'regular');
                const arrow = card.querySelector('.sdl-mode-arrow');
                if (arrow) arrow.textContent = card.dataset.mode === 'regular' ? '⌃' : '⌄';
            });
            const regularBody = document.getElementById('sdl-mode-body-regular');
            const creatorBody = document.getElementById('sdl-cf-body');
            const mirrorBody  = document.getElementById('sdl-bf-body');
            if (regularBody) regularBody.style.display = '';
            if (creatorBody) creatorBody.style.display = 'none';
            if (mirrorBody)  mirrorBody.style.display = 'none';
            creatorFetchEnabled = false;
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

    async function fetchAllV2(baseEndpoint, sourceId, contextTag = null, opts = {}) {
        const { quiet = false, silent = false, capturedPath = null } = opts;
        if (!silent) log(`── ${sourceId}${contextTag ? ` · ${contextTag}` : ''} ──`);
        const base = `${location.origin}${baseEndpoint}`;
        let cursor = null, hasMore = true, page = 0;
        while (hasMore && !stopRequested) {
            page++;
            const sep = base.includes('?') ? '&' : '?';
            const url = cursor ? `${base}${sep}cursor=${encodeURIComponent(cursor)}` : base;
            const r   = await fetchWithRetry(url, { credentials: 'include', headers: buildHeaders() });
            if (!r) { if (!silent) setSrcStatus(sourceId, 'error'); return; }
            let data;
            try { data = await r.json(); }
            catch(e) { if (!silent) log(`${sourceId}: JSON parse error`); if (!silent) setSrcStatus(sourceId, 'error'); return; }
            const result = ingestV2Page(data, url, sourceId, capturedPath, contextTag);
            hasMore = result.nextCursor != null;
            cursor  = result.nextCursor;
            if (!quiet) log(`${sourceId} p${page}: ${collected.size} items${hasMore ? '…' : ' ✓'}`);
            if (hasMore) await sleep(60);
        }
        if (!silent) setSrcStatus(sourceId, stopRequested ? 'skipped' : 'done');
    }

    // Resolve the authenticated user's ID via /v2/me — cached for the session.
    // Returns the user_id string, or null if it couldn't be captured.
    async function ensureCachedUserId(logPrefix = 'V2') {
        if (cachedUserId) return cachedUserId;
        const r = await fetchWithRetry(
            `${location.origin}/backend/project_y/v2/me`,
            { credentials: 'include', headers: buildHeaders() }
        );
        if (!r) { log(`${logPrefix}: could not fetch /v2/me`); return null; }
        try {
            const d = await r.json();
            cachedUserId = d?.profile?.user_id ?? null;
        } catch(e) {
            log(`${logPrefix}: /v2/me parse error`);
            return null;
        }
        if (!cachedUserId) { log(`${logPrefix}: no user_id in /v2/me`); return null; }
        log(`${logPrefix}: user_id captured`);
        return cachedUserId;
    }

    async function fetchAllV2Liked() {
        log('── V2 Liked ──');
        const uid = await ensureCachedUserId('V2 liked');
        if (!uid) { setSrcStatus('v2_liked', 'error'); return; }
        await fetchAllV2(
            `/backend/project_y/profile/${uid}/post_listing/likes?limit=8`,
            'v2_liked'
        );
    }

    async function fetchCharacterDrafts(chId, characterUsername) {
        const before = collected.size;
        await fetchAllV2(
            `/backend/project_y/profile/drafts/cameos/character/${encodeURIComponent(chId)}?limit=50`,
            'v2_my_characters', characterUsername, { quiet: true, silent: true }
        );
        return collected.size > before;
    }

    function getCharacterId(ch) {
        return ch?.user_id ?? ch?.id ?? ch?.character_id ?? ch?.profile?.user_id ?? null;
    }

    async function fetchCharactersOfUser(userId, onCharacter, statusId = null) {
        const base = `${location.origin}/backend/project_y/profile/${userId}/characters?limit=20`;
        let cursor = null, hasMore = true;
        while (hasMore && !stopRequested) {
            const sep = base.includes('?') ? '&' : '?';
            const url = cursor ? `${base}${sep}cursor=${encodeURIComponent(cursor)}` : base;
            const r = await fetchWithRetry(url, { credentials: 'include', headers: buildHeaders() });
            if (!r) { if (statusId) setSrcStatus(statusId, 'error'); return; }
            let data;
            try { data = await r.json(); }
            catch(e) { if (statusId) { log(`${statusId}: characters JSON parse error`); setSrcStatus(statusId, 'error'); } return; }
            const items = Array.isArray(data?.items) ? data.items : [];
            for (const ch of items) {
                if (stopRequested) return;
                try { await onCharacter(ch); }
                catch (e) { log(`🎭 error processing character: ${e.message}`); }
            }
            cursor = data?.cursor ?? null;
            hasMore = cursor != null;
            if (hasMore) await sleep(60);
        }
    }

    async function fetchAllV2MyCharacters() {
        log('── My Characters (preview) ──');
        const uid = await ensureCachedUserId('V2 chars');
        if (!uid) { setSrcStatus('v2_my_characters', 'error'); return; }

        let charCount = 0;
        await fetchCharactersOfUser(uid, async (ch) => {
            const chId = getCharacterId(ch);
            const username = ch?.username ?? 'unknown';
            const display  = ch?.display_name ?? username;
            if (!chId || !chId.startsWith('ch_')) return;
            charCount++;
            log(`🎭 ${display} (@${username})`);
            await fetchAllV2(
                `/backend/project_y/profile_feed/${chId}?limit=50&cut=nf2`,
                'v2_my_characters', username, { quiet: true, silent: true }
            );
            await fetchAllV2(
                `/backend/project_y/profile_feed/${chId}?limit=50&cut=appearances`,
                'v2_my_characters', username, { quiet: true, silent: true }
            );
            const draftsFound = await fetchCharacterDrafts(chId, username);
            if (!draftsFound) {
                log(`🎭 ${username}: no character drafts found (posts + appearances captured)`);
            }
        }, 'v2_my_characters');

        if (charCount === 0) {
            log('🎭 No characters found for your account.');
        }
        setSrcStatus('v2_my_characters', stopRequested ? 'skipped' : 'done');
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
            v2_profile:      () => fetchAllV2('/backend/project_y/profile_feed/me?limit=8&cut=nf2', 'v2_profile'),
            v2_drafts:       () => fetchAllV2('/backend/project_y/profile/drafts/v2?limit=15', 'v2_drafts'),
            v2_liked:        fetchAllV2Liked,
            v2_cameos:       () => fetchAllV2('/backend/project_y/profile_feed/me?limit=8&cut=appearances', 'v2_cameos'),
            v2_cameo_drafts: () => fetchAllV2('/backend/project_y/profile/drafts/cameos?limit=15', 'v2_cameo_drafts'),
            v2_my_characters: fetchAllV2MyCharacters,
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

    function renderCreatorScanProgress(activeName = null) {
        const el = document.getElementById('sdl-src-progress');
        if (!el) return;
        const valid = creators.filter(c => c.state === 'valid' && c.userId);
        el.innerHTML = valid.map(c => {
            const active = activeName === c.username;
            return `<div class="sp-item ${active ? 'sp-active' : 'sp-done'}">
                <span class="sp-icon">👥</span>
                <span class="sp-lbl">${c.username}</span>
                <span class="sp-st">${active ? '◉' : '○'}</span>
            </div>`;
        }).join('');
    }

    async function fetchSelectedCreators() {
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

        const valid = creators.filter(c => c.state === 'valid' && c.userId);
        if (valid.length === 0) return;

        log(`── Creators (${valid.length}) ──`);
        renderCreatorScanProgress();
        for (const c of valid) {
            if (stopRequested) break;
            renderCreatorScanProgress(c.username);
            log(`👤 ${c.username}`);
            await fetchAllV2(
                `/backend/project_y/profile_feed/${c.userId}?limit=8&cut=nf2`,
                'v2_creator', c.username, { quiet: true, silent: true }
            );
            if (creatorFetchIncludeChars) {
                await fetchCharactersOfUser(c.userId, async (ch) => {
                    const chId = ch?.user_id;
                    const chUsername = ch?.username ?? 'unknown';
                    const chDisplay  = ch?.display_name ?? chUsername;
                    if (!chId || !chId.startsWith('ch_')) return;
                    log(`👤 ${c.username} → 🎭 ${chDisplay} (@${chUsername})`);
                    // For nested character content we still want the creator bucket,
                    // but ingestV2Page writes author = item.profile.username (= the character),
                    // which getSubfolderName combines with creatorUsername for the right path.
                    const tag = c.username;
                    await fetchAllV2(
                        `/backend/project_y/profile_feed/${chId}?limit=8&cut=nf2`,
                        'v2_creator', tag, { quiet: true, silent: true }
                    );
                    await fetchAllV2(
                        `/backend/project_y/profile_feed/${chId}?limit=8&cut=appearances`,
                        'v2_creator', tag, { quiet: true, silent: true }
                    );
                });
            }
        }
        renderCreatorScanProgress();
        log(`Creators ✓  · total ${collected.size}`);
    }

    // =====================================================================
    // DISCOVER & DOWNLOAD
    // =====================================================================
    function resetDiscoverState() {
        discoverSeenCreators.clear();
        discoverCreatorQueue.length = 0;
        discoverCreatorStats.clear();
        discoverStats.pages = 0;
        discoverStats.creatorsFound = 0;
        discoverStats.creatorsDone = 0;
        discoverStats.creatorErrors = 0;
        discoverStats.feedItems = 0;
        discoverStats.creatorItems = 0;
        discoverStats.mediaScreened = 0;
        discoverStats.mediaQueued = 0;
        discoverStats.mediaFiltered = 0;
        discoverStats.mediaDuplicate = 0;
        discoverStats.mediaKnown = 0;
        discoverStats.mediaDropped = 0;
        discoverStats.videosQueued = 0;
        discoverStats.imagesQueued = 0;
        discoverStats.creatorsWithMedia = 0;
        discoverStats.current = 'Starting';
        discoverStats.lastEvent = '';
        discoverStats.currentCreator = '';
    }

    function discoverCreatorKey(profile) {
        return profile?.userId || profile?.username || null;
    }

    function normaliseDiscoverProfile(profile) {
        if (!profile || typeof profile !== 'object') return null;
        const username = profile.username ?? profile.handle ?? profile.name ?? null;
        const userId = profile.user_id ?? profile.userId ?? profile.id ?? profile.profile_id ?? null;
        if (!username && !userId) return null;
        return {
            username: username ? String(username).replace(/^@/, '').toLowerCase() : null,
            userId: userId ? String(userId) : null,
        };
    }

    function discoverRememberCreator(profile) {
        if (browseFetchFilters.version !== 'v1' && browseFetchFilters.version !== 'v2') return false;
        const c = normaliseDiscoverProfile(profile);
        const key = discoverCreatorKey(c);
        if (!key || discoverSeenCreators.has(key)) return false;
        for (const seen of discoverSeenCreators.values()) {
            if (c.userId && seen.userId === c.userId) return false;
            if (c.username && seen.username === c.username) return false;
        }
        if (browseFetchFilters.maxCreators > 0 && discoverSeenCreators.size >= browseFetchFilters.maxCreators) return false;
        discoverSeenCreators.set(key, c);
        discoverCreatorQueue.push(c);
        discoverStats.creatorsFound++;
        return true;
    }

    function discoverExtractCreators(value, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 4) return;
        if (Array.isArray(value)) {
            value.forEach(v => discoverExtractCreators(v, depth + 1));
            return;
        }
        [
            value.profile, value.author, value.user, value.creator,
            value.post?.author, value.post?.profile, value.generation?.user,
        ].forEach(discoverRememberCreator);
        for (const key of ['items', 'data', 'posts', 'results', 'generations']) {
            if (Array.isArray(value[key])) discoverExtractCreators(value[key], depth + 1);
        }
    }

    function discoverV1FeedConfig(kind = browseFetchFilters.v1Feed) {
        if (kind === 'videos') {
            return { key: 'videos', path: '/backend/feed/videos?limit=24', label: 'Sora 1 Videos', capturedPath: '/explore/videos' };
        }
        if (kind === 'images') {
            return { key: 'images', path: '/backend/feed/images?limit=24', label: 'Sora 1 Images', capturedPath: '/explore/images' };
        }
        return { key: 'home', path: '/backend/feed/home?limit=24', label: 'Sora 1 Explore', capturedPath: '/explore' };
    }

    function discoverFeedLabel() {
        if (browseFetchFilters.version === 'v1') return discoverV1FeedConfig().label;
        return browseFetchFilters.feed === 'top' ? 'Sora 2 Top' : 'Sora 2 Explore';
    }

    function discoverIngestFeedPayload(data, urlPath, sourceOverride = null) {
        const candidates = [];
        if (Array.isArray(data?.items)) candidates.push(...data.items);
        if (Array.isArray(data?.data)) candidates.push(...data.data);
        if (Array.isArray(data?.posts)) candidates.push(...data.posts);
        if (Array.isArray(data?.results)) candidates.push(...data.results);
        if (Array.isArray(data?.generations)) candidates.push(...data.generations);
        candidates.forEach(raw => {
            const entry = normaliseOpportunisticItem(raw);
            if (entry) {
                if (sourceOverride) entry.source = sourceOverride;
                else if (browseFetchMode === 'discover') {
                    if (entry.mode === 'v1') entry.source = `v1_discover_${discoverV1FeedConfig().key}`;
                    if (entry.mode === 'v2') entry.source = browseFetchFilters.feed === 'top'
                        ? 'v2_discover_top'
                        : 'v2_discover_explore';
                }
                maybeEnqueueBrowseFetch(entry, urlPath);
            }
        });
        discoverExtractCreators(data);
    }

    function discoverReadCursor(data, endpoint) {
        if (endpoint?.cursorParam === 'after') {
            return data?.after
                ?? data?.next_after
                ?? data?.nextAfter
                ?? data?.last_id
                ?? data?.lastId
                ?? data?.pagination?.after
                ?? null;
        }
        return data?.cursor
            ?? data?.next_cursor
            ?? data?.nextCursor
            ?? data?.page_info?.end_cursor
            ?? data?.pagination?.cursor
            ?? null;
    }

    function discoverDescribePayload(data) {
        if (!data || typeof data !== 'object') return 'non-object response';
        const keys = Object.keys(data).slice(0, 8).join(',') || 'no keys';
        const counts = ['items', 'data', 'posts', 'results', 'generations']
            .filter(k => Array.isArray(data[k]))
            .map(k => `${k}:${data[k].length}`);
        return `keys=${keys}${counts.length ? ` arrays=${counts.join(',')}` : ''}`;
    }

    function discoverFeedEndpoints() {
        const feed = browseFetchFilters.feed === 'top' ? 'top' : 'explore';
        const top = feed === 'top';
        const v = browseFetchFilters.version;
        if (v === 'v1') {
            const cfg = discoverV1FeedConfig();
            return [{
                path: cfg.path,
                cursorParam: 'after',
                label: cfg.label,
                capturedPath: cfg.capturedPath,
            }];
        }
        if (top) {
            return [
                {
                    path: '/backend/project_y/feed?limit=8&cut=top',
                    cursorParam: 'cursor',
                    label: 'Sora 2 Top cut=top',
                    capturedPath: '/explore/top',
                },
                {
                    path: '/backend/project_y/feed?limit=8&cut=nf2&feed=top',
                    cursorParam: 'cursor',
                    label: 'Sora 2 Top feed=top',
                    capturedPath: '/explore/top',
                },
            ];
        }
        return [{
            path: '/backend/project_y/feed?limit=8&cut=nf2',
            cursorParam: 'cursor',
            label: 'Sora 2 Explore',
            capturedPath: '/explore',
        }];
    }

    async function discoverFetchFeedOnce(token) {
        let anyUseful = false;
        for (const endpoint of discoverFeedEndpoints()) {
            if (stopRequested || !discoverRunning || token !== discoverRunToken) break;
            const base = `${location.origin}${endpoint.path}`;
            const referrerPath = endpoint.capturedPath || topPathForDiscover();
            let cursor = null;
            for (let page = 0; page < 20 && !stopRequested && discoverRunning && token === discoverRunToken; page++) {
                const sep = base.includes('?') ? '&' : '?';
                const cursorParam = endpoint.cursorParam || 'cursor';
                const url = cursor ? `${base}${sep}${cursorParam}=${encodeURIComponent(cursor)}` : base;
                discoverStats.current = `${endpoint.label} page ${page + 1}`;
                discoverStats.lastEvent = cursor ? 'fetching next feed page' : 'fetching feed';
                updateMirrorRunningStats();
                let r;
                try {
                    r = await _fetch(url, {
                        credentials: 'include',
                        headers: buildHeaders(),
                        referrer: `${location.origin}${referrerPath}`,
                    });
                } catch(e) {
                    log(`Discover probe ${endpoint.label}: network error ${e.message}`);
                    break;
                }
                if (!r.ok) {
                    log(`Discover probe ${endpoint.label}: HTTP ${r.status}`);
                    if (r.status === 400 && !storedV2Headers['openai-sentinel-token']) {
                        log('Discover: Sora 1 feed may need Sora sentinel headers. Open the matching Explore feed once, then start Discover again.');
                    }
                    break;
                }
                let data;
                try { data = await r.json(); }
                catch(e) { log(`Discover: JSON parse failed for ${endpoint.label}`); break; }
                log(`Discover probe ${endpoint.label}: OK ${discoverDescribePayload(data)}`);
                discoverStats.pages++;
                const beforeCreators = discoverStats.creatorsFound;
                const beforeCaptured = browseFetchStats.captured;
                discoverIngestFeedPayload(data, referrerPath);
                if (discoverStats.creatorsFound > beforeCreators || browseFetchStats.captured > beforeCaptured) anyUseful = true;
                cursor = discoverReadCursor(data, endpoint);
                updateMirrorRunningStats();
                if ((data?.has_more === true || data?.hasMore === true) && !cursor) {
                    log(`Discover probe ${endpoint.label}: has_more=true but no ${cursorParam} cursor found`);
                }
                if (!cursor) break;
                await sleep(80);
            }
            if (anyUseful) break;
        }
        return anyUseful;
    }

    function topPathForDiscover() {
        if (browseFetchFilters.version === 'v1') return discoverV1FeedConfig().capturedPath;
        return browseFetchFilters.feed === 'top' ? '/explore/top' : '/explore';
    }

    async function resolveDiscoverCreator(profile) {
        if (browseFetchFilters.version === 'v1') return profile?.userId || profile?.username ? profile : null;
        if (profile.userId && profile.username) return profile;
        if (!profile.username) return profile.userId ? profile : null;
        try {
            const r = await _fetch(
                `${location.origin}/backend/project_y/profile/username/${encodeURIComponent(profile.username)}`,
                { credentials: 'include', headers: buildHeaders() }
            );
            if (!r.ok) return profile.userId ? profile : null;
            const d = await r.json();
            return {
                username: profile.username,
                userId: d?.user_id ?? profile.userId ?? null,
            };
        } catch(e) {
            return profile.userId ? profile : null;
        }
    }

    async function discoverFetchV1Creator(profile) {
        const c = await resolveDiscoverCreator(profile);
        const userId = c?.userId || c?.username || null;
        if (!userId) return false;
        const username = c.username || userId;
        discoverStats.currentCreator = username;
        discoverStats.current = `creator ${username}`;
        discoverStats.lastEvent = 'fetching Sora 1 creator library';
        updateMirrorRunningStats();
        let r;
        try {
            r = await _fetch(`${location.origin}/backend/search`, {
                method: 'POST',
                credentials: 'include',
                headers: buildHeaders({ 'content-type': 'application/json' }),
                body: JSON.stringify({ user_id: userId, query: '' }),
            });
        } catch (e) {
            log(`Discover: Sora 1 creator ${username} search failed - ${e.message}`);
            return false;
        }
        if (!r.ok) {
            log(`Discover: Sora 1 creator ${username} search HTTP ${r.status}`);
            return false;
        }
        let data;
        try { data = await r.json(); }
        catch (e) {
            log(`Discover: Sora 1 creator ${username} search JSON parse failed`);
            return false;
        }
        const before = discoverStats.mediaQueued;
        discoverIngestFeedPayload(data, `/profile/${username}`, 'v1_discover_creator');
        const st = discoverCreatorStats.get(sanitiseSegment(username)) || discoverCreatorStats.get(username);
        const found = st ? st.queued : (discoverStats.mediaQueued - before);
        discoverStats.lastEvent = `creator ${username}: ${found} queued`;
        log(`Discover: Sora 1 creator ${username} fetched (${found} queued)`);
        return true;
    }

    async function discoverFetchCreator(profile) {
        if (browseFetchFilters.version === 'v1') return discoverFetchV1Creator(profile);
        const c = await resolveDiscoverCreator(profile);
        if (!c?.userId) return false;
        const username = c.username || c.userId;
        discoverStats.currentCreator = username;
        discoverStats.current = `creator ${username}`;
        discoverStats.lastEvent = 'fetching Sora 2 creator videos';
        updateMirrorRunningStats();
        await fetchAllV2(
            `/backend/project_y/profile_feed/${encodeURIComponent(c.userId)}?limit=8&cut=nf2`,
            'v2_creator', username, { quiet: true, silent: true, capturedPath: `/profile/${username}` }
        );
        if (browseFetchFilters.includeChars) {
            await fetchCharactersOfUser(c.userId, async (ch) => {
                const chId = getCharacterId(ch);
                const chUsername = ch?.username ?? 'unknown';
                if (!chId || !chId.startsWith('ch_')) return;
                discoverStats.current = `creator ${username} / ${chUsername}`;
                discoverStats.lastEvent = 'fetching character videos';
                updateMirrorRunningStats();
                await fetchAllV2(
                    `/backend/project_y/profile_feed/${encodeURIComponent(chId)}?limit=8&cut=nf2`,
                    'v2_creator', username, { quiet: true, silent: true, capturedPath: `/profile/${username}/characters/${chUsername}` }
                );
                await fetchAllV2(
                    `/backend/project_y/profile_feed/${encodeURIComponent(chId)}?limit=8&cut=appearances`,
                    'v2_creator', username, { quiet: true, silent: true, capturedPath: `/profile/${username}/characters/${chUsername}/appearances` }
                );
                log(`Discover: ${username} -> character ${chUsername}`);
            });
        }
        const st = discoverCreatorStats.get(sanitiseSegment(username)) || discoverCreatorStats.get(username);
        if (st) discoverStats.lastEvent = `creator ${username}: ${st.queued} queued, ${st.filtered} filtered`;
        return true;
    }

    async function discoverDrainCreatorQueue(token) {
        const limit = Math.max(1, Math.min(4, (SPEED_PRESETS[speedIdx] ?? SPEED_PRESETS[1]).workers || 4));
        const workers = Array.from({ length: limit }, async () => {
            while (discoverRunning && !stopRequested && token === discoverRunToken) {
                const creator = discoverCreatorQueue.shift();
                if (!creator) return;
                discoverStats.currentCreator = creator.username || creator.userId || 'unknown';
                discoverStats.current = `queued creator ${discoverStats.currentCreator}`;
                discoverStats.lastEvent = `${discoverCreatorQueue.length} creators left in queue`;
                updateMirrorRunningStats();
                try {
                    const ok = await discoverFetchCreator(creator);
                    if (ok) discoverStats.creatorsDone++;
                    else discoverStats.creatorErrors++;
                } catch(e) {
                    discoverStats.creatorErrors++;
                    log(`Discover: creator failed - ${e.message}`);
                }
                updateMirrorRunningStats();
                await sleep(120);
            }
        });
        await Promise.all(workers);
    }

    function scheduleDiscoverDrain() {
        if (!discoverRunning || discoverDrainPromise) return;
        const token = discoverRunToken;
        discoverDrainPromise = discoverDrainCreatorQueue(token)
            .finally(() => { discoverDrainPromise = null; });
    }

    async function discoverLoop(token) {
        if (!CFG.BEARER_TOKEN) {
            try {
                const sessionRes = await _fetch('/api/auth/session');
                if (sessionRes.ok) {
                    const sessionData = await sessionRes.json();
                    if (sessionData?.accessToken) CFG.BEARER_TOKEN = sessionData.accessToken;
                }
            } catch (e) {}
        }
        for (let w = 0; !oaiDeviceId && w < 40 && !stopRequested; w++) await sleep(250);
        if (browseFetchFilters.feed === 'top' && browseFetchFilters.version !== 'v2') {
            browseFetchFilters.version = 'v2';
            log('Discover: Top feed is Sora 2 only; using Sora 2.');
        }
        log(`Discover: ${discoverFeedLabel()} feed started.`);
        while (discoverRunning && !stopRequested && token === discoverRunToken) {
            const ok = await discoverFetchFeedOnce(token);
            await discoverDrainCreatorQueue(token);
            if (!browseFetchFilters.keepPolling) break;
            if (!ok) log('Discover: no media from direct probes yet. Open Explore once while Discover is running to let SoraVault learn the live feed response.');
            await sleep(DISCOVER_IDLE_SLEEP_MS);
        }
        if (token !== discoverRunToken) return;
        discoverRunning = false;
        updateScanButton();
        updateMirrorRunningStats();
        log(`Discover: idle - ${discoverStats.creatorsDone} creators discovered, ${browseFetchManifest.size} files in manifest.`);
    }

    // =====================================================================
    // DOWNLOAD HELPERS
    // =====================================================================
    async function getDownloadUrl(item) {
        if (item.downloadUrl) return item.downloadUrl;
        if (item.mode === 'v2') {
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
        if (item.source === 'v2_my_characters') {
            const char = sanitiseSegment(item.author ?? 'unknown');
            return `${SUBFOLDERS.v2_my_characters}/${char}`;
        }
        if (item.source === 'v2_creator') {
            const creator = sanitiseSegment(item.creatorUsername ?? 'unknown');
            const char    = item.author && item.author !== item.creatorUsername
                ? sanitiseSegment(item.author) : null;
            return char
                ? `${SUBFOLDERS.v2_creator}/${creator}/characters/${char}`
                : `${SUBFOLDERS.v2_creator}/${creator}`;
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
        const filename = `soravault_manifest_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
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
        if (ENV.isTM) {
            GM_download({
                url, name: filename, saveAs: true,
                onload:  () => URL.revokeObjectURL(url),
                onerror: () => URL.revokeObjectURL(url),
            });
        } else {
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
    async function fetchBlobWithTimeout(url, timeoutMs) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const r = await _fetch(url, { signal: ctrl.signal });
            if (!r.ok) return { ok: false, status: r.status };
            return { ok: true, blob: await r.blob() };
        } finally {
            clearTimeout(t);
        }
    }

    async function downloadFileFS(url, filename, dir) {
        let blob;

        // 1) Native fetch with timeout + one retry — prevents workers from parking on hung requests
        const FETCH_TIMEOUT_MS = 30000;
        for (let attempt = 1; attempt <= 2 && !blob; attempt++) {
            try {
                const res = await fetchBlobWithTimeout(url, FETCH_TIMEOUT_MS);
                if (res.ok) { blob = res.blob; break; }
                log(`⚠ fetch ${res.status} for ${filename}${attempt === 1 ? ' — retrying' : ''}`);
            } catch(e) {
                const reason = e?.name === 'AbortError' ? `timeout after ${FETCH_TIMEOUT_MS/1000}s` : e.message;
                log(`⚠ fetch error for ${filename}: ${reason}${attempt === 1 ? ' — retrying' : ''}`);
            }
            if (!blob && attempt === 1) await sleep(800);
        }

        // 2) Fallback: GM_xmlhttpRequest (bypasses CORS / VPN issues) — Tampermonkey only
        if (!blob && ENV.isTM && typeof GM_xmlhttpRequest === 'function') {
            log(`↻ Retry via GM_xmlhttpRequest: ${filename}`);
            try {
                blob = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET', url,
                        responseType: 'blob',
                        onload:    (r) => r.status >= 200 && r.status < 300
                                         ? resolve(r.response) : reject(new Error(`GM ${r.status}`)),
                        onerror:   (e) => reject(new Error(e?.error || 'GM network error')),
                        ontimeout: ()  => reject(new Error('GM timeout')),
                    });
                });
            } catch(e) {
                log(`⚠ GM fallback failed for ${filename}: ${e.message}`);
            }
        }

        if (!blob) return false;
        return saveBlobFS(blob, filename, dir);
    }

    async function saveBlobFS(blob, filename, dir) {
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

    function downloadFileGM(url, subfolder, filename) {
        if (ENV.isTM) {
            // Tampermonkey: GM_download with subfolder support
            return new Promise(resolve => {
                const name = subfolder ? `${subfolder}/${filename}` : filename;
                GM_download({
                    url, name, saveAs: false,
                    onload:    ()  => resolve(true),
                    onerror:   (e) => { log(`GM err: ${e?.error || 'unknown'}`); resolve(false); },
                    ontimeout: ()  => { log('GM timeout'); resolve(false); },
                });
            });
        }
        // Chrome: anchor/blob fallback (no subfolder support)
        return (async () => {
            try {
                const r = await _fetch(url);
                if (!r.ok) return false;
                let blob = await r.blob();
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
                blob = null;
                return true;
            } catch(e) {
                log('Anchor download error: ' + e.message);
                return false;
            }
        })();
    }

    function downloadBlobGM(blob, subfolder, filename) {
        const name = subfolder ? `${subfolder}/${filename}` : filename;
        if (ENV.isTM) {
            return new Promise(resolve => {
                const url = URL.createObjectURL(blob);
                GM_download({
                    url, name, saveAs: false,
                    onload:   () => { URL.revokeObjectURL(url); resolve(true); },
                    onerror:  (e) => { URL.revokeObjectURL(url); log(`GM err: ${e?.error || 'unknown'}`); resolve(false); },
                    ontimeout:() => { URL.revokeObjectURL(url); log('GM timeout'); resolve(false); },
                });
            });
        }
        // Chrome: anchor fallback (no subfolder support)
        try {
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            return Promise.resolve(true);
        } catch(e) {
            log('Anchor download error: ' + e.message);
            return Promise.resolve(false);
        }
    }

    // =====================================================================
    // WATERMARK REMOVAL — proxy helpers + fetch logic
    // =====================================================================
    function extractMaybeSharedVideoId(value) {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (SHARED_VIDEO_ID_PATTERN.test(trimmed)) return trimmed;
        const match = trimmed.match(/(s_[A-Za-z0-9_-]+)/);
        return match?.[1] ?? null;
    }

    function getExpectedVideoSizeBytesFromSource(source) {
        const candidates = [
            source?.size_bytes,
            source?.sizeBytes,
            source?.byte_size,
            source?.byteSize,
            source?.bytes,
            source?.file_size,
            source?.fileSize,
            source?.content_length,
            source?.contentLength,
            source?.encodings?.source?.size_bytes,
            source?.encodings?.source?.sizeBytes,
            source?.encodings?.source?.byte_size,
            source?.encodings?.source?.content_length,
        ];
        for (const value of candidates) {
            const n = Number(value);
            if (Number.isFinite(n) && n > 0) return Math.round(n);
        }
        return null;
    }

    function getWatermarkProxyVideoId(item, directUrl) {
        const raw  = item?._raw ?? null;
        const post = raw?.post ?? null;
        const att  = (post?.attachments ?? [])[0] ?? null;
        const candidates = [
            item?.videoId,
            item?.genId,
            raw?.id,
            raw?.video_id,
            raw?.videoId,
            raw?.generation_id,
            raw?.generationId,
            post?.video_id,
            post?.videoId,
            att?.id,
            att?.video_id,
            att?.videoId,
            att?.generation_id,
            att?.generationId,
            directUrl,
            item?.downloadUrl,
            item?.previewUrl,
            raw?.url,
            att?.downloadable_url,
            att?.download_urls?.watermark,
            att?.download_urls?.no_watermark,
            att?.encodings?.source?.path,
            att?.encodings?.source?.url,
            att?.url,
        ];
        for (const candidate of candidates) {
            const videoId = extractMaybeSharedVideoId(candidate);
            if (videoId) return videoId;
        }
        return null;
    }

    function getWatermarkExpectedSizeBytes(item) {
        const raw  = item?._raw ?? null;
        const post = raw?.post ?? null;
        const att  = (post?.attachments ?? [])[0] ?? null;
        return item?.expectedSizeBytes
            ?? getExpectedVideoSizeBytesFromSource(raw)
            ?? getExpectedVideoSizeBytesFromSource(att)
            ?? null;
    }

    function isWatermarkRemovalSourceSupported(item) {
        return item?.source === 'v2_profile'
            || item?.source === 'v2_liked'
            || item?.source === 'v2_cameos'
            || item?.source === 'v2_my_characters'
            || item?.source === 'v2_creator';
    }

    function isWatermarkProxyEligible(item, directUrl) {
        return watermarkRemovalEnabled
            && !watermarkProxyDisabled
            && item?.mode === 'v2'
            && isWatermarkRemovalSourceSupported(item)
            && getFileExt(item) === '.mp4'
            && !!getWatermarkProxyVideoId(item, directUrl);
    }

    function clampRetryMs(value) {
        return Math.min(WATERMARK_FETCH_MAX_RETRY_MS, Math.max(800, Math.round(value)));
    }

    function jitterMs(maxJitterMs) {
        return Math.floor(Math.random() * maxJitterMs);
    }

    function resolveRetryDelayMs(response, attempt, rateLimitStreak) {
        const retryAfterSeconds = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
            return clampRetryMs(retryAfterSeconds * 1000 + jitterMs(400));
        }
        const exponentialMultiplier = Math.max(1, Math.min(6, attempt + 1 + rateLimitStreak));
        return clampRetryMs(WATERMARK_FETCH_BASE_RETRY_MS * exponentialMultiplier + jitterMs(500));
    }

    function isRetryableWatermarkStatus(status) {
        // 408 = soravdl upstream timeout — infrastructure-wide, retrying the same request won't help.
        // Caller must fast-fail and disable the proxy for the session.
        return status === 425 || status === 429 || (status >= 500 && status < 600);
    }

    function shouldFallbackToSourceDownload(byteLength, expectedSizeBytes) {
        if (byteLength < MIN_VIDEO_BYTES_FALLBACK_THRESHOLD) return true;
        if (expectedSizeBytes && expectedSizeBytes > 0) {
            return byteLength < expectedSizeBytes * ESTIMATED_SIZE_FALLBACK_RATIO;
        }
        return false;
    }

    function isLikelyVideoPayload(bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.length < 12) return false;
        const isMp4  = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
        const isWebM = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
        return isMp4 || isWebM;
    }

    function getVideoMimeType(bytes) {
        if (bytes?.[4] === 0x66 && bytes?.[5] === 0x74 && bytes?.[6] === 0x79 && bytes?.[7] === 0x70) return 'video/mp4';
        if (bytes?.[0] === 0x1a && bytes?.[1] === 0x45 && bytes?.[2] === 0xdf && bytes?.[3] === 0xa3) return 'video/webm';
        return 'application/octet-stream';
    }

    async function fetchWatermarkFreeVideoBytes(videoId, expectedSizeBytes, setPhase) {
        if (!SHARED_VIDEO_ID_PATTERN.test(videoId)) {
            throw new Error(`Video ID ${videoId} is not eligible for watermark removal.`);
        }

        const proxyUrl = `https://soravdl.com/api/proxy/video/${encodeURIComponent(videoId)}`;
        let lastError = null;

        for (let attempt = 1; attempt <= WATERMARK_FETCH_MAX_ATTEMPTS; attempt++) {
            setPhase?.(attempt === 1 ? 'Removing watermark via soravdl.com' : `Removing watermark via soravdl.com (retry ${attempt})`);
            const cooldownMs = globalRateLimitCooldownUntilMs - Date.now();
            if (cooldownMs > 0) await sleep(cooldownMs);

            let response;
            try {
                response = await _fetch(proxyUrl, {
                    method: 'GET',
                    headers: { accept: 'video/*,*/*;q=0.8' },
                });
            } catch(e) {
                lastError = e instanceof Error ? e : new Error(String(e));
                if (attempt >= WATERMARK_FETCH_MAX_ATTEMPTS) break;
                const retryMs = clampRetryMs(WATERMARK_FETCH_BASE_RETRY_MS * attempt + jitterMs(250));
                log(`Proxy retry ${attempt}/${WATERMARK_FETCH_MAX_ATTEMPTS} for ${videoId} in ${retryMs} ms`);
                await sleep(retryMs);
                continue;
            }

            if (response.status === 429) {
                watermarkRateLimitStreak++;
                const retryMs = resolveRetryDelayMs(response, attempt, watermarkRateLimitStreak);
                globalRateLimitCooldownUntilMs = Date.now() + retryMs;
                lastError = new Error(`Proxy rate limited (${response.status})`);
                if (attempt >= WATERMARK_FETCH_MAX_ATTEMPTS) break;
                setPhase?.(`Watermark proxy rate-limited - waiting ${Math.round(retryMs / 1000)}s`);
                log(`Proxy rate limited for ${videoId}; retrying in ${retryMs} ms`);
                await sleep(retryMs);
                continue;
            }

            globalRateLimitCooldownUntilMs = 0;
            watermarkRateLimitStreak = 0;

            if (!response.ok) {
                let detail = '';
                try { const j = await response.clone().json(); detail = j.message || j.error || ''; } catch(_) {}
                const statusLabel = detail ? `${response.status} — ${detail}` : `${response.status}`;
                lastError = new Error(`Proxy responded with ${statusLabel}`);
                // 408 = soravdl upstream timeout; infrastructure-wide, no point retrying
                if (response.status === 408 || !isRetryableWatermarkStatus(response.status) || attempt >= WATERMARK_FETCH_MAX_ATTEMPTS) break;
                const retryMs = clampRetryMs(WATERMARK_FETCH_BASE_RETRY_MS * attempt + jitterMs(250));
                log(`Proxy retry ${attempt}/${WATERMARK_FETCH_MAX_ATTEMPTS} for ${videoId} after HTTP ${response.status}`);
                await sleep(retryMs);
                continue;
            }

            const bytes = new Uint8Array(await response.arrayBuffer());
            if (!isLikelyVideoPayload(bytes)) {
                throw new Error('Proxy returned a non-video payload.');
            }
            if (shouldFallbackToSourceDownload(bytes.length, expectedSizeBytes)) {
                throw new Error(`Proxy payload too small (${bytes.length} bytes).`);
            }
            return bytes;
        }

        throw lastError ?? new Error(`Watermark proxy failed for ${videoId}`);
    }

    async function fetchWatermarkFreeVideoBlob(item, directUrl, setPhase) {
        const videoId = getWatermarkProxyVideoId(item, directUrl);
        if (!videoId) throw new Error('No shared Sora video ID found for proxy download.');
        const bytes = await fetchWatermarkFreeVideoBytes(videoId, getWatermarkExpectedSizeBytes(item), setPhase);
        return new Blob([bytes], { type: getVideoMimeType(bytes) });
    }

    async function downloadWithCurrentSolution(url, filename, item, dir, setPhase) {
        setPhase?.(`Downloading ${getSourceLabel(item)}`);
        if (dlMethod === 'fs') return downloadFileFS(url, filename, dir);
        return downloadFileGM(url, getSubfolderName(item), filename);
    }

    async function downloadMediaWithWatermarkProxyFallback(item, url, filename, dir, setPhase) {
        if (!isWatermarkProxyEligible(item, url)) {
            return downloadWithCurrentSolution(url, filename, item, dir, setPhase);
        }

        const videoId = getWatermarkProxyVideoId(item, url);
        try {
            const proxyPhase = phrase => setPhase?.(`${phrase} · ${getSourceLabel(item)}`);
            const blob = await fetchWatermarkFreeVideoBlob(item, url, proxyPhase);
            log(`Proxy download succeeded: ${videoId}`);
            if (dlMethod === 'fs') return saveBlobFS(blob, filename, dir);
            return downloadBlobGM(blob, getSubfolderName(item), filename);
        } catch(e) {
            watermarkProxyFailureCount++;
            const message = e instanceof Error ? e.message : String(e);
            const is408 = message.includes('408');
            setPhase?.(`Downloading ${getSourceLabel(item)} (direct file)`);
            log(`Proxy failed for ${videoId}: ${message}; falling back to OpenAI download`);
            if (!watermarkProxyDisabled && (is408 || watermarkProxyFailureCount >= WATERMARK_PROXY_FAILURE_LIMIT)) {
                watermarkProxyDisabled = true;
                const reason = is408 ? 'upstream timeout (408)' : `${watermarkProxyFailureCount} consecutive failures`;
                log(`Proxy disabled after ${reason}; continuing with OpenAI downloads only`);
            }
            showActivityWarning(watermarkProxyDisabled
                ? 'Watermark removal not available — turned off for this session'
                : 'Watermark removal not available — using original file');
            return downloadWithCurrentSolution(url, filename, item, dir, setPhase);
        }
    }

    function downloadTextFileGM(content, subfolder, filename) {
        if (ENV.isTM) {
            return new Promise(resolve => {
                const name = subfolder ? `${subfolder}/${filename}` : filename;
                const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                const dataUrl = URL.createObjectURL(blob);
                GM_download({
                    url: dataUrl, name, saveAs: false,
                    onload:    () => { URL.revokeObjectURL(dataUrl); resolve(true); },
                    onerror:   () => { URL.revokeObjectURL(dataUrl); resolve(false); },
                    ontimeout: () => { URL.revokeObjectURL(dataUrl); resolve(false); },
                });
            });
        }
        // Chrome: anchor fallback
        try {
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            return Promise.resolve(true);
        } catch(e) {
            return Promise.resolve(false);
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
        btn.classList.remove('sdl-btn-stop');
        if (activeStartMode === 'creator') {
            const valid = creators.filter(c => c.state === 'valid' && c.userId).length;
            btn.disabled = valid === 0 || !isV2Supported;
            btn.textContent = valid > 0 ? `Start Scan (${valid} creator${valid !== 1 ? 's' : ''})` : 'Add a valid creator';
            return;
        }
        if (activeStartMode === 'mirror') {
            btn.disabled = false;
            btn.textContent = browseFetchEnabled ? 'Stop Mirror Mode' : 'Start Scan';
            btn.classList.toggle('sdl-btn-stop', browseFetchEnabled);
            return;
        }
        if (activeStartMode === 'discover') {
            btn.disabled = false;
            btn.textContent = discoverRunning ? 'Stop Discover & Download' : 'Start Discover & Download';
            btn.classList.toggle('sdl-btn-stop', discoverRunning);
            return;
        }
        const availableCount = SCAN_SOURCES.filter(s => {
            const cb = document.getElementById('sdl-src-cb-' + s.id);
            return !cb || !cb.disabled;
        }).length;
        const n = enabledSources.size;
        btn.disabled = n === 0;
        btn.textContent = n >= availableCount ? 'Start Scan' : `Start Scan (${n} source${n !== 1 ? 's' : ''})`;
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
        }, 3600);
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
        iconEl.style.opacity = '0';
        textEl.style.opacity = '0';
        setTimeout(() => {
            iconEl.textContent = s.icon;
            textEl.textContent = s.text;
            iconEl.style.opacity = '1';
            textEl.style.opacity = '1';
        }, 160);
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

    function sendExtensionCommand(type, payload = {}) {
        if (!ENV.EXT_BASE) return Promise.resolve({ ok: false, error: 'extension bridge unavailable' });
        const id = `sv_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                window.removeEventListener('message', onMessage);
                resolve({ ok: false, error: 'extension bridge timeout' });
            }, 1500);
            function onMessage(event) {
                if (event.source !== window) return;
                const msg = event.data;
                if (!msg || msg.type !== 'SV_EXT_RESPONSE' || msg.id !== id) return;
                clearTimeout(timer);
                window.removeEventListener('message', onMessage);
                resolve(msg.response || { ok: false });
            }
            window.addEventListener('message', onMessage);
            window.postMessage({ type: 'SV_EXT_COMMAND', id, command: type, payload }, '*');
        });
    }

    async function openDownloadFolder() {
        if (baseDir && dlMethod === 'fs') {
            try {
                if (typeof baseDir.requestPermission === 'function') {
                    await baseDir.requestPermission({ mode: 'readwrite' });
                }
                if (typeof window.showDirectoryPicker === 'function') {
                    await window.showDirectoryPicker({
                        id: 'soravault-download-folder',
                        mode: 'readwrite',
                        startIn: baseDir,
                    });
                    return;
                }
            } catch(e) {
                showToast(`Folder selected: ${baseDir.name}`);
                return;
            }
        }

        const res = await sendExtensionCommand('SV_SHOW_DOWNLOADS_FOLDER');
        if (res.ok) return;
        showToast(lastDownloadFolderName
            ? `Folder: ${lastDownloadFolderName}`
            : 'Browser cannot open the selected folder directly');
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
    function updateMirrorRunningStats() {
        const saved = document.getElementById('sdl-mirror-saved');
        const captured = document.getElementById('sdl-mirror-captured');
        const queued = document.getElementById('sdl-mirror-queued');
        const failed = document.getElementById('sdl-mirror-failed');
        const folder = document.getElementById('sdl-mirror-folder');
        const filtersEl = document.getElementById('sdl-mirror-filters');
        const discoverDetail = document.getElementById('sdl-discover-detail');
        const isDiscover = browseFetchMode === 'discover';
        const liveText = document.getElementById('sdl-mirror-live-text');
        const countLabel = document.getElementById('sdl-mirror-count-label');
        const stopBtn = document.getElementById('sdl-stop-mirror');
        if (saved) saved.textContent = browseFetchManifest.size.toLocaleString();
        if (countLabel) countLabel.textContent = isDiscover ? 'discover items saved' : 'mirror items saved';
        if (liveText) liveText.textContent = isDiscover
            ? (discoverStats.current || `Discovering creators (${discoverStats.creatorsDone}/${discoverStats.creatorsFound})`)
            : 'Mirror Mode is watching your Sora browsing';
        if (stopBtn) stopBtn.textContent = isDiscover ? 'Stop Discover & Download' : 'Stop Mirror Mode';
        const mirrorMaxWrap = document.getElementById('sdl-mirror-maxlikes-wrap');
        const mirrorIncWrap = document.getElementById('sdl-mirror-include-wrap');
        const mirrorExcWrap = document.getElementById('sdl-mirror-exclude-wrap');
        if (mirrorMaxWrap) mirrorMaxWrap.style.display = isDiscover ? '' : 'none';
        if (mirrorIncWrap) mirrorIncWrap.style.display = isDiscover ? 'none' : '';
        if (mirrorExcWrap) mirrorExcWrap.style.display = isDiscover ? 'none' : '';
        const mirrorMin = document.getElementById('sdl-mirror-minlikes');
        const mirrorMax = document.getElementById('sdl-mirror-maxlikes');
        if (mirrorMin && document.activeElement !== mirrorMin) mirrorMin.value = String(browseFetchFilters.minLikes || 0);
        if (mirrorMax && document.activeElement !== mirrorMax) mirrorMax.value = browseFetchFilters.maxLikes == null ? '' : String(browseFetchFilters.maxLikes);
        if (captured) captured.textContent = browseFetchStats.captured.toLocaleString();
        if (queued) queued.textContent = browseFetchQueue.length.toLocaleString();
        if (failed) failed.textContent = browseFetchStats.failed.toLocaleString();
        if (folder) folder.textContent = browseFetchBaseDir ? `${browseFetchBaseDir.name}/${getBrowseFetchRootName()}/` : '(no folder picked)';
        if (discoverDetail) {
            discoverDetail.style.display = isDiscover ? '' : 'none';
            if (isDiscover) {
                const avgScreened = discoverStats.creatorsDone > 0
                    ? (discoverStats.creatorItems / discoverStats.creatorsDone).toFixed(1)
                    : '0';
                const creatorQueuedTotal = [...discoverCreatorStats.values()].reduce((n, st) => n + st.queued, 0);
                const avgQueued = discoverStats.creatorsDone > 0
                    ? (creatorQueuedTotal / discoverStats.creatorsDone).toFixed(1)
                    : '0';
                const activeCreators = discoverStats.currentCreator || 'feed';
                const knownOrDupes = discoverStats.mediaKnown + discoverStats.mediaDuplicate;
                const recentCreators = [...discoverCreatorStats.entries()].slice(-3)
                    .map(([name, st]) => `${name}: ${st.queued}/${st.screened} queued, ${st.filtered} filtered`)
                    .join(' · ') || 'none yet';
                const rows = [
                    ['Current', discoverStats.current || 'Idle'],
                    ['Last event', discoverStats.lastEvent || 'waiting'],
                    ['Creators', `${discoverStats.creatorsDone}/${discoverStats.creatorsFound} done · ${discoverCreatorQueue.length} queued · ${discoverStats.creatorErrors} errors`],
                    ['Media queue', `${browseFetchQueue.length} queued · ${browseFetchWorkersActive} workers · ${discoverStats.videosQueued} videos · ${discoverStats.imagesQueued} images`],
                    ['Screened', `${discoverStats.mediaScreened} total · ${discoverStats.feedItems} feed · ${discoverStats.creatorItems} creator`],
                    ['Matched', `${discoverStats.mediaQueued} queued · ${browseFetchManifest.size} saved · ${browseFetchStats.failed} failed`],
                    ['Filtered', `${discoverStats.mediaFiltered} by filters · ${knownOrDupes} known/duplicate · ${discoverStats.mediaDropped} dropped`],
                    ['Averages', `${avgScreened} screened/creator · ${avgQueued} queued/creator · ${discoverStats.creatorsWithMedia} creators with media`],
                    ['Active creator', activeCreators],
                    ['Recent creators', recentCreators],
                ];
                const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
                discoverDetail.innerHTML = rows.map(([k, v]) =>
                    `<div class="sdl-discover-stat-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`
                ).join('');
            }
        }
        if (filtersEl) {
            const parts = [];
            if (browseFetchFilters.minLikes > 0) parts.push(`min likes ${browseFetchFilters.minLikes}`);
            if (browseFetchFilters.maxLikes != null) parts.push(`max likes ${browseFetchFilters.maxLikes}`);
            if (browseFetchFilters.include.length) parts.push(`include: ${browseFetchFilters.include.join(', ')}`);
            if (browseFetchFilters.exclude.length) parts.push(`exclude: ${browseFetchFilters.exclude.join(', ')}`);
            if (browseFetchMode === 'discover') {
                parts.push(browseFetchFilters.version === 'v1' ? 'Sora 1' : 'Sora 2');
                if (browseFetchFilters.version === 'v1') parts.push(discoverV1FeedConfig().label.replace(/^Sora 1\s*/, ''));
                else parts.push(browseFetchFilters.feed === 'top' ? 'Top only' : 'Explore');
                if (browseFetchFilters.dateFrom) parts.push(`from ${browseFetchFilters.dateFrom}`);
                if (browseFetchFilters.dateTo) parts.push(`to ${browseFetchFilters.dateTo}`);
                if (browseFetchFilters.ratios.size) parts.push(`ratio ${[...browseFetchFilters.ratios].join(', ')}`);
                if (browseFetchFilters.version === 'v2') parts.push(browseFetchFilters.includeChars ? 'characters on' : 'characters off');
            }
            parts.push(browseFetchFilters.saveTxt ? 'prompts on' : 'prompts off');
            filtersEl.textContent = parts.join(' · ');
        }
        const discoverBadge = document.getElementById('sdl-discover-badge');
        if (discoverBadge) {
            discoverBadge.textContent = discoverRunning
                ? `${discoverStats.creatorsDone}/${discoverStats.creatorsFound} creators`
                : `${discoverStats.creatorsFound || 0} creators`;
            discoverBadge.classList.toggle('on', discoverRunning || discoverStats.creatorsFound > 0);
        }
        updateScanButton();
    }

    function startMirrorStatsTimer() {
        if (mirrorStatsTimer) clearInterval(mirrorStatsTimer);
        updateMirrorRunningStats();
        mirrorStatsTimer = setInterval(updateMirrorRunningStats, 1200);
    }

    function stopMirrorStatsTimer() {
        if (mirrorStatsTimer) clearInterval(mirrorStatsTimer);
        mirrorStatsTimer = null;
    }

    async function startMirrorMode() {
        if (browseFetchEnabled) {
            setState('mirror');
            startMirrorStatsTimer();
            return;
        }
        const ok = await enableBrowseFetch('mirror');
        if (!ok) {
            updateScanButton();
            return;
        }
        const bfFolder = document.getElementById('sdl-bf-folder');
        if (bfFolder && browseFetchBaseDir) bfFolder.textContent = `${browseFetchBaseDir.name}/${getBrowseFetchRootName()}/`;
        setState('mirror');
        startMirrorStatsTimer();
    }

    async function stopMirrorMode() {
        await disableBrowseFetch();
        stopMirrorStatsTimer();
        setState('init');
        updateScanButton();
    }

    async function startDiscoverMode() {
        if (discoverRunning) {
            await stopDiscoverMode();
            return;
        }
        if (speedIdx === 0) setSpeedIdx(1);
        resetDiscoverState();
        const ok = await enableBrowseFetch('discover');
        if (!ok) { updateScanButton(); return; }
        discoverRunning = true;
        const token = ++discoverRunToken;
        browseFetchStopRequested = false;
        stopRequested = false;
        setState('mirror');
        startMirrorStatsTimer();
        discoverLoopPromise = discoverLoop(token);
        updateScanButton();
    }

    async function stopDiscoverMode() {
        discoverRunning = false;
        discoverRunToken++;
        stopRequested = true;
        if (discoverLoopPromise) {
            try { await Promise.race([discoverLoopPromise, sleep(1500)]); } catch(e) {}
            discoverLoopPromise = null;
        }
        await disableBrowseFetch();
        stopMirrorStatsTimer();
        setState('init');
        updateScanButton();
    }

    async function startScan() {
        if (isRunning) return;
        if (activeStartMode === 'mirror') {
            if (browseFetchEnabled) {
                await stopMirrorMode();
                return;
            }
            await startMirrorMode();
            return;
        }
        if (activeStartMode === 'discover') {
            await startDiscoverMode();
            return;
        }
        if (activeStartMode === 'creator' && !isV2Supported) {
            setStatus('Creator Backup requires Sora 2 access');
            return;
        }
        if (activeStartMode === 'creator' && creators.filter(c => c.state === 'valid' && c.userId).length === 0) {
            setStatus('Add at least one valid creator');
            return;
        }
        if (activeStartMode === 'regular' && enabledSources.size === 0) {
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
        if (activeStartMode === 'creator') await fetchSelectedCreators();
        else await fetchSelectedSources();
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
        const wasDownloading = uiState === 'downloading';
        if (discoverRunning) {
            stopDiscoverMode();
            return;
        }
        stopRequested = true; isRunning = false;
        // Release any paused workers so they observe stopRequested and exit
        if (isPaused && pauseResolver) { pauseResolver(); pauseResolver = null; }
        isPaused = false;
        pauseGate = Promise.resolve();
        stopScanStories();
        log('Stopped.');
        if (wasDownloading) {
            setStatus('Stopping after active downloads finish...');
            const stopBtn = document.getElementById('sdl-stop-dl');
            if (stopBtn) stopBtn.textContent = 'Stopping...';
            return;
        }
        if (collected.size > 0) { setState('ready'); rebuildAllChips(); recomputeSelection(); }
        else setState('init');
    }

    // =====================================================================
    // WATERMARK ESTIMATE BADGE
    // =====================================================================
    function formatWatermarkEstimateLabel(minSeconds, maxSeconds) {
        if (maxSeconds <= 0) return '+0 min';
        const minMinutes = Math.max(1, Math.ceil(minSeconds / 60));
        const maxMinutes = Math.max(minMinutes, Math.ceil(maxSeconds / 60));
        return minMinutes === maxMinutes
            ? `+${maxMinutes} min`
            : `+${minMinutes}-${maxMinutes} min`;
    }

    function updateWatermarkEstimateBadge() {
        const badge = document.getElementById('sdl-watermark-estimate');
        if (!badge) return;

        const saveMedia = readConfigBool('SAVE_MEDIA', true);
        const watermarkEnabled = readConfigBool('WATERMARK_REMOVAL', false);
        if (!saveMedia || !watermarkEnabled) {
            badge.textContent = 'off';
            badge.classList.add('off');
            return;
        }

        const eligibleCount = getFilteredItems().filter(item =>
            item?.mode === 'v2'
            && isWatermarkRemovalSourceSupported(item)
            && getFileExt(item) === '.mp4'
            && !!getWatermarkProxyVideoId(item, item?.downloadUrl ?? null)
        ).length;

        badge.textContent = formatWatermarkEstimateLabel(eligibleCount * 10, eligibleCount * 20);
        badge.classList.remove('off');
    }

    // =====================================================================
    // SKIP-EXISTING + PAUSE HELPERS
    // =====================================================================

    // Extract all plausible ID tokens from a filename (stripped of ext).
    // Returns an array — a filename may contain both genId and postId.
    function extractIdTokensFromName(name) {
        const stem = name.replace(/\.[^.]+$/, '');
        const matches = stem.match(EXISTING_ID_PATTERN);
        return matches ? matches : [];
    }

    // Enumerate a FileSystemDirectoryHandle once. Returns Map<idToken, {exts:Set, sizes:Map<ext,size>, names:Set}>.
    // Fails open — any error returns an empty map so we never skip-by-mistake.
    async function scanExistingFiles(dir) {
        const map = new Map();
        if (!dir || typeof dir.values !== 'function') return map;
        try {
            for await (const entry of dir.values()) {
                if (entry.kind !== 'file') continue;
                const name = entry.name;
                const extMatch = name.match(/\.([a-z0-9]+)$/i);
                const ext = extMatch ? ('.' + extMatch[1].toLowerCase()) : '';
                let size = 0;
                try { const f = await entry.getFile(); size = f.size; } catch(_) { /* size unknown → treat as 0 */ }
                const tokens = extractIdTokensFromName(name);
                // Also index by full stem for exact-match fallback when template omits {genId}
                tokens.push(name.replace(/\.[^.]+$/, ''));
                for (const tok of tokens) {
                    if (!tok) continue;
                    let rec = map.get(tok);
                    if (!rec) { rec = { exts: new Set(), sizes: new Map(), names: new Set() }; map.set(tok, rec); }
                    rec.exts.add(ext);
                    rec.sizes.set(ext, size);
                    rec.names.add(name);
                }
            }
        } catch(e) {
            log(`⚠ Could not enumerate "${dir.name}" for skip-check — will re-download.`);
            return new Map();
        }
        return map;
    }

    // Look up candidate id tokens for this item against a pre-built existing map.
    // Returns the record from the map (or null) for the first matching token.
    function findExistingRecord(item, baseName, existingMap) {
        if (!existingMap) return null;
        const candidates = [item.genId, item.postId, item.taskId, baseName].filter(Boolean);
        for (const c of candidates) {
            const rec = existingMap.get(c);
            if (rec) return rec;
        }
        return null;
    }

    function shouldSkipMedia(item, rec) {
        if (!rec) return false;
        const ext = getFileExt(item);
        if (!rec.exts.has(ext)) return false;
        const size = rec.sizes.get(ext) ?? 0;
        const threshold = ext === '.mp4' ? SKIP_MIN_VIDEO_BYTES : SKIP_MIN_IMAGE_BYTES;
        return size >= threshold;
    }

    function shouldSkipText(rec) {
        if (!rec || !rec.exts.has('.txt')) return false;
        const size = rec.sizes.get('.txt') ?? 0;
        return size > 0;
    }

    function bumpSkipCount(sourceId, kind) {
        if (!skipSummary) return;
        const src = skipSummary.bySource[sourceId] ?? (skipSummary.bySource[sourceId] = {});
        src[kind] = (src[kind] ?? 0) + 1;
        skipSummary.totalSkipped += 1;
    }

    // Map a skip kind to human-readable noun for the summary line
    const SKIP_KIND_LABELS = { mp4: 'videos', png: 'images', txt: 'prompts' };

    function buildSkipSummaryLine() {
        if (!skipSummary || skipSummary.totalSkipped === 0) return '';
        const kinds = { mp4: 0, png: 0, txt: 0 };
        const sources = {};
        for (const [srcId, counts] of Object.entries(skipSummary.bySource)) {
            let srcTotal = 0;
            for (const [k, n] of Object.entries(counts)) {
                kinds[k] = (kinds[k] ?? 0) + n;
                srcTotal += n;
            }
            if (srcTotal > 0) sources[srcId] = srcTotal;
        }
        const kindParts = Object.entries(kinds)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${n.toLocaleString()} ${SKIP_KIND_LABELS[k] ?? k}`);
        const srcParts = Object.entries(sources)
            .map(([id, n]) => `${SOURCE_LABELS[id] ?? id} ${n.toLocaleString()}`);
        let line = `Skipped ${skipSummary.totalSkipped.toLocaleString()} existing files`;
        if (kindParts.length) line += ` — ${kindParts.join(', ')}`;
        if (srcParts.length)  line += ` · by source: ${srcParts.join(' · ')}`;
        return line;
    }

    // Pause — workers await pauseGate between items
    function waitIfPaused() {
        return isPaused ? pauseGate : Promise.resolve();
    }

    function pauseDownload() {
        if (isPaused || !isRunning) return;
        isPaused = true;
        pauseGate = new Promise(resolve => { pauseResolver = resolve; });
        const btn = document.getElementById('sdl-pause');
        if (btn) { btn.textContent = '▶ Resume'; btn.classList.add('sdl-paused'); }
        const eta = document.getElementById('sdl-dl-eta');
        if (eta) eta.textContent = 'Paused';
        const bar = document.getElementById('sdl-dl-bar');
        if (bar) bar.classList.add('sdl-bar-paused');
        log('⏸ Paused — in-flight items will finish; no new items will start.');
    }

    function resumeDownload() {
        if (!isPaused) return;
        isPaused = false;
        if (pauseResolver) { pauseResolver(); pauseResolver = null; }
        pauseGate = Promise.resolve();
        const btn = document.getElementById('sdl-pause');
        if (btn) { btn.textContent = '⏸ Pause'; btn.classList.remove('sdl-paused'); }
        const bar = document.getElementById('sdl-dl-bar');
        if (bar) bar.classList.remove('sdl-bar-paused');
        log('▶ Resumed.');
    }

    function togglePause() {
        if (!isRunning) return;
        if (isPaused) resumeDownload(); else pauseDownload();
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
        skipEnabled     = readConfigBool('SKIP_EXISTING', true);
        watermarkRemovalEnabled = readConfigBool('WATERMARK_REMOVAL', false);

        if (!saveMedia && !saveTxt && !saveJSON) {
            showToast('Enable at least one output format ↑');
            return;
        }

        const hasFS = typeof window.showDirectoryPicker === 'function';
        const hasGM = ENV.hasGM;

        baseDir = null;

        if (saveMedia || saveTxt) {
            if (hasFS) {
                try {
                    baseDir = await window.showDirectoryPicker({ mode: 'readwrite' });
                    lastDownloadFolderName = baseDir?.name || '';
                    dlMethod = 'fs';
                } catch(e) {
                    log('Folder selection cancelled.');
                    return;
                }
            } else if (hasGM) {
                dlMethod = 'gm';
                log(ENV.isTM
                    ? 'ℹ Folder picker not available — using Tampermonkey downloads'
                    : 'ℹ Folder picker not available — using anchor download fallback');
            } else {
                log('⚠ No download method available (use Chrome/Edge).');
                setStatus('Chrome/Edge required for folder picker — see log');
                return;
            }
        }

        isRunning = true; stopRequested = false;
        completedCount = 0; failedCount = 0;
        totalToDownload = items.length;
        activeDownloadWorkerCount = 0;
        lastSaveTxt    = saveTxt;
        lastSaveMedia  = saveMedia;
        lastSaveJSON   = saveJSON;
        lastFilterSnap = snapshotActiveFilters();
        watermarkProxyDisabled = !watermarkRemovalEnabled;
        watermarkProxyFailureCount = 0;
        globalRateLimitCooldownUntilMs = 0;
        watermarkRateLimitStreak = 0;

        // Reset pause + skip state for this run
        isPaused = false; pauseGate = Promise.resolve(); pauseResolver = null;
        existingFilesCache.clear();
        skipSummary = { bySource: {}, totalSkipped: 0 };
        skipTemplateWarned = false;
        const pauseBtn = document.getElementById('sdl-pause');
        if (pauseBtn) { pauseBtn.textContent = '⏸ Pause'; pauseBtn.classList.remove('sdl-paused'); }
        const barEl = document.getElementById('sdl-dl-bar');
        if (barEl) barEl.classList.remove('sdl-bar-paused');

        // Warn once if skip is on but template won't match reliably
        if (skipEnabled) {
            const tpl = readConfig('FILENAME_TEMPLATE') || CFG.FILENAME_TEMPLATE;
            if (!tpl.includes('{genId}')) {
                log('ℹ Skip-existing works best with {genId} in the filename template — falling back to exact-name match.');
                skipTemplateWarned = true;
            }
        }

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

        if (saveJSON) {
            log('Saving JSON manifest first...');
            await exportJSON(true);
            showToast('JSON manifest saved first');
        }

        const subDirCache = {};
        async function getSubDir(item) {
            const name = getSubfolderName(item);
            if (!subDirCache[name]) {
                const segments = name.split('/').filter(Boolean);
                let dir = baseDir;
                try {
                    for (const seg of segments) {
                        dir = await dir.getDirectoryHandle(seg, { create: true });
                    }
                    subDirCache[name] = dir;
                } catch(e) {
                    log(`Could not create subfolder "${name}", using root.`);
                    subDirCache[name] = baseDir;
                }
            }
            return subDirCache[name];
        }

        // Build (once per subfolder) a map of existing files for skip-check
        async function getExistingMap(item) {
            if (!skipEnabled || dlMethod !== 'fs') return null;
            const name = getSubfolderName(item);
            if (!existingFilesCache.has(name)) {
                const dir = await getSubDir(item);
                existingFilesCache.set(name, await scanExistingFiles(dir));
            }
            return existingFilesCache.get(name);
        }

        const dlStart = Date.now();
        let idx = 0;
        let activeDownloadWorkers = 0;
        let resolveDownloadWorkersDone;
        const downloadWorkersDone = new Promise(resolve => { resolveDownloadWorkersDone = resolve; });

        function getDownloadWorkerLimit() {
            const preset = SPEED_PRESETS[speedIdx] ?? SPEED_PRESETS[0];
            const workers = dlMethod === 'gm'
                ? Math.min(2, preset.workers)
                : preset.workers;
            return Math.max(1, workers);
        }

        function getDownloadDelayMs() {
            return (SPEED_PRESETS[speedIdx] ?? SPEED_PRESETS[0]).delay;
        }

        function maybeResolveDownloadWorkers() {
            if ((stopRequested || idx >= items.length) && activeDownloadWorkers === 0) {
                resolveDownloadWorkersDone();
            }
        }

        function scheduleDownloadWorkers() {
            if (stopRequested) {
                maybeResolveDownloadWorkers();
                return;
            }

            const desired = Math.min(items.length - idx, getDownloadWorkerLimit());
            while (activeDownloadWorkers < desired && idx < items.length && !stopRequested) {
                activeDownloadWorkers++;
                worker().finally(() => {
                    activeDownloadWorkers--;
                    activeDownloadWorkerCount = activeDownloadWorkers;
                    updateDownloadProgress(dlStart);
                    scheduleDownloadWorkers();
                    maybeResolveDownloadWorkers();
                });
                activeDownloadWorkerCount = activeDownloadWorkers;
                updateDownloadProgress(dlStart);
            }
            maybeResolveDownloadWorkers();
        }

        async function worker() {
            let prevI = null;
            while (idx < items.length && !stopRequested) {
                // Block here if paused, then re-check stop (stop wins over resume)
                if (isPaused) await waitIfPaused();
                if (stopRequested) break;
                if (activeDownloadWorkers > getDownloadWorkerLimit()) break;

                const i = idx++, item = items[i];

                // Clean up previous item's entry at start of next — eliminates the empty-line gap
                if (prevI !== null) { workerActivities.delete(prevI); scheduleActivityRender(); }
                prevI = i;

                const base = buildBase(item);
                const ext  = getFileExt(item);

                const srcLabel = getSourceLabel(item);
                const setPhase = phrase => {
                    phrase ? workerActivities.set(i, phrase) : workerActivities.delete(i);
                    scheduleActivityRender();
                };
                setPhase(`Downloading ${srcLabel}`);

                // ── Skip-existing check (FS mode only) ───────────────────────
                const existingMap = await getExistingMap(item);
                const rec         = findExistingRecord(item, base, existingMap);
                const mediaSkip   = saveMedia && shouldSkipMedia(item, rec);
                const txtSkip     = saveTxt   && shouldSkipText(rec);
                const allRequestedSkippable = (!saveMedia || mediaSkip) && (!saveTxt || txtSkip);

                if (allRequestedSkippable && rec) {
                    if (mediaSkip) bumpSkipCount(item.source || item.sourceId, ext.replace('.', ''));
                    if (txtSkip)   bumpSkipCount(item.source || item.sourceId, 'txt');
                    completedCount++;
                    setPhase(null);
                    updateDownloadProgress(dlStart);
                    // No inter-item delay for pure skips — keeps a 5000-item re-run fast
                    continue;
                }

                log(`[${i+1}/${totalToDownload}] ${base.slice(0, 55)}…`);

                let mediaOk = true;

                if (saveMedia) {
                    if (mediaSkip) {
                        bumpSkipCount(item.source || item.sourceId, ext.replace('.', ''));
                    } else {
                        const url = await getDownloadUrl(item);
                        if (!url) {
                            failedCount++;
                            log(`No URL: ${item.genId || item.postId}`);
                            updateDownloadProgress(dlStart);
                            continue;
                        }
                        const targetDir = dlMethod === 'fs' ? await getSubDir(item) : null;
                        mediaOk = await downloadMediaWithWatermarkProxyFallback(item, url, base + ext, targetDir, setPhase);
                    }
                }

                if (saveTxt) {
                    if (txtSkip) {
                        bumpSkipCount(item.source || item.sourceId, 'txt');
                    } else {
                        await sleep(60);
                        const content = buildTxtContent(item);
                        if (dlMethod === 'fs' && baseDir) {
                            const targetDir = await getSubDir(item);
                            await downloadTextFileFS(content, base + '.txt', targetDir);
                        } else if (dlMethod === 'gm') {
                            await downloadTextFileGM(content, getSubfolderName(item), base + '.txt');
                        }
                    }
                }

                if (saveMedia && !mediaOk) {
                    failedCount++;
                    log(`Failed: ${item.genId || item.postId}`);
                } else {
                    completedCount++;
                }

                updateDownloadProgress(dlStart);
                await sleep(getDownloadDelayMs());
            }
            // Clean up last item when worker exits loop
            if (prevI !== null) { workerActivities.delete(prevI); scheduleActivityRender(); }
        }

        downloadWorkerRetune = scheduleDownloadWorkers;
        scheduleDownloadWorkers();
        await downloadWorkersDone;

        isRunning = false;
        isPaused = false;
        downloadWorkerRetune = null;
        activeDownloadWorkerCount = 0;
        if (pauseResolver) { pauseResolver(); pauseResolver = null; }
        pauseGate = Promise.resolve();
        workerActivities.clear();
        renderActivityLine();
        if (activityWarningTimer) { clearTimeout(activityWarningTimer); activityWarningTimer = null; }
        const actRightEl = document.getElementById('sdl-activity-right');
        if (actRightEl) actRightEl.textContent = '';

        const skipLine = buildSkipSummaryLine();
        if (skipLine) log(skipLine);

        if (stopRequested) {
            log(`Stopped — ${completedCount} saved, ${failedCount} failed`);
            showEndScreen(saveTxt, saveMedia, saveJSON, { stopped: true });
        } else {
            if (saveJSON) log('JSON manifest was saved before media downloads started.');
            // Save download log
            const logEl = document.getElementById('sdl-log');
            if (logEl && logEl.textContent.trim()) {
                const logFilename = `SoraVault_log_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
                if (dlMethod === 'fs' && baseDir) {
                    await downloadTextFileFS(logEl.textContent, logFilename, baseDir);
                } else if (dlMethod === 'gm' && ENV.isTM) {
                    await downloadTextFileGM(logEl.textContent, null, logFilename);
                }
                log('Download log saved ✓');
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

    function showEndScreen(saveTxt, saveMedia, saveJSON, opts = {}) {
        setState('done');
        const stopped = opts.stopped === true;
        const timeStr = computeTimeSaved(completedCount, saveTxt);
        const word    = getContentWord();
        const titleEl = document.querySelector('.sdl-done-title');
        if (titleEl) titleEl.textContent = stopped
            ? `Stopped — ${completedCount} of ${totalToDownload} ${word} saved.`
            : `${completedCount} ${word} saved. ~${timeStr} back.`;
        const savedEl = document.getElementById('sdl-done-saved');
        if (savedEl) {
            savedEl.textContent = stopped
                ? 'Download stopped. Completed files remain saved on disk.'
                : (saveTxt ? 'Every prompt. Every experiment. ' : '') + 'Saved to your hard drive.';
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
        const skippedEl = document.getElementById('sdl-done-skipped');
        if (skippedEl) {
            const skipLine = buildSkipSummaryLine();
            if (skipLine) {
                skippedEl.style.display = '';
                skippedEl.innerHTML = `<span class="sdl-done-skipped-lbl">Skipped (already on disk)</span>${skipLine.replace(/^Skipped [\d,]+ existing files\s*/, '')}`;
            } else {
                skippedEl.style.display = 'none';
            }
        }
        const coffeeMsg = document.querySelector('#sdl-s-done .sdl-coffee-msg');
        if (coffeeMsg) {
            coffeeMsg.innerHTML = stopped
                ? `<strong>Partial backup saved.</strong><br>If SoraVault helped, a coffee still means the world.`
                : `<strong>You just saved ~${timeStr} of manual work.</strong><br>If that's worth a coffee to you — it means the world.`;
        }
        const folderBtn = document.getElementById('sdl-open-folder');
        if (folderBtn) {
            folderBtn.style.display = (baseDir || dlMethod !== 'fs') ? '' : 'none';
            const label = lastDownloadFolderName ? `Open folder: ${lastDownloadFolderName}` : 'Open download folder';
            folderBtn.textContent = label;
        }
    }

    // =====================================================================
    // STATE MACHINE
    // =====================================================================
    function setState(s) {
        uiState = s;
        ['init', 'scanning', 'ready', 'downloading', 'done', 'mirror'].forEach(id => {
            const el = document.getElementById('sdl-s-' + id);
            if (el) el.style.display = id === s ? '' : 'none';
        });
        if (s !== 'mirror') stopMirrorStatsTimer();
        setStatus({
            init:        '',
            scanning:    'Scanning your selected Sora sources',
            mirror:      browseFetchMode === 'discover'
                ? 'Discover & Download is exploring feeds and saving matching creator content'
                : 'Mirror Mode is watching your Sora browsing and saving matches in the background',
            ready:       '',
            downloading: dlMethod === 'gm'
                ? 'Saving via Tampermonkey → default Downloads folder'
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
        filters.authorExclude = ''; filters.filterSources.clear(); filters.onlyFavorites = false;
        filters.minLikes = ''; filters.maxLikes = '';
    }

    function resetFilterInputs() {
        ['sdl-f-keyword', 'sdl-f-author', 'sdl-f-date-from', 'sdl-f-date-to', 'sdl-f-n-items', 'sdl-f-min-likes', 'sdl-f-max-likes'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        document.querySelectorAll('#sdl-filter-drawer .sdl-chip.active').forEach(c => c.classList.remove('active'));
        syncNDirButtons();
    }

    function rebuildSourceChips() {
        const container = document.getElementById('sdl-f-sources');
        if (!container) return;
        container.innerHTML = '';

        // Only show sources that actually have items after the scan
        const presentSources = SCAN_SOURCES.filter(src =>
            [...collected.values()].some(i => i.source === src.id)
        );

        if (presentSources.length <= 1) {
            container.innerHTML = '<span class="sdl-chip-empty">—</span>';
            return;
        }

        presentSources.forEach(src => {
            const chip = document.createElement('button');
            chip.className = 'sdl-chip';
            chip.textContent = SOURCE_LABELS[src.id] || src.id;
            if (filters.filterSources.has(src.id)) chip.classList.add('active');
            chip.addEventListener('click', () => {
                filters.filterSources.has(src.id)
                    ? filters.filterSources.delete(src.id)
                    : filters.filterSources.add(src.id);
                chip.classList.toggle('active', filters.filterSources.has(src.id));
                rebuildAllChips();     // re-evaluate dim state on sub-filter chips
                recomputeSelection();
            });
            container.appendChild(chip);
        });
    }

    function rebuildAllChips() {
        rebuildSourceChips();
        rebuildChips('sdl-f-v1-ratios',     'ratios',     getDistinctValuesByModeFiltered('ratio', 'v1'));
        rebuildChips('sdl-f-v1-qualities',  'qualities',  getDistinctValuesByModeFiltered('quality', 'v1'));
        rebuildChips('sdl-f-v1-operations', 'operations', getDistinctValuesByModeFiltered('operation', 'v1'));
        rebuildChips('sdl-f-v2-ratios',     'ratios',     getDistinctValuesByModeFiltered('ratio', 'v2'));
        rebuildChips('sdl-f-v2-qualities',  'qualities',  getDistinctValuesByModeFiltered('quality', 'v2'));
    }

    function rebuildChips(containerId, filterKey, availableValues) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        // Append any selected values that are no longer available (show dimmed so the
        // user can see their selection is preserved, ready to un-dim when re-enabled).
        const unavailableSelected = [...filters[filterKey]].filter(v => !availableValues.includes(v));
        const allValues = [...availableValues, ...unavailableSelected];

        if (!allValues.length) { container.innerHTML = '<span class="sdl-chip-empty">—</span>'; return; }

        allValues.forEach(val => {
            const available = availableValues.includes(val);
            const chip = document.createElement('button');
            chip.className = 'sdl-chip';
            chip.textContent = val;
            if (filters[filterKey].has(val)) chip.classList.add('active');
            if (!available) chip.classList.add('dim');
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

    function getSourceLabel(item) {
        const sourceId = item?.source ?? item?.sourceId ?? '';
        return SOURCE_LABELS[sourceId]
            || SCAN_SOURCES.find(s => s.id === sourceId)?.label
            || sourceId
            || 'items';
    }

    function recomputeSelection() {
        const selected = getFilteredItems().length;
        const total    = collected.size;
        const word     = getContentWord();
        const pill     = document.getElementById('sdl-counter-pill');
        if (pill) {
            const filtered = selected < total;
            const pct = total > 0 ? Math.max(0, Math.min(1, selected / total)) : 0;
            pill.style.setProperty('--sdl-filter-deg', `${Math.round(pct * 360)}deg`);
            pill.innerHTML = filtered
                ? `<span class="sdl-filter-ring" aria-hidden="true"><span></span></span><span class="sdl-filter-summary-text">Will download <strong>${selected}</strong> of ${total} ${word}</span>`
                : `<span class="sdl-filter-ring" aria-hidden="true"><span></span></span><span class="sdl-filter-summary-text">Will download <strong>${total}</strong> ${word}</span>`;
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
        updateActiveFilterChips();
        updateWatermarkEstimateBadge();
    }

    function updateActiveFilterChips() {
        const wrap = document.getElementById('sdl-filter-active-chips');
        if (!wrap) return;
        const parts = snapshotActiveFilters();
        wrap.innerHTML = '';
        wrap.style.display = parts.length ? 'flex' : 'none';
        const shown = parts.slice(0, 4);
        shown.forEach(label => {
            const chip = document.createElement('span');
            chip.className = 'sdl-filter-mini-chip';
            chip.textContent = label;
            wrap.appendChild(chip);
        });
        if (parts.length > shown.length) {
            const more = document.createElement('span');
            more.className = 'sdl-filter-mini-chip more';
            more.textContent = `+${parts.length - shown.length}`;
            wrap.appendChild(more);
        }
    }

    function updateFilterBadge() {
        const badge = document.getElementById('sdl-filter-badge');
        if (!badge) return;
        const count = (filters.keyword.trim() ? 1 : 0) + (filters.nItems.trim() ? 1 : 0)
            + filters.ratios.size + filters.qualities.size + filters.operations.size
            + (filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0)
            + (filters.minLikes !== '' ? 1 : 0) + (filters.maxLikes !== '' ? 1 : 0)
            + (filters.authorExclude.trim() ? 1 : 0)
            + filters.filterSources.size + (filters.onlyFavorites ? 1 : 0);
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

    function renderActivityLine() {
        const el = document.getElementById('sdl-activity-left');
        if (!el) return;
        if (workerActivities.size === 0) {
            el.textContent = '\u00A0';
            el.classList.remove('sdl-activity-pulse');
            return;
        }
        const counts = new Map();
        for (const phrase of workerActivities.values())
            counts.set(phrase, (counts.get(phrase) || 0) + 1);
        el.textContent = [...counts.entries()]
            .map(([p, n]) => n > 1 ? `${p} ×${n}` : p)
            .join(' · ');
        const hasSlow = [...workerActivities.values()].some(p => p.includes('soravdl') || p.includes('rate-limited'));
        el.classList.toggle('sdl-activity-pulse', hasSlow);
    }

    function scheduleActivityRender() {
        if (activityRenderTimer) return;
        activityRenderTimer = setTimeout(() => { activityRenderTimer = null; renderActivityLine(); }, 120);
    }

    function showActivityWarning(text) {
        const el = document.getElementById('sdl-activity-right');
        if (!el) return;
        if (activityWarningTimer) clearTimeout(activityWarningTimer);
        el.textContent = text;
        activityWarningTimer = setTimeout(() => {
            el.textContent = '';
            activityWarningTimer = null;
        }, 10000);
    }

    function updateDownloadProgress(dlStart) {
        const done  = completedCount + failedCount;
        const nEl   = document.getElementById('sdl-dl-count');
        const bar   = document.getElementById('sdl-dl-bar');
        const dEl   = document.getElementById('sdl-dl-done');
        const fEl   = document.getElementById('sdl-dl-failed');
        const eta   = document.getElementById('sdl-dl-eta');
        const activeEl = document.getElementById('sdl-dl-active-workers');
        const fWrap = document.getElementById('sdl-fail-wrap');
        if (nEl) nEl.textContent = completedCount;
        if (dEl) dEl.textContent = completedCount;
        if (fEl) { fEl.textContent = failedCount; if (fWrap) fWrap.style.color = failedCount > 0 ? '#f87171' : ''; }
        if (bar && totalToDownload > 0) bar.style.width = (done / totalToDownload * 100) + '%';
        if (activeEl) activeEl.textContent = activeDownloadWorkerCount;
        if (eta && isPaused) {
            eta.textContent = 'Paused';
        } else if (eta && dlStart && completedCount > 0) {
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
        const n = Number.isFinite(i) ? i : parseInt(i, 10);
        speedIdx = Math.max(0, Math.min(SPEED_PRESETS.length - 1, Number.isFinite(n) ? n : 0));
        document.querySelectorAll('.sdl-speed-seg').forEach(el =>
            el.classList.toggle('active', parseInt(el.dataset.spd) === speedIdx));
        const hints   = [
            'Higher speed reduces total time but increases block risk.',
            'Higher speed reduces total time but increases block risk.',
            'Higher speed reduces total time but increases block risk.',
            'Higher speed reduces total time but increases block risk.',
        ];
        const classes = ['', '', 'warn', 'danger'];
        document.querySelectorAll('.sdl-speed-hint').forEach(h => {
            h.textContent = hints[speedIdx]; h.className = 'sdl-speed-hint ' + classes[speedIdx];
        });
        if (typeof downloadWorkerRetune === 'function') {
            downloadWorkerRetune();
            showActivityWarning('Speed updated');
        }
    }

    // =====================================================================
    // STYLES
    // =====================================================================
    const STYLE = `
#sdl {
  position:fixed; top:16px; right:16px; z-index:2147483647;
  width:530px; min-width:300px; max-width:720px;
  max-height:calc(100vh - 32px);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;
  font-size:14px; color:rgba(255,255,255,0.82);
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
#sdl-title { font-size:15px; font-weight:700; color:rgba(255,255,255,0.9); flex-shrink:0; }
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

/* ── Section cards (v2.6.0) — Backup + Mirror ──────────────────── */
.sdl-section {
  border:0.5px solid rgba(255,255,255,0.08);
  border-radius:12px; padding:10px 12px; margin-bottom:12px;
  background:rgba(255,255,255,0.015);
}
.sdl-section-backup { /* neutral */ }
.sdl-section-mirror {
  background:rgba(96,165,250,0.04);
  border-color:rgba(96,165,250,0.18);
}
.sdl-section-hd {
  display:flex; align-items:center; gap:8px; margin-bottom:10px;
  padding-bottom:8px; border-bottom:0.5px solid rgba(255,255,255,0.05);
}
.sdl-section-icon { font-size:14px; line-height:1; }
.sdl-section-title {
  font-size:12px; font-weight:600; color:rgba(255,255,255,0.82);
  display:inline-flex; align-items:center; gap:5px;
}
.sdl-section-sub {
  font-size:10px; color:rgba(255,255,255,0.32); flex:1;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.sdl-beta-tag {
  font-size:8.5px; font-weight:600; padding:1px 6px; border-radius:4px;
  background:rgba(251,191,36,0.15); color:rgba(251,191,36,0.85);
  border:0.5px solid rgba(251,191,36,0.25);
  letter-spacing:0.04em; text-transform:uppercase;
}
.sdl-active-pill {
  font-size:8.5px; font-weight:700; padding:1px 6px; border-radius:4px;
  background:rgba(251,191,36,0.12); color:rgba(251,191,36,0.9);
  border:0.5px solid rgba(251,191,36,0.3); text-transform:uppercase;
  margin-left:6px;
}
.sdl-mode-card:not(.active) .sdl-active-pill { display:none; }
.sdl-mode-card {
  border:0.5px solid rgba(255,255,255,0.12);
  border-radius:12px; margin-bottom:8px;
  background:rgba(255,255,255,0.018);
  overflow:hidden; transition:border-color 0.16s, background 0.16s, box-shadow 0.16s;
}
.sdl-mode-card.active {
  border-color:rgba(251,191,36,0.95);
  background:rgba(251,191,36,0.035);
  box-shadow:0 0 0 1px rgba(251,191,36,0.18) inset;
}
.sdl-mode-card.active .sdl-mode-title { font-size:14px; }
.sdl-mode-card.active .sdl-mode-sub { color:rgba(255,255,255,0.5); }
.sdl-mode-card.disabled { opacity:0.55; cursor:not-allowed; }
.sdl-mode-card.v2-disabled { opacity:0.45; }
.sdl-mode-head {
  display:flex; align-items:center; gap:10px;
  padding:12px 13px; cursor:pointer; user-select:none;
}
.sdl-mode-card.disabled .sdl-mode-head { cursor:not-allowed; }
.sdl-mode-radio {
  width:15px; height:15px; border-radius:50%;
  border:2px solid rgba(255,255,255,0.42); flex-shrink:0;
  box-shadow:inset 0 0 0 3px rgba(10,10,10,0.98);
}
.sdl-mode-card.active .sdl-mode-radio {
  border-color:#facc15; background:#fff;
}
.sdl-mode-icon {
  width:30px; height:30px; border-radius:8px;
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
  background:rgba(255,255,255,0.07); font-size:16px;
}
.sdl-mode-copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.sdl-mode-title {
  font-size:13px; font-weight:700; color:rgba(255,255,255,0.9);
  display:flex; align-items:center; gap:4px; white-space:nowrap;
}
.sdl-mode-sub {
  font-size:10.8px; color:rgba(255,255,255,0.42);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.sdl-mode-arrow, .sdl-mode-lock { color:rgba(255,255,255,0.45); flex-shrink:0; font-size:15px; }
.sdl-mode-card.active .sdl-mode-arrow { color:rgba(255,255,255,0.75); }
.sdl-mode-body { padding:0 13px 13px 42px; }
.sdl-src-note-top { font-size:11px; color:rgba(255,255,255,0.45); margin:2px 0 9px; }
.sdl-mirror-panel {
  border:0.5px solid rgba(59,130,246,0.35); border-radius:12px;
  background:linear-gradient(135deg,rgba(37,99,235,0.11),rgba(15,20,26,0.78)); margin-bottom:14px; overflow:hidden;
  box-shadow:0 0 0 1px rgba(59,130,246,0.08) inset;
}
.sdl-mirror-row {
  display:flex; align-items:center; justify-content:space-between; gap:10px;
  padding:11px 14px; border-bottom:0.5px solid rgba(255,255,255,0.075);
  font-size:12px; color:rgba(255,255,255,0.48);
}
.sdl-mirror-row strong {
  color:rgba(255,255,255,0.88); font-size:13px; font-weight:700;
  text-align:right; word-break:break-word;
}
.sdl-discover-detail { border-bottom:0.5px solid rgba(255,255,255,0.075); background:rgba(5,10,18,0.2); }
.sdl-discover-stat-row {
  display:flex; align-items:flex-start; justify-content:space-between; gap:10px;
  padding:8px 14px; border-bottom:0.5px solid rgba(255,255,255,0.055);
  font-size:11px; color:rgba(255,255,255,0.46);
}
.sdl-discover-stat-row:last-child { border-bottom:none; }
.sdl-discover-stat-row strong {
  color:rgba(226,232,240,0.9); font-size:11.5px; font-weight:650;
  text-align:right; max-width:62%; overflow-wrap:anywhere;
}
.sdl-mirror-filters { padding:11px 14px; font-size:12px; line-height:1.45; color:rgba(147,197,253,0.88); background:rgba(59,130,246,0.08); }
.sdl-mirror-hero {
  padding:16px 18px 14px; border-radius:12px; margin-bottom:14px;
  border:0.5px solid rgba(255,255,255,0.12); background:rgba(15,20,26,0.72);
}
.sdl-mirror-hero .sdl-big-count { margin-bottom:0; }
.sdl-mirror-hero .sdl-big-count .n { font-size:45px; font-weight:800; }
.sdl-mirror-hero .sdl-big-count .lbl { font-size:13px; letter-spacing:0; color:rgba(255,255,255,0.46); }
.sdl-mirror-live {
  display:flex; align-items:center; justify-content:center; gap:8px; margin-top:12px;
  font-size:12px; color:rgba(52,211,153,0.88);
}
.sdl-mirror-live-dot {
  width:8px; height:8px; border-radius:50%; background:#34d399;
  box-shadow:0 0 14px rgba(52,211,153,0.75);
}
.sdl-mirror-minimize-hint {
  margin-top:8px; font-size:11px; line-height:1.45; text-align:center;
  color:rgba(147,197,253,0.72);
}

/* Header mini indicator: pulsing monitor shown only when minimised and Mirror is active */
#sdl-bf-mini {
  display:none; width:18px; height:18px; align-items:center; justify-content:center;
  font-size:14px; line-height:1; color:rgba(147,197,253,0.96);
  text-shadow:0 0 10px rgba(96,165,250,0.85), 0 0 18px rgba(52,211,153,0.45);
  filter:drop-shadow(0 0 4px rgba(96,165,250,0.6));
  animation:sdl-bf-mini-pulse 1.8s ease-in-out infinite;
}
#sdl.collapsed.bf-on #sdl-bf-mini { display:inline-flex; }
@keyframes sdl-bf-mini-pulse {
  0%,100% { opacity:0.62; transform:scale(1); }
  50%     { opacity:1;    transform:scale(1.12); }
}

/* ── Mirror tile internals ─────────────────────────────────────── */
#sdl-bf-tile .sdl-section-title { flex:0 0 auto; }
.sdl-bf-badge {
  font-size:10px; padding:2px 8px; border-radius:20px; font-weight:500;
  background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.4);
  border:0.5px solid rgba(255,255,255,0.1);
}
.sdl-bf-badge.on {
  background:rgba(96,165,250,0.15); color:rgba(147,197,253,0.95);
  border-color:rgba(96,165,250,0.35);
}
.sdl-bf-toggle { flex-shrink:0; }
.sdl-bf-sub { font-size:10.5px; color:rgba(255,255,255,0.42); margin-top:5px; line-height:1.4; }
.sdl-bf-folder {
  font-size:10px; color:rgba(255,255,255,0.3); margin-bottom:8px;
  word-break:break-all; font-family:monospace;
}
.sdl-bf-row { display:flex; gap:10px; align-items:center; margin-bottom:6px; }
.sdl-bf-lbl {
  display:block; font-size:10.5px; color:rgba(255,255,255,0.55);
  margin-bottom:6px;
}
.sdl-bf-lbl-inline {
  display:flex; align-items:center; gap:6px; margin-bottom:0;
}
.sdl-bf-input {
  width:100%; margin-top:3px; padding:5px 8px; font-size:11px;
  background:rgba(255,255,255,0.04); border:0.5px solid rgba(255,255,255,0.1);
  border-radius:6px; color:rgba(255,255,255,0.85); box-sizing:border-box;
  font-family:inherit; resize:vertical;
}
.sdl-bf-input option { background:#111827; color:rgba(255,255,255,0.88); }
select.sdl-bf-input { min-height:28px; resize:none; }
.sdl-bf-input-num { width:70px; }
.sdl-bf-hint { font-size:9.5px; color:rgba(255,255,255,0.25); margin-top:6px; line-height:1.4; }
.sdl-bf-hint code { font-family:monospace; color:rgba(147,197,253,0.7); }
.sdl-segment {
  display:flex; gap:2px; width:100%; margin-top:3px; padding:2px;
  background:rgba(255,255,255,0.04); border:0.5px solid rgba(255,255,255,0.1);
  border-radius:6px; box-sizing:border-box;
}
.sdl-seg-btn {
  flex:1; min-width:0; height:24px; border:0; border-radius:4px;
  background:transparent; color:rgba(255,255,255,0.56); font:inherit; font-size:10.5px;
  cursor:pointer; white-space:nowrap;
}
.sdl-seg-btn.active { background:rgba(147,197,253,0.18); color:rgba(255,255,255,0.92); }
.sdl-seg-btn:disabled { opacity:0.36; cursor:not-allowed; }
.sdl-mirror-filter-controls {
  padding:12px 14px 6px; border-bottom:0.5px solid rgba(255,255,255,0.075);
  background:rgba(255,255,255,0.025);
}
.sdl-mirror-filter-controls .sdl-bf-row { margin-bottom:8px; }
.sdl-mirror-filter-controls .sdl-bf-lbl { color:rgba(255,255,255,0.62); }
.sdl-mirror-filter-controls .sdl-bf-input { background:rgba(5,10,18,0.32); }

/* ── Creator chips (sdl-cf-*) ─────────────────────────────────── */
.sdl-cf-chips { display:flex; flex-wrap:wrap; gap:5px; margin:2px 0 6px; min-height:4px; }
.sdl-cf-chip {
  display:inline-flex; align-items:center; gap:5px; padding:3px 6px 3px 9px;
  background:rgba(255,255,255,0.05); border:0.5px solid rgba(255,255,255,0.12);
  border-radius:14px; font-size:11px; color:rgba(255,255,255,0.8);
  line-height:1.2; max-width:100%;
}
.sdl-cf-chip .sdl-cf-chip-name { font-weight:500; }
.sdl-cf-chip .sdl-cf-chip-meta { font-size:9.5px; color:rgba(255,255,255,0.4); margin-left:2px; }
.sdl-cf-chip.state-checking { border-color:rgba(251,191,36,0.35); background:rgba(251,191,36,0.08); }
.sdl-cf-chip.state-valid    { border-color:rgba(52,211,153,0.4);  background:rgba(52,211,153,0.1); }
.sdl-cf-chip.state-valid .sdl-cf-chip-name { color:rgba(134,239,172,0.95); }
.sdl-cf-chip.state-invalid  { border-color:rgba(248,113,113,0.4); background:rgba(248,113,113,0.08); text-decoration:line-through; opacity:0.7; }
.sdl-cf-chip.state-error    { border-color:rgba(251,146,60,0.4);  background:rgba(251,146,60,0.08); }
.sdl-cf-chip-x {
  cursor:pointer; color:rgba(255,255,255,0.5);
  padding:0 2px; font-size:12px; line-height:1;
  background:none; border:0; font-family:inherit;
}
.sdl-cf-chip-x:hover { color:rgba(255,255,255,0.9); }

/* Preview pill on source-row names ("Characters [preview]") */
.sdl-preview-pill {
  display:inline-block; font-size:8.5px; padding:1px 5px; border-radius:10px;
  background:rgba(147,197,253,0.14); color:rgba(147,197,253,0.9);
  border:0.5px solid rgba(147,197,253,0.3);
  font-weight:500; letter-spacing:0.04em; text-transform:uppercase;
  margin-left:5px; vertical-align:middle;
}
.sdl-src-report {
  color:rgba(147,197,253,0.6); text-decoration:underline; text-underline-offset:1.5px;
}
.sdl-src-report:hover { color:rgba(147,197,253,0.95); }

/* ── Source groups ─────────────────────────────────────────────── */
.sdl-src-groups { margin-bottom:12px; display:flex; flex-direction:column; gap:10px; }
.sdl-src-group {
  background:rgba(255,255,255,0.025); border:0.5px solid rgba(255,255,255,0.07);
  border-radius:12px; overflow:hidden;
  display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:10px;
}
.sdl-src-group-hd {
  grid-column:1 / -1; margin:-10px -10px 0;
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
  grid-column:1 / -1; margin:0 -10px;
  padding:6px 12px 5px; font-size:10px; line-height:1.45;
  border-bottom:0.5px solid rgba(255,255,255,0.05);
}
.sdl-v2-notice-blocked { color:rgba(251,191,36,0.75); background:rgba(251,191,36,0.05); display:none; }
.sdl-v2-notice-ok      { color:rgba(52,211,153,0.7);  background:rgba(52,211,153,0.04); display:none; }

.sdl-src-row {
  display:grid; grid-template-columns:15px 18px 1fr; grid-template-areas:"check icon name" ". . sub";
  align-items:center; gap:3px 10px;
  padding:10px 11px; cursor:pointer; min-height:50px;
  border:0.5px solid rgba(255,255,255,0.08);
  border-radius:8px; background:rgba(255,255,255,0.018);
  transition:background 0.12s;
  user-select:none;
}
.sdl-src-row:last-child { border-bottom:0.5px solid rgba(255,255,255,0.08); }
.sdl-src-row:hover { background:rgba(255,255,255,0.035); }
.sdl-src-row input[type="checkbox"] {
  grid-area:check;
  width:15px; height:15px; flex-shrink:0; cursor:pointer;
  accent-color:#34d399;
}
.sdl-src-icon { grid-area:icon; font-size:14px; line-height:1; flex-shrink:0; }
.sdl-src-name { grid-area:name; font-size:13px; font-weight:700; color:rgba(255,255,255,0.82); min-width:0; }
.sdl-src-sub  { grid-area:sub; font-size:11px; color:rgba(255,255,255,0.34); white-space:normal; line-height:1.25; }
.sdl-geo-tag  {
  font-size:9px; padding:1.5px 6px; border-radius:20px;
  background:rgba(251,191,36,0.1); color:rgba(251,191,36,0.7);
  border:0.5px solid rgba(251,191,36,0.18); white-space:nowrap;
}

#sdl-src-note {
  font-size:11px; color:rgba(255,255,255,0.32); text-align:center;
  margin-bottom:11px; line-height:1.5;
}
.sdl-start-foot {
  font-size:12px; color:rgba(255,255,255,0.34); text-align:center;
  margin-top:8px; line-height:1.45; font-weight:500;
}

/* Source progress (scanning state) */
#sdl-src-progress {
  display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px;
}
.sp-item {
  display:flex; align-items:center; gap:4px;
  padding:5px 10px; border-radius:20px;
  background:rgba(255,255,255,0.045); border:0.5px solid rgba(255,255,255,0.09);
  font-size:12px; color:rgba(255,255,255,0.38);
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

.sdl-progress-card {
  padding:16px 18px 14px; border-radius:12px; margin-bottom:14px;
  border:0.5px solid rgba(255,255,255,0.12); background:rgba(15,20,26,0.72);
}
.sdl-progress-card .sdl-big-count .n { font-size:45px; font-weight:800; }
.sdl-progress-card .sdl-big-count .lbl { font-size:13px; letter-spacing:0; color:rgba(255,255,255,0.46); }
.sdl-progress-card .sdl-prog { height:12px; background:rgba(255,255,255,0.11); margin:0 0 12px; }
.sdl-progress-card .sdl-prog-bar { background:linear-gradient(90deg,#34d399,#4ade80); }
.sdl-progress-card .sdl-stats {
  display:grid; grid-template-columns:repeat(4,1fr); gap:0; margin:12px 0 0;
  padding-top:12px; border-top:0.5px solid rgba(255,255,255,0.1);
}
.sdl-progress-card .sdl-stat {
  justify-content:center; flex-direction:column; gap:3px; font-size:12px;
  color:rgba(255,255,255,0.62); border-right:0.5px solid rgba(255,255,255,0.1);
}
.sdl-progress-card .sdl-stat:last-child { border-right:none; }
.sdl-progress-card .sdl-stat-n { display:block; font-size:18px; font-weight:700; color:rgba(255,255,255,0.92); }
.sdl-stat-icon { color:#34d399; font-size:14px; margin-right:4px; }
.sdl-stat-icon.err { color:#f87171; }
.sdl-stat-icon.muted { color:rgba(255,255,255,0.58); }

/* Buttons */
.sdl-btn {
  display:block; width:100%; padding:14px 16px; margin-bottom:8px; border:none; border-radius:12px;
  cursor:pointer; font-size:16px; font-weight:700; letter-spacing:0.01em;
  text-align:center; -webkit-font-smoothing:antialiased;
  transition:opacity 0.14s,transform 0.1s; position:relative;
}
.sdl-btn:not(:disabled):active { transform:scale(0.98); }
.sdl-btn:disabled { opacity:0.22; cursor:not-allowed; }
.sdl-btn-primary { background:linear-gradient(135deg,#3b82f6,#3048e6); color:white; box-shadow:0 10px 24px rgba(48,72,230,0.25); }
.sdl-btn-primary:not(:disabled):hover { opacity:0.9; }
.sdl-btn-secondary { background:rgba(255,255,255,0.055); color:rgba(255,255,255,0.62); border:0.5px solid rgba(255,255,255,0.09); }
.sdl-btn-secondary:not(:disabled):hover { background:rgba(255,255,255,0.09); }
.sdl-btn-stop { background:rgba(248,113,113,0.1); color:#fca5a5; border:0.5px solid rgba(248,113,113,0.18); }
.sdl-btn-stop:not(:disabled):hover { background:rgba(248,113,113,0.18); }
.sdl-btn-pause { background:rgba(251,191,36,0.08); color:#fcd34d; border:0.5px solid rgba(251,191,36,0.16); }
.sdl-btn-pause:not(:disabled):hover { background:rgba(251,191,36,0.14); }
.sdl-btn-pause.sdl-paused { background:rgba(34,197,94,0.1); color:#86efac; border-color:rgba(34,197,94,0.2); }
.sdl-btn-pause.sdl-paused:not(:disabled):hover { background:rgba(34,197,94,0.18); }
.sdl-dl-actions { display:flex; gap:6px; }
.sdl-dl-actions .sdl-btn { margin-bottom:0; }
.sdl-ready-actions {
  display:grid; grid-template-columns:minmax(120px,0.36fr) 1fr; gap:8px; align-items:stretch;
}
.sdl-ready-actions .sdl-btn { margin-bottom:0; }
.sdl-ready-actions #sdl-rescan {
  font-size:13px; padding:10px 12px; font-weight:700;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;
}
.sdl-rescan-sub { font-size:10px; font-weight:500; color:rgba(255,255,255,0.35); }
.sdl-prog-bar.sdl-bar-paused { opacity:0.45; background:rgba(251,191,36,0.55); }
.sdl-btn-ghost { background:none; color:rgba(255,255,255,0.3); border:0.5px solid rgba(255,255,255,0.08); font-size:11.5px; padding:7px 14px; }
.sdl-btn-ghost:not(:disabled):hover { color:rgba(255,255,255,0.6); border-color:rgba(255,255,255,0.18); }

/* Stats row */
.sdl-stats { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:12px; }
.sdl-stat { display:flex; align-items:center; gap:4px; font-size:11px; color:rgba(255,255,255,0.26); }
.sdl-stat-n { color:rgba(255,255,255,0.68); font-weight:500; font-variant-numeric:tabular-nums; }
.sdl-stat-sep { width:1px; height:10px; background:rgba(255,255,255,0.09); }

/* Export toggles */
.sdl-export-toggles {
  background:rgba(17,22,28,0.78); border:0.5px solid rgba(255,255,255,0.1);
  border-radius:12px; margin-bottom:16px; overflow:hidden;
}
.sdl-export-row {
  display:flex; align-items:center; gap:12px; padding:12px 15px;
  border-bottom:0.5px solid rgba(255,255,255,0.07);
  transition:background 0.1s;
}
.sdl-export-row:last-child { border-bottom:none; }
.sdl-export-row:hover { background:rgba(255,255,255,0.02); }
.sdl-export-icon {
  width:26px; min-width:26px; height:26px; display:flex; align-items:center; justify-content:center;
  font-size:22px; line-height:1; font-weight:700;
}
.sdl-export-icon.media { color:#60a5fa; }
.sdl-export-icon.txt { color:#a78bfa; }
.sdl-export-icon.json { color:#4ade80; }
.sdl-export-icon.skip { color:#fb923c; }
.sdl-export-icon.watermark { color:rgba(255,255,255,0.42); }
.sdl-export-lbl {
  font-size:14px; color:rgba(255,255,255,0.88); flex:1; cursor:default; line-height:1.35; font-weight:600;
}
.sdl-export-lbl span { font-size:12px; color:rgba(255,255,255,0.42); display:block; margin-top:1px; font-weight:400; }
.sdl-export-row.watermark .sdl-export-lbl { font-size:15px; }
.sdl-export-row.watermark .sdl-export-lbl span { font-size:13px; color:rgba(255,255,255,0.5); }

/* Toggle */
.sdl-toggle { position:relative; width:32px; height:18px; flex-shrink:0; cursor:pointer; display:block; }
.sdl-toggle input { opacity:0; width:0; height:0; position:absolute; }
.sdl-toggle-track { position:absolute; inset:0; background:rgba(255,255,255,0.1); border-radius:999px; transition:background 0.2s; }
.sdl-toggle input:checked + .sdl-toggle-track { background:rgba(52,211,153,0.65); }
.sdl-toggle-thumb { position:absolute; top:3px; left:3px; width:12px; height:12px; border-radius:50%; background:rgba(255,255,255,0.9); transition:transform 0.2s; pointer-events:none; }
.sdl-toggle input:checked ~ .sdl-toggle-thumb { transform:translateX(14px); }

/* Filter summary card */
.sdl-filter-card {
  margin-bottom:14px; padding:14px 15px; border-radius:12px;
  border:0.5px solid rgba(59,130,246,0.75);
  background:linear-gradient(135deg,rgba(37,99,235,0.14),rgba(20,184,166,0.06));
  box-shadow:0 0 0 1px rgba(59,130,246,0.14) inset;
}
.sdl-filter-head {
  display:flex; align-items:center; gap:8px; margin-bottom:10px;
}
.sdl-filter-title {
  display:flex; align-items:center; gap:8px; flex:1;
  font-size:13px; color:rgba(255,255,255,0.72); font-weight:800;
  text-transform:uppercase; letter-spacing:0.04em;
}
.sdl-filter-edit {
  display:inline-flex; align-items:center; gap:8px; padding:7px 10px; border-radius:8px;
  background:rgba(255,255,255,0.06); border:0.5px solid rgba(255,255,255,0.14);
  color:rgba(255,255,255,0.78); font-size:12px; font-weight:600; cursor:pointer;
}
.sdl-filter-edit:hover { background:rgba(255,255,255,0.1); color:#fff; }
.sdl-filter-edit .sdl-disc-arrow { font-size:11px; }
.sdl-filter-edit.open .sdl-disc-arrow { transform:rotate(90deg); }
.sdl-filter-active-chips {
  display:none; flex-wrap:wrap; gap:5px; margin:-2px 0 10px;
}
.sdl-filter-mini-chip {
  display:inline-flex; align-items:center; max-width:100%;
  padding:4px 8px; border-radius:8px; font-size:11px; line-height:1.2;
  color:rgba(191,219,254,0.92); background:rgba(59,130,246,0.14);
  border:0.5px solid rgba(59,130,246,0.28);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.sdl-filter-mini-chip.more {
  color:rgba(255,255,255,0.72); background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.12);
}
.sdl-filter-card .sdl-drawer { margin:0 0 12px; padding-top:10px; border-top:0.5px solid rgba(255,255,255,0.08); }
#sdl-counter-pill {
  display:flex; align-items:center; justify-content:center; gap:8px; text-align:center;
  margin:0; font-size:19px; color:rgba(255,255,255,0.78);
  background:transparent; border:none; border-radius:0; padding:4px 8px 2px;
  transition:background 0.2s,color 0.2s; line-height:1.3;
}
.sdl-filter-ring {
  width:36px; height:36px; border-radius:50%; flex:0 0 36px;
  display:inline-flex; align-items:center; justify-content:center;
  background:conic-gradient(#34d399 var(--sdl-filter-deg, 360deg), rgba(255,255,255,0.12) 0);
}
.sdl-filter-ring span {
  width:22px; height:22px; border-radius:50%; background:rgba(15,20,26,0.96);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08);
  position:relative;
}
.sdl-filter-ring span::after {
  content:''; position:absolute; inset:7px; border-radius:50%; background:rgba(255,255,255,0.72);
}
#sdl-counter-pill strong { color:#4ade80; font-size:28px; line-height:1; font-weight:800; }
.sdl-filter-summary-text { display:inline-flex; align-items:baseline; gap:6px; flex-wrap:wrap; justify-content:center; }
#sdl-counter-pill.filtered { color:rgba(255,255,255,0.9); }
#sdl-counter-pill.flash { animation:sdlFlash 0.3s ease; }
@keyframes sdlFlash { 0%,100%{opacity:1} 50%{opacity:0.55} }

/* Filter disclosure */
.sdl-disc {
  display:flex; align-items:center; gap:7px; cursor:pointer; margin-bottom:8px;
  font-size:12px; font-weight:600; color:rgba(255,255,255,0.65); user-select:none;
  transition:color 0.15s; padding:8px 0;
}
.sdl-disc:hover { color:rgba(255,255,255,0.9); }
.sdl-disc-line { flex:1; height:0.5px; background:rgba(255,255,255,0.14); }
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
.sdl-chip.dim { opacity:0.32; text-decoration:line-through; }
.sdl-chip.active.dim { background:rgba(99,102,241,0.10); border-color:rgba(99,102,241,0.20); }
.sdl-chip-empty { font-size:11px; color:rgba(255,255,255,0.15); font-style:italic; }
/* Favorites-only toggle chip — amber/gold when active */
.sdl-chip-star { width:100%; padding:4px 10px; margin-bottom:2px; }
.sdl-chip-star.active { background:rgba(202,152,42,0.2); border-color:rgba(202,152,42,0.5); color:rgba(255,210,80,0.95); }
.sdl-chip-star:not(.active):hover { background:rgba(202,152,42,0.08); border-color:rgba(202,152,42,0.2); color:rgba(255,210,80,0.6); }
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
.sdl-speed {
  margin:0 0 14px; padding:14px 16px 16px; border-radius:12px;
  border:0.5px solid rgba(255,255,255,0.12); background:rgba(17,22,28,0.72);
}
.sdl-speed-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:11px; }
.sdl-speed-lbl {
  font-size:13px; color:rgba(255,255,255,0.68); text-transform:uppercase;
  letter-spacing:0.04em; font-weight:800; display:flex; align-items:center; gap:8px;
}
.sdl-speed-workers {
  color:rgba(255,255,255,0.76); font-size:12px; padding:6px 9px; border-radius:8px;
  border:0.5px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04);
}
.sdl-speed-segs { display:grid; grid-template-columns:repeat(4,1fr); gap:0; margin-bottom:12px; border:0.5px solid rgba(255,255,255,0.12); border-radius:9px; overflow:hidden; }
.sdl-speed-seg {
  min-height:60px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:9px 4px;
  border-radius:0; background:rgba(255,255,255,0.02); border:0; border-right:0.5px solid rgba(255,255,255,0.09);
  cursor:pointer; transition:all 0.15s; gap:2px; user-select:none;
}
.sdl-speed-seg:last-child { border-right:none; }
.sdl-speed-seg:hover { background:rgba(255,255,255,0.08); }
.sdl-speed-seg.active  { background:rgba(52,211,153,0.12); box-shadow:inset 0 0 0 1px rgba(52,211,153,0.85); color:#fff; }
.s-icon { display:none; }
.s-lbl { font-size:14px; font-weight:700; color:rgba(255,255,255,0.86); }
.s-risk { font-size:12px; color:rgba(255,255,255,0.44); }
.sdl-speed-hint { font-size:12px; color:rgba(255,255,255,0.42); text-align:center; }
.sdl-speed-hint.warn   { color:rgba(251,191,36,0.65); }
.sdl-speed-hint.danger { color:rgba(248,113,113,0.65); }

/* Coffee */
.sdl-coffee {
  margin-bottom:16px; padding:24px 28px; border-radius:14px;
  background:rgba(36,27,11,0.72); border:0.5px solid rgba(251,191,36,0.5);
  display:grid; grid-template-columns:108px 1fr; align-items:center; gap:20px; text-align:left;
}
.sdl-coffee-img { width:96px; height:112px; object-fit:contain; justify-self:center; }
.sdl-coffee-copy { display:flex; flex-direction:column; gap:11px; min-width:0; }
.sdl-coffee-msg { font-size:13px; color:rgba(255,255,255,0.72); line-height:1.45; max-width:none; margin:0; }
.sdl-coffee-msg strong { color:rgba(255,255,255,0.96); font-weight:800; font-size:14px; }
.sdl-coffee-btn {
  display:inline-flex; align-items:center; justify-content:center; gap:8px;
  background:#ffdd22; color:#171100; border:none; border-radius:10px; padding:12px 18px;
  font-size:16px; font-weight:800; text-decoration:none; cursor:pointer; width:100%;
  transition:opacity 0.15s,transform 0.1s; letter-spacing:0.01em; -webkit-font-smoothing:antialiased;
}
.sdl-coffee-btn img { width:22px; height:22px; object-fit:contain; }
.sdl-coffee-btn:hover { opacity:0.88; }
.sdl-coffee-btn:active { transform:scale(0.97); }

/* Settings drawer */
#sdl-expert-foot {
  display:flex; align-items:center; gap:7px; margin-top:16px; padding:10px 13px;
  border:0.5px solid rgba(255,255,255,0.07); border-radius:10px; cursor:pointer; color:rgba(255,255,255,0.36);
  font-size:10.5px; font-weight:700; letter-spacing:0.035em; text-transform:uppercase; user-select:none; transition:color 0.15s,background 0.15s;
}
#sdl-expert-foot:hover { color:rgba(255,255,255,0.7); background:rgba(255,255,255,0.025); }
#sdl-expert-foot .exp-line { display:none; }
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
#sdl-activity-line {
  display:flex; justify-content:space-between; align-items:center;
  font-size:10px; min-height:13px; margin:3px 0 2px; letter-spacing:0.01em;
}
#sdl-activity-left {
  color:rgba(255,255,255,0.4); flex:1; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap;
}
#sdl-activity-right {
  color:rgba(251,191,36,0.85); flex-shrink:0; margin-left:10px;
  font-size:9.5px; white-space:nowrap;
}
@keyframes sdl-pulse-opacity {
  0%,100% { opacity:0.45; }
  50%      { opacity:1;    }
}
.sdl-activity-pulse { animation:sdl-pulse-opacity 1.4s ease-in-out infinite; }

/* Scan story */
#sdl-scan-story {
  margin-top:4px; margin-bottom:14px; padding:16px 17px; border-radius:12px;
  background:linear-gradient(135deg,rgba(37,99,235,0.12),rgba(15,20,26,0.78));
  border:0.5px solid rgba(59,130,246,0.28); text-align:left;
  min-height:118px; display:grid; grid-template-columns:42px 1fr; gap:14px; align-items:center;
}
#sdl-story-icon {
  width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center;
  background:rgba(52,211,153,0.12); border:0.5px solid rgba(52,211,153,0.34);
  color:#86efac; font-size:12px; font-weight:800; transition:opacity 0.25s ease;
}
#sdl-story-text { font-size:14px; color:rgba(255,255,255,0.82); line-height:1.45; transition:opacity 0.25s ease; margin:0; }
#sdl-shutdown-badge {
  display:inline-block; grid-column:2; margin-top:-8px; font-size:11px;
  color:rgba(255,255,255,0.46); background:rgba(255,255,255,0.04);
  border:0.5px solid rgba(255,255,255,0.08); border-radius:20px; padding:4px 10px; width:max-content;
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
.sdl-done-skipped {
  margin-bottom:12px; padding:8px 11px; border-radius:9px;
  background:rgba(148,163,184,0.05); border:0.5px solid rgba(148,163,184,0.15);
  font-size:10px; color:rgba(203,213,225,0.7); line-height:1.5;
}
.sdl-done-skipped-lbl { color:rgba(255,255,255,0.2); display:block; margin-bottom:2px; font-size:9px; text-transform:uppercase; letter-spacing:0.07em; }
.sdl-done-filters-lbl { color:rgba(255,255,255,0.2); display:block; margin-bottom:2px; font-size:9px; text-transform:uppercase; letter-spacing:0.07em; }
.sdl-done-secondary {
  display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:8px;
  margin-bottom:12px; font-size:12.5px; color:rgba(255,255,255,0.24);
}
.sdl-open-folder-btn {
  width:auto; margin:0; padding:7px 12px; font-size:12.5px; border-radius:9px;
}
.sdl-done-github-link {
  color:rgba(255,255,255,0.58); text-decoration:none; transition:color 0.15s,background 0.15s;
  padding:7px 12px; border-radius:9px; border:0.5px solid rgba(255,255,255,0.1);
  background:rgba(255,255,255,0.035); font-weight:700;
}
.sdl-done-github-link:hover { color:rgba(255,255,255,0.82); background:rgba(255,255,255,0.065); }
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

/* Watermark estimate badge */
.sdl-export-badge {
  font-size:10px; font-weight:700; letter-spacing:0.01em; white-space:nowrap;
  padding:3px 8px; border-radius:999px;
  background:rgba(255,221,0,0.18); color:#ffdd00; border:0.5px solid rgba(255,221,0,0.32);
}
.sdl-export-badge.off {
  background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.35); border-color:rgba(255,255,255,0.1);
}
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
       src="${ENV.LOGO_URL}"
       alt="SoraVault" referrerpolicy="no-referrer">
  <span id="sdl-logo-fb">🔐</span>
  <span id="sdl-title">SoraVault 2.7   
  <span style="font-size: 8px; display: inline-block; transform: scale(0.8); transform-origin: left; opacity: 0.8;">

  </span>
  </span>
  <span id="sdl-bf-mini" title="Mirror Mode is scanning in the background">&#x1f5a5;&#xfe0f;</span>
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

     <button class="sdl-hd-btn" id="sdl-gear" title="Log &amp; advanced">&#x2637;</button>
    <button class="sdl-hd-btn" id="sdl-min"  title="Minimise">&#x2014;</button>
  </div>
</div>

<div id="sdl-body">
  <div id="sdl-status"></div>

  <!-- ─── STATE: init ──────────────────────────────────────── -->
  <div id="sdl-s-init">

    <!-- ── BACKUP section ───────────────────────────────────── -->
    <div class="sdl-mode-card active" id="sdl-mode-regular" data-mode="regular">
      <div class="sdl-mode-head" data-mode="regular">
        <span class="sdl-mode-radio"></span>
        <span class="sdl-mode-icon">💼</span>
        <span class="sdl-mode-copy">
          <span class="sdl-mode-title">Regular Backup <span class="sdl-active-pill">active</span></span>
          <span class="sdl-mode-sub">Back up your own Sora account data.</span>
        </span>
        <span class="sdl-mode-arrow">⌃</span>
      </div>
      <div class="sdl-mode-body" id="sdl-mode-body-regular">
        <div class="sdl-src-note-top">Choose what to back up by Sora version.</div>

    <div class="sdl-src-groups">

      <!-- Sora 1 -->
      <div class="sdl-src-group">
        <div class="sdl-src-group-hd">Sora 1</div>
        <label class="sdl-src-row" id="sdl-src-row-v1_library">
          <input type="checkbox" id="sdl-src-cb-v1_library" checked>
          <span class="sdl-src-icon">📷</span>
          <span class="sdl-src-name">Library</span>
          <span class="sdl-src-sub">Your Sora 1 image library</span>
        </label>
        <label class="sdl-src-row" id="sdl-src-row-v1_liked">
          <input type="checkbox" id="sdl-src-cb-v1_liked" checked>
          <span class="sdl-src-icon" style="font-size: 14px;">♡</span>
          <span class="sdl-src-name">Likes</span>
          <span class="sdl-src-sub">Creator content you liked</span>
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
          <span class="sdl-src-sub">Published Sora 2 videos</span>
        </label>
        <label class="sdl-src-row" id="sdl-src-row-v2_drafts">
          <input type="checkbox" id="sdl-src-cb-v2_drafts" checked>
          <span class="sdl-src-icon">📋</span>
          <span class="sdl-src-name">Drafts</span>
          <span class="sdl-src-sub">Generated drafts and unpublished work</span>
        </label>
        <label class="sdl-src-row" id="sdl-src-row-v2_liked">
          <input type="checkbox" id="sdl-src-cb-v2_liked" checked>
          <span class="sdl-src-icon">♡</span>
          <span class="sdl-src-name">Liked</span>
          <span class="sdl-src-sub">Creator content you liked</span>
        </label>
        <label class="sdl-src-row" id="sdl-src-row-v2_cameos">
          <input type="checkbox" id="sdl-src-cb-v2_cameos" checked>
          <span class="sdl-src-icon">👤</span>
          <span class="sdl-src-name">Cameos</span>
          <span class="sdl-src-sub">Featuring you</span>
        </label>
        <label class="sdl-src-row" id="sdl-src-row-v2_cameo_drafts">
          <input type="checkbox" id="sdl-src-cb-v2_cameo_drafts" checked>
          <span class="sdl-src-icon">📋</span>
          <span class="sdl-src-name">Cameo drafts</span>
          <span class="sdl-src-sub">Featuring you</span>
        </label>
        <label class="sdl-src-row" id="sdl-src-row-v2_my_characters" title="Your characters' posts + cameo appearances.">
          <input type="checkbox" id="sdl-src-cb-v2_my_characters" checked>
          <span class="sdl-src-icon">🎭</span>
          <span class="sdl-src-name">Characters</span>
          <span class="sdl-src-sub">Your characters</span>
        </label>
      </div>

    </div>

      <div id="sdl-src-note">Choose sources, scan once, then filter the backup.</div>
    </div>
    </div>

    <!-- ── CREATORS section (beta, bulk-fetch named creators) ── -->
    <div class="sdl-mode-card" id="sdl-mode-creator" data-mode="creator">
      <div class="sdl-mode-head" data-mode="creator">
        <span class="sdl-mode-radio"></span>
        <span class="sdl-mode-icon">👥</span>
        <span class="sdl-mode-copy">
          <span class="sdl-mode-title">Creator Backup <span class="sdl-active-pill">active</span></span>
          <span class="sdl-mode-sub">Back up posts and characters from selected creators.</span>
        </span>
        <span id="sdl-cf-badge" class="sdl-bf-badge">👥 0</span>
        <span class="sdl-mode-arrow">⌄</span>
      </div>
      <div class="sdl-mode-body" id="sdl-cf-body" style="display:none;">
        <div id="sdl-cf-chips" class="sdl-cf-chips"></div>
        <input id="sdl-cf-input" class="sdl-bf-input" placeholder="creator1, creator2, … (comma or Enter to add)" autocomplete="off" spellcheck="false">
        <div class="sdl-bf-row">
          <label class="sdl-bf-lbl sdl-bf-lbl-inline">Include each creator's characters
            <input type="checkbox" id="sdl-cf-include-chars" checked>
          </label>
          <label class="sdl-bf-lbl sdl-bf-lbl-inline">Remember across reloads
            <input type="checkbox" id="sdl-cf-persist" checked>
          </label>
        </div>
        <div class="sdl-bf-hint">Sora 2 only · validates usernames live · folder: <code>sora_v2_creators/&lt;name&gt;/</code></div>
      </div>
    </div>
    <!-- /Creators section -->

    <!-- ── MIRROR section (beta, passive capture while browsing) ── -->
    <div class="sdl-mode-card" id="sdl-mode-mirror" data-mode="mirror">
      <div class="sdl-mode-head" data-mode="mirror">
        <span class="sdl-mode-radio"></span>
        <span class="sdl-mode-icon">🖥️</span>
        <span class="sdl-mode-copy">
          <span class="sdl-mode-title">Mirror Mode <span class="sdl-beta-tag">beta</span><span class="sdl-active-pill">active</span></span>
          <span class="sdl-mode-sub">Captures what you browse in the background.</span>
        </span>
        <span id="sdl-bf-badge" class="sdl-bf-badge">📡 Off</span>
        <span class="sdl-mode-arrow">⌄</span>
      </div>
      <div class="sdl-mode-body" id="sdl-bf-body" style="display:none;">
        <button class="sdl-btn sdl-btn-secondary" id="sdl-bf-pick" style="margin:6px 0;">📂 Pick folder…</button>
        <div id="sdl-bf-folder" class="sdl-bf-folder">(no folder picked yet)</div>
        <div class="sdl-bf-row">
          <label class="sdl-bf-lbl">Min likes
            <input type="number" id="sdl-bf-minlikes" min="0" value="0" class="sdl-bf-input sdl-bf-input-num">
          </label>
          <label class="sdl-bf-lbl sdl-bf-lbl-inline">Save prompts (.txt)
            <input type="checkbox" id="sdl-bf-savetxt" checked>
          </label>
        </div>
        <label class="sdl-bf-lbl">Include keywords (comma-separated — any match)
          <textarea id="sdl-bf-include" class="sdl-bf-input" rows="1" placeholder="e.g. anime, cyberpunk"></textarea>
        </label>
        <label class="sdl-bf-lbl">Exclude keywords (comma-separated — skip on match)
          <textarea id="sdl-bf-exclude" class="sdl-bf-input" rows="1" placeholder="e.g. nsfw"></textarea>
        </label>
        <div class="sdl-bf-hint">Saved now: <strong id="sdl-bf-saved-count">0</strong> · <code>mirror_browse/sora[1|2]_&lt;path&gt;/</code> · no watermark removal · stops on page reload</div>
      </div>
    </div>
    <!-- /Mirror section -->

    <!-- ── DISCOVER section (active explore/top creator discovery) ── -->
    <div class="sdl-mode-card" id="sdl-mode-discover" data-mode="discover">
      <div class="sdl-mode-head" data-mode="discover">
        <span class="sdl-mode-radio"></span>
        <span class="sdl-mode-icon">&#x1f50d;</span>
        <span class="sdl-mode-copy">
          <span class="sdl-mode-title">Discover &amp; Download <span class="sdl-beta-tag">beta</span><span class="sdl-active-pill">active</span></span>
          <span class="sdl-mode-sub">Auto-discover creators and download matching content.</span>
        </span>
        <span id="sdl-discover-badge" class="sdl-bf-badge">0 creators</span>
        <span class="sdl-mode-arrow">⌄</span>
      </div>
      <div class="sdl-mode-body" id="sdl-discover-body" style="display:none;">
        <button class="sdl-btn sdl-btn-secondary" id="sdl-discover-pick" style="margin:6px 0;">Pick folder...</button>
        <div id="sdl-discover-folder" class="sdl-bf-folder">(no folder picked yet)</div>
        <div class="sdl-bf-row">
          <label class="sdl-bf-lbl">Sora version
            <select id="sdl-discover-version" class="sdl-bf-input">
              <option value="v1">Sora 1</option>
              <option value="v2" selected>Sora 2</option>
            </select>
          </label>
          <label class="sdl-bf-lbl" id="sdl-discover-v1feed-wrap">Sora 1 feed
            <span class="sdl-segment" id="sdl-discover-v1feed">
              <button type="button" class="sdl-seg-btn active" data-v1feed="home">Explore</button>
              <button type="button" class="sdl-seg-btn" data-v1feed="videos">Videos</button>
              <button type="button" class="sdl-seg-btn" data-v1feed="images">Images</button>
            </span>
          </label>
          <label class="sdl-bf-lbl sdl-bf-lbl-inline" id="sdl-discover-toponly-wrap">Top only
            <input type="checkbox" id="sdl-discover-toponly">
          </label>
        </div>
        <div class="sdl-bf-row">
          <label class="sdl-bf-lbl">Min likes
            <input type="number" id="sdl-discover-minlikes" min="0" value="0" class="sdl-bf-input sdl-bf-input-num">
          </label>
          <label class="sdl-bf-lbl">Max likes
            <input type="number" id="sdl-discover-maxlikes" min="0" class="sdl-bf-input sdl-bf-input-num" placeholder="any">
          </label>
          <label class="sdl-bf-lbl">Max creators
            <input type="number" id="sdl-discover-maxcreators" min="0" value="0" class="sdl-bf-input sdl-bf-input-num" title="0 = unlimited">
          </label>
        </div>
        <label class="sdl-bf-lbl">Include keywords (comma-separated, any match)
          <textarea id="sdl-discover-include" class="sdl-bf-input" rows="1" placeholder="e.g. anime, cyberpunk"></textarea>
        </label>
        <label class="sdl-bf-lbl">Exclude keywords (comma-separated, skip on match)
          <textarea id="sdl-discover-exclude" class="sdl-bf-input" rows="1" placeholder="e.g. nsfw"></textarea>
        </label>
        <div class="sdl-bf-row">
          <label class="sdl-bf-lbl">Date from
            <input type="date" id="sdl-discover-datefrom" class="sdl-bf-input">
          </label>
          <label class="sdl-bf-lbl">Date to
            <input type="date" id="sdl-discover-dateto" class="sdl-bf-input">
          </label>
        </div>
        <label class="sdl-bf-lbl">Aspect ratios
          <input id="sdl-discover-ratios" class="sdl-bf-input" placeholder="e.g. 16:9, 9:16">
        </label>
        <div class="sdl-bf-row">
          <label class="sdl-bf-lbl sdl-bf-lbl-inline" id="sdl-discover-chars-wrap">Include creator characters
            <input type="checkbox" id="sdl-discover-chars" checked>
          </label>
          <label class="sdl-bf-lbl sdl-bf-lbl-inline">Keep polling
            <input type="checkbox" id="sdl-discover-poll" checked>
          </label>
          <label class="sdl-bf-lbl sdl-bf-lbl-inline">Save prompts
            <input type="checkbox" id="sdl-discover-savetxt" checked>
          </label>
        </div>
        <div class="sdl-bf-hint">Folder: <code>discover_download/</code> · manifest: <code>discover_manifest.json</code> · default speed: Balanced (4 workers)</div>
      </div>
    </div>
    <!-- /Discover section -->

  

      <button class="sdl-btn sdl-btn-primary" id="sdl-scan">Start Scan</button>
      <div class="sdl-start-foot">
        Private. Local-first. Built by Sebastian in Munich for Sora creators.
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
  <div id="sdl-s-mirror" style="display:none">
    <div class="sdl-mirror-hero">
      <div class="sdl-big-count">
        <span class="n" id="sdl-mirror-saved">0</span>
        <span class="lbl" id="sdl-mirror-count-label">mirror items saved</span>
      </div>
      <div class="sdl-mirror-live"><span class="sdl-mirror-live-dot"></span><span id="sdl-mirror-live-text">Mirror Mode is watching your Sora browsing</span></div>
      <div class="sdl-mirror-minimize-hint">You can minimise SoraVault now. When the glowing monitor is visible, Mirror Mode is still scanning in the background.</div>
    </div>
    <div class="sdl-mirror-panel">
      <div class="sdl-mirror-row"><span>Folder</span><strong id="sdl-mirror-folder">(no folder picked)</strong></div>
      <div class="sdl-mirror-row"><span>Captured</span><strong id="sdl-mirror-captured">0</strong></div>
      <div class="sdl-mirror-row"><span>Queued</span><strong id="sdl-mirror-queued">0</strong></div>
      <div class="sdl-mirror-row"><span>Failed</span><strong id="sdl-mirror-failed">0</strong></div>
      <div class="sdl-discover-detail" id="sdl-discover-detail" style="display:none;"></div>
      <div class="sdl-mirror-filter-controls">
        <div class="sdl-bf-row">
          <label class="sdl-bf-lbl">Min likes
            <input type="number" id="sdl-mirror-minlikes" min="0" value="0" class="sdl-bf-input sdl-bf-input-num">
          </label>
          <label class="sdl-bf-lbl" id="sdl-mirror-maxlikes-wrap" style="display:none;">Max likes
            <input type="number" id="sdl-mirror-maxlikes" min="0" class="sdl-bf-input sdl-bf-input-num" placeholder="any">
          </label>
        </div>
        <label class="sdl-bf-lbl" id="sdl-mirror-include-wrap">Include keywords (comma-separated)
          <textarea id="sdl-mirror-include" class="sdl-bf-input" rows="1" placeholder="e.g. anime, cyberpunk"></textarea>
        </label>
        <label class="sdl-bf-lbl" id="sdl-mirror-exclude-wrap">Exclude keywords (comma-separated)
          <textarea id="sdl-mirror-exclude" class="sdl-bf-input" rows="1" placeholder="e.g. nsfw"></textarea>
        </label>
      </div>
      <div class="sdl-mirror-filters" id="sdl-mirror-filters">prompts on</div>
    </div>
    <button class="sdl-btn sdl-btn-stop" id="sdl-stop-mirror">Stop Mirror Mode</button>
    <button class="sdl-btn sdl-btn-secondary" id="sdl-mirror-back">Back to start</button>
  </div>

  <div id="sdl-s-ready" style="display:none">

    <!-- Export toggles -->
    <div class="sdl-export-toggles">
      <div class="sdl-export-row">
        <span class="sdl-export-icon media">▧</span>
        <span class="sdl-export-lbl">Save media<span>images &amp; videos to disk</span></span>
        <label class="sdl-toggle">
          <input type="checkbox" id="sdl-cfg-SAVE_MEDIA" checked>
          <div class="sdl-toggle-track"></div>
          <div class="sdl-toggle-thumb"></div>
        </label>
      </div>
      <div class="sdl-export-row">
        <span class="sdl-export-icon txt">▤</span>
        <span class="sdl-export-lbl">Save .txt sidecar<span>prompt + metadata per file</span></span>
        <label class="sdl-toggle">
          <input type="checkbox" id="sdl-cfg-DOWNLOAD_TXT" ${CFG.DOWNLOAD_TXT ? 'checked' : ''}>
          <div class="sdl-toggle-track"></div>
          <div class="sdl-toggle-thumb"></div>
        </label>
      </div>
      <div class="sdl-export-row">
        <span class="sdl-export-icon json">{ }</span>
        <span class="sdl-export-lbl">Save .json manifest<span>full metadata export</span></span>
        <label class="sdl-toggle">
          <input type="checkbox" id="sdl-cfg-SAVE_JSON" checked>
          <div class="sdl-toggle-track"></div>
          <div class="sdl-toggle-thumb"></div>
        </label>
      </div>
      <div class="sdl-export-row">
        <span class="sdl-export-icon skip">✓</span>
        <span class="sdl-export-lbl">Skip already-downloaded<span>Files matched by {genId} + min size (video ≥3 MB, image ≥1 MB). Uncheck to force re-download.</span></span>
        <label class="sdl-toggle">
          <input type="checkbox" id="sdl-cfg-SKIP_EXISTING" checked>
          <div class="sdl-toggle-track"></div>
          <div class="sdl-toggle-thumb"></div>
        </label>
      </div>
      <div class="sdl-export-row watermark">
        <span class="sdl-export-icon watermark">◇</span>
        <span class="sdl-export-lbl">Watermark Removal<span>Via soravdl.com (3rd party). No support for drafts.</span></span>
        <span class="sdl-export-badge" id="sdl-watermark-estimate">+0 min</span>
        <label class="sdl-toggle">
          <input type="checkbox" id="sdl-cfg-WATERMARK_REMOVAL">
          <div class="sdl-toggle-track"></div>
          <div class="sdl-toggle-thumb"></div>
        </label>
      </div>
    </div>

    <div class="sdl-filter-card">
      <div class="sdl-filter-head">
        <div class="sdl-filter-title">▽ Filters <span class="sdl-disc-badge" id="sdl-filter-badge">none active</span></div>
        <button type="button" class="sdl-filter-edit" id="sdl-filter-disc">Edit filters <span class="sdl-disc-arrow">&#x203a;</span></button>
      </div>
      <div class="sdl-filter-active-chips" id="sdl-filter-active-chips"></div>

    <div class="sdl-drawer" id="sdl-filter-drawer">

      <!-- Category filter (source) -->
      <div class="sdl-f-sec">
        <span class="sdl-f-lbl">Category</span>
        <div class="sdl-chips" id="sdl-f-sources"></div>
      </div>

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

      <div class="sdl-f-sec">
        <span class="sdl-f-lbl">Likes range</span>
        <div class="sdl-f-row">
          <input class="sdl-f-inp" id="sdl-f-min-likes" type="number" min="0" placeholder="Min likes">
          <input class="sdl-f-inp" id="sdl-f-max-likes" type="number" min="0" placeholder="Max likes">
        </div>
      </div>

      <!-- V1 / V2 chip filters side by side -->
      <div class="sdl-f-grid2">
        <!-- V1 — Images -->
        <div>
          <div class="sdl-f-group-hd">📷 Sora 1 · Images</div>
          <div class="sdl-f-sec">
            <button class="sdl-chip sdl-chip-star" id="sdl-f-v1-fav">⭐ Favorites only</button>
          </div>
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

      <div id="sdl-counter-pill">&#x2014;</div>
    </div>
    <div class="sdl-ready-actions">
      <button class="sdl-btn sdl-btn-secondary" id="sdl-rescan" title="Clears current scan results and returns to source selection">&#x21ba; Rescan<span class="sdl-rescan-sub">scan resets</span></button>
      <button class="sdl-btn sdl-btn-primary"   id="sdl-dl"     disabled>Download All</button>
    </div>
  </div>

  <!-- ─── STATE: downloading ───────────────────────────────── -->
  <div id="sdl-s-downloading" style="display:none">
    <div class="sdl-coffee">
      <img class="sdl-coffee-img" src="${ENV.COFFEE_BIG_URL}" alt="">
      <div class="sdl-coffee-copy">
        <p class="sdl-coffee-msg">
          <strong>SoraVault is free — built in spare time so your creative work survives Sora's shutdown.</strong><br>
          If it saved something precious, a coffee means the world.
        </p>
        <a class="sdl-coffee-btn"
           href="https://buymeacoffee.com/soravault"
           target="_blank" rel="noopener noreferrer">
          <img src="${ENV.COFFEE_SMALL_URL}" alt=""> Buy me a coffee
        </a>
      </div>
    </div>
    <div class="sdl-progress-card">
      <div class="sdl-big-count">
        <span class="n">
          <span id="sdl-dl-count">0</span><span class="sub"> / <span id="sdl-dl-total">0</span></span>
        </span>
        <span class="lbl">downloaded</span>
      </div>
      <div class="sdl-prog"><div class="sdl-prog-bar" id="sdl-dl-bar" style="width:0%"></div></div>
      <div id="sdl-activity-line"><span id="sdl-activity-left">&nbsp;</span><span id="sdl-activity-right"></span></div>
      <div class="sdl-stats">
        <div class="sdl-stat"><span><span class="sdl-stat-icon">✓</span>Done</span><span class="sdl-stat-n" id="sdl-dl-done">0</span></div>
        <div class="sdl-stat" id="sdl-fail-wrap"><span><span class="sdl-stat-icon err">×</span>Failed</span><span class="sdl-stat-n" id="sdl-dl-failed">0</span></div>
        <div class="sdl-stat"><span><span class="sdl-stat-icon muted">◷</span>ETA</span><span class="sdl-stat-n" id="sdl-dl-eta">~0s</span></div>
        <div class="sdl-stat"><span><span class="sdl-stat-icon muted">☷</span>Active workers</span><span class="sdl-stat-n" id="sdl-dl-active-workers">0</span></div>
      </div>
    </div>
    <div class="sdl-speed">
      <div class="sdl-speed-head">
        <span class="sdl-speed-lbl">◴ Speed</span>
        <span class="sdl-speed-workers">Workers ›</span>
      </div>
      <div class="sdl-speed-segs">
        <div class="sdl-speed-seg spd-std active" data-spd="0">
          <span class="s-icon">&#x25cf;</span><span class="s-lbl">Safe</span><span class="s-risk">2 workers</span>
        </div>
        <div class="sdl-speed-seg spd-fast" data-spd="1">
          <span class="s-icon">&#x25ce;</span><span class="s-lbl">Balanced</span><span class="s-risk">4 workers</span>
        </div>
        <div class="sdl-speed-seg spd-fast" data-spd="2">
          <span class="s-icon">&#x25ce;</span><span class="s-lbl">Fast</span><span class="s-risk">6 workers</span>
        </div>
        <div class="sdl-speed-seg spd-rip" data-spd="3">
          <span class="s-icon">&#x25c9;</span><span class="s-lbl">Very Fast</span><span class="s-risk">8 workers</span>
        </div>
      </div>
      <div class="sdl-speed-hint">Higher speed reduces total time but increases block risk.</div>
    </div>
    <div class="sdl-dl-actions">
      <button class="sdl-btn sdl-btn-secondary sdl-btn-pause" id="sdl-pause">⏸ Pause</button>
      <button class="sdl-btn sdl-btn-stop" id="sdl-stop-dl">Stop</button>
    </div>
  </div>

  <!-- ─── STATE: done ──────────────────────────────────────── -->
  <div id="sdl-s-done" style="display:none">
    <div class="sdl-done-hero">
      <div class="sdl-done-check">✓</div>
      <div class="sdl-done-title">Your library is safe.</div>
      <div class="sdl-done-saved" id="sdl-done-saved">Computing time saved…</div>
    </div>
    <div class="sdl-done-stats" id="sdl-done-stats"></div>
    <div class="sdl-done-skipped" id="sdl-done-skipped" style="display:none"></div>
    <div class="sdl-done-filters" id="sdl-done-filters" style="display:none">
      <span class="sdl-done-filters-lbl">Filters applied</span>
      <span id="sdl-done-filter-list"></span>
    </div>
    <div class="sdl-coffee">
      <img class="sdl-coffee-img" src="${ENV.COFFEE_BIG_URL}" alt="">
      <div class="sdl-coffee-copy">
        <p class="sdl-coffee-msg">
          <strong>I built this so nobody has to lose their work.</strong><br>
          It's free, it stays free. A coffee means the world.
        </p>
        <a class="sdl-coffee-btn"
           href="https://buymeacoffee.com/soravault"
           target="_blank" rel="noopener noreferrer">
          <img src="${ENV.COFFEE_SMALL_URL}" alt=""> Buy me a coffee
        </a>
      </div>
    </div>
    <div class="sdl-done-secondary">
      <button class="sdl-btn sdl-btn-secondary sdl-open-folder-btn" id="sdl-open-folder">Open download folder</button>
      <a class="sdl-done-github-link"
         href="https://github.com/${GITHUB_REPO}"
         target="_blank" rel="noopener noreferrer">
        ⭐ Star on GitHub
      </a>
      <span class="sdl-done-sep">·</span>
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
      🎬 V2 Profile       → <code style="color:rgba(255,255,255,0.38)">sora_v2_profile</code><br>
      📋 V2 Drafts        → <code style="color:rgba(255,255,255,0.38)">sora_v2_drafts</code><br>
      ♡  V2 Liked         → <code style="color:rgba(255,255,255,0.38)">sora_v2_liked</code><br>
      👤 V2 Cameos        → <code style="color:rgba(255,255,255,0.38)">sora_v2_cameos</code><br>
      👤 V2 Cameo drafts  → <code style="color:rgba(255,255,255,0.38)">sora_v2_cameo_drafts</code>
    </div>
    <div style="font-size:9.5px;color:rgba(255,255,255,0.16);line-height:1.6;padding:0 0 4px">
      <strong style="color:rgba(255,255,255,0.25)">Chrome/Edge:</strong> folder picker — you choose where<br>
      <strong style="color:rgba(255,255,255,0.25)">Firefox/other:</strong> Tampermonkey fallback → Downloads
    </div>
  </div>

  <!-- ─── EXPERT SECTION ───────────────────────────────────── -->
  <div id="sdl-expert-foot">
    <span class="exp-line"></span>
    <span>&#x26a1; Log & advanced</span>
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

        function installImageFallback(selector, fallbackUrl, onFinalError) {
            document.querySelectorAll(selector).forEach(img => {
                img.addEventListener('error', function () {
                    if (fallbackUrl && this.src !== fallbackUrl) {
                        this.src = fallbackUrl;
                        return;
                    }
                    onFinalError?.(this);
                });
            });
        }

        installImageFallback('#sdl-logo', ENV.LOGO_FALLBACK_URL, img => {
            img.style.display = 'none';
            document.getElementById('sdl-logo-fb').style.display = 'flex';
        });
        installImageFallback('.sdl-coffee-img', ENV.COFFEE_BIG_FALLBACK_URL);
        installImageFallback('.sdl-coffee-btn img', ENV.COFFEE_SMALL_FALLBACK_URL);

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
        function setStartMode(mode) {
            if (mode === 'creator' && !isV2Supported) {
                setStatus('Creator Backup requires Sora 2 access');
                return;
            }
            if (mode === 'discover' && speedIdx === 0) setSpeedIdx(1);
            activeStartMode = mode;
            document.querySelectorAll('.sdl-mode-card').forEach(card => {
                card.classList.toggle('active', card.dataset.mode === mode);
                const arrow = card.querySelector('.sdl-mode-arrow');
                if (arrow) arrow.textContent = card.dataset.mode === mode ? '⌃' : '⌄';
            });
            document.getElementById('sdl-mode-body-regular').style.display = mode === 'regular' ? '' : 'none';
            document.getElementById('sdl-cf-body').style.display = mode === 'creator' ? '' : 'none';
            document.getElementById('sdl-bf-body').style.display = mode === 'mirror' ? '' : 'none';
            document.getElementById('sdl-discover-body').style.display = mode === 'discover' ? '' : 'none';
            creatorFetchEnabled = mode === 'creator';
            updateCreatorsBadge();
            updateScanButton();
        }

        document.querySelectorAll('.sdl-mode-head[data-mode]').forEach(head => {
            head.addEventListener('click', () => setStartMode(head.dataset.mode));
        });

        document.getElementById('sdl-gear').addEventListener('click', () => {
            const foot = document.getElementById('sdl-expert-foot');
            const drawer = document.getElementById('sdl-expert-drawer');
            const open = drawer.classList.toggle('open');
            foot.classList.toggle('open', open);
        });

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
        document.getElementById('sdl-stop-mirror').addEventListener('click', () => {
            if (browseFetchMode === 'discover' || discoverRunning) stopDiscoverMode();
            else stopMirrorMode();
        });
        document.getElementById('sdl-mirror-back').addEventListener('click', () => {
            if (discoverRunning) return;
            setState('init');
            updateScanButton();
        });
        document.getElementById('sdl-stop-dl').addEventListener('click',   stopAll);
        document.getElementById('sdl-pause').addEventListener('click',     togglePause);
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
        document.getElementById('sdl-open-folder').addEventListener('click', openDownloadFolder);

        // ── Browse & Fetch (v2.6.0) ─────────────────────────────────────
        const bfBody   = document.getElementById('sdl-bf-body');
        const bfFolder = document.getElementById('sdl-bf-folder');
        const bfMinLikes = document.getElementById('sdl-bf-minlikes');
        const bfInclude  = document.getElementById('sdl-bf-include');
        const bfExclude  = document.getElementById('sdl-bf-exclude');
        const bfSaveTxt  = document.getElementById('sdl-bf-savetxt');
        const bfPick     = document.getElementById('sdl-bf-pick');
        const mirrorMinLikes = document.getElementById('sdl-mirror-minlikes');
        const mirrorMaxLikes = document.getElementById('sdl-mirror-maxlikes');
        const mirrorInclude  = document.getElementById('sdl-mirror-include');
        const mirrorExclude  = document.getElementById('sdl-mirror-exclude');
        const discoverFolder = document.getElementById('sdl-discover-folder');
        const discoverPick = document.getElementById('sdl-discover-pick');
        const discoverVersion = document.getElementById('sdl-discover-version');
        const discoverV1FeedWrap = document.getElementById('sdl-discover-v1feed-wrap');
        const discoverV1FeedButtons = [...document.querySelectorAll('#sdl-discover-v1feed [data-v1feed]')];
        const discoverTopOnlyWrap = document.getElementById('sdl-discover-toponly-wrap');
        const discoverTopOnly = document.getElementById('sdl-discover-toponly');
        const discoverMinLikes = document.getElementById('sdl-discover-minlikes');
        const discoverMaxLikes = document.getElementById('sdl-discover-maxlikes');
        const discoverMaxCreators = document.getElementById('sdl-discover-maxcreators');
        const discoverInclude = document.getElementById('sdl-discover-include');
        const discoverExclude = document.getElementById('sdl-discover-exclude');
        const discoverDateFrom = document.getElementById('sdl-discover-datefrom');
        const discoverDateTo = document.getElementById('sdl-discover-dateto');
        const discoverRatios = document.getElementById('sdl-discover-ratios');
        const discoverCharsWrap = document.getElementById('sdl-discover-chars-wrap');
        const discoverChars = document.getElementById('sdl-discover-chars');
        const discoverPoll = document.getElementById('sdl-discover-poll');
        const discoverSaveTxt = document.getElementById('sdl-discover-savetxt');
        let selectedDiscoverV1Feed = browseFetchFilters.v1Feed || 'home';

        const parseTerms = v => (v || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        const parseRatios = v => new Set(parseTerms(v).filter(t => /^\d+:\d+$/.test(t)));
        const setIfDifferent = (el, value) => {
            if (el && el.value !== value) el.value = value;
        };
        const syncBfFilterControls = source => {
            const minLikes = String(browseFetchFilters.minLikes || 0);
            const include  = browseFetchFilters.include.join(', ');
            const exclude  = browseFetchFilters.exclude.join(', ');
            if (source !== 'start') {
                setIfDifferent(bfMinLikes, minLikes);
                setIfDifferent(bfInclude, include);
                setIfDifferent(bfExclude, exclude);
            }
            if (source !== 'mirror') {
                setIfDifferent(mirrorMinLikes, minLikes);
                setIfDifferent(mirrorInclude, include);
                setIfDifferent(mirrorExclude, exclude);
            }
        };
        const syncBfFilters = (source = 'start') => {
            const minEl = source === 'mirror' ? mirrorMinLikes : bfMinLikes;
            const includeEl = source === 'mirror' ? mirrorInclude : bfInclude;
            const excludeEl = source === 'mirror' ? mirrorExclude : bfExclude;
            browseFetchFilters.minLikes = Math.max(0, parseInt(minEl.value) || 0);
            if (source === 'mirror' && browseFetchMode === 'discover') {
                const maxLikes = parseInt(mirrorMaxLikes.value);
                browseFetchFilters.maxLikes = Number.isFinite(maxLikes) && maxLikes >= 0 ? maxLikes : null;
                setIfDifferent(discoverMinLikes, String(browseFetchFilters.minLikes || 0));
                setIfDifferent(discoverMaxLikes, browseFetchFilters.maxLikes == null ? '' : String(browseFetchFilters.maxLikes));
                updateMirrorRunningStats();
                return;
            }
            browseFetchFilters.maxLikes = null;
            browseFetchFilters.include  = parseTerms(includeEl.value);
            browseFetchFilters.exclude  = parseTerms(excludeEl.value);
            browseFetchFilters.saveTxt  = bfSaveTxt.checked;
            browseFetchFilters.version = 'all';
            browseFetchFilters.feed = 'explore';
            browseFetchFilters.v1Feed = 'home';
            browseFetchFilters.dateFrom = '';
            browseFetchFilters.dateTo = '';
            browseFetchFilters.ratios = new Set();
            syncBfFilterControls(source);
            updateMirrorRunningStats();
        };
        bfMinLikes.addEventListener('input', () => syncBfFilters('start'));
        bfInclude.addEventListener('input',  () => syncBfFilters('start'));
        bfExclude.addEventListener('input',  () => syncBfFilters('start'));
        bfSaveTxt.addEventListener('change', () => syncBfFilters('start'));
        mirrorMinLikes.addEventListener('input', () => syncBfFilters('mirror'));
        mirrorMaxLikes.addEventListener('input', () => syncBfFilters('mirror'));
        mirrorInclude.addEventListener('input',  () => syncBfFilters('mirror'));
        mirrorExclude.addEventListener('input',  () => syncBfFilters('mirror'));
        syncBfFilterControls();

        const renderDiscoverV1FeedButtons = () => {
            discoverV1FeedButtons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.v1feed === selectedDiscoverV1Feed);
            });
        };
        const syncDiscoverFilters = () => {
            browseFetchFilters.version = discoverVersion.value || 'v2';
            browseFetchFilters.v1Feed = selectedDiscoverV1Feed;
            browseFetchFilters.feed = browseFetchFilters.version === 'v2' && discoverTopOnly.checked ? 'top' : 'explore';
            browseFetchFilters.minLikes = Math.max(0, parseInt(discoverMinLikes.value) || 0);
            const maxLikes = parseInt(discoverMaxLikes.value);
            browseFetchFilters.maxLikes = Number.isFinite(maxLikes) && maxLikes >= 0 ? maxLikes : null;
            browseFetchFilters.maxCreators = Math.max(0, parseInt(discoverMaxCreators.value) || 0);
            browseFetchFilters.include = parseTerms(discoverInclude.value);
            browseFetchFilters.exclude = parseTerms(discoverExclude.value);
            browseFetchFilters.dateFrom = discoverDateFrom.value || '';
            browseFetchFilters.dateTo = discoverDateTo.value || '';
            browseFetchFilters.ratios = parseRatios(discoverRatios.value);
            browseFetchFilters.includeChars = browseFetchFilters.version === 'v2' && discoverChars.checked;
            browseFetchFilters.keepPolling = discoverPoll.checked;
            browseFetchFilters.saveTxt = discoverSaveTxt.checked;
            if (browseFetchFilters.version === 'v1') discoverTopOnly.checked = false;
            if (discoverV1FeedWrap) discoverV1FeedWrap.style.display = browseFetchFilters.version === 'v1' ? '' : 'none';
            if (discoverTopOnlyWrap) discoverTopOnlyWrap.style.display = browseFetchFilters.version === 'v2' ? '' : 'none';
            if (discoverCharsWrap) discoverCharsWrap.style.display = browseFetchFilters.version === 'v2' ? '' : 'none';
            renderDiscoverV1FeedButtons();
            setIfDifferent(mirrorMinLikes, String(browseFetchFilters.minLikes || 0));
            setIfDifferent(mirrorMaxLikes, browseFetchFilters.maxLikes == null ? '' : String(browseFetchFilters.maxLikes));
            updateMirrorRunningStats();
        };
        [
            discoverVersion, discoverTopOnly, discoverMinLikes, discoverMaxLikes, discoverMaxCreators,
            discoverInclude, discoverExclude, discoverDateFrom, discoverDateTo, discoverRatios,
            discoverChars, discoverPoll, discoverSaveTxt,
        ].forEach(el => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', syncDiscoverFilters));
        discoverV1FeedButtons.forEach(btn => btn.addEventListener('click', () => {
            selectedDiscoverV1Feed = btn.dataset.v1feed || 'home';
            syncDiscoverFilters();
        }));
        syncDiscoverFilters();

        bfPick.addEventListener('click', async () => {
            try {
                browseFetchBaseDir = await window.showDirectoryPicker();
                bfFolder.textContent = browseFetchBaseDir.name + '/';
                if (discoverFolder) discoverFolder.textContent = browseFetchBaseDir.name + '/';
            } catch { /* user cancelled */ }
        });

        discoverPick.addEventListener('click', async () => {
            try {
                browseFetchBaseDir = await window.showDirectoryPicker();
                discoverFolder.textContent = browseFetchBaseDir.name + '/';
                if (bfFolder) bfFolder.textContent = browseFetchBaseDir.name + '/';
            } catch { /* user cancelled */ }
        });

        // ── Creators tile (v2.6.1) ──────────────────────────────────────
        const cfBody         = document.getElementById('sdl-cf-body');
        const cfInput        = document.getElementById('sdl-cf-input');
        const cfChips        = document.getElementById('sdl-cf-chips');
        const cfIncludeChars = document.getElementById('sdl-cf-include-chars');
        const cfPersist      = document.getElementById('sdl-cf-persist');
        const cfBadge        = document.getElementById('sdl-cf-badge');

        const CREATORS_STORAGE_KEY = 'soravault:creators';

        function normaliseCreatorInput(raw) {
            let s = (raw || '').trim().toLowerCase();
            s = s.replace(/^@/, '');
            const m = s.match(/sora\.chatgpt\.com\/profile\/([^\/?#]+)/);
            if (m) s = m[1];
            return s.replace(/[^a-z0-9._-]/g, '');
        }

        function renderCreatorChips() {
            cfChips.innerHTML = '';
            creators.forEach((c, idx) => {
                const chip = document.createElement('span');
                chip.className = `sdl-cf-chip state-${c.state}`;
                const name = document.createElement('span');
                name.className = 'sdl-cf-chip-name';
                name.textContent = c.username;
                chip.appendChild(name);
                if (c.state === 'valid' && (c.postCount != null || c.characterCount != null)) {
                    const meta = document.createElement('span');
                    meta.className = 'sdl-cf-chip-meta';
                    const parts = [];
                    if (c.postCount != null)      parts.push(`${c.postCount} posts`);
                    if (c.characterCount != null) parts.push(`${c.characterCount} chars`);
                    meta.textContent = parts.join(' · ');
                    chip.appendChild(meta);
                } else if (c.state === 'checking') {
                    const meta = document.createElement('span');
                    meta.className = 'sdl-cf-chip-meta';
                    meta.textContent = '…';
                    chip.appendChild(meta);
                } else if (c.state === 'invalid') {
                    const meta = document.createElement('span');
                    meta.className = 'sdl-cf-chip-meta';
                    meta.textContent = 'not found';
                    chip.appendChild(meta);
                }
                const x = document.createElement('button');
                x.type = 'button';
                x.className = 'sdl-cf-chip-x';
                x.textContent = '×';
                x.title = 'Remove';
                x.addEventListener('click', () => {
                    creators.splice(idx, 1);
                    renderCreatorChips();
                    updateCreatorsBadge();
                    persistCreatorsIfEnabled();
                });
                chip.appendChild(x);
                cfChips.appendChild(chip);
            });
        }

        function updateCreatorsBadge() {
            const valid = creators.filter(c => c.state === 'valid').length;
            cfBadge.textContent = `👥 ${valid}`;
            cfBadge.classList.toggle('on', creatorFetchEnabled && valid > 0);
            updateScanButton();
        }

        function persistCreatorsIfEnabled() {
            if (!creatorFetchPersist) return;
            try {
                const data = creators
                    .filter(c => c.state === 'valid')
                    .map(c => ({ username: c.username, userId: c.userId }));
                localStorage.setItem(CREATORS_STORAGE_KEY, JSON.stringify(data));
            } catch (e) { /* quota or access denied — silently ignore */ }
        }

        async function validateCreator(creator) {
            creator.state = 'checking';
            renderCreatorChips();
            try {
                const r = await _fetch(
                    `${location.origin}/backend/project_y/profile/username/${encodeURIComponent(creator.username)}`,
                    { credentials: 'include', headers: buildHeaders() }
                );
                if (r.status === 404) {
                    creator.state = 'invalid';
                } else if (!r.ok) {
                    creator.state = 'error';
                    creator.error = `HTTP ${r.status}`;
                } else {
                    const d = await r.json();
                    if (d && d.user_id) {
                        creator.userId         = d.user_id;
                        creator.postCount      = d.post_count ?? null;
                        creator.characterCount = d.character_count ?? null;
                        creator.state          = 'valid';
                    } else {
                        creator.state = 'invalid';
                    }
                }
            } catch (e) {
                creator.state = 'error';
                creator.error = e.message;
            }
            renderCreatorChips();
            updateCreatorsBadge();
            persistCreatorsIfEnabled();
        }

        function addCreatorNames(raw) {
            const parts = raw.split(',').map(normaliseCreatorInput).filter(Boolean);
            for (const name of parts) {
                if (creators.some(c => c.username === name)) continue;
                const creator = { username: name, userId: null, state: 'checking' };
                creators.push(creator);
                validateCreator(creator);
            }
            renderCreatorChips();
            updateCreatorsBadge();
        }

        cfInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                if (cfInput.value.trim()) {
                    addCreatorNames(cfInput.value);
                    cfInput.value = '';
                }
            } else if (e.key === 'Backspace' && !cfInput.value && creators.length) {
                creators.pop();
                renderCreatorChips();
                updateCreatorsBadge();
                persistCreatorsIfEnabled();
            }
        });
        cfInput.addEventListener('blur', () => {
            if (cfInput.value.trim()) {
                addCreatorNames(cfInput.value);
                cfInput.value = '';
            }
        });
        cfIncludeChars.addEventListener('change', () => { creatorFetchIncludeChars = cfIncludeChars.checked; });
        cfPersist.addEventListener('change', () => {
            creatorFetchPersist = cfPersist.checked;
            if (creatorFetchPersist) persistCreatorsIfEnabled();
            else try { localStorage.removeItem(CREATORS_STORAGE_KEY); } catch (e) {}
        });
        // Restore persisted creators on panel init
        try {
            const stored = localStorage.getItem(CREATORS_STORAGE_KEY);
            if (stored) {
                const arr = JSON.parse(stored);
                if (Array.isArray(arr) && arr.length) {
                    cfPersist.checked = true;
                    creatorFetchPersist = true;
                    for (const entry of arr) {
                        if (!entry || !entry.username) continue;
                        if (creators.some(c => c.username === entry.username)) continue;
                        const creator = {
                            username: entry.username,
                            userId: entry.userId ?? null,
                            state: entry.userId ? 'valid' : 'checking',
                        };
                        creators.push(creator);
                        // Revalidate in background — user_id may have changed
                        validateCreator(creator);
                    }
                    renderCreatorChips();
                    updateCreatorsBadge();
                }
            }
        } catch (e) { /* corrupt storage — ignore */ }

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
        document.getElementById('sdl-f-min-likes').addEventListener('input',  e => { filters.minLikes      = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-f-max-likes').addEventListener('input',  e => { filters.maxLikes      = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-f-date-from').addEventListener('change', e => { filters.dateFrom      = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-f-date-to').addEventListener('change',   e => { filters.dateTo        = e.target.value; recomputeSelection(); });
        document.getElementById('sdl-f-v1-fav').addEventListener('click', () => {
            filters.onlyFavorites = !filters.onlyFavorites;
            document.getElementById('sdl-f-v1-fav').classList.toggle('active', filters.onlyFavorites);
            recomputeSelection();
        });
        document.getElementById('sdl-filter-reset').addEventListener('click', () => {
            resetFilters(); resetFilterInputs(); recomputeSelection(); rebuildAllChips();
        });
        document.getElementById('sdl-cfg-SAVE_MEDIA').addEventListener('change', updateWatermarkEstimateBadge);
        document.getElementById('sdl-cfg-WATERMARK_REMOVAL').addEventListener('change', updateWatermarkEstimateBadge);

        // ── Async init ───────────────────────────────────────────────────
        setTimeout(checkForUpdate, 1500);
        updateShutdownBadge();
        updateScanButton();
        updateWatermarkEstimateBadge();
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
