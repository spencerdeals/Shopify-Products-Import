// backend/fastScraper.js
// Production-safe API server for Instant Import
// - Trust proxy + strict CORS allowlist
// - Health endpoints: /ping, /health
// - Unified /products?url=... endpoint
// - Scraping strategy: Zyte primary → GPT enrichment → GPT fallback

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

require('dotenv').config();

// Optional modules (don’t crash if absent)
let ZyteScraper, gptParser, boxEstimator, adaptiveScraper;
try { ZyteScraper = require('./zyteScraper'); } catch { ZyteScraper = null; }
try { gptParser = require('./gptParser'); } catch { gptParser = null; }
try { boxEstimator = require('./boxEstimator'); } catch { boxEstimator = null; }
try { adaptiveScraper = require('./adaptiveScraper'); } catch { adaptiveScraper = null; }

const app = express();
app.set('trust proxy', true);

// ---- CORS (allowlist prod + common localhost ports) ----
const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:8080',
    'http://localhost:3000',
    'https://sdl.bm',
    'https://www.sdl.bm',
    /\.railway\.app$/,
    /\.vercel\.app$/,
    /\.netlify\.app$/
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---- Rate limit (clean) ----
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // up to 120 requests/min per IP
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// ---- Static frontend (optional) ----
app.use(express.static(path.join(__dirname, '../frontend')));

// ---- Helpers ----
const zyte = ZyteScraper ? new ZyteScraper() : null;

function detectRetailer(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return 'Unknown';
  }
}

function missingCritical(p) {
  if (!p) return true;
  const hasCritical = p.name && p.price && p.price > 0;
  const hasOptional = p.dimensions || p.weight || p.image;
  return !hasCritical || !hasOptional;
}

function detectEngine(zyteUsed, gptUsed, enriched) {
  if (zyteUsed && gptUsed && enriched) return 'Zyte + GPT-enriched';
  if (zyteUsed && !gptUsed) return 'Zyte-only';
  if (!zyteUsed && gptUsed) return 'GPT-only';
  if (zyteUsed && gptUsed && !enriched) return 'Zyte + GPT-fallback';
  return 'Adaptive-fallback';
}

// ---- Health ----
app.get('/ping', (_req, res) => res.json({ ok: true }));
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    scrapers: {
      zyte: zyte && zyte.enabled ? 'enabled' : 'disabled',
      gpt: gptParser && typeof gptParser.parseProduct === 'function' ? 'enabled' : 'disabled',
      adaptive: adaptiveScraper ? 'enabled' : 'disabled'
    }
  });
});

// ---- Scraping core: Zyte → GPT enrich → GPT fallback ----
async function scrapeProductData(url) {
  console.log(`[Scraper] Start: ${String(url).slice(0, 120)}`);
  const retailer = detectRetailer(url);

  let base = null;
  let zyteUsed = false;
  let gptUsed = false;
  let enriched = false;

  // 1) Zyte primary
  if (zyte?.enabled && typeof zyte.scrapeProduct === 'function') {
    try {
      console.log('[Scraper] 🕷️ Zyte primary…');
      base = await zyte.scrapeProduct(url);
      zyteUsed = true;
    } catch (e) {
      console.log('[Scraper] ⚠️ Zyte failed:', e?.message || e);
      base = null;
    }
  }

  // 2) GPT enrichment or fallback
  if (gptParser && typeof gptParser.parseProduct === 'function') {
    try {
      if (base && missingCritical(base)) {
        console.log('[Scraper] 🤖 GPT enrichment…');
        const g = await gptParser.parseProduct(url);
        gptUsed = true;
        enriched = true;
        if (g) {
          base = {
            ...base,
            name: base.name || g.name,
            price: base.price || g.price,
            image: base.image || g.image,
            dimensions: base.dimensions || g.dimensions,
            weight: base.weight || g.weight,
            variant: base.variant || g.variant,
            selectedVariants: base.selectedVariants || g.selectedVariants,
            assemblyFee: base.assemblyFee || g.assemblyFee,
            isFlatPacked: (base.isFlatPacked ?? g.isFlatPacked),
            brand: base.brand || g.brand,
            category: base.category || g.category,
            confidence: Math.max(base.confidence || 0, g.confidence || 0)
          };
        }
      } else if (!base) {
        console.log('[Scraper] 🤖 GPT fallback…');
        const g = await gptParser.parseProduct(url);
        gptUsed = true;
        if (g && g.name && g.price) base = g;
      }
    } catch (e) {
      console.log('[Scraper] ⚠️ GPT step failed:', e?.message || e);
    }
  }

  if (!base || !base.name || !base.price) {
    if (adaptiveScraper && typeof adaptiveScraper.recordScrapingAttempt === 'function') {
      try { await adaptiveScraper.recordScrapingAttempt(url, retailer, false, null, ['all_methods_failed']); } catch {}
    }
    throw new Error('All scraping methods failed');
  }

  // 3) finalize + estimate box if needed
  if (boxEstimator && !base.dimensions && !base.estimatedBoxes) {
    try {
      const boxes = boxEstimator.estimateBoxDimensions(base);
      base.estimatedBoxes = boxes;
      base.dimensions = boxes?.[0];
    } catch {}
  }

  base.url = url;
  base.retailer = base.retailer || retailer;
  base.scrapedAt = new Date().toISOString();
  base.engine = detectEngine(zyteUsed, gptUsed, enriched);

  if (adaptiveScraper && typeof adaptiveScraper.recordScrapingAttempt === 'function') {
    try { await adaptiveScraper.recordScrapingAttempt(url, retailer, true, base); } catch {}
  }

  console.log(`[Scraper] ✅ Done (${base.engine})`);
  return base;
}

// ---- API route ----
// GET /products?url=<product URL>
app.get('/products', async (req, res) => {
  try {
    const url = String(req.query.url || '').trim();
    if (!url) return res.status(400).json({ error: 'Missing url param' });
    const product = await scrapeProductData(url);
    res.json({ products: product, engine: product.engine || 'unknown' });
  } catch (e) {
    console.error('UNEXPECTED:', e);
    res.status(500).json({ error: 'UNEXPECTED', message: String(e?.message || e) });
  }
});

// ---- Start server ----
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 SDL Import Calculator running on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/ping`);
});

module.exports = app;
