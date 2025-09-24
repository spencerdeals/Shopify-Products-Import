// backend/fastScraper.js
// Minimal, production-safe server with clean rate limit (max: 120)
// No dotenv required (Railway injects env). Defensive optional loaders.

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Try to load optional helpers if they exist in your repo
let ZyteScraper = null;
let parseProduct = null;

try {
  ZyteScraper = require('./zyteScraper');
} catch (_) {}

try {
  ({ parseProduct } = require('./gptParser'));
} catch (_) {}

const app = express();
const PORT = process.env.PORT || 8080;

// CORS + JSON
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ✅ Clean, safe rate-limit: 120 requests per minute
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Health + ping
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

// Basic scrape endpoint (safe; uses Zyte if present, else returns minimal info)
app.post('/scrape', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing "url" string in JSON body.' });
    }

    // If ZyteScraper class exists and appears enabled, try it
    if (ZyteScraper) {
      const zyte = new ZyteScraper();
      if (zyte.enabled) {
        try {
          const data = await zyte.scrapeProduct(url);
          return res.status(200).json({
            ok: true,
            method: 'zyte',
            data,
          });
        } catch (e) {
          // Fall through to GPT/basic if Zyte fails
          console.log('Zyte scrape failed:', e?.message || e);
        }
      }
    }

    // If parseProduct exists, try it
    if (typeof parseProduct === 'function') {
      try {
        const data = await parseProduct(url);
        return res.status(200).json({
          ok: true,
          method: 'gpt',
          data,
        });
      } catch (e) {
        console.log('GPT parse failed:', e?.message || e);
      }
    }

    // Minimal safe fallback
    return res.status(200).json({
      ok: true,
      method: 'basic',
      data: {
        url,
        message:
          'Advanced scrapers are not configured. Set ZYTE_API_KEY and/or OPENAI_API_KEY in Railway to enable richer results.',
      },
    });
  } catch (err) {
    console.error('Unhandled /scrape error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Start
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
