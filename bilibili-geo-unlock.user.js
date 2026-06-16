// ==UserScript==
// @name         Bilibili 港澳台/海外区域解锁 (Geo Unlock)
// @name:en      Bilibili Geo Unlock (大会员 / Bangumi)
// @namespace    https://github.com/realzza/bilibili-geo-unlock
// @version      1.0.0
// @description  解除 Bilibili 番剧/影视/大会员视频的地区版权限制（"非常抱歉，根据版权要求，您所在的地区无法观看本片"）。通过把 playurl 接口请求转发到位于解锁区域的反向代理服务器实现。专为 Safari (Userscripts / Tampermonkey) 适配。
// @description:en Unblock region-locked Bilibili bangumi / VIP videos from overseas by routing the playurl API through an in-region reverse proxy. Tuned for Safari userscript managers.
// @author       realzza
// @license      MIT
// @match        https://www.bilibili.com/*
// @match        https://www.biliintl.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_registerMenuCommand
// @connect      *
// @noframes
// ==/UserScript==

/*
 * HOW IT WORKS
 * ------------
 * When you open a region-locked title, Bilibili's web player calls a "playurl"
 * API (e.g. https://api.bilibili.com/pgc/player/web/v2/playurl?...). From a US
 * IP that call returns code -10403 ("您所在的地区无法观看本片"), so the player
 * shows the grey "sorry" overlay.
 *
 * This script intercepts those playurl calls. It first lets the real request
 * go through; only if the response is a region-limit error does it re-issue the
 * SAME url (signing/params preserved) against a reverse-proxy server you
 * configure — a server that sits in an unblocked region and answers with a
 * normal, playable response. The proxy's reply is handed back to the player in
 * place of the error, and the video plays.
 *
 * A userscript by itself cannot change your IP, so a working in-region proxy is
 * REQUIRED. See the README for trusted public servers and how to self-host one.
 */

