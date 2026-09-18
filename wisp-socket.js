import {connectTunnel} from "./connect-tunnel.js";
import {upstreamPool} from "./upstream-pool.js";

const RETRYABLE = /^(CONNECT_HTTP_(429|500|502|503|504)|CONNECT_TIMEOUT|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN)$/;

export default function socketForSession(session, trace) {
  return class ResidentialTCPSocket {
    constructor(hostname, port) {
      this.hostname = hostname;
      this.port = port;
      this.socket = null;
      this.closed = false;
      this.queue = [];
      this.waiter = null;
      this.report = { targetHost: hostname, targetPort: port, transport: "http-connect", upstream: session.upstream.id, receivedBytes: 0, sentBytes: 0, stage: "created", attempts: 0 };
      trace.streams.push(this.report);
    }

    log(label, extra = {}) {
      if (process.env.WISP_DIAGNOSTICS !== "0" || label === "WISP ERROR") console.log("[" + label + "]", JSON.stringify({ connection: trace.id, session: session.cookie.split(".")[0], ...this.report, ...extra }));
    }

    async connect() {
      this.log("WISP REQUEST");
      const pool = upstreamPool();
      const primary = Math.max(0, pool.findIndex(entry => entry.id === session.upstream.id));
      const limit = Math.min(pool.length, 6);
      let socket;
      let lastError;

      for (let attempt = 0; attempt < limit; attempt++) {
        const upstream = pool[(primary + attempt) % pool.length];
        this.report.upstream = upstream.id;
        this.report.attempts = attempt + 1;
        this.report.stage = "upstream-connect";
        delete this.report.error;
        delete this.report.connectStatus;
        try {
          socket = await connectTunnel(upstream, this.hostname, this.port, this.report);
          session.upstream = upstream;
          break;
        } catch (error) {
          lastError = error;
          const code = error.code || "CONNECT_FAILED";
          if (!RETRYABLE.test(code) || attempt === limit - 1) break;
          this.log("WISP RETRY", { error: code, nextUpstream: pool[(primary + attempt + 1) % pool.length].id });
        }
      }

      if (!socket) {
        this.report.error = lastError?.code || "CONNECT_FAILED";
        this.log("WISP ERROR");
        throw new Error(this.report.error);
      }
      if (this.closed) { socket.destroy(); return; }
      this.socket = socket;
      socket.on("data", data => {
        this.report.receivedBytes += data.length;
        if (this.waiter) { const resolve = this.waiter; this.waiter = null; resolve(data); }
        else { this.queue.push(data); socket.pause(); }
      });
      socket.on("error", error => { this.report.error = error.code || "TUNNEL_ERROR"; this.log("WISP ERROR"); });
      socket.once("close", () => {
        this.closed = true;
        if (this.waiter) { this.waiter(null); this.waiter = null; }
        this.log("WISP RESPONSE", { responseSize: this.report.receivedBytes });
      });
      this.log("WISP CONNECT", { connectStatus: this.report.connectStatus });
      socket.resume();
    }

    recv() { if (this.queue.length) return Promise.resolve(this.queue.shift()); if (this.closed) return Promise.resolve(null); return new Promise(resolve => { this.waiter = resolve; this.socket?.resume(); }); }
    send(data) { if (!this.socket || this.closed) return Promise.reject(new Error("TUNNEL_CLOSED")); this.report.sentBytes += data.length; return new Promise((resolve, reject) => this.socket.write(data, error => error ? reject(new Error("TUNNEL_WRITE_FAILED")) : resolve())); }
    pause() { this.socket?.pause(); }
    resume() { if (!this.queue.length && !this.closed) this.socket?.resume(); }
    close() { this.closed = true; this.socket?.destroy(); this.queue = []; if (this.waiter) { this.waiter(null); this.waiter = null; } }
  };
}
