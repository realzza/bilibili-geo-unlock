# Implementation notes: BiliRoamingX to macOS web

## What BiliRoamingX does

The active [BiliRoamingX project](https://github.com/BiliRoamingX/BiliRoamingX)
patches the Android client, not the web site. Its PGC playback hook treats a
missing stream or an `area_limit` player dialog as a signal to reconstruct an
app-style request from the episode ID and playback settings. It tries configured
CN/HK/TW/Thailand parser servers, adds an area and account token, re-signs the
request with the Android client’s app parameters, then rebuilds the protobuf
player response from the successful JSON. It can also reconstruct season data
and use the Thailand-specific BiliIntl API.

That approach is deliberately wider than a browser implementation:

- Android code runs inside the Bilibili app and can hook its protobuf and
  OkHttp layers.
- Its app API call uses a Bilibili app signing routine and optional account
  tokens.
- The web player expects web `playurl` JSON and cannot consume an Android
  protobuf replacement.

The older `yujincheng08/BiliRoaming` project was archived on July 6, 2026. Its
active descendants include BiliRoamingX, several source backups, and parser
server projects, but they are not a safe source of public credentials. In
particular, a reviewed Vercel parser implementation records `access_key` data
in external logging code. This project therefore ships no public parser list
and never shares a credential with a third party by default.

## What the web player does now

On July 18, 2026, the Bilibili web player bundle maps PGC playback to:

```text
https://api.bilibili.com/pgc/player/web/v2/playurl
```

From the workspace’s US egress, the public test page
[`ep267851`](https://www.bilibili.com/bangumi/play/ep267851) responds:

```json
{"code":-10403,"message":"抱歉您所在地区不可观看！"}
```

The currently-rendered page requests season metadata server-side, then its
player calls `window.fetch` for the play URL. That is why the userscript hooks
page-world `fetch` at `document-start` and keeps an XMLHttpRequest fallback for
older bundles.

## The browser design

```text
web player → normal web playurl request → geographic denial?
                                         │
                                  no ────┘ return original response
                                         │
                                        yes
                                         ▼
same URL + same query → private HTTPS proxy → api.bilibili.com
                                         │
                                valid JSON │ return it to player
```

The script does not retry a generic `-10403` without region text, because the
same status code can represent login or VIP entitlement. The proxy sends no
cookies upstream: a Bilibili page cannot safely read its HttpOnly session and
copy it to another origin. This keeps the macOS MVP useful for free
geo-limited content while making the entitlement boundary explicit.
