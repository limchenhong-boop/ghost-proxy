// Ghost Proxy Gateway — Scramjet interception proxy
//
// Serves the Scramjet static files, a Wisp WebSocket transport, and a custom
// proxy page that the Base44 app embeds in an iframe. The service worker
// (registered by the proxy page) intercepts all requests from the proxied
// site and routes them through the Wisp server, giving full SPA support
// (YouTube, TikTok, etc.) that the old srcDoc approach couldn't match.
//
// Endpoints:
//   GET  /                  -> proxy.html (the proxy page)
//   GET  /scram/*           -> Scramjet core files (wasm, js)
//   GET  /libcurl/*         -> libcurl transport files
//   GET  /baremux/*         -> BareMux connection files
//   GET  /sw.js             -> service worker
//   GET  /config.js         -> scramjet config
//   WS   /wisp/             -> Wisp WebSocket transport
//   GET  /health            -> { ok: true }
//
// Env:
//   PORT   listen port (default 8080)

import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicPath = join(__dirname, "public");
const PORT = parseInt(process.env.PORT || "8080", 10);

// Silence wisp debug logs
logging.set_level(logging.NONE);

// Wisp configuration — direct HTTP requests (no residential proxy needed
// for most sites; the Scramjet rewriter handles cookies, CSP, etc.)
Object.assign(wisp.options, {
  allow_udp_streams: false,
  dns_servers: ["1.1.1.1", "1.0.0.1"],
});

const fastify = Fastify({
  serverFactory: (handler) => {
    return createServer()
      .on("request", (req, res) => {
        // COOP/COEP headers — required for SharedArrayBuffer (libcurl WASM)
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        handler(req, res);
      })
      .on("upgrade", (req, socket, head) => {
        if (req.url.endsWith("/wisp/")) {
          wisp.routeRequest(req, socket, head);
        } else {
          socket.end();
        }
      });
  },
});

// Serve our custom proxy page + service worker
fastify.register(fastifyStatic, {
  root: publicPath,
  decorateReply: true,
});

// Explicit routes for critical proxy files (reliable fallback)
fastify.get("/proxy.html", (req, reply) => reply.sendFile("proxy.html"));
fastify.get("/proxy.js", (req, reply) => reply.sendFile("proxy.js"));
fastify.get("/sw.js", (req, reply) => reply.sendFile("sw.js"));
fastify.get("/config.js", (req, reply) => reply.sendFile("config.js"));

// Serve Scramjet core files at /scram/
fastify.register(fastifyStatic, {
  root: scramjetPath,
  prefix: "/scram/",
  decorateReply: false,
});

// Serve libcurl transport at /libcurl/
fastify.register(fastifyStatic, {
  root: libcurlPath,
  prefix: "/libcurl/",
  decorateReply: false,
});

// Serve BareMux at /baremux/
fastify.register(fastifyStatic, {
  root: baremuxPath,
  prefix: "/baremux/",
  decorateReply: false,
});

fastify.get("/health", async () => ({ ok: true, build: "scramjet-v4" }));

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Ghost Proxy (Scramjet) gateway listening on :${PORT}`);
});
