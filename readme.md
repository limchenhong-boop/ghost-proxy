# Ghost Proxy — Residential Proxy Gateway

A tiny Node service that fetches URLs through your Proxy-Seller residential
proxy and exposes a simple HTTPS API that Base44 can call.

Base44's runtime can't tunnel through an HTTP forward proxy, but a normal Node
host can (via undici's `ProxyAgent`). This gateway runs on such a host and does
the tunneling for Base44.

## Deploy

Works on **Render**, **Railway**, **Fly.io**, or **Cloud Run** — any host that
runs Node and gives you a public HTTPS URL. (Do **not** use Cloudflare Workers —
it has the same tunneling limitation as Base44.)

### Render (easiest)

1. New → **Web Service** → connect this `gateway/` folder (or a repo containing it).
2. **Runtime:** Node
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`
5. **Environment Variables:**
   - `PROXY_URL` = `http://93143ddafb86b99c:0MczPiC3ltnRYHOx@res.proxy-seller.com:10000`
   - `API_KEY` = (pick a long random string, e.g. `openssl rand -hex 32`)
   - `ALLOWED_ORIGINS` = `https://ghost-proxy.base44.app`
6. Deploy. You'll get a URL like `https://ghost-proxy-gateway.onrender.com`.

### Railway / Fly.io / Cloud Run

Same idea: Node 18+, `npm install && npm start`, same env vars, public URL.

## Verify it works

```bash
# health
curl https://YOUR-GATEWAY/health
# -> {"ok":true}

# check the residential egress IP (should be a residential IP, NOT a cloud IP)
curl "https://YOUR-GATEWAY/ip?key=YOUR_API_KEY"
# -> {"ip":"<residential-ip>","status":200}

# fetch a page
curl -X POST https://YOUR-GATEWAY/fetch \
  -H "x-api-key: YOUR_API_KEY" \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com"}'
```

If `/ip` returns a residential (non-cloud) IP, the proxy is working.

## Then tell me

Once deployed, send me:
1. The gateway URL (e.g. `https://ghost-proxy-gateway.onrender.com`)
2. The `API_KEY` value

I'll wire `proxyFetch` to route all upstream fetches through the gateway, so
every page and resource Ghost Proxy loads goes out through your residential IPs.
