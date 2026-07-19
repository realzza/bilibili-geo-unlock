'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createProxyServer } = require('../proxy/server');

function listen(server) {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function close(server) {
    return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function request(port, path, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port, path, method: options.method || 'GET', headers: options.headers,
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

test('proxies only permitted endpoints and strips proxy cookies', async (t) => {
    let observed;
    const upstream = await listen(http.createServer((req, res) => {
        observed = { url: req.url, host: req.headers.host, cookie: req.headers.cookie };
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 0, result: { playable: true } }));
    }));
    const upstreamPort = upstream.address().port;
    const proxy = await listen(createProxyServer({
        upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
    }));
    const proxyPort = proxy.address().port;
    t.after(async () => {
        await close(proxy);
        await close(upstream);
    });

    const ok = await request(proxyPort, '/pgc/player/web/v2/playurl?ep_id=267851&fnval=12240', {
        headers: { Cookie: 'proxy_session=should-not-forward' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['access-control-allow-origin'], 'https://www.bilibili.com');
    assert.deepEqual(JSON.parse(ok.body), { code: 0, result: { playable: true } });
    assert.deepEqual(observed, {
        url: '/pgc/player/web/v2/playurl?ep_id=267851&fnval=12240',
        host: `127.0.0.1:${upstreamPort}`,
        cookie: '',
    });

    const rejected = await request(proxyPort, '/x/web-interface/nav');
    assert.equal(rejected.status, 404);
});

test('answers CORS preflight and rejects non-GET requests', async (t) => {
    const upstream = await listen(http.createServer());
    const proxy = await listen(createProxyServer({
        upstreamOrigin: `http://127.0.0.1:${upstream.address().port}`,
    }));
    const proxyPort = proxy.address().port;
    t.after(async () => {
        await close(proxy);
        await close(upstream);
    });

    const preflight = await request(proxyPort, '/pgc/player/web/playurl', { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-methods'], 'GET, OPTIONS');

    const post = await request(proxyPort, '/pgc/player/web/playurl', { method: 'POST' });
    assert.equal(post.status, 405);
});
