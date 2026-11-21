// ==UserScript==
// @name         Instagram Beast Optimizer V6.0 PRO
// @namespace    http://tampermonkey.net/
// @version      6.1
// @description  Safe Reels optimizer, auto-skip sponsored Reels, IGPlus-style controls, live HUD and a built-in debug console. Created by Ajmaine Al Arafat
// @author       Ajmaine Al Arafat
// @match        https://www.instagram.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    if (window.__igBeast6) return;
    window.__igBeast6 = true;
    const VERSION = '6.1';

    /* ───────────────────────── Settings ───────────────────────── */
    const KEY = 'igBeast6.settings';
    const DEFAULTS = {
        // Reels engine
        optimizer: true, mode: 'auto', safePause: true, gpu: true,
        skipAds: true, hideAds: true, turbo: false,
        // UI
        hud: true, hudMin: false, hudX: null, hudY: null, debug: false,
        // Main features
        noReels: false, noExplore: false, hideStories: false, noStories: false,
        grayLabels: false, noLabels: false, noRecs: false, goDirect: false,
        noThreads: false, noFeed: false,
        // Additional features
        noVanity: false, grayscale: false, square: false, blockVideos: false,
        blockImages: false, noComments: false, noNotes: false
    };
    let S = loadSettings();
    function loadSettings() {
        try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
        catch (_) { return Object.assign({}, DEFAULTS); }
    }
    function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {} }

    /* ───────────────────────── Logger (feeds the in-page Console) ───────────────────────── */
    const LV = { debug: 0, info: 1, warn: 2, error: 3 };
    const LOG_MAX = 800;
    const logs = [];
    const stats = { errors: 0, warns: 0, vBlocked: 0, iBlocked: 0, adSkipped: 0, jumps: 0,
                    scans: 0, slowScans: 0, longTasks: 0, longTaskMs: 0, marked: {} };
    let consoleUI = null;

    function fmt(d) {
        if (d === undefined) return '';
        if (typeof d === 'string') return d;
        try { const s = JSON.stringify(d); return s.length > 400 ? s.slice(0, 400) + '…' : s; }
        catch (_) { return String(d); }
    }
    function L(level, tag, msg, data) {
        if (level === 'debug' && !S.debug) return;
        const e = { t: Date.now(), level, tag, msg: data === undefined ? String(msg) : msg + ' ' + fmt(data) };
        logs.push(e);
        if (logs.length > LOG_MAX) logs.splice(0, logs.length - LOG_MAX);
        if (level === 'error') stats.errors++; else if (level === 'warn') stats.warns++;
        if (S.debug) {
            try { console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log']('[IG Beast][' + tag + '] ' + e.msg); } catch (_) {}
        }
        if (consoleUI) consoleUI.push(e);
    }
    function safe(tag, fn) {
        return function () {
            try { return fn.apply(this, arguments); }
            catch (err) {
                L('error', tag, (err && err.message) || String(err),
                  err && err.stack ? String(err.stack).split('\n').slice(1, 3).join(' | ') : undefined);
            }
        };
    }
    const pad = (n, l) => String(n).padStart(l || 2, '0');
    function fmtLine(e) {
        const d = new Date(e.t);
        return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3) +
               ' [' + e.level.toUpperCase() + '] [' + e.tag + '] ' + e.msg;
    }
    function desc(el) {
        if (!el || !el.tagName) return String(el);
        let s = el.tagName.toLowerCase();
        if (el.id) s += '#' + el.id;
        const al = el.getAttribute('aria-label'); if (al) s += '[aria-label="' + al.slice(0, 30) + '"]';
        const hr = el.getAttribute('href'); if (hr) s += '[href="' + hr.slice(0, 40) + '"]';
        return s;
    }

    window.addEventListener('error', (e) => {
        const s = String(e.filename || '') + String((e.error && e.error.stack) || '');
        if (/userscript|tampermonkey|igBeast|Beast Optimizer/i.test(s)) L('error', 'global', e.message || 'error', s.slice(0, 200));
    }, true);
    try {
        new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
                stats.longTasks++; stats.longTaskMs += Math.round(e.duration);
                if (e.duration > 200) L('debug', 'perf', 'long task ' + Math.round(e.duration) + 'ms');
            }
        }).observe({ entryTypes: ['longtask'] });
    } catch (_) {}

    /* ─────────────── Network / media blocking (page-level) ─────────────── */
    const VIDEO_RE = /\.(mp4|webm)(\?|$)|\.m4s(\?|$)|[?&]bytestart=|\/o1\/v\/t\d/i;

    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
        window.fetch = function (input) {
            try {
                if (S.blockVideos) {
                    const u = typeof input === 'string' ? input : ((input && input.url) || String(input));
                    if (VIDEO_RE.test(u)) { stats.vBlocked++; L('debug', 'net', 'blocked video request', u.slice(0, 90)); return Promise.reject(new DOMException('Blocked', 'AbortError')); }
                }
            } catch (_) {}
            return origFetch.apply(this, arguments);
        };
    }
    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
        try { this.__igpBlock = !!(S.blockVideos && VIDEO_RE.test(String(u))); } catch (_) {}
        return xhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
        if (this.__igpBlock) {
            stats.vBlocked++;
            const x = this;
            setTimeout(() => { try { x.dispatchEvent(new ProgressEvent('error')); } catch (_) {} }, 0);
            return;
        }
        return xhrSend.apply(this, arguments);
    };
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
        if (S.blockVideos && this.tagName === 'VIDEO') return Promise.resolve();
        return origPlay.apply(this, arguments);
    };

    const PIX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const blockable = (v) => typeof v === 'string' && v !== '' && !/^(data|blob):/i.test(v);
    const imgSrcD = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    const imgSetD = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'srcset');
    const origSetAttr = Element.prototype.setAttribute;
    if (imgSrcD && imgSrcD.set) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            configurable: true, enumerable: imgSrcD.enumerable,
            get() { return (S.blockImages && this.__igpSrc) || imgSrcD.get.call(this); },
            set(v) {
                if (S.blockImages && blockable(v)) { this.__igpSrc = v; stats.iBlocked++; imgSrcD.set.call(this, PIX); }
                else { this.__igpSrc = undefined; imgSrcD.set.call(this, v); }
            }
        });
    }
    if (imgSetD && imgSetD.set) {
        Object.defineProperty(HTMLImageElement.prototype, 'srcset', {
            configurable: true, enumerable: imgSetD.enumerable,
            get() { return (S.blockImages && this.__igpSet) || imgSetD.get.call(this); },
            set(v) {
                if (S.blockImages && v) { this.__igpSet = v; imgSetD.set.call(this, ''); }
                else { this.__igpSet = undefined; imgSetD.set.call(this, v); }
            }
        });
    }
    Element.prototype.setAttribute = function (name, value) {
        if (S.blockImages && this.tagName === 'IMG' && typeof name === 'string') {
            const k = name.toLowerCase();
            if (k === 'src' && blockable(value)) { this.__igpSrc = value; stats.iBlocked++; return origSetAttr.call(this, 'src', PIX); }
            if (k === 'srcset' && value) { this.__igpSet = value; return origSetAttr.call(this, 'srcset', ''); }
        }
        return origSetAttr.apply(this, arguments);
    };
    function restoreImages() {
        let n = 0;
        for (const img of document.images) {
            if (img.__igpSrc) { const s = img.__igpSrc; img.__igpSrc = undefined; origSetAttr.call(img, 'src', s); n++; }
            if (img.__igpSet) { const s = img.__igpSet; img.__igpSet = undefined; origSetAttr.call(img, 'srcset', s); }
        }
        if (n) L('info', 'net', 'restored ' + n + ' blocked images');
    }

    /* ───────────────────────── Routing ───────────────────────── */
    let route = 'other';
    let navCount = 0;
    let lastPath = '';

    function computeRoute() {
        const p = location.pathname;
        if (p === '/' || p === '') return 'home';
        if (/^\/reels?(\/|$)/.test(p)) return 'reels';
        if (/^\/explore\/?$/.test(p)) return 'explore';
        if (p.startsWith('/direct')) return 'direct';
        if (p.startsWith('/stories/')) return 'stories';
        return 'other';
    }
    function allowRedirect() {
        const now = Date.now();
        let a = [];
        try { a = JSON.parse(sessionStorage.getItem('igBeast6.r') || '[]').filter((t) => now - t < 6000); } catch (_) {}
        if (a.length >= 5) return false;
        a.push(now);
        try { sessionStorage.setItem('igBeast6.r', JSON.stringify(a)); } catch (_) {}
        return true;
    }
    function leave(why) {
        if (!allowRedirect()) { L('warn', 'redirect', 'loop guard blocked a redirect (' + why + ')'); return; }
        L('info', 'redirect', 'leaving ' + route + ' (' + why + ')');
        if (navCount > 0 && history.length > 1) history.back();
        else location.replace('/');
    }
    function goDirect() {
        if (!allowRedirect()) { L('warn', 'redirect', 'loop guard blocked goDirect'); return; }
        L('info', 'redirect', 'Home → Direct');
        if (navCount === 0) { location.replace('/direct/inbox/'); return; }
        let tries = 0;
        const t = () => {
            const a = document.querySelector('a[href="/direct/inbox/"]');
            if (a) a.click();
            else if (++tries < 10) setTimeout(t, 150);
            else location.replace('/direct/inbox/');
        };
        t();
    }
    function enforce() {
        if (route === 'reels' && S.noReels) return leave('Reels disabled');
        if (route === 'explore' && S.noExplore) return leave('Explore disabled');
        if (route === 'stories' && S.noStories) return leave('Stories disabled');
        if (route === 'home' && S.goDirect) return goDirect();
    }
    const onRoute = safe('route', function (force) {
        const p = location.pathname;
        if (!force && p === lastPath) return;
        lastPath = p;
        const r = computeRoute();
        const prev = route;
        route = r;
        adFailStreak = 0;
        document.documentElement.setAttribute('data-igp-route', r);
        if (r !== prev) {
            L('info', 'route', prev + ' → ' + r + ' (' + p + ')');
            if (r !== 'reels') resetVideoState();
            syncTurbo();
            renderHud();
        }
        enforce();
        schedule();
    });

    /* ───────────────────────── CSS builder ───────────────────────── */
    let styleEl = null;
    function buildCss() {
        const c = [];
        const hide = (s) => c.push(s + '{display:none!important}');
        const wrap = (s) => hide(':is(div,span,li):has(> ' + s + ':only-child)');
        c.push('.igp-gpu{will-change:transform}');
        if (S.noReels) {
            const a = 'a[href*="/reels/"]';
            hide(a); wrap(a);
            hide('article:has(a[href*="/reel/"])');
            hide('main a[href*="/reel/"]');
        }
        if (S.noExplore) { hide('a[href="/explore/"]'); wrap('a[href="/explore/"]'); }
        if (S.noThreads) { for (const a of ['a[href*="threads.net"]', 'a[href*="threads.com"]']) { hide(a); wrap(a); } }
        if (S.noFeed) hide('html[data-igp-route="home"] article');
        if (S.noComments) {
            hide('a[href*="/comments/"]');
            hide(':is(button,[role="button"]):has(svg[aria-label="Comment"])');
            hide('form:has(textarea[aria-label*="omment" i])');
            hide('textarea[aria-label*="omment" i]');
        }
        if (S.noVanity) {
            hide('a[href$="/followers/"], a[href*="/liked_by/"]');
            c.push('[data-igp-h~="vanity"]{display:none!important}');
        }
        if (S.noLabels) { c.push('[data-igp-h~="badge"]{display:none!important}'); hide('[aria-label^="Unread" i]'); }
        else if (S.grayLabels) c.push('[data-igp-h~="badge"],[aria-label^="Unread" i]{filter:grayscale(1)!important}');
        if (S.hideStories || S.noStories) c.push('[data-igp-h~="stories"]{display:none!important}');
        if (S.noStories) hide('header canvas');
        if (S.noRecs) c.push('[data-igp-h~="recs"]{display:none!important}');
        if (S.hideAds) c.push('[data-igp-h~="ads"]{display:none!important}');
        if (S.noNotes) c.push('[data-igp-h~="notes"]{display:none!important}');
        if (S.grayscale) c.push('html{filter:grayscale(1)!important}');
        if (S.square) c.push('*,*::before,*::after{border-radius:0!important}');
        return c.join('\n');
    }

    /* ───────────────────────── DOM rules ───────────────────────── */
    let domRulesActive = false;
    const computeDomActive = () => !!(S.hideStories || S.noStories || S.noRecs || S.noVanity || S.grayLabels ||
                                      S.noLabels || S.noNotes || S.hideAds);
    const STORY_SEL = 'a[href^="/stories/"], [aria-label^="Story by"]';
    const LIKE_RE = /^\s*(liked by\b|[\d.,]+\s*[KkMm]?\s+(likes?|views?|plays?)\s*$)/i;
    const NOTE_RE = /^(Your note|Note…|Note\.\.\.)$/;
    const SPONSOR_WORDS = ['Sponsored', 'Publicidad', 'Patrocinado', 'Gesponsert', 'Sponsorisé', 'স্পনসর', 'বিজ্ঞাপন'];

    function mark(node, tag) {
        const cur = node.getAttribute('data-igp-h') || '';
        if ((' ' + cur + ' ').includes(' ' + tag + ' ')) return;
        node.setAttribute('data-igp-h', (cur + ' ' + tag).trim());
        const n = (stats.marked[tag] = (stats.marked[tag] || 0) + 1);
        if (n === 1) L('info', 'dom', 'first element hidden for "' + tag + '": ' + desc(node));
        else L('debug', 'dom', 'hid ' + tag + ': ' + desc(node));
    }
    function hideAboveEls(els, stopSel, tag, skipSel) {
        for (const el of els) {
            if (el.closest('[data-igp-h]') || el.closest(skipSel || 'article,[role="dialog"]')) continue;
            let node = el, p = el.parentElement;
            while (p && p !== document.body && p !== document.documentElement && !p.querySelector(stopSel)) { node = p; p = p.parentElement; }
            if (p && p !== document.body && p !== document.documentElement && node !== el) mark(node, tag);
        }
    }
    function hideSidebarRecs() {
        const a = document.querySelector('a[href="/explore/people/"]');
        if (!a || a.closest('[data-igp-h]')) return;
        let node = a;
        for (let i = 0; i < 5 && node.parentElement; i++) {
            const nx = node.nextElementSibling;
            if (nx && /Follow/.test(nx.textContent || '')) { mark(node, 'recs'); mark(nx, 'recs'); return; }
            node = node.parentElement;
        }
    }
    function processArticle(a) {
        const n = parseInt(a.getAttribute('data-igp-ck') || '0', 10);
        if (n >= 3) return;
        a.setAttribute('data-igp-ck', String(n + 1));
        const hd = a.querySelector('header');
        const ht = hd ? (hd.textContent || '') : '';
        if (S.hideAds && SPONSOR_WORDS.some((w) => ht.includes(w))) { mark(a, 'ads'); return; }
        if (S.noRecs && route === 'home' && /\bFollow\b|Suggested/.test(ht)) { mark(a, 'recs'); return; }
        if (S.noVanity) {
            for (const s of a.querySelectorAll('span')) {
                if (!s.firstElementChild && LIKE_RE.test(s.textContent || '')) mark(s, 'vanity');
            }
        }
    }
    function markBadges() {
        for (const link of document.querySelectorAll('a[href^="/direct/inbox"]')) {
            for (const el of link.querySelectorAll('span,div')) {
                if (el.firstElementChild) continue;
                const t = (el.textContent || '').trim();
                if (!/^\d{1,3}\+?$/.test(t)) continue;
                let node = el, i = 0;
                while (i++ < 3 && node.parentElement && node.parentElement !== link &&
                       (node.parentElement.textContent || '').trim() === t) node = node.parentElement;
                mark(node, 'badge');
            }
        }
    }
    function markNotes() {
        if (document.querySelector('[data-igp-h~="notes"]')) return;
        const hits = [];
        for (const s of document.querySelectorAll('span')) {
            if (!s.firstElementChild && NOTE_RE.test((s.textContent || '').trim())) hits.push(s);
        }
        if (hits.length) hideAboveEls(hits, 'a[href^="/direct/t/"]', 'notes', '[role="dialog"]');
    }

    let scanPending = false;
    const scan = safe('scan', function () {
        scanPending = false;
        const t0 = performance.now();
        if (route === 'reels' && reelsEngineOn()) { scanVideos(); checkAd(); }
        if (domRulesActive) {
            if (route === 'home') {
                if (S.hideStories || S.noStories) hideAboveEls(document.querySelectorAll(STORY_SEL), 'article', 'stories');
                if (S.noRecs) hideSidebarRecs();
            }
            if (S.noRecs || S.noVanity || S.hideAds) for (const a of document.querySelectorAll('article')) processArticle(a);
            if (S.grayLabels || S.noLabels) markBadges();
            if (S.noNotes && route === 'direct') markNotes();
        }
        const dt = performance.now() - t0;
        stats.scans++;
        if (dt > 20) { stats.slowScans++; L('warn', 'perf', 'slow scan ' + dt.toFixed(1) + 'ms on ' + route); }
        else L('debug', 'perf', 'scan ' + dt.toFixed(1) + 'ms');
    });
    function schedule() {
        if (scanPending) return;
        scanPending = true;
        const fast = route === 'reels' && S.skipAds;
        setTimeout(() => {
            if (!fast && 'requestIdleCallback' in window) requestIdleCallback(scan, { timeout: 800 });
            else scan();
        }, fast ? 120 : (MODES[curMode] || MODES.balanced).debounce);
    }

    /* ───────────────────────── Reels engine ───────────────────────── */
    const MODES = {
        light:       { margin: '250px 0px 250px 0px', preload: 0, debounce: 600 },
        balanced:    { margin: '500px 0px 500px 0px', preload: 1, debounce: 400 },
        performance: { margin: '900px 0px 900px 0px', preload: 2, debounce: 250 }
    };
    let curMode = 'balanced';
    const observed = new Set();
    const visible = new Set();
    const preloadQ = new Set();
    let io = null, pausedTotal = 0, refreshTimer = 0;
    let scrollDir = 1, lastTop = 0, lastSkip = 0, adFailStreak = 0;
    const reelsEngineOn = () => S.optimizer || S.skipAds || S.turbo;

    function resolveMode() {
        if (S.mode !== 'auto') return MODES[S.mode] ? S.mode : 'balanced';
        const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 4;
        let m = (mem <= 4 || cores <= 4) ? 'light' : ((mem >= 8 && cores >= 8) ? 'performance' : 'balanced');
        const pm = performance.memory;
        if (pm && pm.jsHeapSizeLimit && pm.usedJSHeapSize / pm.jsHeapSizeLimit > 0.75) m = 'light';
        return m;
    }
    function buildIO() {
        if (io) io.disconnect();
        io = new IntersectionObserver(onIntersect, { root: null, rootMargin: MODES[curMode].margin, threshold: 0 });
        observed.forEach((v) => io.observe(v));
    }
    const onIntersect = safe('io', function (entries) {
        if (route !== 'reels') return;
        for (const e of entries) {
            const v = e.target;
            if (e.isIntersecting) { visible.add(v); continue; }
            visible.delete(v);
            v.classList.remove('igp-gpu');
            // Safe cleanup: only PAUSE far-away videos. Never touch src/source (Instagram owns them).
            if (S.optimizer && S.safePause && !v.paused) {
                try { v.pause(); pausedTotal++; L('debug', 'opt', 'paused far video'); } catch (_) {}
            }
        }
        requestRefresh();
    });
    function requestRefresh() {
        if (refreshTimer) return;
        refreshTimer = setTimeout(() => { refreshTimer = 0; refresh(); }, 120);
    }
    const refresh = safe('refresh', function () {
        if (route !== 'reels' || !reelsEngineOn()) return;
        if (S.optimizer) {
            const mid = window.innerHeight / 2;
            let cur = null;
            const below = [];
            for (const v of visible) {
                if (!v.isConnected) continue;
                const r = v.getBoundingClientRect();
                if (r.height <= 0) continue;
                if (r.top <= mid && r.bottom >= mid) cur = v;
                else if (r.top > mid) below.push([r.top, v]);
            }
            for (const v of visible) v.classList.toggle('igp-gpu', !!(S.gpu && v === cur));
            below.sort((a, b) => a[0] - b[0]);
            const want = new Set(below.slice(0, MODES[curMode].preload).map((x) => x[1]));
            want.forEach((v) => { if (v.preload !== 'auto') { try { v.preload = 'auto'; } catch (_) {} } preloadQ.add(v); });
            for (const v of Array.from(preloadQ)) {
                if (want.has(v)) continue;
                preloadQ.delete(v);
                if (v !== cur && v.preload === 'auto') { try { v.preload = 'metadata'; } catch (_) {} }
            }
        }
        if (S.skipAds) checkAd();
    });
    function scanVideos() {
        if (!io) { curMode = resolveMode(); buildIO(); L('info', 'opt', 'observer started (mode ' + curMode + ', margin ' + MODES[curMode].margin + ')'); }
        for (const v of document.querySelectorAll('video')) {
            if (!observed.has(v)) { observed.add(v); io.observe(v); }
        }
    }
    function resetVideoState() {
        visible.forEach((v) => v.classList.remove('igp-gpu'));
        visible.clear(); preloadQ.clear();
    }
    function teardownOptimizer() {
        if (io) { io.disconnect(); io = null; L('info', 'opt', 'observer stopped'); }
        resetVideoState(); observed.clear();
    }
    function pruneDetached() {
        let n = 0;
        for (const v of Array.from(observed)) {
            if (v.isConnected) continue;
            if (io) io.unobserve(v);
            observed.delete(v); visible.delete(v); preloadQ.delete(v); n++;
        }
        if (n) L('debug', 'opt', 'pruned ' + n + ' detached videos');
    }

    /* ── Scroll helpers (used by Ad-skip and Turbo scroll) ── */
    function getCurrentVideo() {
        const mid = window.innerHeight / 2;
        for (const v of document.querySelectorAll('video')) {
            const r = v.getBoundingClientRect();
            if (r.height > 0 && r.top <= mid && r.bottom >= mid) return v;
        }
        return null;
    }
    function findScroller(el) {
        let n = el;
        while (n && n !== document.documentElement && n !== document.body) {
            if (n.scrollHeight > n.clientHeight + 50) {
                const oy = getComputedStyle(n).overflowY;
                if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return n;
            }
            n = n.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    }
    function jumpReel(dir, why) {
        const cur = getCurrentVideo();
        if (!cur) { L('warn', 'scroll', 'jump(' + why + '): no current video found'); return false; }
        const sc = findScroller(cur);
        const cr = cur.getBoundingClientRect();
        const ch = cr.top + cr.height / 2;
        let delta = null;
        for (const v of document.querySelectorAll('video')) {
            if (v === cur) continue;
            const r = v.getBoundingClientRect();
            if (r.height <= 0) continue;
            const d = r.top + r.height / 2 - ch;
            if (dir > 0 ? d > cr.height * 0.4 : d < -cr.height * 0.4) { if (delta === null || Math.abs(d) < Math.abs(delta)) delta = d; }
        }
        if (delta === null) {
            delta = dir * (sc === document.scrollingElement ? window.innerHeight : sc.clientHeight);
            L('debug', 'scroll', 'neighbour video not mounted, using page height');
        }
        const before = sc.scrollTop;
        try { sc.scrollBy({ top: delta, behavior: 'instant' }); } catch (_) { try { sc.scrollTop += delta; } catch (__) { return false; } }
        if (Math.abs(sc.scrollTop - before) < 2) { L('warn', 'scroll', 'jump(' + why + ') did not move the scroller ' + desc(sc)); return false; }
        stats.jumps++;
        L('debug', 'scroll', 'jump ' + why + ' ' + Math.round(delta) + 'px');
        return true;
    }

    /* ── Sponsored-reel detection & auto-skip ── */
    const AD_LABELS = new Set(['ad', 'sponsored', 'বিজ্ঞাপন', 'স্পনসর করা', 'স্পনসর্ড', 'publicidad', 'patrocinado', 'anzeige', 'annonce']);
    const AD_CTAS = new Set(['learn more', 'shop now', 'install now', 'sign up', 'book now', 'order now', 'get offer',
        'apply now', 'send message', 'get quote', 'use app', 'play game', 'contact us', 'আরও জানুন', 'এখনই কিনুন']);
    function detectAd(v) {
        const r = v.getBoundingClientRect();
        if (r.height <= 0) return null;
        for (const el of document.querySelectorAll('span,a,button,div[role="button"],div[dir="auto"]')) {
            if (el.childElementCount) continue;
            const raw = el.textContent;
            if (!raw || raw.length > 24) continue;
            const t = raw.trim().toLowerCase();
            const kind = AD_LABELS.has(t) ? 'label' : (AD_CTAS.has(t) ? 'cta' : null);
            if (!kind) continue;
            const b = el.getBoundingClientRect();
            const cy = b.top + b.height / 2;
            if (b.width > 0 && cy >= r.top && cy <= r.bottom) return { kind, text: raw.trim() };
        }
        return null;
    }
    const checkAd = safe('ads', function () {
        if (!S.skipAds || route !== 'reels' || adFailStreak >= 3) return;
        const now = Date.now();
        if (now - lastSkip < 450) return;
        const v = getCurrentVideo();
        if (!v) return;
        const hit = detectAd(v);
        if (!hit) return;
        lastSkip = now;
        const dir = scrollDir || 1;
        L('info', 'ads', 'Ad reel detected (' + hit.kind + ': "' + hit.text + '") → skipping ' + (dir > 0 ? 'down' : 'up'));
        if (jumpReel(dir, 'ad')) {
            stats.adSkipped++; adFailStreak = 0;
            try { v.pause(); } catch (_) {}
        } else {
            adFailStreak++;
            L('warn', 'ads', 'skip failed (' + adFailStreak + '/3)');
            if (adFailStreak >= 3) L('error', 'ads', 'auto-skip paused on this page because scrolling failed. Run Self-test in Console and send the log.');
        }
    });

    /* ── Turbo wheel scroll (instant next/previous reel) ── */
    let wheelAttached = false, wheelLock = false, wheelTimer = 0, lastJump = 0;
    const onWheel = safe('wheel', function (e) {
        if (!S.turbo || route !== 'reels' || e.ctrlKey || Math.abs(e.deltaY) < 4 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        const t = e.target;
        if (t && t.closest && t.closest('[role="dialog"],textarea,input,[contenteditable="true"]')) return;
        const cur = getCurrentVideo();
        if (!cur) return;
        const sc = findScroller(cur);
        if (findScroller(t) !== sc) return;
        e.preventDefault();
        clearTimeout(wheelTimer);
        const now = performance.now();
        wheelTimer = setTimeout(() => { wheelLock = false; }, Math.max(140, 220 - (now - lastJump)));
        if (wheelLock) return;
        wheelLock = true; lastJump = now;
        jumpReel(e.deltaY > 0 ? 1 : -1, 'turbo');
    });
    function syncTurbo() {
        const want = S.turbo && route === 'reels';
        if (want && !wheelAttached) { document.addEventListener('wheel', onWheel, { passive: false, capture: true }); wheelAttached = true; L('info', 'scroll', 'Turbo wheel scroll ON'); }
        else if (!want && wheelAttached) { document.removeEventListener('wheel', onWheel, { capture: true }); wheelAttached = false; L('info', 'scroll', 'Turbo wheel scroll OFF'); }
    }
    document.addEventListener('scroll', safe('scroll', function (e) {
        if (route !== 'reels') return;
        const t = e.target === document ? document.scrollingElement : e.target;
        if (t && typeof t.scrollTop === 'number' && t.clientHeight > 300) {
            const d = t.scrollTop - lastTop;
            if (Math.abs(d) > 4) { scrollDir = d > 0 ? 1 : -1; lastTop = t.scrollTop; }
        }
        if (reelsEngineOn()) requestRefresh();
    }), { capture: true, passive: true });

    /* ───────────────────────── Legacy-script detection ───────────────────────── */
    let legacy = false, legacyWarned = false;
    const checkLegacy = safe('legacy', function () {
        const hud5 = document.getElementById('ig-ram-hud');
        const st5 = document.getElementById('ig-beast-optimizer-style');
        if (!hud5 && !st5) return;
        legacy = true;
        if (!legacyWarned) {
            legacyWarned = true;
            L('warn', 'legacy', 'OLD V5 SCRIPT IS STILL RUNNING. It strips video sources and forces smooth scrolling, which makes Reels slow. Disable/delete it in Tampermonkey.');
        }
        if (st5) st5.remove();
        if (hud5) hud5.remove();
        renderHud();
    });

    /* ───────────────────────── Self-test & FPS test ───────────────────────── */
    const heapStr = () => {
        const pm = performance.memory;
        return (pm && pm.usedJSHeapSize) ? (pm.usedJSHeapSize / 1048576).toFixed(1) + ' / ' + Math.round(pm.jsHeapSizeLimit / 1048576) + ' MB' : 'n/a';
    };
    function reportHeader() {
        return ['Instagram Beast Optimizer ' + VERSION + ' - debug report', new Date().toString(), 'URL: ' + location.href,
            'UA: ' + navigator.userAgent, 'Route: ' + route + ' | Mode: ' + curMode,
            'deviceMemory=' + (navigator.deviceMemory || '?') + ' cores=' + (navigator.hardwareConcurrency || '?') + ' JSHeap=' + heapStr(),
            'Settings: ' + JSON.stringify(S), 'Stats: ' + JSON.stringify(stats), ''].join('\n');
    }
    const selfTest = safe('selftest', function () {
        L('info', 'test', '──────── SELF-TEST ────────');
        L('info', 'test', 'V' + VERSION + ' | route ' + route + ' | mode ' + curMode + ' | ' + location.pathname);
        const chk = (ok, good, bad) => L(ok ? 'info' : 'warn', 'test', (ok ? 'PASS ' : 'WARN ') + (ok ? good : (bad || good)));
        let hasHas = true; try { hasHas = CSS.supports('selector(:has(a))'); } catch (_) {}
        chk(hasHas, 'CSS :has() supported', 'CSS :has() NOT supported: Reels/Explore/Comments hide rules will not work. Update the browser.');
        chk(!legacy, 'No old V5 script detected', 'Old V5 script detected: disable/delete it in Tampermonkey');
        chk(!!ui, 'UI mounted');
        L('info', 'test', 'Videos in DOM ' + document.querySelectorAll('video').length + ' | observed ' + observed.size + ' | visible ' + visible.size + ' | preload queue ' + preloadQ.size);
        if (route === 'reels') {
            const cur = getCurrentVideo();
            chk(!!cur, 'Current reel video found', 'No current reel video found');
            if (cur) {
                const sc = findScroller(cur);
                L('info', 'test', 'Reel scroller: ' + (sc === document.scrollingElement ? 'document' : desc(sc)));
                const hit = detectAd(cur);
                L('info', 'test', 'Current reel: ' + (hit ? 'AD (' + hit.kind + ': "' + hit.text + '")' : 'not detected as an ad'));
            }
        }
        const total = (sel) => { try { return document.querySelectorAll(sel).length; } catch (_) { return -1; } };
        const shown = (sel) => { let n = 0; try { document.querySelectorAll(sel).forEach((el) => { if (el.getClientRects().length) n++; }); } catch (_) { return -1; } return n; };
        const linkCheck = (flag, name, sel) => {
            if (!S[flag]) return;
            const n = total(sel), v = shown(sel);
            if (n === 0) L('info', 'test', name + ': no matching element on this page (nothing to hide here)');
            else chk(v === 0, name + ': ' + n + ' found, all hidden', name + ': ' + v + ' of ' + n + ' still visible');
        };
        linkCheck('noReels', 'Reels links', 'a[href*="/reels/"]');
        linkCheck('noExplore', 'Explore links', 'a[href="/explore/"]');
        linkCheck('noThreads', 'Threads links', 'a[href*="threads.net"],a[href*="threads.com"]');
        linkCheck('noVanity', 'Follower/likes links', 'a[href$="/followers/"],a[href*="/liked_by/"]');
        linkCheck('noComments', 'Comment buttons', ':is(button,[role="button"]):has(svg[aria-label="Comment"])');
        const mk = (tag) => total('[data-igp-h~="' + tag + '"]');
        if (S.hideStories || S.noStories) {
            const n = total(STORY_SEL), m = mk('stories');
            if (route === 'home') chk(!(n > 0 && m === 0), 'Stories: ' + n + ' story links, ' + m + ' block(s) hidden', 'Stories: ' + n + ' story links found but no tray block hidden yet (feed may still be loading)');
            else L('info', 'test', 'Stories tray is only handled on Home (currently ' + route + ')');
        }
        if (S.noRecs) L('info', 'test', 'Recommendations: sidebar link ' + (total('a[href="/explore/people/"]') ? 'found' : 'not found') + ', hidden blocks ' + mk('recs'));
        if (S.hideAds) L('info', 'test', 'Sponsored feed posts hidden: ' + mk('ads') + ' (articles on page: ' + total('article') + ')');
        if (S.noVanity) L('info', 'test', 'Like-count spans hidden: ' + mk('vanity'));
        if (S.grayLabels || S.noLabels) L('info', 'test', 'Inbox badges: direct link ' + (total('a[href^="/direct/inbox"]') ? 'found' : 'not found') + ', badges marked ' + mk('badge'));
        if (S.noNotes) L('info', 'test', 'Notes blocks hidden: ' + mk('notes') + (route === 'direct' ? '' : ' (only works on /direct/)'));
        if (S.noFeed && route === 'home') chk(shown('article') === 0, 'Feed hidden (0 articles visible)', 'Feed: ' + shown('article') + ' articles still visible');
        if (S.goDirect) L('info', 'test', 'Direct link in nav: ' + (total('a[href="/direct/inbox/"]') ? 'found' : 'not found'));
        if (S.blockVideos) L('info', 'test', 'Blocked video requests so far: ' + stats.vBlocked);
        if (S.blockImages) L('info', 'test', 'Blocked images so far: ' + stats.iBlocked + ' (already-loaded images stay; refresh the page)');
        if (S.skipAds) L('info', 'test', 'Auto-skip ON | ads skipped: ' + stats.adSkipped + ' | fail streak ' + adFailStreak + '/3');
        if (S.turbo) L('info', 'test', 'Turbo wheel scroll ' + (wheelAttached ? 'attached' : 'not attached (only active on Reels)') + ' | jumps ' + stats.jumps);
        L('info', 'test', 'Perf: scans ' + stats.scans + ', slow scans ' + stats.slowScans + ', long tasks ' + stats.longTasks + ' (' + stats.longTaskMs + 'ms total)');
        L('info', 'test', 'JS heap: ' + heapStr());
        L('info', 'test', '──────── END SELF-TEST ────────');
    });
    const fpsTest = safe('fps', function () {
        L('info', 'test', 'FPS test running for 3s: SCROLL REELS NOW...');
        const lt0 = stats.longTasks, lm0 = stats.longTaskMs;
        const t0 = performance.now();
        let last = t0, frames = 0, worst = 0, jank = 0;
        const tick = (t) => {
            frames++;
            const dt = t - last; last = t;
            if (frames > 1) { if (dt > worst) worst = dt; if (dt > 33) jank++; }
            if (t - t0 < 3000) requestAnimationFrame(tick);
            else {
                const fps = frames * 1000 / (t - t0);
                L(fps < 45 ? 'warn' : 'info', 'test', 'FPS avg ' + fps.toFixed(0) + ' | worst frame ' + worst.toFixed(0) + 'ms | janky frames (>33ms) ' + jank +
                  ' | long tasks ' + (stats.longTasks - lt0) + ' (' + (stats.longTaskMs - lm0) + 'ms) | JS heap ' + heapStr());
            }
        };
        requestAnimationFrame(tick);
    });

    /* ───────────────────────── UI (Shadow DOM: HUD, Settings, Console) ───────────────────────── */
    const UI_CSS = `
    *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    .hidden{display:none!important}
    .hud{position:fixed;right:12px;top:12px;background:rgba(18,18,22,.93);color:#f2f2f7;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:8px 12px;font-size:12px;line-height:1.45;box-shadow:0 6px 20px rgba(0,0,0,.35);user-select:none;min-width:130px}
    .title{display:flex;align-items:center;gap:6px;font-weight:600;color:#34c759;cursor:grab;touch-action:none}
    .dot{width:7px;height:7px;border-radius:50%;background:#34c759;flex:none}
    .mini{color:#d1d1d6;font-weight:500;font-variant-numeric:tabular-nums}
    .btns{margin-left:auto;display:flex;gap:8px;padding-left:8px}
    .ib{cursor:pointer;background:none;border:0;color:#d1d1d6;font-size:14px;padding:0 2px;line-height:1}
    .ib:hover{color:#fff}
    .rows{margin-top:4px}
    .row{display:flex;justify-content:space-between;gap:14px;color:#d1d1d6;font-variant-numeric:tabular-nums}
    .row b{color:#fff;font-weight:600}
    .legacy{margin-top:4px;color:#ffc107;font-weight:600;max-width:210px}
    .off .rows{display:none}
    .veil{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center}
    .veil.open{display:flex}
    .panel{width:min(860px,96vw);max-height:90vh;overflow:auto;background:#212529;color:#e9ecef;border:1px solid rgba(255,255,255,.1);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-size:13px}
    .ph{display:flex;align-items:center;gap:10px;padding:14px 18px 8px}
    .ph h1{margin:0;font-size:16px;font-weight:600}
    .ph p{margin:2px 0 0;color:#9aa0a6;font-size:11.5px}
    .ph .ib{margin-left:auto;font-size:18px}
    .tabs{display:flex;gap:6px;padding:0 18px;border-bottom:1px solid rgba(255,255,255,.08)}
    .tab{background:none;border:0;border-bottom:2px solid transparent;color:#9aa0a6;padding:8px 12px;cursor:pointer;font-size:13px}
    .tab.on{color:#fff;border-bottom-color:#2f9bf5}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 26px;padding:14px 18px}
    @media(max-width:640px){.grid{grid-template-columns:1fr}}
    h2{margin:6px 0 4px;font-size:12px;font-weight:600;color:#adb5bd;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:4px}
    .item{display:flex;align-items:center;gap:10px;padding:5px 0;cursor:pointer}
    .item input{display:none}
    .sw{width:34px;height:20px;border-radius:10px;background:#4a4f55;position:relative;flex:none;transition:background .15s}
    .sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
    .item input:checked+.sw{background:#2f9bf5}
    .item input:checked+.sw::after{transform:translateX(14px)}
    select{width:100%;background:#2b3035;color:#e9ecef;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:7px 9px;font-size:13px;margin:4px 0 6px}
    select.sm{width:auto;margin:0;padding:5px 8px;font-size:12px}
    .pf{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px 18px;border-top:1px solid rgba(255,255,255,.08);color:#9aa0a6;font-size:12px}
    .btn{background:#2b3035;color:#e9ecef;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px}
    .btn:hover{background:#343a40}
    .btn.pri{background:#1c6fc2;border-color:#1c6fc2}
    .note{color:#9aa0a6;font-size:11.5px;margin:4px 0}
    .ctool{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px 18px 8px}
    .clist{margin:0 18px;background:#14171a;border:1px solid rgba(255,255,255,.1);border-radius:8px;height:46vh;min-height:220px;overflow:auto;padding:6px 8px;font:11.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;user-select:text}
    .ln{white-space:pre-wrap;word-break:break-word}
    .ln.debug{color:#6c757d}.ln.info{color:#ced4da}.ln.warn{color:#ffc107}.ln.error{color:#ff6b6b}
    .cfoot{padding:8px 18px 14px;color:#9aa0a6;font-size:11.5px}
    `;

    const FEATURES_MAIN = [
        ['noReels', 'Disable the Reels page & Reels videos'],
        ['noExplore', 'Disable the Explore page'],
        ['hideStories', 'Hide the Stories section (Main page)'],
        ['noStories', 'Disable Stories everywhere'],
        ['grayLabels', 'Make "New messages" labels gray'],
        ['noLabels', 'Disable "New messages" labels'],
        ['noRecs', 'Disable recommendations (Main page)'],
        ['goDirect', 'Navigate to Direct from the Main page'],
        ['noThreads', 'Hide Threads button'],
        ['noFeed', 'Disable Feed (experimental)']
    ];
    const FEATURES_EXTRA = [
        ['noVanity', 'Disable likes and follower counts (vanity metrics)'],
        ['grayscale', 'Enable grayscale mode (experimental)'],
        ['square', 'Make everything square-shaped'],
        ['blockVideos', 'Block all videos to reduce traffic usage'],
        ['blockImages', 'Block all images to reduce traffic usage'],
        ['noComments', 'Disable Comments (experimental)'],
        ['noNotes', 'Disable Notes (experimental)']
    ];
    const FEATURES_OPT = [
        ['skipAds', 'Auto-skip sponsored Reels'],
        ['hideAds', 'Hide sponsored posts in Feed'],
        ['turbo', 'Turbo Reels scroll: wheel = instant next/prev (experimental)'],
        ['optimizer', 'Reels optimizer engine'],
        ['safePause', 'Safe off-screen video pause'],
        ['gpu', 'Adaptive GPU optimization'],
        ['hud', 'Show HUD'],
        ['debug', 'Verbose debug logging (also prints to F12 console)']
    ];

    function h(tag, attrs) {
        const e = document.createElement(tag);
        if (attrs) for (const k in attrs) {
            const v = attrs[k];
            if (k === 'class') e.className = v;
            else if (k === 'text') e.textContent = v;
            else e.setAttribute(k, v);
        }
        for (let i = 2; i < arguments.length; i++) if (arguments[i]) e.append(arguments[i]);
        return e;
    }
    async function copyText(txt) {
        try { await navigator.clipboard.writeText(txt); return true; }
        catch (_) {
            try {
                const ta = document.createElement('textarea');
                ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0';
                document.body.appendChild(ta); ta.select();
                const ok = document.execCommand('copy'); ta.remove(); return ok;
            } catch (__) { return false; }
        }
    }

    let ui = null;
    const inputs = {};
    let modeSelEl = null;

    function setKey(key, val) {
        const prev = S[key];
        S[key] = val;
        saveSettings();
        if (prev !== val) applyAll(key);
    }
    function syncInputs() {
        for (const k in inputs) inputs[k].checked = !!S[k];
        if (modeSelEl) modeSelEl.value = S.mode;
    }
    function updateBadge() {
        if (!ui || !ui.bug) return;
        ui.bug.textContent = '🐞' + (stats.errors ? ' ' + stats.errors : '');
        ui.bug.style.color = stats.errors ? '#ff6b6b' : (stats.warns ? '#ffc107' : '');
    }

    function mountUI() {
        if (ui || !document.documentElement) return;
        const host = h('div', { id: 'igp-host' });
        host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
        const root = host.attachShadow({ mode: 'open' });
        root.append(h('style', { text: UI_CSS }));

        /* HUD */
        const vals = {};
        const mkRow = (k, label) => { const b = h('b', { text: '–' }); vals[k] = b; return h('div', { class: 'row' }, h('span', { text: label }), b); };
        const tt = h('span', { text: 'IG Beast' });
        const mini = h('span', { class: 'mini' });
        const gear = h('button', { class: 'ib', title: 'Settings (Alt+Shift+O)', text: '⚙' });
        const bug = h('button', { class: 'ib', title: 'Console (Alt+Shift+D)', text: '🐞' });
        const title = h('div', { class: 'title' }, h('span', { class: 'dot' }), tt, mini, h('span', { class: 'btns' }, bug, gear));
        const legacyEl = h('div', { class: 'legacy hidden', text: '⚠ Old V5 script is running. Disable it in Tampermonkey!' });
        const rows = h('div', { class: 'rows' },
            mkRow('heap', 'JS Heap'), mkRow('active', 'Active videos'), mkRow('observed', 'Observed'),
            mkRow('paused', 'Paused'), mkRow('queue', 'Preload queue'), mkRow('ads', 'Ads skipped'), mkRow('status', 'Status'));
        const hud = h('div', { class: 'hud' }, title, rows, legacyEl);
        if (S.hudX != null && S.hudY != null) {
            hud.style.left = S.hudX + 'px'; hud.style.top = S.hudY + 'px';
            hud.style.right = 'auto'; hud.style.bottom = 'auto';
        }
        let drag = null;
        title.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.ib')) return;
            const r = hud.getBoundingClientRect();
            drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
            try { title.setPointerCapture(e.pointerId); } catch (_) {}
        });
        title.addEventListener('pointermove', (e) => {
            if (!drag) return;
            if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
            if (!drag.moved) return;
            const x = Math.max(0, Math.min(window.innerWidth - hud.offsetWidth, e.clientX - drag.dx));
            const y = Math.max(0, Math.min(window.innerHeight - hud.offsetHeight, e.clientY - drag.dy));
            hud.style.left = x + 'px'; hud.style.top = y + 'px';
            hud.style.right = 'auto'; hud.style.bottom = 'auto';
        });
        title.addEventListener('pointerup', () => {
            if (!drag) return;
            if (drag.moved) { S.hudX = parseInt(hud.style.left, 10); S.hudY = parseInt(hud.style.top, 10); saveSettings(); }
            else { S.hudMin = !S.hudMin; saveSettings(); renderHud(); }
            drag = null;
        });

        /* Settings tab */
        const toggle = (key, label) => {
            const i = h('input', { type: 'checkbox' });
            i.checked = !!S[key];
            i.addEventListener('change', () => setKey(key, i.checked));
            inputs[key] = i;
            return h('label', { class: 'item' }, i, h('span', { class: 'sw' }), h('span', { text: label }));
        };
        const modeSel = h('select');
        [['auto', 'Auto (recommended)'], ['light', 'Light (low RAM devices)'], ['balanced', 'Balanced'], ['performance', 'Performance']]
            .forEach(([v, t]) => modeSel.append(h('option', { value: v, text: t })));
        modeSel.value = S.mode;
        modeSel.addEventListener('change', () => setKey('mode', modeSel.value));
        modeSelEl = modeSel;

        const col1 = h('div', null, h('h2', { text: 'Main Features' }), ...FEATURES_MAIN.map((f) => toggle(f[0], f[1])));
        const col2 = h('div', null, h('h2', { text: 'Additional Features' }), ...FEATURES_EXTRA.map((f) => toggle(f[0], f[1])),
            h('h2', { text: 'Reels Engine & Debug' }), h('div', { class: 'note', text: 'Performance mode' }), modeSel,
            ...FEATURES_OPT.map((f) => toggle(f[0], f[1])));

        const reset = h('button', { class: 'btn', text: 'Reset all' });
        reset.addEventListener('click', () => { S = Object.assign({}, DEFAULTS); saveSettings(); syncInputs(); applyAll('reset'); });
        const exp = h('button', { class: 'btn', text: 'Export' });
        exp.addEventListener('click', async () => { const ok = await copyText(JSON.stringify(S)); L(ok ? 'info' : 'warn', 'ui', ok ? 'Settings copied to clipboard' : 'Could not copy settings'); });
        const imp = h('button', { class: 'btn', text: 'Import' });
        imp.addEventListener('click', () => {
            const txt = window.prompt('Paste exported settings JSON:');
            if (!txt) return;
            try {
                const o = JSON.parse(txt);
                for (const k in DEFAULTS) if (k in o && (DEFAULTS[k] === null || typeof o[k] === typeof DEFAULTS[k])) S[k] = o[k];
                saveSettings(); syncInputs(); applyAll('import');
            } catch (err) { L('error', 'ui', 'Import failed: ' + err.message); }
        });
        const bodySet = h('div', null,
            h('div', { class: 'grid' }, col1, col2),
            h('div', { class: 'pf' }, h('span', { text: 'Alt+Shift+O settings · Alt+Shift+D console · some changes need a page refresh' }),
                h('span', { class: 'btns' }, exp, imp, reset)));

        /* Console tab */
        let minLevel = 'info';
        const conList = h('div', { class: 'clist' });
        const lvlSel = h('select', { class: 'sm' });
        [['debug', 'All (debug)'], ['info', 'Info+'], ['warn', 'Warnings+'], ['error', 'Errors only']].forEach(([v, t]) => lvlSel.append(h('option', { value: v, text: t })));
        lvlSel.value = minLevel;
        const bTest = h('button', { class: 'btn pri', text: 'Self-test' });
        const bFps = h('button', { class: 'btn', text: 'FPS test (3s)' });
        const bCopy = h('button', { class: 'btn', text: 'Copy log' });
        const bSave = h('button', { class: 'btn', text: 'Download' });
        const bClear = h('button', { class: 'btn', text: 'Clear' });
        const bodyCon = h('div', { class: 'hidden' },
            h('div', { class: 'ctool' }, lvlSel, bTest, bFps, bCopy, bSave, bClear),
            conList,
            h('div', { class: 'cfoot', text: 'Something not working? Press Self-test, then "Copy log" and send it. Turn on "Verbose debug logging" in Settings for more detail.' }));

        let panelOpen = false, tab = 'set';
        const lineEl = (e) => { const el = h('div', { class: 'ln ' + e.level }); el.textContent = fmtLine(e); return el; };
        const conVisible = () => panelOpen && tab === 'con';
        consoleUI = {
            push(e) {
                if (e.level === 'warn' || e.level === 'error') updateBadge();
                if (!conVisible() || LV[e.level] < LV[minLevel]) return;
                const near = conList.scrollHeight - conList.scrollTop - conList.clientHeight < 40;
                conList.append(lineEl(e));
                while (conList.childElementCount > 400) conList.firstChild.remove();
                if (near) conList.scrollTop = conList.scrollHeight;
            },
            renderAll() {
                conList.textContent = '';
                const frag = document.createDocumentFragment();
                for (const e of logs.slice(-400)) if (LV[e.level] >= LV[minLevel]) frag.append(lineEl(e));
                conList.append(frag);
                conList.scrollTop = conList.scrollHeight;
            }
        };
        lvlSel.addEventListener('change', () => { minLevel = lvlSel.value; consoleUI.renderAll(); });
        bTest.addEventListener('click', () => selfTest());
        bFps.addEventListener('click', () => fpsTest());
        bClear.addEventListener('click', () => { logs.length = 0; stats.errors = 0; stats.warns = 0; updateBadge(); consoleUI.renderAll(); });
        bCopy.addEventListener('click', async () => {
            const ok = await copyText(reportHeader() + logs.map(fmtLine).join('\n'));
            L(ok ? 'info' : 'warn', 'ui', ok ? 'Log copied to clipboard (' + logs.length + ' lines)' : 'Copy failed. Use Download instead.');
        });
        bSave.addEventListener('click', () => {
            try {
                const blob = new Blob([reportHeader() + logs.map(fmtLine).join('\n')], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob); a.download = 'ig-beast-log-' + Date.now() + '.txt';
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(a.href), 2000);
                L('info', 'ui', 'Log downloaded');
            } catch (err) { L('error', 'ui', 'Download failed: ' + err.message); }
        });

        /* Panel shell */
        const tabSet = h('button', { class: 'tab on', text: 'Settings' });
        const tabCon = h('button', { class: 'tab', text: 'Console' });
        const close = h('button', { class: 'ib', text: '✕', title: 'Close' });
        const veil = h('div', { class: 'veil' });
        const panel = h('div', { class: 'panel' },
            h('div', { class: 'ph' }, h('div', null, h('h1', { text: 'Instagram Beast Optimizer V' + VERSION + ' PRO' }),
                h('p', { text: 'Less distraction, smoother Reels, lower traffic. Created by Ajmaine Al Arafat' })), close),
            h('div', { class: 'tabs' }, tabSet, tabCon), bodySet, bodyCon);
        veil.append(panel);
        const showTab = (name) => {
            tab = name;
            tabSet.classList.toggle('on', name === 'set'); tabCon.classList.toggle('on', name === 'con');
            bodySet.classList.toggle('hidden', name !== 'set'); bodyCon.classList.toggle('hidden', name !== 'con');
            if (name === 'con') consoleUI.renderAll();
        };
        const openPanel = (open, which) => {
            panelOpen = open === undefined ? !panelOpen : open;
            veil.classList.toggle('open', panelOpen);
            if (panelOpen) showTab(which || tab);
        };
        tabSet.addEventListener('click', () => showTab('set'));
        tabCon.addEventListener('click', () => showTab('con'));
        gear.addEventListener('click', (e) => { e.stopPropagation(); openPanel(undefined, 'set'); });
        bug.addEventListener('click', (e) => { e.stopPropagation(); openPanel(true, 'con'); });
        close.addEventListener('click', () => openPanel(false));
        veil.addEventListener('click', (e) => { if (e.target === veil) openPanel(false); });
        window.addEventListener('keydown', (e) => {
            if (e.altKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); openPanel(panelOpen && tab === 'set' ? false : true, 'set'); }
            else if (e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) { e.preventDefault(); openPanel(panelOpen && tab === 'con' ? false : true, 'con'); }
            else if (e.key === 'Escape' && panelOpen) openPanel(false);
        }, true);

        root.append(hud, veil);
        document.documentElement.appendChild(host);
        ui = { hud, tt, mini, vals, bug, legacyEl };
        updateBadge();
        renderHud();
        L('info', 'ui', 'UI mounted');
    }

    function renderHud() {
        if (!ui) return;
        const onReels = route === 'reels';
        ui.hud.style.display = S.hud ? '' : 'none';
        ui.hud.classList.toggle('off', !onReels || S.hudMin);
        ui.legacyEl.classList.toggle('hidden', !legacy);
        ui.tt.textContent = onReels ? 'Reels Optimizer' : 'IG Beast';
        updateHud();
    }
    const updateHud = safe('hud', function () {
        if (!ui || !S.hud) return;
        const heap = heapStr();
        ui.mini.textContent = route === 'reels' ? heap : '';
        if (route !== 'reels' || S.hudMin) return;
        let active = 0, paused = 0;
        observed.forEach((v) => { if (v.paused) paused++; else active++; });
        ui.vals.heap.textContent = heap;
        ui.vals.active.textContent = String(active);
        ui.vals.observed.textContent = String(observed.size);
        ui.vals.paused.textContent = String(paused) + (pausedTotal ? ' (' + pausedTotal + ' auto)' : '');
        ui.vals.queue.textContent = String(preloadQ.size);
        ui.vals.ads.textContent = S.skipAds ? String(stats.adSkipped) : 'off';
        ui.vals.status.textContent = reelsEngineOn() ? 'Active · ' + curMode : 'Off';
    });

    /* ───────────────────────── Apply / Init ───────────────────────── */
    const applyAll = safe('apply', function (changedKey) {
        domRulesActive = computeDomActive();
        if (styleEl) styleEl.textContent = buildCss();
        if (!S.blockImages) restoreImages();
        if (!reelsEngineOn()) teardownOptimizer();
        else {
            if (!S.optimizer) resetVideoState();
            if (changedKey === 'mode' || changedKey === 'reset' || changedKey === 'import') { curMode = resolveMode(); if (io) buildIO(); }
        }
        syncTurbo();
        onRoute(true);
        renderHud();
        schedule();
        L('info', 'settings', 'changed: ' + changedKey + (changedKey in S ? ' = ' + S[changedKey] : ''));
    });

    function init() {
        styleEl = document.createElement('style');
        styleEl.id = 'igp-style';
        (document.head || document.documentElement).appendChild(styleEl);
        domRulesActive = computeDomActive();
        styleEl.textContent = buildCss();
        curMode = resolveMode();

        L('info', 'boot', 'V' + VERSION + ' started | ' + navigator.userAgent.slice(0, 110));
        L('info', 'boot', 'enabled: ' + Object.keys(S).filter((k) => S[k] === true).join(', '));

        const origPush = history.pushState, origReplace = history.replaceState;
        history.pushState = function () { const r = origPush.apply(this, arguments); navCount++; onRoute(); return r; };
        history.replaceState = function () { const r = origReplace.apply(this, arguments); onRoute(); return r; };
        window.addEventListener('popstate', () => { navCount++; onRoute(); });

        document.addEventListener('click', (e) => {
            if (!S.noStories) return;
            const a = e.target && e.target.closest && e.target.closest('a[href^="/stories/"]');
            if (a) { e.preventDefault(); e.stopPropagation(); L('debug', 'dom', 'blocked story link click'); }
        }, true);

        new MutationObserver(() => {
            if (domRulesActive || (route === 'reels' && reelsEngineOn())) schedule();
        }).observe(document.documentElement, { childList: true, subtree: true });

        onRoute(true);

        const boot = () => { mountUI(); schedule(); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else boot();
        [1500, 4000, 10000].forEach((ms) => setTimeout(checkLegacy, ms));

        setInterval(safe('tick', function () {
            if (document.hidden) return;
            if (route === 'reels' && reelsEngineOn()) {
                pruneDetached();
                if (S.optimizer && S.mode === 'auto') {
                    const m = resolveMode();
                    if (m !== curMode) { curMode = m; if (io) buildIO(); L('info', 'opt', 'auto mode → ' + m); }
                }
            }
            updateHud();
        }), 2000);
    }

    init();
})();
