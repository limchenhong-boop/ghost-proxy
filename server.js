// Ghost Proxy — Residential Proxy Gateway
// A tiny Node service that fetches a target URL through a residential proxy
// (Proxy-Seller) and exposes a simple HTTPS API Base44 can call.
//
// Base44's runtime can't tunnel through an HTTP forward proxy, but a normal
// Node host can (via undici's ProxyAgent). This gateway runs on such a host,
// does the tunneling, and Base44 just makes a plain HTTPS request to it.
//
// Endpoints:
//   GET  /health            -> { ok: true }
//   GET  /ip?key=           -> { ip }  (verifies the residential egress IP)
//   POST /fetch  (x-api-key) -> { status, contentType, finalUrl, body }  (JSON in/out)
//   GET  /raw?url=&key=     -> streams the target response through the proxy (CORS)
//
// Env:
//   PROXY_URL   http://93143ddafb86b99c:0MczPiC3ltnRYHOx@res.proxy-seller.com:10000   (full residential proxy URL)
//   API_KEY     ghost_8f3a9c2e1d4b7a6f5e0c9d8b7a6f5e0c
//   PORT        listen port (default 8080)
//   ALLOWED_ORIGINS  comma-separated CORS origins (default "*")

import http from "node:http";
import { ProxyAgent, fetch as uFetch, Agent } from "undici";

const PROXY_URL = process.env.PROXY_URL || "";
const API_KEY = process.env.API_KEY || "";
const PORT = parseInt(process.env.PORT || "8080", 10);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "*";
const TIMEOUT_MS = 30000;

if (!PROXY_URL) {
  console.error("FATAL: PROXY_URL env var is required (http://USER:PASS@host:port)");
  process.exit(1);
}
if (!API_KEY) {
  console.error("FATAL: API_KEY env var is required");
  process.exit(1);
}

const dispatcher = new ProxyAgent({
  uri: PROXY_URL,
  headersTimeout: TIMEOUT_MS,
  bodyTimeout: TIMEOUT_MS,
});
const directAgent = new Agent({ headersTimeout: TIMEOUT_MS, bodyTimeout: TIMEOUT_MS });

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function cors(res, origin) {
  res.setHeader("access-control-allow-origin", ALLOWED_ORIGINS === "*" ? "*" : origin);
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-expose-headers", "x-final-url, content-type, content-length, content-range, accept-ranges");
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(body);
}

function checkKey(req, url) {
  const headerKey = req.headers["x-api-key"];
  const queryKey = url.searchParams.get("key");
  return headerKey === API_KEY || queryKey === API_KEY;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function buildHeaders(req, targetUrl, isJsonPost, contentType) {
  const parsed = new URL(targetUrl);
  const h = {
    "user-agent": UA,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    referer: parsed.origin + "/",
  };
  if (isJsonPost && contentType) h["content-type"] = contentType;
  return h;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    cors(res, req.headers.origin);
    res.writeHead(204);
    return res.end();
  }

  // ---- health (no auth) ----
  if (url.pathname === "/health") return sendJson(res, 200, { ok: true });

  // ---- auth ----
  if (!checkKey(req, url)) return sendJson(res, 401, { error: "Unauthorized" });
  cors(res, req.headers.origin);

  try {
    // ---- /ip : verify residential egress ----
    if (url.pathname === "/ip") {
      const r = await uFetch("https://api.ipify.org?format=json", { dispatcher });
      const j = await r.json();
      return sendJson(res, 200, { ip: j.ip, status: r.status });
    }

    // ---- /fetch : POST JSON, returns JSON { body } (for HTML documents) ----
    if (url.pathname === "/fetch" && req.method === "POST") {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw.toString()); } catch { return sendJson(res, 400, { error: "Invalid JSON" }); }
      const target = body.url;
      if (!target) return sendJson(res, 400, { error: "Missing url" });
      const method = (body.method || "GET").toUpperCase();
      const headers = buildHeaders(req, target, true, body.contentType);
      const opts = { method, headers, dispatcher, redirect: "follow" };
      if (!["GET", "HEAD"].includes(method) && body.body != null) opts.body = String(body.body);

      const r = await uFetch(target, opts);
      const contentType = r.headers.get("content-type") || "";
      const finalUrl = r.url || target;
      const buf = Buffer.from(await r.arrayBuffer());
      const isText = /^(text\/|application\/(json|javascript|x-javascript|xml|xhtml\+xml))/i.test(contentType) || !contentType;
      const respBody = isText ? buf.toString("utf8") : buf.toString("base64");
