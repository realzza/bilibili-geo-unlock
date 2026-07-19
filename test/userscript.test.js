'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class MockResponse {
    constructor(body, options = {}) {
        this.body = String(body);
        this.status = options.status ?? 200;
        this.statusText = options.statusText ?? 'OK';
        this.ok = this.status >= 200 && this.status < 300;
        this.headers = options.headers || {};
    }

    clone() {
        return new MockResponse(this.body, { status: this.status, statusText: this.statusText, headers: this.headers });
    }

    async text() {
        return this.body;
    }
}

function createRuntime({ server = 'https://proxy.example/bili', accessKey = '', response }) {
    const stored = new Map(Object.entries({
        bgu_server: JSON.stringify(server),
        bgu_accessKey: JSON.stringify(accessKey),
        bgu_always: JSON.stringify(false),
        bgu_enabled: JSON.stringify(true),
    }));
    const seen = [];
    const page = {
        location: { href: 'https://www.bilibili.com/bangumi/play/ep267851' },
        localStorage: {
            getItem: (key) => stored.has(key) ? stored.get(key) : null,
            setItem: (key, value) => stored.set(key, value),
        },
        document: { body: null, addEventListener() {}, getElementById() { return null; } },
        console: { log() {} },
        fetch: async (url) => {
            seen.push(String(url));
            return response(String(url), seen.length);
        },
    };
    const context = {
        window: page,
        console: page.console,
        URL,
        Response: MockResponse,
        Event: class Event { constructor(type) { this.type = type; } },
        JSON,
        Object,
        Array,
        Promise,
        String,
        RegExp,
        Error,
        setTimeout,
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '..', 'bilibili-geo-unlock.user.js'), 'utf8'),
        context,
        { filename: 'bilibili-geo-unlock.user.js' },
    );
    return { page, seen };
}

test('retries an explicit regional denial through the same proxied playurl URL', async () => {
    const { page, seen } = createRuntime({
        accessKey: 'credential-placeholder',
        response: (url, count) => count === 1
            ? new MockResponse('{"code":-10403,"message":"抱歉您所在地区不可观看！"}')
            : new MockResponse('{"code":0,"result":{"video_info":{"ok":true}}}'),
    });

    const result = await page.fetch('https://api.bilibili.com/pgc/player/web/v2/playurl?ep_id=267851&fnval=12240');
    assert.equal(await result.text(), '{"code":0,"result":{"video_info":{"ok":true}}}');
    assert.deepEqual(seen, [
        'https://api.bilibili.com/pgc/player/web/v2/playurl?ep_id=267851&fnval=12240',
        'https://proxy.example/bili/pgc/player/web/v2/playurl?ep_id=267851&fnval=12240&access_key=credential-placeholder',
    ]);
});

test('does not send a VIP/login-style -10403 response to the proxy', async () => {
    const { page, seen } = createRuntime({
        response: () => new MockResponse('{"code":-10403,"message":"大会员专享"}'),
    });

    const result = await page.fetch('https://api.bilibili.com/pgc/player/web/v2/playurl?ep_id=267851');
    assert.equal(await result.text(), '{"code":-10403,"message":"大会员专享"}');
    assert.equal(seen.length, 1);
});
