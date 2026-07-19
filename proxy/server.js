#!/usr/bin/env node
'use strict';

/*
 * Bilibili geo-unlock reverse proxy.
 *
 * This deliberately proxies only the small PGC metadata/playurl endpoints used
 * by the browser companion. It is not a general-purpose proxy, it does not
 * cache responses, and it never forwards browser cookies to Bilibili.
 *
 * Deploy it only on infrastructure you control in a region where you are
 * entitled to access the requested title. Premium entitlement still needs to
 * be handled by Bilibili (for example, through a user-supplied access key when
 * the relevant endpoint accepts it); this service does not bypass it.
 */
const http = require('http');
const https = require('https');
const { isAllowedMethod, isAllowedPath } = require('./policy');

const DEFAULT_UPSTREAM = 'https://api.bilibili.com';
const DEFAULT_ALLOW_ORIGIN = 'https://www.bilibili.com';

function corsHeaders(allowOrigin) {
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Max-Age': '86400',
        'Cache-Control': 'no-store',
        'Vary': 'Origin',
    };
}

function json(res, status, body, headers = {}) {
    res.writeHead(status, Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    }, headers));
    res.end(JSON.stringify(body));
}

function createProxyServer({
    upstreamOrigin = process.env.BILI_UPSTREAM_ORIGIN || DEFAULT_UPSTREAM,
    allowOrigin = process.env.BILI_ALLOW_ORIGIN || DEFAULT_ALLOW_ORIGIN,
} = {}) {
    const upstream = new URL(upstreamOrigin);
    if (!['http:', 'https:'].includes(upstream.protocol)) {
        throw new Error('BILI_UPSTREAM_ORIGIN must use http or https');
    }
    const transport = upstream.protocol === 'https:' ? https : http;
    const cors = corsHeaders(allowOrigin);

    return http.createServer((req, res) => {
        const requestUrl = new URL(req.url, 'http://proxy.invalid');

        if (req.method === 'OPTIONS') {
            if (!isAllowedPath(requestUrl.pathname)) {
                json(res, 404, { code: -404, message: 'not found' }, cors);
                return;
            }
            res.writeHead(204, cors);
            res.end();
            return;
        }

        if (req.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/healthz')) {
            res.writeHead(200, Object.assign({
                'Content-Type': 'text/plain; charset=utf-8',
            }, cors));
            res.end('bilibili-geo-unlock proxy: ok');
            return;
        }

        if (!isAllowedMethod(req.method)) {
            json(res, 405, { code: -405, message: 'method not allowed' }, cors);
            return;
        }
        if (!isAllowedPath(requestUrl.pathname)) {
            json(res, 404, { code: -404, message: 'not found' }, cors);
            return;
        }

        const upstreamRequest = transport.request({
            protocol: upstream.protocol,
            hostname: upstream.hostname,
            port: upstream.port || undefined,
            method: 'GET',
            path: requestUrl.pathname + requestUrl.search,
            headers: {
                Host: upstream.host,
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
                Referer: 'https://www.bilibili.com/',
                Origin: 'https://www.bilibili.com',
                Accept: 'application/json, text/plain, */*',
                // Do not send cookies scoped to this proxy host upstream. The
                // browser cannot safely relay Bilibili's HttpOnly cookies here.
                Cookie: '',
            },
        }, (upstreamResponse) => {
            res.writeHead(upstreamResponse.statusCode || 502, Object.assign({
                'Content-Type': upstreamResponse.headers['content-type'] || 'application/json; charset=utf-8',
            }, cors));
            upstreamResponse.pipe(res);
        });

        upstreamRequest.setTimeout(15_000, () => {
            upstreamRequest.destroy(new Error('upstream timeout'));
        });
        upstreamRequest.on('error', (error) => {
            if (!res.headersSent) {
                json(res, 502, { code: -1, message: `proxy error: ${error.message}` }, cors);
            } else {
                res.destroy(error);
            }
        });
        upstreamRequest.end();
    });
}

if (require.main === module) {
    const port = Number(process.env.FC_SERVER_PORT || process.env.PORT || 9000);
    const server = createProxyServer();
    server.listen(port, () => {
        console.log(`bilibili-geo-unlock proxy listening on :${port}`);
    });
}

module.exports = { createProxyServer };
