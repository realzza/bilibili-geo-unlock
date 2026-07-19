# Bilibili Geo Unlock (macOS web MVP)

A Safari-friendly userscript for Bilibili **番剧 / 影视** pages. When the web
player receives a confirmed regional-availability error from its PGC `playurl`
API, it retries the *same* request through an HTTPS proxy you run in a region
where you are entitled to view the title.

It does not bypass a 大会员 subscription, paid access, DRM, or an account-level
restriction. It does not read or forward `SESSDATA` (an HttpOnly cookie) to the
proxy.

## What is implemented

```text
Safari page world                    private HK / TW / CN proxy
------------------                   --------------------------
Bilibili player -- playurl (blocked) --> Bilibili API
       |                                      |
       +-- same playurl via HTTPS proxy -------+--> playable JSON, if entitled
```

- Hooks the current `https://api.bilibili.com/pgc/player/web/v2/playurl` call
  in the page's JavaScript world. This is essential on Safari: isolated
  userscript code cannot replace the player's `window.fetch`.
- Retries only an explicit geographic denial (such as “抱歉您所在地区不可观看！”).
  A generic `-10403` is **not** enough because Bilibili also uses it for VIP or
  login denials.
- Includes an allowlisted Node reverse proxy. It forwards only PGC `playurl`
  and season metadata endpoints; it is not an open proxy and never forwards
  cookies from the proxy request to Bilibili.
- Uses no public parser or default host. Public “unlock” services are both
  unreliable and unsafe for account credentials.

More detail on the Android project comparison and the verified web request is
in [implementation notes](docs/implementation-notes.md).

## Install on macOS Safari

1. Install [Userscripts for Safari](https://apps.apple.com/app/userscripts/id1463298887).
2. In Safari **Settings → Extensions**, enable Userscripts and grant it access
   to `bilibili.com`.
3. Add [`bilibili-geo-unlock.user.js`](bilibili-geo-unlock.user.js) as a local
   script (or use its raw GitHub URL once the repository is published).
4. Open a Bilibili page and click the 🌏 button at lower right. Enter the HTTPS
   URL of **your own** proxy, then refresh the 番剧 page.

The metadata uses `@inject-into page`, which Userscripts for Safari supports.
It uses CORS fetches in that context, so use the bundled proxy or preserve its
CORS policy if you deploy another implementation.

Tampermonkey can also run the script; when available it uses its cross-origin
request API and otherwise falls back to the same CORS path.

## Run the private proxy

The host running the proxy needs egress in the relevant entitlement region:
Hong Kong/Taiwan commonly covers overseas-limited titles; mainland-only titles
require mainland egress. You need TLS in front of the Node process because a
Bilibili HTTPS page cannot call an insecure proxy.

```sh
node proxy/server.js
curl http://127.0.0.1:9000/healthz
```

For a VPS, run it behind nginx with your certificate; see
[`proxy/nginx.conf`](proxy/nginx.conf). For a serverless runtime that supplies
HTTPS, set the service's listen port with `PORT` or `FC_SERVER_PORT` and use
the deployed HTTPS URL in the userscript.

The proxy accepts only:

- `GET /pgc/player/web/v2/playurl`
- `GET /pgc/player/web/playurl`
- `GET /pgc/player/api/playurl`
- `GET /pgc/view/web/season` and `/pgc/view/web/simple/season`

It rejects every other endpoint and all non-GET methods (apart from CORS
preflight). Validate the deployment before adding it to Safari:

```sh
curl https://your-proxy.example/healthz
curl -I -X OPTIONS https://your-proxy.example/pgc/player/web/v2/playurl
```

### Account entitlement

For region-blocked but free titles, a normal reverse proxy is enough. For
subscription-only titles Bilibili must still see valid entitlement. The browser
cannot safely send its `HttpOnly` Bilibili session to another origin, so this
repository intentionally does not try to copy cookies or recommend public
parsers. The UI has an optional `access_key` field only for a private proxy you
operate; treat it as a credential and leave it empty unless you understand the
server's handling of it.

## Development checks

```sh
npm test
npm run check
```

The tests run a mock upstream and verify that the proxy preserves an allowed
`playurl` request, strips proxy cookies, serves CORS preflight, and refuses
unrelated URLs.

## Limitations

- The proxy's egress location decides whether a particular title is available.
- Bilibili can change its web player or API at any time.
- This is for personal access to content you are entitled to view. Follow
  Bilibili's terms and applicable law.

## License

MIT — see [LICENSE](LICENSE).
