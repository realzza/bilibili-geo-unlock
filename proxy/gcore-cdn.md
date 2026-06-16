# Free, no-credit-card proxy via Gcore CDN

This is the **zero-cost, no-payment-method** way to host the in-region proxy the
userscript needs. You sign up with just an email — Gcore's CDN free plan needs
no credit card — and put their CDN in front of `api.bilibili.com`. Bilibili then
sees the request coming from Gcore's Asia network instead of your US IP.

- **Cost:** $0. Free plan includes 1 TB/month.
- **The free-plan throttle (100 Kbps after 5 MB) does NOT matter here.** We only
  proxy the tiny `playurl` JSON API (a few KB per request). The actual video
  bytes stream directly from Bilibili's video CDN to your browser and never go
  through Gcore.
- **No server to run, nothing to keep alive.**

> ### ⚠️ The one thing that decides success: egress region
> A CDN only unblocks if its *origin pull* (the fetch to `api.bilibili.com`)
> leaves from an **Asia/Hong Kong** node, not a US node. On the free plan this
> usually happens via Gcore's backbone, but it isn't guaranteed. Gcore's
> guaranteed control for it — **Origin Shielding pinned to Hong Kong** — is a
> *paid* add-on.
>
> **You don't have to guess:** [Step 6](#step-6--verify-the-egress-region-the-decisive-test)
> is a 10-second test that tells you exactly which region Bilibili sees. If it
> says CN/HK you're done for free; if it says US, only paid shielding (or a
> different host) would fix it.

---

## Step 1 — Create a free Gcore account
1. Go to <https://gcore.com/> → **Sign up**. Use email (or Google/GitHub login).
   No credit card is requested for the CDN free plan.
2. In the Customer Portal, open **CDN**.

## Step 1b — Get a free subdomain (you DON'T need to buy a domain)
Gcore's "Create resource" form **requires a delivery domain**, and accessing the
bare `cl-xxxx.gcdn.co` hostname directly is disabled by default (it needs a
support request). So grab a free subdomain you can put a CNAME on:

1. Sign up at **<https://freedns.afraid.org>** (free, email only).
2. **Registry** → pick any shared domain (e.g. `mooo.com`, `chickenkiller.com`)
   and choose a name, e.g. `bili-unlock.mooo.com`. (You'll create the actual
   CNAME record in Step 2, once Gcore gives you its target.)

> Use **FreeDNS (afraid.org)** specifically because it supports **CNAME**
> records. DuckDNS only does A records and won't work (Gcore gives you a CNAME
> target, not a fixed IP).

## Step 2 — Create a CDN resource pointing at Bilibili
1. **CDN → Create resource**.
2. **Add domain:** enter your free subdomain, e.g. `bili-unlock.mooo.com`.
   Choose **"Do not delegate"**. Leave **WAAP off** (it's a paid feature).
3. **Origin → URL → Origin source:** `api.bilibili.com`
4. **Host header override:** `api.bilibili.com`
5. Click **Create**. Gcore shows a **CNAME target** like `cl-xxxxxxxx.gcdn.co`.
6. Back in **afraid.org → Subdomains → add a record:**
   - Type **CNAME**, subdomain `bili-unlock` (domain `mooo.com`),
     destination = the `cl-xxxxxxxx.gcdn.co` value from step 5.
7. **Origin protocol:** in the resource settings set origin pull to **HTTPS** so
   Gcore talks to Bilibili over TLS.
8. **Enable HTTPS:** **SSL certificates** → issue a free **Let's Encrypt**
   certificate for `bili-unlock.mooo.com` (so the userscript can reach it over
   `https://`). It issues once the CNAME from step 6 has propagated.

Your **proxy URL** is now `https://bili-unlock.mooo.com`.

## Step 3 — Confirm the Host header is `api.bilibili.com`
Bilibili rejects requests whose `Host` isn't its own domain. You set this as
**Host header override** in Step 2; double-check it here.

1. Open the resource → **HTTP headers → Host header**.
2. It should be **Custom Host header = `api.bilibili.com`**. If not, set it.

## Step 4 — Disable caching (this is a live API, not static files)
1. Resource → **Cache settings** (a.k.a. "Caching").
2. Set caching to **CDN controlled** with **expiration = `0` seconds**, i.e.
   *do not cache*. (Each `playurl` request is unique/signed; caching would serve
   stale or wrong responses.)
3. Make sure the **query string is forwarded** to the origin (default). If
   there's a "Ignore query string" / cache-key option, leave query strings
   **included / forwarded**.

## Step 5 — Add CORS response headers
Belt-and-suspenders (the userscript's `GM_xmlhttpRequest` path bypasses CORS,
but its fallback path needs these):

1. Resource → **HTTP headers → Response headers → Add header**.
2. Add:
   - `Access-Control-Allow-Origin` = `https://www.bilibili.com`
   - `Access-Control-Allow-Credentials` = `true`
3. Save. If you changed anything, **purge/clear the CDN cache** so settings take
   effect.

## Step 6 — Verify the egress region (the decisive test)
Open this in your browser (use your subdomain):

```
https://bili-unlock.mooo.com/x/web-interface/zone
```

Bilibili replies with the region **it thinks the request came from**. Look at
`data.country_code` / `data.country`:

- **`CN` / `HK` / `TW`** → 🎉 the CDN is egressing in-region. Unblock will work.
- **`US`** (or other) → the free CDN pulled from a US node. It won't unblock;
  you'd need Gcore **Origin Shielding → Hong Kong** (paid), or a different host
  (see the README's other options).

Also sanity-check the proxy itself:
```
https://bili-unlock.mooo.com/x/web-interface/nav   # should return Bilibili JSON
```

## Step 7 — Point the userscript at it
1. On any Bilibili page, click the 🌏 button (bottom-right) → set **Server** to
   `https://bili-unlock.mooo.com` (your subdomain, no trailing path).
2. Refresh a region-locked title and play.

---

## Notes
- **大会员-exclusive titles:** a bare CDN proxy can't send your HttpOnly
  `SESSDATA`, so it unblocks region-locked *free* titles and (if the proxy were
  to carry your premium session) your own VIP content. For VIP-gated titles you
  may still need an `access_key` (set it in the 🌏 panel). Region-locked-but-free
  番剧 is what this reliably fixes.
- **If Step 6 shows US:** don't waste time — the free CDN egress isn't in-region
  for you. Your remaining no-card option is running [`server.js`](server.js) on a
  machine someone has in HK/TW/mainland, exposed via a free Cloudflare Tunnel
  (`cloudflared`). A mainland machine additionally unblocks mainland-only titles.
- Gcore may rotate which backbone node serves origin pulls; if it stops working,
  re-run Step 6.