(function () {
    'use strict';

    // ----- defaults & constants -----------------------------------------
    const NS = 'bgu';                       // storage key prefix
    const DEFAULTS = {
        // Reverse proxy that mirrors api.bilibili.com paths from an unblocked
        // region. Change this in the settings panel (gear button, bottom-right)
        // or via the userscript manager menu command.
        server: 'https://bili.tuturu.top',
        // Optional access_key, appended to proxied requests. Only needed for
        // some proxies / for 大会员-exclusive titles. Leave blank otherwise.
        access_key: '',
        // Force-proxy every playurl, even ones that weren't blocked. Off by
        // default so normal videos stay direct (faster, no proxy dependency).
        always: false,
        enabled: true,
    };

    // playurl endpoints we care about (pgc = 番剧/影视/课程)
    const PLAYURL_RE = /\/pgc\/player\/(web|api)\/(v2\/)?playurl/i;
    // also unblock the season/view payload occasionally needed for the EP list
    const SEASON_RE = /\/pgc\/view\/web\/season/i;

    // region-limit signatures in a playurl response
    const LIMIT_CODES = new Set([-10403, -10500, -688, -689]);
    const LIMIT_TEXT_RE = /(地区|區域|区域|版权|版權|地區).*(观看|觀看|播放)|无法观看本片|無法觀看本片|not available in your (area|region)/i;

    // ----- tiny logger ---------------------------------------------------
    const log = (...a) => console.log('%c[geo-unlock]', 'color:#fb7299;font-weight:bold', ...a);

    // ----- cross-manager storage shim (Tampermonkey GM_* / Userscripts GM.*)
    const hasGM = typeof GM !== 'undefined';
    const store = {
        async get(k, d) {
            try {
                if (hasGM && GM.getValue) return await GM.getValue(NS + '_' + k, d);
                if (typeof GM_getValue === 'function') return GM_getValue(NS + '_' + k, d);
            } catch (e) { /* fall through */ }
            try {
                const v = localStorage.getItem(NS + '_' + k);
                return v === null ? d : JSON.parse(v);
            } catch (e) { return d; }
        },
        async set(k, v) {
            try {
                if (hasGM && GM.setValue) return await GM.setValue(NS + '_' + k, v);
                if (typeof GM_setValue === 'function') return GM_setValue(NS + '_' + k, v);
            } catch (e) { /* fall through */ }
            try { localStorage.setItem(NS + '_' + k, JSON.stringify(v)); } catch (e) {}
        },
    };

    // ----- cross-manager cross-origin GET --------------------------------
    function gmGet(url) {
        return new Promise((resolve, reject) => {
            const fn = (hasGM && GM.xmlHttpRequest) ? GM.xmlHttpRequest
                : (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest
                : null;
            if (!fn) { reject(new Error('NO_GM_XHR')); return; }
            fn({
                method: 'GET',
                url,
                timeout: 15000,
                onload: (r) => (r.status >= 200 && r.status < 400)
                    ? resolve(r.responseText)
                    : reject(new Error('proxy HTTP ' + r.status)),
                onerror: () => reject(new Error('proxy network error')),
                ontimeout: () => reject(new Error('proxy timeout')),
            });
        });
    }

    // Last-resort path when no GM xhr exists (e.g. a very limited manager):
    // try a plain CORS fetch. Works only if the proxy sets CORS headers.
    async function corsGet(url) {
        const r = await NATIVE_FETCH(url, { credentials: 'omit', cache: 'no-store' });
        if (!r.ok) throw new Error('proxy HTTP ' + r.status);
        return await r.text();
    }

    async function proxyGet(url) {
        try { return await gmGet(url); }
        catch (e) {
            if (e && e.message === 'NO_GM_XHR') return await corsGet(url);
            throw e;
        }
    }

    // ----- config (loaded async, kept in CONFIG) -------------------------
    const CONFIG = Object.assign({}, DEFAULTS);
    (async () => {
        for (const k of Object.keys(DEFAULTS)) {
            CONFIG[k] = await store.get(k, DEFAULTS[k]);
        }
        log('config', { server: CONFIG.server, hasKey: !!CONFIG.access_key, always: CONFIG.always, enabled: CONFIG.enabled });
    })();

    // ----- helpers -------------------------------------------------------
    function isTargetUrl(url) {
        return typeof url === 'string' && (PLAYURL_RE.test(url) || (CONFIG.always && SEASON_RE.test(url)));
    }

    function isAreaLimited(text) {
        if (!text) return false;
        let j;
        try { j = JSON.parse(text); } catch (e) { return false; }
        if (LIMIT_CODES.has(j.code)) return true;
        if (j.code !== 0 && typeof j.message === 'string' && LIMIT_TEXT_RE.test(j.message)) return true;
        // some responses nest the error under result/data
        const inner = j.result || j.data;
        if (inner && LIMIT_CODES.has(inner.code)) return true;
        return false;
    }

    function buildProxyUrl(originalUrl) {
        const u = new URL(originalUrl, location.href);
        const base = new URL(CONFIG.server);
        u.protocol = base.protocol;
        u.host = base.host;
        // preserve any base path on the proxy (e.g. https://host/bili)
        if (base.pathname && base.pathname !== '/') {
            u.pathname = base.pathname.replace(/\/$/, '') + u.pathname;
        }
        if (CONFIG.access_key && !u.searchParams.has('access_key')) {
            u.searchParams.set('access_key', CONFIG.access_key);
        }
        return u.toString();
    }

    // Given the original (failed/raw) url, return unblocked JSON text or null.
    async function unblock(originalUrl) {
        if (!CONFIG.enabled) return null;
        try {
            const proxied = buildProxyUrl(originalUrl);
            log('proxying ->', proxied);
            const text = await proxyGet(proxied);
            // if the proxy itself returns a limit error, treat as failure
            if (isAreaLimited(text)) { log('proxy still region-limited'); return null; }
            return text;
        } catch (e) {
            log('proxy failed:', e.message);
            return null;
        }
    }

    // Keep a pristine fetch before we (and the page) touch it.
    const NATIVE_FETCH = window.fetch.bind(window);

    // ----- hook: fetch ---------------------------------------------------
    const origFetch = window.fetch;
    window.fetch = async function (input, init) {
        let url;
        try { url = (typeof input === 'string') ? input : (input && input.url); } catch (e) {}
        if (!isTargetUrl(url)) return origFetch.apply(this, arguments);

        const res = await origFetch.apply(this, arguments);
        try {
            const text = await res.clone().text();
            if (CONFIG.always || isAreaLimited(text)) {
                const fixed = await unblock(url);
                if (fixed) {
                    log('fetch unblocked');
                    return new Response(fixed, {
                        status: 200,
                        statusText: 'OK',
                        headers: { 'content-type': 'application/json; charset=utf-8' },
                    });
                }
            }
        } catch (e) { log('fetch hook error', e); }
        return res;
    };

    // ----- hook: XMLHttpRequest -----------------------------------------
    const XHR = XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    const origSend = XHR.send;

    XHR.open = function (method, url) {
        this.__bgu_url = url;
        this.__bgu_target = isTargetUrl(url);
        return origOpen.apply(this, arguments);
    };

    XHR.send = function (body) {
        if (!this.__bgu_target) return origSend.apply(this, arguments);

        const xhr = this;
        // Run the original request out-of-band so we can inspect/replace it.
        proxyOrPassXhr(xhr).catch((e) => log('xhr hook error', e));
        return; // swallow original send; we drive completion ourselves
    };

    async function proxyOrPassXhr(xhr) {
        const url = xhr.__bgu_url;
        let raw = '';
        try {
            raw = await proxyOriginalViaFetch(url, xhr);
        } catch (e) {
            // fall back to a normal send if our shadow request failed entirely
            log('shadow request failed, falling back to native send');
            origSend.call(xhr);
            return;
        }

        let out = raw;
        if (CONFIG.always || isAreaLimited(raw)) {
            const fixed = await unblock(url);
            if (fixed) { out = fixed; log('xhr unblocked'); }
        }
        deliverXhr(xhr, out);
    }

    // Issue the *original* request (with the page's cookies) via native fetch,
    // returning its body text. We use fetch so we don't recurse into our XHR hook.
    async function proxyOriginalViaFetch(url, xhr) {
        const r = await NATIVE_FETCH(url, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
        });
        return await r.text();
    }

    // Make a hooked XHR look "done" with the given responseText.
    function deliverXhr(xhr, text) {
        const define = (prop, val) => {
            try { Object.defineProperty(xhr, prop, { configurable: true, get: () => val }); }
            catch (e) { /* some props are non-configurable; ignore */ }
        };
        define('readyState', 4);
        define('status', 200);
        define('statusText', 'OK');
        define('responseText', text);
        define('response', xhr.responseType === 'json' ? safeJson(text) : text);
        define('responseURL', xhr.__bgu_url);
        try { xhr.getAllResponseHeaders = () => 'content-type: application/json; charset=utf-8\r\n'; } catch (e) {}
        try { xhr.getResponseHeader = () => 'application/json; charset=utf-8'; } catch (e) {}

        const fire = (type) => {
            const ev = new Event(type);
            try { xhr.dispatchEvent(ev); } catch (e) {}
            const h = xhr['on' + type];
            if (typeof h === 'function') { try { h.call(xhr, ev); } catch (e) {} }
        };
        fire('readystatechange');
        fire('load');
        fire('loadend');
    }

    function safeJson(t) { try { return JSON.parse(t); } catch (e) { return t; } }

    // ----- settings UI ---------------------------------------------------
    async function openSettings() {
        // pull freshest values
        for (const k of Object.keys(DEFAULTS)) CONFIG[k] = await store.get(k, DEFAULTS[k]);

        const server = window.prompt(
            '【Bilibili 区域解锁】反向代理服务器地址\n' +
            '(必须位于解锁区域，如港澳台/大陆。留空恢复默认)\n\n' +
            '当前: ' + CONFIG.server,
            CONFIG.server
        );
        if (server === null) return; // cancelled
        const access = window.prompt(
            '【可选】access_key (大会员专享内容/部分代理需要，没有就留空):',
            CONFIG.access_key || ''
        );
        if (access === null) return;

        await store.set('server', (server.trim() || DEFAULTS.server));
        await store.set('access_key', access.trim());
        CONFIG.server = server.trim() || DEFAULTS.server;
        CONFIG.access_key = access.trim();
        alert('已保存。请刷新页面以生效。\n服务器: ' + CONFIG.server);
    }

    function injectGearButton() {
        if (document.getElementById('bgu-gear')) return;
        const btn = document.createElement('div');
        btn.id = 'bgu-gear';
        btn.title = 'Bilibili 区域解锁设置';
        btn.textContent = '🌏';
        Object.assign(btn.style, {
            position: 'fixed', right: '14px', bottom: '14px', zIndex: 2147483647,
            width: '40px', height: '40px', lineHeight: '40px', textAlign: 'center',
            fontSize: '20px', cursor: 'pointer', borderRadius: '50%',
            background: 'rgba(251,114,153,0.92)', color: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,.3)', userSelect: 'none',
        });
        btn.addEventListener('click', openSettings);
        document.body.appendChild(btn);
    }

    function ready(fn) {
        if (document.body) fn();
        else document.addEventListener('DOMContentLoaded', fn, { once: true });
    }
    ready(injectGearButton);

    // userscript-manager menu commands (Tampermonkey & newer Userscripts)
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('⚙️ 设置代理服务器 / access_key', openSettings);
        GM_registerMenuCommand('🔁 始终走代理: 切换', async () => {
            const v = !(await store.get('always', false));
            await store.set('always', v); CONFIG.always = v;
            alert('始终走代理: ' + (v ? '开' : '关') + '\n刷新页面生效。');
        });
        GM_registerMenuCommand('⏯️ 启用/停用 解锁', async () => {
            const v = !(await store.get('enabled', true));
            await store.set('enabled', v); CONFIG.enabled = v;
            alert('解锁: ' + (v ? '启用' : '停用') + '\n刷新页面生效。');
        });
    }

    log('loaded. hooks installed at document-start.');
})();
