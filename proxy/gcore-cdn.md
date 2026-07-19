# Deprecated CDN experiment

This repository no longer documents or recommends a provider-specific CDN
setup as a Bilibili proxy. CDN origin-egress routing and free-plan features are
not stable enough to promise a particular region, and a generic CDN endpoint
does not provide the narrow allowlist and cookie policy of the bundled proxy.

Use [`proxy/server.js`](server.js) or [`nginx.conf`](nginx.conf) on a private
HTTPS host you control instead. Verify its actual Bilibili-visible region with
an appropriate account-neutral API check before configuring Safari.
