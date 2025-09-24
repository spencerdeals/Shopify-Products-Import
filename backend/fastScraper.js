// backend/fastScraper.js
// Production-safe server for Instant Import
// - trust proxy (fixes express-rate-limit X-Forwarded-For warning)
// - clean rate limit (max: 120 / minute)
// - /ping, /health
// - /scrape POST  (and POST / alias)
// - helpful GET / landing

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

let ZyteScraper = null;
let parseProduct = null;

try { ZyteScraper = require('./zyteScraper'); } catch (_) {}
try { ({ parseProduct } = require('./gptParser')); } catch (_) {}

const app = express();
const PORT = process.env.PORT || 8080;

// ⚙️ Behind Railway proxy → required for correct client IPs
app.set('trust proxy', true);

// CORS + parsers
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ✅ Rate limit (apply to API endpoints only)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(['/scrape', '/ping', '/health', '/'], limiter);

// --- Health + ping ---
app.get('/ping', (_req, res) => {
  res.status(200).json({ ok: true, t: new Date().toISOString() });
});

app.get('/health', (_req, res) => {
  const zyteEnabled = !!(process.env.ZYTE_API_KEY && process.env.ZYTE_API_KEY.trim());
  const gptEnabled = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    scrapers: {
      zyte: zyteEnabled ? 'enabled' : 'disabled',
      gpt: gptEnabled ? 'enabled' : 'disabled',
      adaptive: 'enabled',
    },
  });
});

// --- Landing page (fixes "Cannot GET /") ---
app.get('/', (_req, res) => {
  res
    .status(200)
    .type('text/plain')
    .send(
`SDL Instant Import is running.

Health:   GET /health
Ping:     GET /ping
Scrape:   POST /scrape  (or POST /)
Body:     { "url": "https://example.com/product" }`
    );
});

// --- Scrape handler core ---
async function handleScrape(req, res) {
  try {
    const { url } = (req.body || {});
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing "url" string in JSON body.' });
    }

    // Try Zyte first (if present & enabled)
    if (ZyteScraper) {
      try {
        const zyte = new ZyteScraper();
        if (zyte.enabled) {
          const data = await zyte.scrapeProduct(url);
          return res.status(200).json({ ok: true, method: 'zyte', data });
        }
      } catch (e) {
        console.log('Zyte failed:', e?.message || e);
      }
    }

    // Try GPT parser if available
    if (typeof parseProduct === 'function') {
      try {
        const data = await parseProduct(url);
        return res.status(200).json({ ok: true, method: 'gpt', data });
      } catch (e) {
        console.log('GPT failed:', e?.message || e);
      }
    }

    // Minimal fallback
    return res.status(200).json({
      ok: true,
      method: 'basic',
      data: {
        url,
        message:
          'Advanced scrapers not configured. Set ZYTE_API_KEY and/or OPENAI_API_KEY in Railway for richer results.',
      },
    });
  } catch (err) {
    console.error('Unhandled /scrape error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

// --- Routes: /scrape and / (POST) ---
app.post('/scrape', handleScrape);
app.post('/', handleScrape);

// --- Start ---
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
