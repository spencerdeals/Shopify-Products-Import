"use strict";
const express = require("express");

module.exports = function devTools() {
  const r = express.Router();

  // Alias so your old link works too
  r.get("/instant-import/health", (_req, res) => {
    res.status(200).json({ ok: true, aliasOf: "/health" });
  });

  // Version info (Railway exposes these when linked to GitHub)
  r.get("/__version", (_req, res) => {
    res.json({
      sha: process.env.RAILWAY_GIT_COMMIT_SHA || null,
      message: process.env.RAILWAY_GIT_COMMIT_MESSAGE || null,
      version: process.env.npm_package_version || null
    });
  });

  // Simple in-app test page (same origin = no CORS)
  r.get("/__test", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Instant Import — Test</title>
<style>
  body{font-family:system-ui,Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;line-height:1.45}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
  input,button{font:inherit}
  input[type=text]{flex:1;min-width:360px;padding:10px;border:1px solid #ccc;border-radius:10px}
  button{padding:10px 14px;border:1px solid #ccc;border-radius:10px;background:#f4f4f4;cursor:pointer}
  pre{white-space:pre-wrap;background:#fafafa;border:1px solid #eee;padding:12px;border-radius:10px;max-height:440px;overflow:auto}
  small{color:#666}
</style>
</head>
<body>
<h1>Instant Import — Browser Test</h1>
<div class="row">
  <input id="url" type="text" placeholder="Paste a product URL (e.g., a Wayfair product page)"/>
</div>
<div class="row">
  <button onclick="post('/fast-scraper')">Test /fast-scraper</button>
  <button onclick="post('/quote')">Test /quote</button>
  <button onclick="openPath('/health')">Open /health</button>
  <button onclick="openPath('/instant-import/health')">Open /instant-import/health</button>
  <button onclick="openPath('/__version')">Open /__version</button>
</div>
<small>This page calls your server from the same origin (no CORS). Nothing is stored on your Mac.</small>
<pre id="out">(results will appear here)</pre>
<script>
async function post(path){
  const url = document.getElementById('url').value.trim();
  const out = document.getElementById('out');
  out.textContent = "Working...";
  try{
    const res = await fetch(path, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(url ? { url } : {})
    });
    const text = await res.text();
    out.textContent = "HTTP " + res.status + "\\n\\n" + text;
  }catch(e){
    out.textContent = "ERROR: " + (e && e.message ? e.message : e);
  }
}
function openPath(p){ window.open(p, "_blank"); }
</script>
</body>
</html>`);
  });

  return r;
};