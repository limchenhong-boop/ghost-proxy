# Ghost Proxy Gateway — Scramjet

A Node.js gateway that runs the [Scramjet](https://github.com/MercuryWorkshop/scramjet) interception proxy with a [Wisp](https://www.npmjs.com/package/@mercuryworkshop/wisp-js) WebSocket transport. The Base44 app embeds this gateway's `/proxy.html` page in an iframe; the service worker intercepts all requests from the proxied site and routes them through the Wisp server, giving full SPA support (YouTube, TikTok, etc.).

## Architecture

```
Base44 app (ghost-proxy.base44.app)
  └─ iframe → gateway/proxy.html?url=<target>
       └─ Scramjet service worker intercepts all requests
            └─ libcurl transport → Wisp WebSocket (wss://gateway/wisp/)
                 └─ Wisp server fetches the target site
```

## Deploy on Render

1. Create a new Web Service on Render, connected to your Git repo.
2. **Build Command:** `npm install`
3. **Start Command:** `node server.js`
4. **Environment Variables:**
   - `PORT` — Render sets this automatically
5. The gateway serves:
   - `/` — proxy page (embedded by the Base44 app)
   - `/scram/*` — Scramjet core files (WASM + JS)
   - `/libcurl/*` — libcurl transport
   - `/baremux/*` — BareMux connection layer
   - `/wisp/` — Wisp WebSocket endpoint
   - `/sw.js` — service worker
   - `/health` — health check

## Verification

```bash
# Health check
curl https://your-gateway.onrender.com/health
# → {"ok":true,"build":"scramjet-v4"}

# Proxy page
curl https://your-gateway.onrender.com/proxy.html?url=https://example.com
# → HTML page with Scramjet proxy
```

## Integration

Set the `GATEWAY_URL` secret in the Base44 app to your deployed gateway URL:
```
GATEWAY_URL=https://your-gateway.onrender.com
```

The Base44 app fetches this URL via the `proxyFetch` function's config endpoint and constructs iframe URLs as `GATEWAY_URL/proxy.html?url=<target>`.
