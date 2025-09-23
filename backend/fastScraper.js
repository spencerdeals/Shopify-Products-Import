const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const ZyteScraper = require('./zyteScraper');
const { parseProduct } = require('./gptParser');

const app = express();
const PORT = process.env.PORT || 8080;

// Trust Railway proxy for correct IP handling (fixes express-rate-limit warning)
app.set('trust proxy', 1);

// CORS configuration with production allowlist
const allowed = [
  'https://sdl.bm',
  'https://www.sdl.bm',
  'https://bermuda-import-calculator-production.up.railway.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080'
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowed.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'OPTIONS']
};

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use(cors(corsOptions));
app.use(express.json());
app.use(limiter);

// Initialize scrapers
const zyteScraper = new ZyteScraper();

// Tiered price sanity guard helpers
function toNumber(x) {
  if (typeof x === 'number') return x;
  if (!x) return NaN;
  const cleaned = String(x).replace(/[^\d.\-]/g, '').replace(/,/g, '');
  return parseFloat(cleaned);
}

function detectTier(item) {
  const name = ((item.name || '') + ' ' + (item.breadcrumbs || []).join(' ')).toLowerCase();
  const vol = Number(item.volumeFt3) || 0;
  if (vol > 20 || /sectional|chaise|3-?seater|4-?seater/.test(name)) return { tier: 'LARGE', min: 200 };
  if (vol >= 10 || /sofa|couch|loveseat/.test(name)) return { tier: 'MEDIUM', min: 100 };
  return { tier: 'SMALL', min: 50 };
}

function pickPrice(z) {
  const order = ['currentPrice', 'salePrice', 'regularPrice', 'listPrice', 'price'];
  const candidates = order.map(k => ({ k, n: toNumber(z?.[k]) })).filter(c => Number.isFinite(c.n) && c.n > 0);
  if (candidates.length === 0) return null;
  const { tier, min } = detectTier(z || {});
  
  // Pick first in priority that meets min
  for (const c of candidates) {
    if (c.n >= min) return { ...c, tier };
  }
  
  // Else pick highest candidate that meets min
  const sane = candidates.filter(c => c.n >= min);
  if (sane.length) return { ...sane.sort((a, b) => b.n - a.n)[0], tier };
  return { tier, none: true };
}

// Enhanced image selection logic
function selectImage(productData, selectedVariant) {
  // Prefer hero/main image
  const hero = productData?.mainImage || productData?.heroImage || productData?.primary_image;
  if (isGoodImage(hero)) {
    return { url: hero.url || hero, reason: 'hero' };
  }

  // Try variant-linked image
  if (selectedVariant && productData?.images) {
    const variantImage = productData.images.find(img => {
      const alt = (img.alt || img.title || '').toLowerCase();
      const variantColor = (selectedVariant.color || '').toLowerCase();
      return variantColor && alt.includes(variantColor);
    });
    if (isGoodImage(variantImage)) {
      return { url: variantImage.url || variantImage, reason: 'variant' };
    }
  }

  // Pick largest good image
  if (productData?.images && Array.isArray(productData.images)) {
    const goodImages = productData.images
      .filter(isGoodImage)
      .map(img => ({
        url: img.url || img,
        width: img.width || 0,
        height: img.height || 0,
        size: (img.width || 0) * (img.height || 0)
      }))
      .filter(img => img.width >= 600 && img.height >= 600)
      .sort((a, b) => b.size - a.size);

    if (goodImages.length > 0) {
      return { url: goodImages[0].url, reason: 'largest' };
    }
  }

  return { url: null, reason: 'none' };
}

function isGoodImage(img) {
  if (!img) return false;
  const url = img.url || img;
  if (typeof url !== 'string' || !url.startsWith('http')) return false;
  return !/sprite|placeholder|blank|thumb/i.test(url);
}

// Health endpoints - /ping primary, /health alias
app.get('/ping', (req, res) => {
  res.json({ ok: true, service: 'instant-import' });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'instant-import' });
});

// Main products endpoint
app.get('/products', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    console.log(`Processing request for URL: ${url}`);

    let productData = null;
    let engine = 'unknown';
    let skipGPT = false;

    // Try Zyte first
    try {
      productData = await zyteScraper.scrapeProduct(url);
      
      // Apply price selection logic
      if (productData) {
        const priceResult = pickPrice(productData);
        
        if (priceResult && !priceResult.none) {
          productData.price = priceResult.n;
          productData.priceSource = priceResult.k;
          console.log(`Selected price: $${priceResult.n} (source: ${priceResult.k}) - tier: ${priceResult.tier}`);
        } else {
          productData.price = undefined;
          productData.engineNote = 'price_unsure';
          const tier = priceResult?.tier || 'UNKNOWN';
          console.log(`Selected price: none (price_unsure) - tier: ${tier}`);
        }

        // Apply image selection logic
        const imageResult = selectImage(productData, productData.variant);
        if (imageResult.url) {
          productData.image = imageResult.url;
          productData.imageReason = imageResult.reason;
          console.log(`Selected image: ${imageResult.url} (reason: ${imageResult.reason})`);
        } else {
          console.log('Selected image: none (reason: none)');
        }
      }
      
      // Check if we should skip GPT
      const confidence = productData?.confidence || 0;
      const hasSanePrice = productData?.price && productData.price > 0;
      
      if (confidence >= 0.90 && hasSanePrice) {
        skipGPT = true;
        console.log('Skip GPT: true (Zyte high confidence & price sane)');
        engine = 'Zyte';
      }
    } catch (error) {
      console.log('Zyte scraping failed:', error.message);
    }

    // GPT enrichment/fallback
    if (!skipGPT) {
      try {
        if (productData && productData.price) {
          // GPT enrichment
          const gptData = await parseProduct(url);
          // Merge GPT data while keeping Zyte price/image selections
          productData = { ...gptData, ...productData };
          engine = 'GPT-enriched';
        } else {
          // GPT fallback
          productData = await parseProduct(url);
          engine = 'GPT-only';
        }
      } catch (error) {
        if (error.message.includes('401') || error.message.includes('invalid key')) {
          console.log('GPT skipped: no valid key (401)');
        } else {
          console.log('GPT failed:', error.message);
        }
        
        if (!productData) {
          throw new Error('All scraping methods failed');
        }
      }
    }

    console.log(`Handled by: ${engine}`);

    // Calculate volume if dimensions available
    if (productData?.dimensions) {
      const { length, width, height } = productData.dimensions;
      if (length && width && height) {
        productData.volumeFt3 = (length * width * height) / 1728;
      }
    }

    res.json({
      products: [productData],
      engine: engine
    });

  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ 
      error: 'Failed to scrape product',
      message: error.message 
    });
  }
});

// Serve frontend build (handles /form and other frontend routes)
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 SDL Import Calculator running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/ping`);
});

module.exports = app;