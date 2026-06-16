# Bilibili Geo Unlock 🌏

A Safari-friendly **userscript** that unblocks region-locked Bilibili content —
the grey screen that says:

> 非常抱歉，根据版权要求，您所在的地区无法观看本片
> *(Sorry, due to copyright requirements this title is not available in your region.)*

It targets 番剧 / 影视 / 课程 (`pgc`) titles, including **大会员-exclusive**
content if you have a 大会员 account.

---

## ⚠️ Read this first — how it actually works

A userscript runs **in your browser**, so it **cannot change your IP address**.
Bilibili decides what you can watch based on the IP that hits its `playurl` API.

This script therefore works by **forwarding the `playurl` API request to a
reverse-proxy server that sits in an unblocked region** (mainland China / Hong
Kong / Taiwan). The proxy answers with a normal, playable response, which the
script hands back to the player.

```
Safari (US IP)                         this userscript
  │  open bangumi page                       │
  │  player calls playurl ──────────────► intercept
  │                                          │  real call → -10403 (blocked)
  │                                          │  re-issue same call ↓
  │                                   ┌──────────────────────────┐
  │                                   │  reverse proxy (HK/TW/CN) │ ──► api.bilibili.com
  │                                   └──────────────────────────┘
  │  ◄──────────── playable playurl ─────────┘
  ▼  video plays
```

