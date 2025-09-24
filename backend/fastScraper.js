// backend/fastScraper.js — production-safe server for Instant Import
const express = require('express');
const cors = require('cors');
const path = require('path');

// Optional modules; handle if missing
let zyte;
try { zyte = require('./zyteScraper'); } catch { zyte = null; }
let gpt;
try { gpt = require('./gptParser'); } catch { gpt = null; }

const app = express();
app.set('trust proxy', 1); // behind proxy (Railway), avoids rate-limit XFF warning
app.use(express.json({ limit: '1mb' }));

// CORS allowlist: prod + common local dev ports
const ALLOWED = new Set([
  'https://sdl.bm',
  'https://www.sdl.bm',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080'
]);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow curl/postman
    const ok = ALLOWED.has(origin);
    if (!ok) console.log('CORS blocked origin:', origin);
    cb(null, ok);
  },
  methods: ['GET','POST','OPTIONS'],
  credentials: true
}));

// Health endpoints
app.get('/ping', (_req, res) => res.json({ ok: true, service: 'instant-import' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

// Serve the form (frontend)
app.get('/form', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'frontend', 'index.html'));
});

// Price + image helpers
function toNumber(x) {
  if (typeof x === 'number') return x;
  if (typeof x !== 'string') return NaN;
  const cleaned = x.replace(/[\s,$£€¥A-Za-z]/g, '').replace(/,/g, '');
  return parseFloat(cleaned);
}
function tierFor(z) {
  const name = ((z?.name || z?.title || '') + ' ' + (Array.isArray(z?.breadcrumbs) ? z.breadcrumbs.join(' ') : '')).toLowerCase();
  const vol = Number(z?.volumeFt3 || z?.volume || 0);
  if (vol > 20 || /(sectional|chaise|3-seater|4-seater)/.test(name)) return { tier: 'LARGE', min: 200 };
  if (vol >= 10 || /(sofa|couch|loveseat)/.test(name)) return { tier: 'MEDIUM', min: 100 };
  return { tier: 'SMALL', min: 50 };
}
function pickPrice(z) {
  const candidates = [
    { k: 'currentPrice', v: z?.currentPrice },
    { k: 'salePrice',    v: z?.salePrice },
    { k: 'regularPrice', v: z?.regularPrice },
    { k: 'listPrice',    v: z?.listPrice },
    { k: 'price',        v: z?.price }
  ]
    .filter(c => c.v != null)
    .map(c => ({ k: c.k, n: toNumber(c.v) }))
    .filter(c => isFinite(c.n) && c.n > 0);
  if (!candidates.length) return null;
  const order = ['currentPrice','salePrice','regularPrice','listPrice','price'];
  const byPriority = [...candidates].sort((a,b) => order.indexOf(a.k) - order.indexOf(b.k));
  const { min } = tierFor(z);
  let best = byPriority[0];
  if (best.n < min) {
    const sane = byPriority.find(c => c.n >= min);
    if (sane) best = sane; else return null;
  }
  return best; // {k,n}
}
function pickImage(z, selectedVariant) {
  const images = Array.isArray(z?.images) ? z.images : [];
  const hero = z?.mainImage || z?.heroImage || z?.primary_image;
  const isGood = (im) => {
    if (!im) return false; const url = typeof im === 'string' ? im : im.url;
    const w = im?.width ?? 0, h = im?.height ?? 0;
    if (!url || /sprite|placeholder|blank/.test(String(url))) return false;
    return (w >= 600 && h >= 600) || (w === 0 && h === 0);
  };
  const size = (im) => (im?.width||0) * (im?.height||0);
  if (isGood(hero)) return hero.url || hero;
  if (selectedVariant && images.length) {
    const v = images.find(im => {
      const txt = (im?.alt || im?.title || '').toLowerCase();
      const c = String(selectedVariant?.color||'').toLowerCase();
      return c && txt.includes(c);
    });
    if (isGood(v)) return v.url || v;
  }
  const good = images.filter(isGood).sort((a,b) => size(b)-size(a))[0];
  return good ? (good.url || good) : null;
}

// Unified /products endpoint
app.get('/products', async (req, res) => {
  const url = String(req.query.url || '');
  if (!url) return res.status(400).json({ error: 'MISSING_URL' });
  try {
    let engine = 'Zyte';
    let product = null;
    let zyteConfidence = 0;

    // 1) Primary: Zyte
    if (zyte?.extract) {
      try {
        const out = await zyte.extract(url);
        const z = out?.data || out || {};
        zyteConfidence = Number(out?.confidence || z?.confidence || 0);
        const pricePick = pickPrice(z);
        const imageUrl = pickImage(z, z?.selectedVariant);
        product = {
          title: z?.name || z?.title || '',
          price: pricePick?.n,
          priceSource: pricePick?.k,
          image: imageUrl || null,
          engineNote: pricePick ? undefined : 'price_unsure',
          raw: undefined
        };
        console.log(`Selected price: ${pricePick ? `$${pricePick.n} (source: ${pricePick.k})` : 'none (price_unsure)'}`);
        console.log(`Selected image: ${product.image ? product.image : 'none'}`);
      } catch (e) {
        console.log('Zyte failed:', String(e?.message || e));
        product = null;
      }
    }

    // 2) Skip GPT if Zyte high confidence + sane price
    const canSkipGPT = zyteConfidence >= 0.90 && product && !product.engineNote;
    if (canSkipGPT) {
      engine = 'Zyte';
    } else {
      // 3) Enrich with GPT (if available), else fallback
      const keyPresent = !!process.env.OPENAI_API_KEY;
      if (gpt?.enrich && keyPresent && product) {
        try {
          const enriched = await gpt.enrich(url, product);
          if (enriched && typeof enriched === 'object') {
            product = { ...product, ...enriched };
            engine = 'GPT-enriched';
          }
        } catch (e) {
          const msg = String(e?.message || e);
          if (/401|invalid api key/i.test(msg)) console.log('GPT skipped: no valid key');
          else console.log('GPT enrich error:', msg);
        }
      }
      if (!product && gpt?.parseOnly && keyPresent) {
        try {
          product = await gpt.parseOnly(url);
          engine = 'GPT-only';
        } catch (e) {
          console.log('GPT-only parse error:', String(e?.message || e));
        }
      }
    }

    if (!product) return res.status(502).json({ error: 'SCRAPE_FAILED' });
    console.log(`Handled by: ${engine}`);
    res.json({ products: product, engine });
  } catch (e) {
    console.error('UNEXPECTED:', e);
    res.status(500).json({ error: 'UNEXPECTED', message: String(e?.message || e) });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`SDL Import Calculator running on port ${port}`));
