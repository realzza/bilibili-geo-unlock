// ==UserScript==
// @name         Bilibili 番剧区域解锁（自托管代理）
// @name:en      Bilibili Bangumi Geo Unlock (self-hosted proxy)
// @namespace    https://github.com/realzza/bilibili-geo-unlock
// @version      1.1.0
// @description  Route a region-blocked Bilibili PGC playurl response through your own in-region proxy. It does not unlock VIP entitlement.
// @description:zh 仅将番剧地区限制的 playurl 请求转发到你自己的区域内代理；不绕过大会员或付费内容权限。
// @author       realzza
// @license      MIT
// @match        https://www.bilibili.com/*
// @run-at       document-start
// @inject-into  page
// @grant        unsafeWindow
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
 * Why page-world injection matters
 * --------------------------------
 * Bilibili's current web player uses window.fetch() for
 * /pgc/player/web/v2/playurl. Safari userscript managers keep GM-enabled
 * scripts in an isolated world by default, where replacing window.fetch does
 * not affect the player. @inject-into page puts the interceptor in the same
 * world as the player. In Userscripts by quoid that also means GM APIs are not
 * available, so the configured proxy must expose the CORS headers documented
 * in this repository. Tampermonkey can use GM XHR when it is available.
 */

(function () {
    'use strict';

    const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const DOC = PAGE.document;
    const NATIVE_FETCH = PAGE.fetch.bind(PAGE);
    const NS = 'bgu';
    const DEFAULTS = Object.freeze({
        // No public endpoint is shipped. Configure a proxy you control.
        server: '',
        // Optional Bilibili access_key. Treat it like a password and only use
        // it with a private proxy you operate. Most free geo-blocked titles do
        // not need it; this script never reads or relays HttpOnly SESSDATA.
        accessKey: '',
        always: false,
        enabled: true,
    });
    const CONFIG = { ...DEFAULTS };

    const PLAYURL_RE = /\/pgc\/player\/(?:web\/(?:v2\/)?|api\/)playurl(?:\?|$)/i;
    const SEASON_RE = /\/pgc\/view\/web\/(?:simple\/)?season(?:\?|$)/i;
    const AREA_LIMIT_TEXT = /(所在.{0,8}(地區|地区|區域|区域)|地區.{0,12}(觀看|播放)|地区.{0,12}(观看|播放)|版權|版权|not available in (your )?(area|region))/i;

    const log = (...values) => console.log('%c[bili-geo-unlock]', 'color:#fb7299;font-weight:bold', ...values);

    function localKey(key) {
        return `${NS}_${key}`;
    }

    function readLocal(key, fallback) {
        try {
            const raw = PAGE.localStorage.getItem(localKey(key));
            return raw === null ? fallback : JSON.parse(raw);
        } catch (_) {
            return fallback;
        }
    }

    function writeLocal(key, value) {
        try {
            PAGE.localStorage.setItem(localKey(key), JSON.stringify(value));
        } catch (_) {
            // A disabled storage area should not stop direct Bilibili playback.
        }
    }

    function hasGMApi() {
        return (typeof GM !== 'undefined' && (GM.getValue || GM.xmlHttpRequest))
            || typeof GM_getValue === 'function' || typeof GM_xmlhttpRequest === 'function';
    }

    const store = {
        async get(key, fallback) {
            const storedLocally = readLocal(key, undefined);
            if (storedLocally !== undefined) return storedLocally;
            try {
                if (typeof GM !== 'undefined' && GM.getValue) return await GM.getValue(localKey(key), fallback);
                if (typeof GM_getValue === 'function') return GM_getValue(localKey(key), fallback);
            } catch (_) {
                // Fall through to the default when a manager's bridge is absent.
            }
            return fallback;
        },
        async set(key, value) {
            writeLocal(key, value);
            try {
                if (typeof GM !== 'undefined' && GM.setValue) await GM.setValue(localKey(key), value);
                else if (typeof GM_setValue === 'function') GM_setValue(localKey(key), value);
            } catch (_) {
                // localStorage is the durable page-world fallback.
            }
        },
    };

    // Read page-world storage synchronously: the player can request playurl
    // before an async GM storage bridge responds.
    for (const key of Object.keys(DEFAULTS)) CONFIG[key] = readLocal(key, DEFAULTS[key]);
    (async () => {
        for (const key of Object.keys(DEFAULTS)) CONFIG[key] = await store.get(key, CONFIG[key]);
        log('ready', { configured: Boolean(CONFIG.server), always: CONFIG.always, gm: hasGMApi() });
    })();

    function isTargetUrl(url) {
        return typeof url === 'string' && (PLAYURL_RE.test(url) || (CONFIG.always && SEASON_RE.test(url)));
    }

    function getUrl(input) {
        if (typeof input === 'string') return input;
        if (input && typeof input.url === 'string') return input.url;
        return '';
    }

    function containsAreaLimitPanel(value) {
        if (!value || typeof value !== 'object') return false;
        if (Array.isArray(value)) return value.some(containsAreaLimitPanel);
        if (value.name === 'AreaLimitPanel' && (value.config?.is_block || value.config?.isBlock)) return true;
        return Object.values(value).some(containsAreaLimitPanel);
    }

    function isAreaLimited(text) {
        if (!text) return false;
        try {
            const body = JSON.parse(text);
            // -10403 is also used for a VIP/login denial. Only proxy when the
            // response explicitly identifies a regional availability problem.
            const messages = [body.message, body.msg, body.data?.message, body.result?.message, body.raw?.message]
                .filter((value) => typeof value === 'string');
            return messages.some((message) => AREA_LIMIT_TEXT.test(message)) || containsAreaLimitPanel(body);
        } catch (_) {
            return AREA_LIMIT_TEXT.test(text);
        }
    }

    function proxyUrl(originalUrl) {
        if (!CONFIG.server) throw new Error('no proxy configured');
        const original = new URL(originalUrl, PAGE.location.href);
        const base = new URL(CONFIG.server);
        if (base.protocol !== 'https:') throw new Error('proxy must use HTTPS');
        original.protocol = base.protocol;
        original.host = base.host;
        if (base.pathname && base.pathname !== '/') {
            original.pathname = base.pathname.replace(/\/$/, '') + original.pathname;
        }
        if (CONFIG.accessKey && !original.searchParams.has('access_key')) {
            original.searchParams.set('access_key', CONFIG.accessKey);
        }
        return original.toString();
    }

    function redact(url) {
        try {
            const parsed = new URL(url);
            if (parsed.searchParams.has('access_key')) parsed.searchParams.set('access_key', 'REDACTED');
            return parsed.toString();
        } catch (_) {
            return url;
        }
    }

    function gmGet(url) {
        return new Promise((resolve, reject) => {
            const request = typeof GM !== 'undefined' && GM.xmlHttpRequest
                ? GM.xmlHttpRequest
                : typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null;
            if (!request) {
                reject(new Error('GM XHR unavailable'));
                return;
            }
            request({
                method: 'GET',
                url,
                timeout: 15_000,
                onload: (response) => response.status >= 200 && response.status < 400
                    ? resolve(response.responseText)
                    : reject(new Error(`proxy HTTP ${response.status}`)),
                onerror: () => reject(new Error('proxy network error')),
                ontimeout: () => reject(new Error('proxy timeout')),
            });
        });
    }

    async function requestProxy(url) {
        // In page-world Userscripts, only the CORS route is available. In a
        // Tampermonkey sandbox, GM XHR remains a useful compatibility fallback.
        if (hasGMApi()) {
            try {
                return await gmGet(url);
            } catch (error) {
                log('GM request failed; trying CORS fetch', error.message);
            }
        }
        const response = await NATIVE_FETCH(url, { credentials: 'omit', cache: 'no-store' });
        if (!response.ok) throw new Error(`proxy HTTP ${response.status}`);
        return response.text();
    }

    async function unblock(originalUrl) {
        if (!CONFIG.enabled || !CONFIG.server) return null;
        try {
            const proxied = proxyUrl(originalUrl);
            log('proxying', redact(proxied));
            const text = await requestProxy(proxied);
            if (isAreaLimited(text)) {
                log('proxy still reports a region limit');
                return null;
            }
            return text;
        } catch (error) {
            log('proxy failed', error.message);
            return null;
        }
    }

    // --- fetch: used by the current Bilibili web player ----------------
    const originalFetch = PAGE.fetch;
    PAGE.fetch = async function interceptedFetch(input, init) {
        const url = getUrl(input);
        if (!isTargetUrl(url) || !CONFIG.enabled || !CONFIG.server) {
            return originalFetch.apply(this, arguments);
        }
        const response = await originalFetch.apply(this, arguments);
        try {
            const originalText = await response.clone().text();
            if (CONFIG.always || isAreaLimited(originalText)) {
                const replacement = await unblock(url);
                if (replacement) {
                    return new Response(replacement, {
                        status: 200,
                        statusText: 'OK',
                        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
                    });
                }
            }
        } catch (error) {
            log('fetch hook error', error.message);
        }
        return response;
    };

    // --- XMLHttpRequest: retained for older player bundles --------------
    const XHR = PAGE.XMLHttpRequest?.prototype;
    if (XHR) {
        const originalOpen = XHR.open;
        const originalSend = XHR.send;
        const originalSetRequestHeader = XHR.setRequestHeader;

        XHR.open = function interceptedOpen(method, url) {
            this.__bgu = {
                method: String(method || 'GET').toUpperCase(),
                url: getUrl(url),
                headers: {},
                target: isTargetUrl(getUrl(url)),
            };
            return originalOpen.apply(this, arguments);
        };

        XHR.setRequestHeader = function interceptedHeader(name, value) {
            if (this.__bgu) this.__bgu.headers[name] = value;
            return originalSetRequestHeader.apply(this, arguments);
        };

        XHR.send = function interceptedSend(body) {
            const state = this.__bgu;
            if (!state?.target || !CONFIG.enabled || !CONFIG.server || state.method !== 'GET') {
                return originalSend.apply(this, arguments);
            }
            replayXhr(this, state, body).catch((error) => {
                log('XHR hook error; falling back to the original request', error.message);
                originalSend.call(this, body);
            });
            return undefined;
        };
    }

    async function replayXhr(xhr, state) {
        const original = await NATIVE_FETCH(state.url, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
        });
        const originalText = await original.text();
        const replacement = (CONFIG.always || isAreaLimited(originalText)) ? await unblock(state.url) : null;
        deliverXhr(xhr, replacement || originalText, original.status, original.statusText);
    }

    function deliverXhr(xhr, text, status = 200, statusText = 'OK') {
        const define = (property, value) => {
            try {
                Object.defineProperty(xhr, property, { configurable: true, get: () => value });
            } catch (_) {
                // Older browser implementations expose non-configurable fields.
            }
        };
        define('readyState', 4);
        define('status', status);
        define('statusText', statusText || 'OK');
        define('responseText', text);
        define('response', xhr.responseType === 'json' ? safeJson(text) : text);
        define('responseURL', xhr.__bgu?.url || '');
        try { xhr.getAllResponseHeaders = () => 'content-type: application/json; charset=utf-8\r\n'; } catch (_) {}
        try { xhr.getResponseHeader = () => 'application/json; charset=utf-8'; } catch (_) {}
        for (const type of ['readystatechange', 'load', 'loadend']) {
            const event = new Event(type);
            xhr.dispatchEvent(event);
            const handler = xhr[`on${type}`];
            if (typeof handler === 'function') handler.call(xhr, event);
        }
    }

    function safeJson(text) {
        try { return JSON.parse(text); } catch (_) { return text; }
    }

    async function openSettings() {
        const server = PAGE.prompt(
            'Bilibili 番剧区域解锁\n\n输入你自己部署的 HTTPS 代理地址（留空关闭代理）：',
            CONFIG.server,
        );
        if (server === null) return;
        const normalized = server.trim().replace(/\/$/, '');
        if (normalized) {
            try {
                if (new URL(normalized).protocol !== 'https:') throw new Error('HTTPS only');
            } catch (_) {
                PAGE.alert('代理地址必须是有效的 HTTPS URL。');
                return;
            }
        }
        const accessKey = PAGE.prompt(
            '可选：Bilibili access_key（仅限你自己控制的私有代理；留空即可）：',
            CONFIG.accessKey,
        );
        if (accessKey === null) return;
        CONFIG.server = normalized;
        CONFIG.accessKey = accessKey.trim();
        await store.set('server', CONFIG.server);
        await store.set('accessKey', CONFIG.accessKey);
        PAGE.alert(CONFIG.server
            ? '已保存。刷新当前番剧页面后生效。'
            : '代理已关闭。刷新页面后恢复 Bilibili 默认行为。');
    }

    function injectSettingsButton() {
        if (DOC.getElementById('bgu-settings')) return;
        const button = DOC.createElement('button');
        button.id = 'bgu-settings';
        button.type = 'button';
        button.title = 'Bilibili 区域解锁设置';
        button.textContent = '🌏';
        Object.assign(button.style, {
            position: 'fixed', right: '14px', bottom: '14px', zIndex: 2147483647,
            width: '40px', height: '40px', border: '0', borderRadius: '50%',
            background: 'rgba(251,114,153,.94)', color: '#fff', fontSize: '20px',
            cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.3)',
        });
        button.addEventListener('click', openSettings);
        DOC.body.appendChild(button);
    }

    if (DOC.body) injectSettingsButton();
    else DOC.addEventListener('DOMContentLoaded', injectSettingsButton, { once: true });

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('🌏 设置 Bilibili 区域代理', openSettings);
    }

    log('page-world hooks installed');
})();
