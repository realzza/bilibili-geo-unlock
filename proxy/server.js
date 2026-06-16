#!/usr/bin/env node
'use strict';
/*
 * Bilibili geo-unlock reverse proxy.
 * ----------------------------------
 * Reverse-proxies api.bilibili.com and adds the CORS headers the userscript
 * needs. Deploy it in an UNBLOCKED region (Hong Kong) so its egress IP is what
 * hits Bilibili. No dependencies — just Node's stdlib.
 *
 * Runs anywhere:
 *   - Alibaba Cloud Function Compute "Web Function" (startup cmd: `node server.js`,
 *     listen port 9000)  ← recommended free option, see README
 *   - Any VPS (Oracle Always Free, etc.):  `node server.js`  (then put nginx/TLS
 *     in front, or run on 443 directly)
 *   - Local testing:  `node server.js` then curl http://localhost:9000/healthz
 *
 * Set the userscript's "Server" to this deployment's https URL.
 */
const http = require('http');
const https = require('https');

const UPSTREAM = 'api.bilibili.com';
const ALLOW_ORIGIN = 'https://www.bilibili.com';
// FC injects FC_SERVER_PORT (default 9000); PORT works for generic hosts.
const PORT = process.env.FC_SERVER_PORT || process.env.PORT || 9000;

const CORS = {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': '*',
};

const server = http.createServer((req, res) => {
    // CORS preflight from www.bilibili.com
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        res.end();
        return;
    }

    // health check / sanity ping
    if (req.url === '/' || req.url === '/healthz') {
        res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS));
        res.end('bilibili-geo-unlock proxy: ok');
        return;
    }

    const headers = {
        Host: UPSTREAM,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        Referer: 'https://www.bilibili.com',
        Origin: 'https://www.bilibili.com',
        Accept: 'application/json, text/plain, */*',
    };
    // Forward credentials if the caller supplied any. (Note: the userscript's
    // cross-origin call cannot read HttpOnly SESSDATA, so 大会员-only titles
    // generally rely on an access_key passed in the query string instead.)
    if (req.headers['cookie']) headers.Cookie = req.headers['cookie'];

    const up = https.request(
        { hostname: UPSTREAM, port: 443, path: req.url, method: req.method, headers },
        (upRes) => {
            const out = Object.assign(
                { 'Content-Type': upRes.headers['content-type'] || 'application/json; charset=utf-8' },
                CORS
            );
            res.writeHead(upRes.statusCode || 200, out);
            upRes.pipe(res);
        }
    );

    up.on('error', (e) => {
        res.writeHead(502, Object.assign({ 'Content-Type': 'application/json' }, CORS));
        res.end(JSON.stringify({ code: -1, message: 'proxy error: ' + e.message }));
    });

    req.pipe(up);
});

server.listen(PORT, () => {
    console.log(`bilibili-geo-unlock proxy listening on :${PORT} -> https://${UPSTREAM}`);
});