**=> You need a working in-region proxy server.** The script ships with a public
default, but public servers are frequently down or rate-limited, and a proxy can
see the requests it relays. For reliability and privacy, **self-host one**
(takes 5 minutes — see [below](#self-hosting-a-proxy-recommended)).

This is the same architecture used by the well-known
[`ipcjs/bilibili-helper`](https://github.com/ipcjs/bilibili-helper) project; this
repo is a compact, Safari-tuned reimplementation.

---

## Install (Safari)

You need a userscript manager that supports cross-origin requests
(`GM_xmlhttpRequest` / `GM.xmlHttpRequest`). Either works:

### Option A — Userscripts by quoid (free, recommended)
1. Install **[Userscripts](https://apps.apple.com/app/userscripts/id1463298887)**
   from the Mac App Store.
2. Safari → Settings → Extensions → enable **Userscripts**, and set it to
   **Allow** on `bilibili.com`.
3. Click the Userscripts toolbar icon → open the editor → **+ → New Remote** and
   paste the raw URL of
   [`bilibili-geo-unlock.user.js`](bilibili-geo-unlock.user.js), **or** create a
   new script and paste the file contents.
4. Make sure the script is **enabled**.

### Option B — Tampermonkey for Safari (paid)
1. Install Tampermonkey from the Mac App Store and enable it in Safari.
2. Open the raw `.user.js` link → Tampermonkey shows an install prompt → Install.

> The `.user.js` raw link, once this repo is on GitHub:
> `https://raw.githubusercontent.com/realzza/bilibili-geo-unlock/main/bilibili-geo-unlock.user.js`
> Opening it in Safari with a manager installed triggers one-click install/update.

---

## Configure the proxy

Open any Bilibili page; a 🌏 button appears bottom-right. Click it to set:

- **Server** — your reverse-proxy base URL (default `https://bili.tuturu.top`).
- **access_key** *(optional)* — only needed by some proxies or for certain
  大会员-exclusive titles. Leave blank otherwise.

Tampermonkey/Userscripts users also get the same options in the userscript
manager's **menu** (⚙️ 设置代理服务器, 🔁 始终走代理, ⏯️ 启用/停用).

Settings persist via `GM.setValue` (or `localStorage` fallback). **Refresh the
page after changing them.**

### Public proxy servers (use at your own risk)
These come and go; none are guaranteed up or safe (a proxy sees your relayed
requests). Try them, but prefer self-hosting:

| Server | Region |
| --- | --- |
| `https://bili.tuturu.top` | Taiwan (default) |
| `https://bili-proxy.98e.org` | Hong Kong |

---

## Self-hosting a proxy (recommended)

You need something with an egress IP in an **unblocked region** (Hong Kong /
Taiwan / mainland). It just reverse-proxies `api.bilibili.com` and adds CORS
headers. The region of the IP decides what unblocks: **HK/TW covers most
overseas-blocked 番剧/影视**; mainland-only titles need a mainland IP (no free
option exists for that).

> ⚠️ A Cloudflare Worker / Deno Deploy / Vercel proxy does **not** work here:
> you can't choose their egress region, so the request leaves from a global edge
> PoP (not HK/CN) and Bilibili still returns -10403.

### Free option — Alibaba Cloud Function Compute, Hong Kong (recommended)

A serverless function in HK gives you a Hong Kong egress IP on a perpetual free
tier (~1M calls/month — far more than you'll use). Nothing to keep running.
The only cost is a credit card for signup verification (every cloud requires it).

Uses [`proxy/server.js`](proxy/server.js) (zero dependencies, stdlib only):

1. Sign up at **alibabacloud.com** (the international site; English console).
2. Go to **Function Compute** → make sure the region selector (top bar) is
   **China (Hong Kong)**.
3. **Create Function** → **Web Function** → Runtime **Node.js** (20.x).
4. Paste the contents of `proxy/server.js` as the code (filename `server.js`).
   - **Startup command:** `node server.js`
   - **Listen port:** `9000`  (the script reads `FC_SERVER_PORT`, default 9000)
5. Under **Triggers / HTTP**, enable the HTTP trigger and set auth to
   **anonymous** (`disable` auth) so the userscript can reach it. Allow `GET`,
   `POST`, `OPTIONS`.
6. Copy the function's public URL (looks like
   `https://<name>-<id>.cn-hongkong.fcapp.run`). Open `…/healthz` in a browser —
   it should print `bilibili-geo-unlock proxy: ok`.
7. In the userscript's 🌏 settings, set **Server** to that URL. Refresh Bilibili.

> Tip: test it end-to-end by opening `https://<your-fc-url>/x/web-interface/nav`
> — you should get Bilibili JSON back, served from a Hong Kong IP.

### Free option — Oracle Cloud "Always Free" VPS

A real VPS, free forever (not a trial). Catch: you usually get a Tokyo/Singapore
IP, which is still "overseas" to Bilibili and unblocks *less* than HK/TW. Only
worth it if you can grab their **Hong Kong** region at signup. Run
[`proxy/server.js`](proxy/server.js) with `node server.js` behind the nginx/TLS
config below, or use the nginx-only setup directly.

### nginx (any HK/TW VPS, reliable)
See [`proxy/nginx.conf`](proxy/nginx.conf). In short:

```nginx
server {
    listen 443 ssl;
    server_name your.proxy.example.com;
    # ... your TLS certs ...

    location / {
        proxy_pass https://api.bilibili.com;
        proxy_ssl_server_name on;
        proxy_set_header Host api.bilibili.com;
        proxy_set_header Referer https://www.bilibili.com;

        add_header Access-Control-Allow-Origin  https://www.bilibili.com always;
        add_header Access-Control-Allow-Credentials true always;
    }
}
```

Then set the script's **Server** to `https://your.proxy.example.com`.

---

## Notes & limitations

- The script lets the real request go first and **only proxies when it sees a
  region-limit error** (codes `-10403` etc.), so non-blocked videos stay direct
  and fast. Toggle "始终走代理" to force-proxy everything.
- 大会员-exclusive titles need a proxy that supplies 大会员 credentials
  (your own, via `access_key`, or the proxy's). A bare reverse proxy unblocks
  region-locked-but-free titles and, if you're a 大会员, your own premium titles.
- Only `pgc` (番剧/影视/课程) playback is handled — that's where the geo wall is.
- This is for **personal access to content you're entitled to**. Respect
  Bilibili's ToS and local law.

## License
MIT — see [LICENSE](LICENSE).
