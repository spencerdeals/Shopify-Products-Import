const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const ZyteScraper = require('./zyteScraper');
const { parseProduct } = require('./gptParser');

const app = express();
const PORT = process.env.PORT || 8080;

// CORS configuration with allowlist
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = ['https://sdl.bm', 'https://www.sdl.bm'];
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
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

// Price selection with tiered sanity guard
function selectPrice(productData) {
  const candidates = [
    { k: "currentPrice", v: productData?.currentPrice },
    { k: "salePrice", v: productData?.salePrice },
    { k: "regularPrice", v: productData?.regularPrice },
    { k: "listPrice", v: productData?.listPrice },
    { k: "price", v: productData?.price }
  ]
  .filter(c => c.v != null)
  .map(c => ({ k: c.k, n: toNumber(c.v) }))
  .filter(c => isFinite(c.n) && c.n > 0);

  if (candidates.length === 0) return null;

  // Determine tier and minimum price
  const volumeFt3 = productData?.volumeFt3 || 0;
  const nameText = (productData?.name || '').toLowerCase();
  const breadcrumbText = (productData?.breadcrumbs || []).join(' ').toLowerCase();
  const searchText = `${nameText} ${breadcrumbText}`;

  let tier, minPrice;
  if (volumeFt3 > 20 || /sectional|chaise|3-seater|4-seater/.test(searchText)) {
    tier = 'LARGE';
    minPrice = 200;
  } else if (volumeFt3 >= 10 || /sofa|couch|loveseat/.test(searchText)) {
    tier = 'MEDIUM';
    minPrice = 100;
  } else {
    tier = 'SMALL';
    minPrice = 50;
  }

  // Try candidates in priority order
  const priorityOrder = ["currentPrice", "salePrice", "regularPrice", "listPrice", "price"];
  for (const fieldName of priorityOrder) {
    const candidate = candidates.find(c => c.k === fieldName);
    if (candidate && candidate.n >= minPrice) {
      return { k: candidate.k, n: candidate.n, tier, minPrice };
    }
  }

  // If none in priority order meet tier, pick highest that meets tier
  const validCandidates = candidates.filter(c => c.n >= minPrice);
  if (validCandidates.length > 0) {
    const highest = validCandidates.sort((a, b) => b.n - a.n)[0];
    return { k: highest.k, n: highest.n, tier, minPrice };
  }

  // None meet tier requirement
  return { tier, minPrice, failed: true };
}

function toNumber(x) {
  if (typeof x === "number") return x;
  if (typeof x !== "string") return NaN;
  const cleaned = x.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  return parseFloat(cleaned);
}

// Image selection logic
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

// Health endpoints
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'instant-import' });
});

app.get('/ping', (req, res) => {
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

    // Apply price selection logic
    if (productData) {
      const priceResult = selectPrice(productData);
      
      if (priceResult && !priceResult.failed) {
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
        console.log(`Selected image: ${imageResult.url} (reason: ${imageResult.reason})`);
      } else {
        console.log('Selected image: none');
      }
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
          console.log('GPT skipped: no valid key or 401');
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

app.listen(PORT, () => {
  console.log(`🚀 SDL Import Calculator running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/ping`);
});

module.exports = app;