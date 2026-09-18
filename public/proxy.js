"use strict";

// Ghost Proxy — Scramjet proxy page
// Loaded inside an iframe by the Base44 app. Reads the target URL from the
// query string, registers the service worker, sets up the libcurl transport
// over Wisp, creates a Scramjet frame, and navigates to the target.

const params = new URLSearchParams(location.search);
const targetUrl = params.get("url") || "";

function showError(msg) {
  const el = document.getElementById("vp-error");
  document.getElementById("vp-error-msg").textContent = msg;
  el.style.display = "flex";
  document.getElementById("vp-loading").classList.add("hidden");
}

function hideLoading() {
  document.getElementById("vp-loading").classList.add("hidden");
}

function search(input, template) {
  try { return new URL(input).toString(); } catch {}
  try {
    const u = new URL("http://" + input);
    if (u.hostname.includes(".")) return u.toString();
  } catch {}
  return template.replace("%s", encodeURIComponent(input));
}

async function init() {
  if (!targetUrl) {
    showError("No URL provided.");
    return;
  }

  const url = search(targetUrl, "https://duckduckgo.com/html/?q=%s");

  // 1. Register the service worker (must be same-origin)
  if (!navigator.serviceWorker) {
    showError("Your browser doesn't support service workers.");
    return;
  }
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    showError("Failed to register service worker: " + err.message);
    return;
  }

  // 2. Initialize Scramjet controller
  let scramjet;
  try {
    const { ScramjetController } = $scramjetLoadController();
    scramjet = new ScramjetController({
      files: {
        wasm: "/scram/scramjet.wasm.wasm",
        all: "/scram/scramjet.all.js",
        sync: "/scram/scramjet.sync.js",
      },
    });
    scramjet.init();
  } catch (err) {
    showError("Failed to initialize Scramjet: " + err.message);
    return;
  }

  // 3. Set up BareMux + libcurl transport over Wisp WebSocket
  try {
    const wispUrl =
      (location.protocol === "https:" ? "wss" : "ws") +
      "://" + location.host + "/wisp/";
    const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
    if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
      await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
    }
  } catch (err) {
    showError("Failed to connect to the Wisp transport: " + err.message);
    return;
  }

  // 4. Create the Scramjet frame and navigate
  try {
    const frame = scramjet.createFrame();
    frame.frame.id = "sj-frame";
    frame.frame.style.width = "100vw";
    frame.frame.style.height = "100vh";
    frame.frame.style.border = "none";
    frame.frame.style.display = "block";
    document.body.appendChild(frame.frame);
    frame.go(url);
    // Hide loading once the frame has had a moment to start loading
    setTimeout(hideLoading, 1500);
  } catch (err) {
    showError("Failed to create proxy frame: " + err.message);
  }
}

init();
