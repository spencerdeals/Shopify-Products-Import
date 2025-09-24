// backend/fastScraper.js
// Production-safe server for Instant Import
// - trust proxy = 1 (Railway)
// - clean rate limit (120/min) on API routes
// - Routes:
//     GET  /            -> landing page with a simple form
//     GET  /scrape?url= -> browser-friendly test (no tools)
//     POST /scrape      -> JSON body: { "url": "https://..." }
//     POST /            -> same as /scrape (accepts JSON or form)

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

let ZyteScraper = null;
let parseProduct = null;
try { ZyteScraper = require('./zyteScraper'); } catch (_) {}
try { ({ parseProduct } = require('./gptParser')); } catch (_) {}

const app = express();
const PORT = process.env.PORT || 8080;

// Behind Railway proxy
app.set('trust proxy', 1);

// Parsers + CORS
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limit API endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(['/scrape'], apiLimiter);

// Health + ping
app.get('/ping', (_req, res) => {
  res.status(200).json({ ok: true, t: new Date().toISOString() });
});

app.get('/health', (_req, res) => {
  const zyteEnabled = !!(process.env.ZYTE_API_KEY && process.env.ZYTE_API_KEY.trim());
  const gptEnabled  = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    scrapers: { zyte: zyteEnabled ? 'enabled' : 'disabled', gpt: gptEnabled ? 'enabled' : 'disabled', adaptive: 'enabled' },
  });
});

// Landing page with quick test form
app.get('/', (_req, res) => {
  res.status(200).type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>SDL Instant Import</title></head>
<body style="font-family: system-ui, sans-serif; line-height:1.4; padding:20px;">
  <h1>SDL Instant Import is running.</h1>
  <p><b>Health:</b> GET <code>/health</code><br>
     <b>Ping:</b> GET <code>/ping</code><br>
     <b>Scrape (browser):</b> GET <code>/scrape?url=&lt;product-url&gt;</code><br>
     <b>Scrape (API):</b> POST <code>/scrape</code> with JSON <code>{"url":"https://..."}</code>
  </p>
  <hr>
  <h2>Quick test</h2>
  <form method="GET" action="/scrape">
    <label>Product URL:
      <input name="url" type="url" style="width:480px" placeholder="https://example.com/product" required>
    </label>
    <button type="submit">Scrape (GET)</button>
  </form>
  <p style="color:#666; font-size:12px;">Tip: For API-style test, POST JSON to <code>/scrape</code>.</p>
</body></html>`);
});

// Shared scrape core
async function runScrape(url) {
  // Try Zyte first (if available and enabled)
  if (ZyteScraper) {
    try {
      const zyte = new ZyteScraper();
      if (zyte.enabled) {
        const data = await zyte.scrapeProduct(url);
        return { ok: true, method: 'zyte', data };
      }
    } catch (e) {
      console.log('Zyte failed:', e?.message || e);
    }
  }
  // Then GPT parser if present
  if (typeof parseProduct === 'function') {
    try {
      const data = await parseProduct(url);
      return { ok: true, method: 'gpt', data };
    } catch (e) {
      console.log('GPT failed:', e?.message || e);
    }
  }
  // Minimal fallback
  return {
    ok: true,
    method: 'basic',
    data: {
      url,
      message:
        'Advanced scrapers not configured. Set ZYTE_API_KEY and/or OPENAI_API_KEY in Railway for richer results.',
    },
  };
}

// GET /scrape?url=...
app.get('/scrape', async (req, res) => {
  const url = (req.query?.url || '').toString().trim();
  if (!url) return res.status(400).json({ error: 'Missing url query param' });
  try {
    const result = await runScrape(url);
    res.status(200).json(result);
  } catch (e) {
    console.error('GET /scrape error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// POST /scrape  (JSON {url})  and POST / alias (form or JSON)
async function handlePost(req, res) {
  const bodyUrl = (req.body?.url || '').toString().trim();
  if (!bodyUrl) return res.status(400).json({ error: 'Missing "url" in body' });
  try {
    const result = await runScrape(bodyUrl);
    res.status(200).json(result);
  } catch (e) {
    console.error('POST /scrape error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
}
app.post('/scrape', handlePost);
app.post('/', handlePost);

// Start
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
