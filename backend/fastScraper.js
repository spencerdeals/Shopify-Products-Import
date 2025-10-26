const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
require('dotenv').config();
const ZyteScraper = require('./zyteScraper');
const { parseProduct: parseWithGPT } = require('./gptParser');
let estimateCarton;
try {
  ({ estimateCarton } = require('./utils/cartonEstimator'));
} catch (e) {
  estimateCarton = (p) => ({
    carton: { length_in: 36, width_in: 24, height_in: 18, boxes: 1 },
    cubic_feet: (36 * 24 * 18) / 1728,
    dimension_source: 'estimated',
    estimation_notes: 'fallback default'
  });
}
const { calculatePricing } = require('./pricing');
const { computeShippingAndHandling } = require('./utils/feeCalculator');
const { loadScrapeByKey, saveScrape } = require('./utils/db');
const adminRoutes = require('./routes/admin');
const { extractProPriceFromHTML } = require('./utils/extractProPriceFromHTML');
const { extractCartons } = require('./utils/cartonExtractors');
const { computePricing, computeFreight, computeDutyWharfage } = require('./utils/pricing');
const { calcFreightSmart } = require('./lib/freightEngine');
const { computeTotalsV41 } = require('./utils/pricingV41');
const torso = require('./torso');

// Simple, working scraper approach
const MAX_CONCURRENT = 1; // Process one at a time to avoid issues

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPING_TIMEOUT = 30000;
const MAX_CONCURRENT_SCRAPES = 2;
const BERMUDA_DUTY_RATE = 0.265;
const SHIPPING_RATE_PER_CUBIC_FOOT = 8;
const OCEAN_RATE_PER_FT3 = Number(process.env.OCEAN_RATE_PER_FT3 || 7);
const MULTIPLIER_FALLBACK = 1.95;
const MULTIPLIER_MIN = 1.7;
const MULTIPLIER_MAX = 2.5;

// === Variant helpers (multi-vendor) ===
function normalizeVariantText(v) {
  if (!v) return "";
  let t = typeof v === "string" ? v : JSON.stringify(v);
  return t.replace(/\s*selected\b/gi,"")
          .replace(/\s*out of stock\b/gi,"")
          .replace(/\s{2,}/g," ")
          .trim()
          .replace(/^[:\-\s]+/,"");
}
function pickSelectedVariants(all = [], url = "") {
  if (!Array.isArray(all) || all.length === 0) return [];
  const explicit = all.filter(x => /\bselected\b/i.test(typeof x === "string" ? x : JSON.stringify(x)));
  let fromUrl = [];
  try {
    if (url) {
      const u = new URL(url);
      const qs = u.search || "";
      const tokens = decodeURIComponent(qs).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      fromUrl = all.filter(x => {
        const s = (typeof x === "string" ? x : JSON.stringify(x)).toLowerCase();
        return tokens.some(t => t.length > 3 && s.includes(t));
      });
    }
  } catch {}
  let heuristic = [];
  if (!explicit.length && !fromUrl.length) {
    const byFacet = {};
    for (const v of all) {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      const facet = (s.match(/^\s*([A-Za-z ]+):/)?.[1] || "misc").toLowerCase();
      (byFacet[facet] ||= []).push(v);
    }
    for (const arr of Object.values(byFacet)) {
      const chosen = arr.find(v => !/out of stock/i.test(typeof v === "string" ? v : JSON.stringify(v))) || arr[0];
      if (chosen) heuristic.push(chosen);
    }
  }
  const picked = (explicit.length ? explicit : (fromUrl.length ? fromUrl : heuristic))
    .map(normalizeVariantText).filter(Boolean);
  const seen = new Set();
  return picked.filter(v => (seen.has(v) ? false : seen.add(v)));
}

// === NJ sales tax (per item) ===
const NJ_TAX_RATE = 0.06625;
function computeNjSalesTax({ unitPrice = 0, quantity = 1 }) {
  const base = (Number(unitPrice)||0)*(Number(quantity)||1);
  return Number((base * NJ_TAX_RATE).toFixed(2));
}

// === S&H clamp helpers ===
function clampByMultiplier(total, price, { minMult = 1.7, maxMult = 2.5, fallbackMult = 1.95 } = {}) {
  const p = Number(price)||0; if (p <= 0) return total;
  const min = p * minMult, max = p * maxMult;
  if (total < min || total > max) return p * fallbackMult;
  return total;
}
function capCartonByCategory(cuft, { title = "", category = "", brand = "" } = {}) {
  const hay = `${title} ${category} ${brand}`.toLowerCase();
  const caps = [
    { re:/sofa|sectional|chaise|loveseat/, cap: 40 },
    { re:/bed|headboard|frame/,           cap: 28 },
    { re:/dresser|sideboard/,             cap: 24 },
    { re:/tv stand|media console/,        cap: 20 },
    { re:/desk|table/,                    cap: 18 },
    { re:/cabinet|hutch/,                 cap: 18 },
    { re:/nightstand|end table/,          cap: 10 },
    { re:/chair|stool|ottoman/,           cap: 14 },
    { re:/lamp|lighting/,                 cap: 6  },
  ];
  let max = 22; for (const c of caps) if (c.re.test(hay)) { max = c.cap; break; }
  return Math.min(Math.max(0, Number(cuft)||0), max);
}

// Initialize scrapers
const zyteScraper = new ZyteScraper();
const USE_ZYTE = zyteScraper.enabled;
const USE_GPT_FALLBACK = !!process.env.OPENAI_API_KEY;

// Confidence threshold for triggering GPT fallback
const CONFIDENCE_THRESHOLD = 0.3; // If Zyte confidence < 30%, try GPT

// Initialize order tracker - DISABLED
// let orderTracker = null;
// 
// OrderTracker.create().then(tracker => {
//   orderTracker = tracker;
// }).catch(error => {
//   console.error('Failed to initialize order tracker:', error);
// });

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Zyte API - ${USE_ZYTE ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log(`2. Fallback: GPT Parser - ${USE_GPT_FALLBACK ? '✅ ENABLED' : '❌ DISABLED (Missing OpenAI Key)'}`);
console.log('');

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Fix for Railway X-Forwarded-For warning
app.set('trust proxy', true);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// CRITICAL: Health check MUST be before rate limiter
app.get('/health', (req, res) => {
  const version = require('./serverVersion');
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    port: PORT,
    scraping: {
      primary: USE_ZYTE ? 'Zyte API' : 'None',
      fallback: process.env.OPENAI_API_KEY ? 'GPT Parser' : 'None',
      dimensions: 'Estimation'
    },
    shopifyConfigured: !!SHOPIFY_ACCESS_TOKEN,
    version: version
  });
});

// Admin authentication middleware
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required');
  }
  
  const credentials = Buffer.from(auth.slice(6), 'base64').toString();
  const [username, password] = credentials.split(':');
  
  if (username === 'admin' && password === '1064') {
    next();
  } else {
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    res.status(401).send('Invalid credentials');
  }
}

// Admin routes
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

app.get('/admin-calculator', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin-calculator.html'));
});

// Root route - redirect to admin calculator
app.get('/', (req, res) => {
  res.redirect('/admin-calculator');
});

// REMOVED: complete-order page (now redirecting directly to Shopify checkoutUrl)
// app.get('/complete-order.html', (req, res) => {
//   const completePath = path.join(__dirname, '../frontend', 'complete-order.html');
//   res.sendFile(completePath, (err) => {
//     if (err) {
//       console.error('Error serving complete-order page:', err);
//       res.redirect('/');
//     }
//   });
// });

// Rate limiter (after health check)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  trustProxy: 1,
  keyGenerator: (req) => req.ip
});
app.use('/api/', limiter);

// Mount admin routes
app.use('/api/admin', adminRoutes);

// Mount order routes
const orderRoutes = require('./routes/order');
app.use('/api/order', orderRoutes);

const shopifyRouter = require('./routes/shopify');
app.use('/api/shopify', shopifyRouter);
console.log('[Shopify] Routes mounted at /api/shopify');

// Mount batch routes
const batchRoutes = require('./routes/batch');
app.use('/api/batch', batchRoutes);
console.log('[Batch] Routes mounted at /api/batch');

// Mount dimensions routes
const dimensionsRoutes = require('./routes/dimensions');
app.use('/api/quote', dimensionsRoutes);
console.log('[Dimensions] Routes mounted at /api/quote');

// Mount version route
const versionRoutes = require('./routes/version');
app.use('/version', versionRoutes);

// Utilities
function generateProductId() {
  return Date.now() + Math.random().toString(36).substr(2, 9);
}

function detectRetailer(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    if (domain.includes('amazon.com')) return 'Amazon';
    if (domain.includes('wayfair.com')) return 'Wayfair';
    if (domain.includes('target.com')) return 'Target';
    if (domain.includes('bestbuy.com')) return 'Best Buy';
    if (domain.includes('walmart.com')) return 'Walmart';
    if (domain.includes('homedepot.com')) return 'Home Depot';
    if (domain.includes('lowes.com')) return 'Lowes';
    if (domain.includes('costco.com')) return 'Costco';
    if (domain.includes('macys.com')) return 'Macys';
    if (domain.includes('ikea.com')) return 'IKEA';
    if (domain.includes('overstock.com')) return 'Overstock';
    if (domain.includes('bedbathandbeyond.com')) return 'Bed Bath & Beyond';
    if (domain.includes('cb2.com')) return 'CB2';
    if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
    if (domain.includes('westelm.com')) return 'West Elm';
    if (domain.includes('potterybarn.com')) return 'Pottery Barn';
    if (domain.includes('lunafurn.com')) return 'Luna Furniture';
    return 'Unknown Retailer';
  } catch (e) {
    return 'Unknown Retailer';
  }
}

// SDL Domain blocking function
function isSDLDomain(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    const blockedPatterns = [
      'spencer-deals-ltd.myshopify.com',
      'sdl.bm',
      'spencer-deals',
      'spencerdeals',
      'sdl.com',
      '.sdl.'
    ];
    
    return blockedPatterns.some(pattern => domain.includes(pattern));
  } catch (e) {
    return false;
  }
}

function categorizeProduct(name, url) {
  const text = (name + ' ' + url).toLowerCase();
  
  // Handle category objects from Zyte (convert to string)
  if (typeof name === 'object' && name.name) {
    const categoryText = name.name.toLowerCase();
    if (categoryText.includes('mattress')) return 'furniture';
    if (categoryText.includes('bedroom')) return 'furniture';
    if (categoryText.includes('furniture')) return 'furniture';
  }
  
  if (/\b(sofa|sectional|loveseat|couch|chair|recliner|ottoman|table|desk|dresser|nightstand|bookshelf|cabinet|wardrobe|armoire|bed|frame|headboard|mattress|dining|kitchen|office)\b/.test(text)) return 'furniture';
  if (/\b(tv|television|monitor|laptop|computer|tablet|phone|smartphone|camera|speaker|headphone|earbuds|router|gaming|console|xbox|playstation|nintendo)\b/.test(text)) return 'electronics';
  if (/\b(refrigerator|fridge|washer|dryer|dishwasher|microwave|oven|stove|range|freezer|ac|air.conditioner|heater|vacuum)\b/.test(text)) return 'appliances';
  if (/\b(shirt|pants|dress|jacket|coat|shoes|boots|sneakers|clothing|apparel|jeans|sweater|hoodie|shorts|skirt)\b/.test(text)) return 'clothing';
  if (/\b(book|novel|textbook|magazine|journal|encyclopedia|bible|dictionary)\b/.test(text)) return 'books';
  if (/\b(toy|game|puzzle|doll|action.figure|lego|playset|board.game|video.game|stuffed|plush)\b/.test(text)) return 'toys';
  if (/\b(exercise|fitness|gym|bike|bicycle|treadmill|weights|dumbbells|yoga|golf|tennis|basketball|football|soccer)\b/.test(text)) return 'sports';
  if (/\b(decor|decoration|vase|picture|frame|artwork|painting|candle|lamp|mirror|pillow|curtain|rug|carpet)\b/.test(text)) return 'home-decor';
  if (/\b(tool|hardware|drill|saw|hammer|screwdriver|wrench|toolbox)\b/.test(text)) return 'tools';
  if (/\b(garden|plant|pot|soil|fertilizer|hose|mower|outdoor)\b/.test(text)) return 'garden';
  return 'general';
}

function estimateWeight(dimensions, category) {
  const volume = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = Math.max(1, volume / 1728); // Minimum 1 cubic foot
  const densityFactors = {
    'furniture': 8, 'electronics': 15, 'appliances': 20, 'clothing': 3,
    'books': 25, 'toys': 5, 'sports': 10, 'home-decor': 6, 'general': 8
  };
  const density = densityFactors[category] || 8;
  const estimatedWeight = Math.max(1, cubicFeet * density);
  return Math.round(estimatedWeight * 10) / 10;
}

function estimateDimensions(category, name = '') {
  const text = name.toLowerCase();
  
  // Check if dimensions are in the name
  const dimMatch = text.match(/(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)/);
  if (dimMatch) {
    const dims = {
      length: Math.max(1, parseFloat(dimMatch[1]) * 1.2),
      width: Math.max(1, parseFloat(dimMatch[2]) * 1.2), 
      height: Math.max(1, parseFloat(dimMatch[3]) * 1.2)
    };
    
    if (dims.length <= 120 && dims.width <= 120 && dims.height <= 120) {
      return dims;
    }
  }
  
  // Enhanced category estimates with more realistic sizes
  const baseEstimates = {
    'furniture': { 
      length: 48 + Math.random() * 30,
      width: 30 + Math.random() * 20,  
      height: 36 + Math.random() * 24
    },
    'electronics': { 
      length: 18 + Math.random() * 15,
      width: 12 + Math.random() * 8,
      height: 8 + Math.random() * 6
    },
    'appliances': { 
      length: 30 + Math.random() * 12,
      width: 30 + Math.random() * 12,
      height: 36 + Math.random() * 20
    },
    'clothing': { 
      length: 12 + Math.random() * 6,
      width: 10 + Math.random() * 6,
      height: 2 + Math.random() * 2
    },
    'books': { 
      length: 8 + Math.random() * 3,
      width: 5 + Math.random() * 3,
      height: 1 + Math.random() * 2
    },
    'toys': { 
      length: 12 + Math.random() * 8,
      width: 10 + Math.random() * 8,
      height: 8 + Math.random() * 8
    },
    'sports': { 
      length: 24 + Math.random() * 12,
      width: 18 + Math.random() * 10,
      height: 12 + Math.random() * 8
    },
    'home-decor': { 
      length: 12 + Math.random() * 12,
      width: 10 + Math.random() * 10,
      height: 12 + Math.random() * 12
    },
    'tools': { 
      length: 18 + Math.random() * 6,
      width: 12 + Math.random() * 6,
      height: 6 + Math.random() * 4
    },
    'garden': { 
      length: 24 + Math.random() * 12,
      width: 18 + Math.random() * 12,
      height: 12 + Math.random() * 12
    },
    'general': { 
      length: 14 + Math.random() * 8,
      width: 12 + Math.random() * 6,
      height: 10 + Math.random() * 6
    }
  };
  
  const estimate = baseEstimates[category] || baseEstimates['general'];
  
  return {
    length: Math.round(estimate.length * 10) / 10,
    width: Math.round(estimate.width * 10) / 10,
    height: Math.round(estimate.height * 10) / 10
  };
}

// Convert product dimensions to shipping box dimensions
function estimateBoxDimensions(productDimensions, category) {
  if (!productDimensions) return null;
  
  // Add padding based on category
  const paddingFactors = {
    'electronics': 1.3,  // More padding for fragile items
    'appliances': 1.2,
    'furniture': 1.1,   // Less padding for large items
    'clothing': 1.4,     // More padding for soft goods
    'books': 1.2,
    'toys': 1.25,
    'sports': 1.2,
    'home-decor': 1.35,  // More padding for fragile decor
    'tools': 1.15,
    'garden': 1.2,
    'general': 1.25
  };
  
  const factor = paddingFactors[category] || 1.25;
  
  return {
    length: Math.round(productDimensions.length * factor * 10) / 10,
    width: Math.round(productDimensions.width * factor * 10) / 10,
    height: Math.round(productDimensions.height * factor * 10) / 10
  };
}

// Removed legacy calculateShippingCost function - now using computeFreight instead

// Enhanced GPT enhancement function
async function enhanceProductDataWithGPT(zyteData, url, retailer) {
  if (!process.env.OPENAI_API_KEY) {
    return zyteData;
  }
  
  try {
    console.log('   🧠 Enhancing product data with GPT intelligence...');
    
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const prompt = `Enhance this product data intelligently. Extract ALL meaningful variants (color, size, style, orientation) and realistic shipping box dimensions. Return valid JSON format.

Product: "${zyteData.name}"
Category: "${zyteData.category}"
Current Variant: "${zyteData.variant || 'none'}"
Current Price: $${zyteData.price || 'unknown'}
Current Dimensions: ${JSON.stringify(zyteData.dimensions)}
Retailer: ${retailer}
URL: ${url}

Rules:
1. VERIFY PRICE: If you see sale/current price info, return the SALE price, not regular price
1. Extract ALL meaningful variants: color, size, style, orientation, material
2. For furniture: Extract size (King, Queen, 63"), color (Navy, Gray), style (Left-facing, Right-facing)
3. Extract realistic shipping box dimensions based on product type
4. Get the main product image URL if available
5. Return valid JSON format with these fields:
   - "salePrice": actual sale price if different from current price
   - "allVariants": ["Color: Navy", "Size: King", "Orientation: Left-facing"]
   - "primaryVariant": "Navy King Left-facing Sectional"
   - "enhancedDimensions": {"length": X, "width": Y, "height": Z}
   - "mainImage": "https://..."

Examples:
- Sectional Sofa → allVariants: ["Color: Navy", "Size: 89.5W", "Orientation: Left-facing"], primaryVariant: "Navy 89.5W Left-facing"
- Standing Desk → allVariants: ["Color: Rustic Brown", "Size: 47.25W"], primaryVariant: "Rustic Brown 47.25W"
- Office Chair → allVariants: ["Color: Black", "Style: Ergonomic"], primaryVariant: "Black Ergonomic"`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a furniture expert. Enhance product data intelligently and return valid JSON format. PRIORITIZE SALE PRICES over regular prices.' },
        { role: 'user', content: prompt }
      ],
    });

    const enhancement = JSON.parse(response.choices[0].message.content || '{}');
    
    // SAFELY enhance the data (never replace, only improve)
    const enhanced = { ...zyteData };
    
    // Check if GPT found a better (sale) price
    if (enhancement.salePrice && typeof enhancement.salePrice === 'number' && enhancement.salePrice > 0 && enhancement.salePrice < zyteData.price) {
      enhanced.price = enhancement.salePrice;
      console.log(`   💰 Enhanced price: $${zyteData.price} → $${enhancement.salePrice} (sale price)`);
    } else if (enhancement.salePrice && typeof enhancement.salePrice === 'number' && enhancement.salePrice > 0) {
      // Even if it's not lower, use it if it's a valid sale price and significantly different
      const priceDifference = Math.abs(enhancement.salePrice - zyteData.price);
      if (priceDifference > zyteData.price * 0.1) { // More than 10% difference
        enhanced.price = enhancement.salePrice;
        console.log(`   💰 Enhanced price: $${zyteData.price} → $${enhancement.salePrice} (corrected price)`);
      }
    }
    
    // Enhance variants if GPT found better ones
    if (enhancement.allVariants && Array.isArray(enhancement.allVariants) && enhancement.allVariants.length > 0) {
      enhanced.allVariants = enhancement.allVariants;
      console.log(`   🎨 Enhanced variants: ${enhancement.allVariants.join(', ')}`);
    }
    
    if (enhancement.primaryVariant && enhancement.primaryVariant !== 'none' && enhancement.primaryVariant.length > 3) {
      enhanced.variant = enhancement.primaryVariant;
      console.log(`   🎨 Enhanced variant: "${zyteData.variant}" → "${enhancement.primaryVariant}"`);
    }
    
    // Enhance main image if GPT found a better one
    if (enhancement.mainImage && enhancement.mainImage.startsWith('http')) {
      enhanced.image = enhancement.mainImage;
      console.log(`   🖼️ Enhanced image URL`);
    }
    
    // Enhance dimensions if GPT found better ones
    if (enhancement.enhancedDimensions && 
        enhancement.enhancedDimensions.length > 0 &&
        enhancement.enhancedDimensions.width > 0 &&
        enhancement.enhancedDimensions.height > 0) {
      
      // Only use GPT dimensions if they seem more realistic
      const gptVolume = enhancement.enhancedDimensions.length * enhancement.enhancedDimensions.width * enhancement.enhancedDimensions.height;
      const currentVolume = zyteData.dimensions ? (zyteData.dimensions.length * zyteData.dimensions.width * zyteData.dimensions.height) : 0;
      
      // Use GPT dimensions if they're significantly larger (more realistic for furniture)
      if (gptVolume > currentVolume * 1.5) {
        enhanced.dimensions = enhancement.enhancedDimensions;
        console.log(`   📦 Enhanced dimensions: ${Math.round(gptVolume/1728 * 100)/100} ft³ vs ${Math.round(currentVolume/1728 * 100)/100} ft³`);
      }
    }
    
    return enhanced;
    
  } catch (error) {
    console.log('   ❌ GPT enhancement error:', error.message);
    return zyteData; // Return original data if enhancement fails
  }
}

// Check if IKEA product needs component collection
function checkIfIkeaNeedsComponents(productName, price) {
  const name = productName.toLowerCase();
  
  // Bed frames - typically 2-4 components
  if (/\b(bed|frame|headboard|footboard)\b/.test(name)) {
    if (price > 400) {
      return { count: 4, type: 'bed frame' }; // King/Queen beds
    } else if (price > 200) {
      return { count: 3, type: 'bed frame' }; // Full/Double beds
    } else {
      return { count: 2, type: 'bed frame' }; // Twin beds
    }
  }
  
  // Wardrobes/PAX - typically 3-6 components
  if (/\b(wardrobe|armoire|closet|pax)\b/.test(name)) {
    if (price > 500) {
      return { count: 6, type: 'wardrobe system' }; // Large PAX systems
    } else if (price > 300) {
      return { count: 4, type: 'wardrobe' }; // Medium wardrobes
    } else {
      return { count: 3, type: 'wardrobe' }; // Small wardrobes
    }
  }
  
  // Kitchen systems - typically 4-8 components
  if (/\b(kitchen|cabinet.*set|knoxhult|enhet)\b/.test(name)) {
    if (price > 1000) {
      return { count: 8, type: 'kitchen system' }; // Full kitchen
    } else if (price > 500) {
      return { count: 5, type: 'kitchen set' }; // Partial kitchen
    } else {
      return { count: 4, type: 'kitchen unit' }; // Small kitchen set
    }
  }
  
  // Sectional sofas - typically 2-4 components
  if (/\b(sectional|sofa.*section|corner.*sofa)\b/.test(name)) {
    if (price > 800) {
      return { count: 4, type: 'sectional sofa' }; // Large sectionals
    } else {
      return { count: 3, type: 'sectional sofa' }; // Small sectionals
    }
  }
  
  // Dining sets - typically 2-3 components (table + chairs)
  if (/\b(dining|table.*chair|chair.*table)\b/.test(name)) {
    return { count: 3, type: 'dining set' };
  }
  
  // Large storage/shelving - typically 2-3 components for tall units
  if (/\b(bookshelf|shelf.*unit|billy|hemnes.*bookcase|kallax)\b/.test(name) && price > 200) {
    return { count: 3, type: 'storage unit' };
  }
  
  // Large desks - typically 2 components
  if (/\b(desk|workstation|office.*table)\b/.test(name) && price > 300) {
    return { count: 2, type: 'desk system' };
  }
  
  return null; // Single component item
}

// Helper function to check if essential data is complete
function isDataComplete(productData) {
  return productData && 
         productData.name && 
         productData.name !== 'Unknown Product' &&
         productData.image && 
         productData.dimensions &&
         productData.dimensions.length > 0 &&
         productData.dimensions.width > 0 &&
         productData.dimensions.height > 0;
}

// Helper function to check if dimensions look suspicious/wrong
function dimensionsLookSuspicious(dimensions) {
  if (!dimensions) return true;
  
  const { length, width, height } = dimensions;
  
  // Check for missing or zero dimensions
  if (!length || !width || !height || length <= 0 || width <= 0 || height <= 0) {
    return true;
  }
  
  // Check for unreasonably small dimensions (likely extraction errors)
  if (length < 2 && width < 2 && height < 2) {
    return true;
  }
  
  // Check for unreasonably large dimensions (likely extraction errors)
  if (length > 200 || width > 200 || height > 200) {
    return true;
  }
  
  return false;
}

// IKEA Multi-Box Estimator - estimates total shipping volume for IKEA furniture
function estimateIkeaMultiBoxShipping(singleBoxDimensions, productName, price) {
  const name = productName.toLowerCase();
  const volume = singleBoxDimensions.length * singleBoxDimensions.width * singleBoxDimensions.height;
  
  console.log(`   🛏️ IKEA Multi-Box Analysis for: "${productName.substring(0, 50)}..."`);
  console.log(`   📦 Single box: ${singleBoxDimensions.length}" × ${singleBoxDimensions.width}" × ${singleBoxDimensions.height}" (${(volume/1728).toFixed(2)} ft³)`);
  
  let boxMultiplier = 1;
  let confidence = 'low';
  
  // Bed frames - typically 2-4 boxes depending on size
  if (/\b(bed|frame|headboard|footboard)\b/.test(name)) {
    if (price > 400) {
      boxMultiplier = 4; // King/Queen beds
      confidence = 'high';
    } else if (price > 200) {
      boxMultiplier = 3; // Full/Double beds
      confidence = 'medium';
    } else {
      boxMultiplier = 2; // Twin beds
      confidence = 'medium';
    }
  }
  // Wardrobes/Armoires - typically 3-6 boxes
  else if (/\b(wardrobe|armoire|closet|pax)\b/.test(name)) {
    if (price > 500) {
      boxMultiplier = 6; // Large PAX systems
      confidence = 'high';
    } else if (price > 300) {
      boxMultiplier = 4; // Medium wardrobes
      confidence = 'medium';
    } else {
      boxMultiplier = 3; // Small wardrobes
      confidence = 'medium';
    }
  }
  // Dining sets - typically 2-3 boxes (table + chairs)
  else if (/\b(dining|table.*chair|chair.*table)\b/.test(name)) {
    boxMultiplier = 3;
    confidence = 'medium';
  }
  // Sectional sofas - typically 2-4 boxes
  else if (/\b(sectional|sofa.*section|corner.*sofa)\b/.test(name)) {
    if (price > 800) {
      boxMultiplier = 4; // Large sectionals
      confidence = 'high';
    } else {
      boxMultiplier = 3; // Small sectionals
      confidence = 'medium';
    }
  }
  // Kitchen systems - typically 3-8 boxes
  else if (/\b(kitchen|cabinet.*set|knoxhult|enhet)\b/.test(name)) {
    if (price > 1000) {
      boxMultiplier = 8; // Full kitchen
      confidence = 'medium';
    } else if (price > 500) {
      boxMultiplier = 5; // Partial kitchen
      confidence = 'medium';
    } else {
      boxMultiplier = 3; // Small kitchen set
      confidence = 'low';
    }
  }
  // Bookshelves/Storage - typically 2-3 boxes for tall units
  else if (/\b(bookshelf|shelf.*unit|billy|hemnes.*bookcase|kallax)\b/.test(name)) {
    if (price > 200) {
      boxMultiplier = 3; // Tall/wide units
      confidence = 'medium';
    } else {
      boxMultiplier = 2; // Standard units
      confidence = 'medium';
    }
  }
  // Desks - typically 2 boxes for larger desks
  else if (/\b(desk|workstation|office.*table)\b/.test(name)) {
    if (price > 300) {
      boxMultiplier = 2; // Large desks
      confidence = 'medium';
    }
  }
  // Default for other furniture
  else if (price > 300) {
    boxMultiplier = 2; // Assume larger furniture ships in 2 boxes
    confidence = 'low';
  }
  
  // Calculate estimated total shipping dimensions
  // Strategy: Stack boxes efficiently (2x2 for 4 boxes, 2x3 for 6 boxes, etc.)
  let totalDimensions;
  
  if (boxMultiplier <= 2) {
    // Side by side
    totalDimensions = {
      length: singleBoxDimensions.length * boxMultiplier,
      width: singleBoxDimensions.width,
      height: singleBoxDimensions.height
    };
  } else if (boxMultiplier <= 4) {
    // 2x2 arrangement
    totalDimensions = {
      length: singleBoxDimensions.length * 2,
      width: singleBoxDimensions.width * 2,
      height: singleBoxDimensions.height
    };
  } else if (boxMultiplier <= 6) {
    // 2x3 arrangement
    totalDimensions = {
      length: singleBoxDimensions.length * 2,
      width: singleBoxDimensions.width * 3,
      height: singleBoxDimensions.height
    };
  } else {
    // 2x4 arrangement for 8 boxes
    totalDimensions = {
      length: singleBoxDimensions.length * 2,
      width: singleBoxDimensions.width * 4,
      height: singleBoxDimensions.height
    };
  }
  
  const totalVolume = totalDimensions.length * totalDimensions.width * totalDimensions.height;
  
  console.log(`   📊 IKEA Multi-Box Estimate:`);
  console.log(`   📊   Product type: ${getIkeaProductType(name)}`);
  console.log(`   📊   Estimated boxes: ${boxMultiplier} (confidence: ${confidence})`);
  console.log(`   📊   Total dimensions: ${totalDimensions.length}" × ${totalDimensions.width}" × ${totalDimensions.height}"`);
  console.log(`   📊   Total volume: ${(totalVolume/1728).toFixed(2)} ft³ (vs single box: ${(volume/1728).toFixed(2)} ft³)`);
  console.log(`   ⚠️   This is an ESTIMATE - actual IKEA shipping may vary`);
  
  return {
    dimensions: totalDimensions,
    boxCount: boxMultiplier,
    confidence: confidence,
    singleBoxVolume: volume / 1728,
    totalVolume: totalVolume / 1728,
    estimationMethod: 'ikea-multibox'
  };
}

function getIkeaProductType(name) {
  if (/\b(bed|frame|headboard)\b/.test(name)) return 'Bed Frame';
  if (/\b(wardrobe|armoire|pax)\b/.test(name)) return 'Wardrobe/Storage';
  if (/\b(dining|table.*chair)\b/.test(name)) return 'Dining Set';
  if (/\b(sectional|sofa.*section)\b/.test(name)) return 'Sectional Sofa';
  if (/\b(kitchen|cabinet.*set)\b/.test(name)) return 'Kitchen System';
  if (/\b(bookshelf|billy|kallax)\b/.test(name)) return 'Storage/Shelving';
  if (/\b(desk|workstation)\b/.test(name)) return 'Desk/Office';
  return 'Furniture';
}

// Merge product data from multiple sources
function mergeProductData(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  
  return {
    name: primary.name || secondary.name,
    price: primary.price || secondary.price,
    image: primary.image || secondary.image,
    dimensions: primary.dimensions || secondary.dimensions,
    weight: primary.weight || secondary.weight,
    brand: primary.brand || secondary.brand,
    category: primary.category || secondary.category,
    inStock: primary.inStock !== undefined ? primary.inStock : secondary.inStock,
    variant: primary.variant || secondary.variant
  };
}

// Main product scraping function
async function scrapeProduct(url) {
  // Normalize URL - ensure it has a protocol
  if (url && !url.match(/^https?:\/\//i)) {
    url = 'https://' + url;
  }

  const productId = generateProductId();
  const retailer = detectRetailer(url);

  let productData = null;
  let scrapingMethod = 'none';
  let confidence = null;
  let dbApplied = false;

  console.log(`\n🔍 Scraping: ${url}`);
  console.log(`   🏪 Retailer: ${retailer}`);

  // Load any admin overrides from DB
  try {
    const key = { retailer, url };
    const dbRecord = await loadScrapeByKey(key);
    if (dbRecord) {
      console.log(`   📂 DB record found - admin overrides will be applied`);
      dbApplied = true;
    }
  } catch (err) {
    console.warn(`   ⚠️  DB load failed: ${err.message}`);
  }
  
  // STEP 1: Try Zyte API first
  if (USE_ZYTE) {
    try {
      console.log('   🕷️ Trying Zyte API...');
      const zyteResult = await zyteScraper.scrapeProduct(url);
      
      if (zyteResult && zyteResult.name && zyteResult.price) {
        productData = zyteResult;
        scrapingMethod = 'zyte';
        confidence = zyteResult.confidence || null;
        console.log(`   ✅ Zyte success! Product: "${zyteResult.name.substring(0, 50)}..." Price: $${zyteResult.price}`);

        // Check for vendor-specific discount/pro price override from HTML
        if (zyteResult.browserHtml) {
          console.log(`   🔍 Checking for Pro/Sale price in HTML (browserHtml length: ${zyteResult.browserHtml.length} chars)`);
          const proPrice = extractProPriceFromHTML(zyteResult.browserHtml, url, true); // Enable debug
          console.log(`   🔍 Pro price extraction result: ${proPrice ? '$' + proPrice : 'null'} (Zyte price: $${zyteResult.price})`);
          if (proPrice && proPrice > 0 && proPrice !== zyteResult.price) {
            console.log(`   💰 ${retailer} discount price override: $${zyteResult.price} → $${proPrice}`);
            productData.price = proPrice;
          } else if (proPrice === zyteResult.price) {
            console.log(`   ℹ️  Pro price matches Zyte price, no override needed`);
          } else {
            console.log(`   ℹ️  No Pro/Sale price found in HTML, using Zyte price: $${zyteResult.price}`);
          }
        } else {
          console.log(`   ⚠️  No browserHtml available from Zyte, cannot check for Pro/Sale price`);
        }

        // Skip GPT enhancement if we already have excellent Zyte data
        if (productData.confidence && productData.confidence > 0.9) {
          console.log('   ✅ Skipping GPT enhancement - Zyte data is excellent');
        } else {
          console.log('   ⚠️ Zyte confidence low, skipping GPT to save time');
        }
      }
    
    } catch (error) {
      console.log('   ❌ Zyte API failed:', error.message);
      
      // STEP 2: Try GPT parser as fallback
      if (USE_GPT_FALLBACK) {
        try {
          console.log('   🤖 Trying GPT parser fallback...');
          const gptData = await parseWithGPT(url);
          
          // Check if GPT got essential data
          const gptHasEssentialData = gptData && gptData.name && gptData.price;
          
          if (gptHasEssentialData) {
            // Convert GPT parser format to our expected format
            productData = {
              name: gptData.name,
              price: gptData.price,
              image: gptData.image,
              dimensions: gptData.dimensions || gptData.package_dimensions,
              weight: gptData.weight || gptData.package_weight_lbs,
              brand: gptData.brand,
              category: gptData.category,
              inStock: gptData.inStock,
              variant: gptData.variant
            };
            scrapingMethod = 'gpt-fallback';
            console.log('   ✅ GPT parser fallback success!');
          } else {
            console.log('   ❌ GPT parser also missing essential data');
            throw new Error(`GPT parser failed: missing essential data (name: ${!!gptData?.name}, price: ${!!gptData?.price})`);
          }
        } catch (gptError) {
          console.log('   ❌ GPT parser fallback failed:', gptError.message);
          
          // Both Zyte and GPT failed - require manual entry
          console.log('   🚨 Both automated methods failed - requiring manual entry');
          scrapingMethod = 'manual-required';
        }
      } else {
        console.log('   ⚠️ No GPT fallback available (missing OpenAI API key)');
        scrapingMethod = 'manual-required';
      }
    }
  }
  
  // Check if manual entry is required
  if (scrapingMethod === 'manual-required') {
    console.log(`   ⚠️ ${retailer} requires manual entry - both automated methods failed`);
    return {
      id: productId,
      url: url,
      name: null,
      price: null,
      image: null,
      category: 'general',
      retailer: retailer,
      dimensions: null,
      weight: null,
      shippingCost: 0,
      scrapingMethod: 'manual-required',
      confidence: null,
      variant: null,
      manualEntryRequired: true,
      message: `${retailer} requires manual entry. Please copy and paste the webpage content.`,
      dataCompleteness: {
        hasName: false,
        hasImage: false,
        hasDimensions: false,
        hasWeight: false,
        hasPrice: false,
        hasVariant: false
      }
    };
  }
  
  // Check if IKEA component collection is needed
  if (retailer === 'IKEA' && productData && productData.name && productData.price) {
    const needsComponents = checkIfIkeaNeedsComponents(productData.name, productData.price);
    if (needsComponents) {
      console.log(`   🛏️ IKEA product likely has multiple components: ${productData.name}`);
    }
    // TEMPORARILY DISABLED FOR DEBUGGING - Let's see what Zyte actually returns
    // if (scrapingMethod === 'manual-required') { ... }
  }
  
  // Ensure we always have valid productData for successful scrapes
  if (!productData) {
    productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true,
      variant: null
    };
  }
  
  // Fill in missing data with estimations
  const productName = (productData && productData.name) ? productData.name : `Product from ${retailer}`;
  
  // Handle category - safely convert object to string if needed
  let category = null;
  if (productData && productData.category) {
    category = productData.category;
  }
  if (typeof category === 'object' && category && category.name) {
    category = category.name; // Extract string from Zyte category object
  }
  if (!category || typeof category !== 'string') {
    category = categorizeProduct(productName, url);
  }
  
  console.log(`   📂 Final category: "${category}"`);
  
  // STEP 3: IKEA Multi-Box Estimation
  if (retailer === 'IKEA' && productData && productData.dimensions && productData.name && productData.price) {
    const ikeaEstimate = estimateIkeaMultiBoxShipping(productData.dimensions, productData.name, productData.price);
    
    if (ikeaEstimate.boxCount > 1) {
      productData.dimensions = ikeaEstimate.dimensions;
      productData.ikeaMultiBox = {
        estimatedBoxes: ikeaEstimate.boxCount,
        confidence: ikeaEstimate.confidence,
        singleBoxVolume: ikeaEstimate.singleBoxVolume,
        totalVolume: ikeaEstimate.totalVolume,
        estimationMethod: ikeaEstimate.estimationMethod
      };
      
      scrapingMethod = scrapingMethod + '+ikea-multibox';
      
      console.log(`   🎯 Applied IKEA multi-box estimation (${ikeaEstimate.confidence} confidence)`);
    }
  }
  
  // STEP 4: Ensure we have dimensions before proceeding
  if (!productData || !productData.dimensions) {
    const estimatedDimensions = estimateDimensions(category, productName);
    if (productData) {
      productData.dimensions = estimatedDimensions;
    } else {
      productData = { dimensions: estimatedDimensions };
    }
    console.log('   📐 Estimated dimensions based on category:', category);
    if (scrapingMethod === 'none') {
      scrapingMethod = 'estimation';
    }
  }
  
  if (!productData || !productData.weight) {
    const estimatedWeight = estimateWeight(productData.dimensions, category);
    if (productData) {
      productData.weight = estimatedWeight;
    } else {
      productData = { ...productData, weight: estimatedWeight };
    }
    console.log('   ⚖️ Estimated weight based on dimensions');
  }
  
  // Removed legacy calculateShippingCost - will use estimateCarton + computeFreight instead

  // Set initial duty values (will be recalculated after freight)
  const itemPrice = (productData && productData.price) ? productData.price : null;
  const dutyPct = 26.5;
  const dutyAmount = 0;
  const dutySource = 'fixed-cif';

  // Prepare final product object
  const product = {
    id: productId,
    url: url,
    name: productName,
    title: productName,
    price: itemPrice,
    brand: (productData && productData.brand) ? productData.brand : null,
    image: (productData && productData.image) ? productData.image : 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=SDL',
    images: (productData && productData.images && Array.isArray(productData.images)) ? productData.images : [],
    category: category,
    retailer: retailer,
    dimensions: productData.dimensions,
    weight: productData.weight,
    dutyPct: dutyPct,
    dutyAmount: dutyAmount,
    dutySource: dutySource,
    scrapingMethod: scrapingMethod,
    confidence: confidence,
    variant: (productData && productData.variant) ? productData.variant : null,
    description: (productData && productData.description) ? productData.description : null,
    descriptionHtml: (productData && productData.descriptionHtml) ? productData.descriptionHtml : null,
    features: (productData && productData.features) ? productData.features : null,
    dataCompleteness: {
      hasName: !!(productData && productData.name),
      hasImage: !!(productData && productData.image),
      hasDimensions: !!(productData && productData.dimensions),
      hasWeight: !!(productData && productData.weight),
      hasPrice: !!(productData && productData.price),
      hasVariant: !!(productData && productData.variant)
    },
    db_applied: dbApplied
  };

  // Apply selected variants
  try {
    const all = Array.isArray(productData.allVariants) ? productData.allVariants : [];
    const selected = pickSelectedVariants(all, product.url || url);
    product.variants_all = all;
    if (selected.length) product.variants_selected = selected;
  } catch (e) { console.warn("variant selection failed:", e?.message || e); }

  // Run carton extraction v3
  if (productData && !product.carton) {
    try {
      console.log('   📦 Running carton extraction v3...');
      const extractionResult = await extractCartons({
        retailer,
        sku: productData?.sku || null,
        url,
        browserHtml: productData?.browserHtml || null,
        zyteData: productData,
        product: {
          ...productData,
          title: productName,
          vendorTier: detectVendorTier(productData.brand || productData.vendor || ''),
          dimensions: productData.dimensions
        }
      });

      if (extractionResult && extractionResult.boxes && extractionResult.boxes.length > 0) {
        product.carton = {
          boxes: extractionResult.boxes,
          confidence: extractionResult.confidence,
          source: extractionResult.source
        };
        console.log(`   ✅ Extracted ${extractionResult.boxes.length} box(es) from ${extractionResult.source} (confidence: ${(extractionResult.confidence * 100).toFixed(0)}%)`);
        if (extractionResult.notes && extractionResult.notes.length > 0) {
          extractionResult.notes.forEach(note => console.log(`      - ${note}`));
        }
      } else {
        console.log('   ℹ️  No carton dimensions extracted from sources');
      }
    } catch (err) {
      console.warn(`   ⚠️  Carton extraction failed: ${err.message}`);
    }
  }

  function detectVendorTier(vendor = '') {
    const v = vendor.toLowerCase();
    if (['ikea', 'south shore', 'walker edison'].some(k => v.includes(k))) return 'flat-pack';
    if (['latitude run', 'restoration hardware', 'rh', 'crate & barrel', 'pottery barn'].some(k => v.includes(k))) return 'high-end';
    return 'neutral';
  }

  // Apply DB overrides (dutyPct, cubic_feet, carton, dimension_source, estimation_notes)
  try {
    const key = { retailer, url };
    const dbRecord = await loadScrapeByKey(key);
    if (dbRecord) {
      if (dbRecord.dutyPct !== null && dbRecord.dutyPct !== undefined) {
        product.dutyPct = dbRecord.dutyPct;
        console.log(`   🔧 Applied admin dutyPct override: ${dbRecord.dutyPct}`);
      }
      if (dbRecord.cubic_feet !== null && dbRecord.cubic_feet !== undefined) {
        product.cubic_feet = dbRecord.cubic_feet;
        console.log(`   🔧 Applied admin cubic_feet override: ${dbRecord.cubic_feet}`);
      }
      if (dbRecord.carton) {
        product.carton = dbRecord.carton;
        console.log(`   �� Applied admin carton override`);
      }
      if (dbRecord.dimension_source) {
        product.dimension_source = dbRecord.dimension_source;
      }
      if (dbRecord.estimation_notes) {
        product.estimation_notes = dbRecord.estimation_notes;
      }
    }
  } catch (err) {
    console.warn(`   ⚠️  DB override apply failed: ${err.message}`);
  }

  // Estimate carton cubic feet if not already set by DB override
  if (!product.cubic_feet && !product.carton_cuft_final && !product.carton_cuft_est) {
    try {
      const estimation = await estimateCarton({
        ...product,
        retailer,
        url,
        sku: productData?.sku || null
      });
      if (estimation) {
        product.cubic_feet = estimation.cubic_feet;
        product.carton = estimation.carton;
        product.dimension_source = estimation.dimension_source;
        product.estimation_notes = estimation.estimation_notes;
        console.log(`   📦 Estimated carton: ${estimation.cubic_feet} ft³ (${estimation.dimension_source}) ${estimation.estimation_notes || ''}`);
      }
    } catch (err) {
      console.warn(`   ⚠️  Carton estimation failed: ${err.message}`);
    }
  }

  // Legacy shipping_handling calc removed - now using calcFreightSmart + V4.1 pricing below

  // Add NJ sales tax
  try {
    const unit = Number(product.price ?? itemPrice ?? 0) || 0;
    const qty  = Number(product.quantity ?? 1) || 1;
    const tax  = computeNjSalesTax({ unitPrice: unit, quantity: qty });
    product.nj_sales_tax = tax;
    product.line_subtotal_with_tax = Number((unit*qty + tax).toFixed(2));
    console.log(`🧾 NJ tax: $${tax} on ${qty} × $${unit}`);
  } catch (e) { console.warn("NJ tax failed:", e?.message || e); }

  // Compute comprehensive pricing breakdown with v3 pricing
  // Legacy pricing_v3 removed - now using V4.1 pricing exclusively (computed after freight calc below)

  // Save to DB
  try {
    const cubicFeet = productData.dimensions
      ? (productData.dimensions.length * productData.dimensions.width * productData.dimensions.height) / 1728
      : null;

    await saveScrape({
      retailer,
      sku: null,
      url,
      title: productName,
      price: itemPrice,
      dutyPct: product.dutyPct,
      cubic_feet: product.cubic_feet || cubicFeet,
      carton: product.carton || null,
      dimension_source: product.dimension_source || scrapingMethod,
      estimation_notes: product.estimation_notes || null
    });
  } catch (err) {
    console.warn(`   ⚠️  DB save failed: ${err.message}`);
  }

  console.log(`   📊 Data source: ${scrapingMethod}`);
  if (confidence !== null) {
    console.log(`   🎯 Confidence: ${(confidence * 100).toFixed(1)}%`);
  }

  const flog = {};
  const freightResult = calcFreightSmart(product, flog);
  product.freight = {
    amount: freightResult.amount,
    mode: freightResult.mode,
    cuft: freightResult.cuft,
    log: flog
  };
  console.log(`🧮 Freight ${freightResult.amount} | ft³ ${freightResult.cuft} | mode ${freightResult.mode}`, flog);

  const itemCostPerUnit = Number(product.price || 0);
  const freightPerUnit = Number(freightResult.amount || 0);
  const usDeliveryPerUnit = Number(product.usDelivery || 0);

  // Calculate NJ sales tax (6.625% of item cost)
  const njTaxRate = Number(process.env.NJ_TAX_RATE_PCT || 6.625) / 100;
  const njTaxPerUnit = Math.round(itemCostPerUnit * njTaxRate * 100) / 100;

  // Duty and Wharfage are calculated on (item + NJ tax) - NEVER on freight
  const dutyBase = itemCostPerUnit + njTaxPerUnit;
  let dutyPerUnit, wharfagePerUnit, effectiveDutyPct;

  if (product.dutyPct && product.dutyPct !== 25) {
    // Admin override: custom duty rate
    effectiveDutyPct = product.dutyPct;
    dutyPerUnit = Math.round(dutyBase * (effectiveDutyPct / 100) * 100) / 100;
    console.log(`   💵 Using admin override duty rate: ${effectiveDutyPct}% on (item + NJ tax)`);
  } else {
    // Standard 25% duty
    effectiveDutyPct = 25;
    dutyPerUnit = Math.round(dutyBase * 0.25 * 100) / 100;
  }

  // Wharfage is always 1.5% of (item + NJ tax)
  wharfagePerUnit = Math.round(dutyBase * 0.015 * 100) / 100;

  product.dutyPct = effectiveDutyPct;
  product.dutyAmount = dutyPerUnit;
  product.wharfageAmount = wharfagePerUnit;
  product.njTaxAmount = njTaxPerUnit;
  product.dutySource = 'item-plus-nj-tax';

  const v41 = computeTotalsV41({
    item: itemCostPerUnit,
    duty: dutyPerUnit,
    freight: freightPerUnit
  });

  product.totals = {
    v41,
    shipping_handling_display: v41.shippingHandling,
    finalRetailPerUnit: v41.finalRetail
  };

  product.shipping_handling = {
    total_usd_per_unit: v41.shippingHandling,
    total_usd: v41.shippingHandling,
    freight_per_unit: freightPerUnit
  };

  console.log(`💰 V4.1 pricing: retail $${v41.finalRetail} | S&H $${v41.shippingHandling} (incl hidden 25% margin) | NJ tax $${v41.njSalesTax}`);

  // Store in Torso database
  try {
    const handle = url.split('/').pop().split('?')[0].replace(/[^a-z0-9-]/g, '-').toLowerCase();
    await torso.upsertProduct({
      handle,
      title: product.title,
      brand: product.brand,
      canonical_url: url,
      description_html: product.descriptionHtml || `<p>${product.description || ''}</p>`,
      breadcrumbs: product.category ? [product.category] : [],
      rating: null,
      reviews: null,
      main_image_url: product.image
    });
    console.log(`   💾 Stored in Torso: ${handle}`);
  } catch (err) {
    console.warn(`   ⚠️  Torso storage failed: ${err.message}`);
  }

  console.log(`   ✅ Product processed`);
  console.log(`   🖼️ Returning ${product.images ? product.images.length : 0} images to frontend\n`);

  return product;
}

// Batch processing with concurrency control
async function processBatch(urls, batchSize = MAX_CONCURRENT) {
  const results = [];

  // BOLT: limit concurrent scrapes to 2 at a time to prevent Zyte timeout
  const chunks = [];
  for (let i = 0; i < urls.length; i += 2) {
    const batch = urls.slice(i, i + 2);
    const batchResults = await Promise.all(
      batch.map(url => scrapeProduct(url).catch(error => {
        console.error(`Failed to process ${url}:`, error);
        return {
          id: generateProductId(),
          url: url,
          name: 'Failed to load product',
          category: 'general',
          retailer: detectRetailer(url),
          shippingCost: 50,
          error: true
        };
      }))
    );
    chunks.push(...batchResults);
    await new Promise(r => setTimeout(r, 200)); // small delay to avoid API throttling
  }

  return chunks;
}

// Fast calculation endpoint - optimized path without scraping
async function fastCalculate(req) {
  const { retailer, sku, price, profile, vendorTier, assembled, carton } = req;

  // Build product object for estimateCarton
  const productInput = {
    retailer,
    sku,
    price,
    profile: profile || 'default',
    vendorTier: vendorTier || 'neutral',
    assembled: assembled || null,
    carton: carton || null
  };

  // Single DB call - check for admin override (only if carton not provided in request)
  if (!productInput.carton) {
    try {
      const dbRecord = await loadScrapeByKey({ retailer, sku });
      if (dbRecord && dbRecord.carton) {
        productInput.carton = dbRecord.carton;
      }
    } catch (err) {
      // Silent fail - continue with estimation
    }
  }

  // Estimate carton (synchronous, fast)
  const est = estimateCarton(productInput);

  const flog = {};
  const smartProduct = {
    ...productInput,
    price: Number(price || 0),
    cartonCubicFeet: Number(est.cubic_feet || 0)
  };
  const fr = calcFreightSmart(smartProduct, flog);

  console.log(`🧮 Freight ${fr.amount} | ft³ ${fr.cuft} | mode ${fr.mode}`, flog);

  return {
    ok: true,
    product: {
      sku,
      retailer,
      name: productInput.name || '',
      price: Number(price || 0),
      profile: productInput.profile,
      vendorTier: productInput.vendorTier,
      assembled: productInput.assembled
    },
    carton_estimate: {
      cubic_feet: est.cubic_feet || 0,
      boxes: est.boxes ?? null,
      source: est.source || 'n/a',
      notes: est.notes || [],
      confidence: est.confidence ?? null
    },
    freight: {
      amount: fr.amount,
      mode: fr.mode,
      cuft: fr.cuft,
      log: flog
    }
  };
}

// API endpoint for scraping
app.post('/api/scrape', async (req, res) => {
  try {
    const { urls, retailer, sku, price, profile, vendorTier, assembled, carton } = req.body;

    // Fast path: Direct calculation (no scraping, DB, or heavy processing)
    if (retailer && sku && price) {
      const result = await fastCalculate({ retailer, sku, price, profile, vendorTier, assembled, carton });
      return res.json(result);
    }

    // Legacy path: Batch URL scraping
    if (urls && Array.isArray(urls) && urls.length > 0) {
      const sdlUrls = urls.filter(url => isSDLDomain(url));
      if (sdlUrls.length > 0) {
        return res.status(400).json({
          error: 'SDL domain detected. This calculator is for importing products from other retailers.'
        });
      }

      console.log(`\n🚀 Starting batch scrape for ${urls.length} products...`);
      const products = await processBatch(urls);
      console.log(`\n✅ Completed scraping ${products.length} products\n`);

      return res.json({ products });
    }

    return res.status(400).json({ error: 'Either urls array or retailer+sku+price required' });

  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// API endpoint for manual webpage processing
app.post('/api/process-manual-content', async (req, res) => {
  try {
    const { url, htmlContent } = req.body;
    
    if (!url || !htmlContent) {
      return res.status(400).json({ error: 'URL and HTML content required' });
    }
    
    console.log(`\n🤖 Processing manual content for: ${url}`);
    console.log(`📄 Content length: ${htmlContent.length} characters`);
    console.log(`📄 Content preview: ${htmlContent.substring(0, 200)}...`);
    
    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
      console.log('❌ OpenAI API key not found');
      return res.status(500).json({ 
        error: 'GPT processing not available - missing OpenAI API key' 
      });
    }
    
    console.log('✅ OpenAI API key found, proceeding with GPT parsing...');
    
    // Use OpenAI directly to parse the content
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    try {
      console.log('🤖 Calling GPT parser...');
      
      const retailer = detectRetailer(url);
      
      // Trim content to avoid token limits
      const trimmedContent = htmlContent.substring(0, 15000);
      
      const prompt = `Extract product information from this ${retailer} webpage content and return ONLY valid JSON with these fields:
- name (string)
- price (number, no currency symbols)
- dimensions (object with length, width, height in inches if found)
- sku (string if found)
- variant (string like color/size if found)

For Crate & Barrel: Extract dimensions from format like "23.8"H height 85.4"W width 37"D depth" as length=85.4, width=37, height=23.8.

Content: ${trimmedContent}`;

      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a product data extractor. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
      });

      const gptData = JSON.parse(response.choices[0].message.content || '{}');
      console.log('📊 GPT parser result:', {
        hasName: !!gptData?.name,
        hasPrice: !!gptData?.price,
        name: gptData?.name?.substring(0, 50),
        price: gptData?.price
      });
      
      if (gptData && gptData.name && gptData.price) {
        const retailer = detectRetailer(url);
        const category = gptData.category || categorizeProduct(gptData.name, url);
        
        // Convert to our expected format
        const productData = {
          name: gptData.name,
          price: gptData.price,
          image: gptData.image,
          dimensions: gptData.dimensions || gptData.package_dimensions,
          weight: gptData.weight || gptData.package_weight_lbs,
          brand: gptData.brand,
          category: category,
          inStock: gptData.inStock,
          variant: gptData.variant,
          allVariants: gptData.allVariants || []
        };
        
        // Fill in missing data with estimations
        if (!productData.dimensions) {
          productData.dimensions = estimateDimensions(category, productData.name);
        }
        
        if (!productData.weight) {
          productData.weight = estimateWeight(productData.dimensions, category);
        }

        const product = {
          id: generateProductId(),
          url: url,
          name: productData.name,
          price: productData.price,
          image: productData.image || 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=SDL',
          category: category,
          retailer: retailer,
          dimensions: productData.dimensions,
          weight: productData.weight,
          scrapingMethod: 'manual-gpt',
          confidence: null,
          variant: productData.variant,
          dataCompleteness: {
            hasName: !!productData.name,
            hasImage: !!productData.image,
            hasDimensions: !!productData.dimensions,
            hasWeight: !!productData.weight,
            hasPrice: !!productData.price,
            hasVariant: !!productData.variant
          }
        };
        
        console.log('   ✅ Manual content processed successfully');
        res.json({ success: true, product });
        
      } else {
        console.log('❌ GPT extraction failed - missing required data:', {
          hasName: !!gptData?.name,
          hasPrice: !!gptData?.price,
          gptData: gptData
        });
        throw new Error('GPT could not extract required data from manual content');
      }
      
    } catch (error) {
      console.log('❌ GPT parsing error details:', error.message);
      console.log('📄 Content sample for debugging:', htmlContent.substring(0, 500));
      console.log('   ❌ Manual content processing failed:', error.message);
      res.status(400).json({ 
        error: `GPT parsing failed: ${error.message}. Please try copying the webpage content again, including product name and price.` 
      });
    }
    
  } catch (error) {
    console.error('Manual content processing error:', error);
    res.status(500).json({ error: 'Failed to process manual content' });
  }
});

// Store pending orders temporarily (in memory for now, could use Redis later)
const pendingOrders = new Map();

// Endpoint to store pending order
app.post('/api/store-pending-order', (req, res) => {
  const orderId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  pendingOrders.set(orderId, {
    data: req.body,
    timestamp: Date.now()
  });
  
  // Clean up old orders after 1 hour
  setTimeout(() => pendingOrders.delete(orderId), 3600000);
  
  console.log(`📦 Stored pending order ${orderId}`);
  res.json({ orderId, success: true });
});

// Endpoint to retrieve pending order
app.get('/api/get-pending-order/:orderId', (req, res) => {
  const order = pendingOrders.get(req.params.orderId);
  if (order) {
    console.log(`✅ Retrieved pending order ${req.params.orderId}`);
    res.json(order.data);
    pendingOrders.delete(req.params.orderId); // Delete after retrieval
  } else {
    console.log(`❌ Order ${req.params.orderId} not found`);
    res.status(404).json({ error: 'Order not found or expired' });
  }
});

// Order tracking endpoints
app.post('/api/orders/:orderId/start-tracking', async (req, res) => {
  // Order tracking disabled - missing orderTracking.js file
  return res.status(500).json({ error: 'Order tracking not available' });
});

app.get('/api/orders/:orderId/tracking-status', async (req, res) => {
  // Order tracking disabled - missing orderTracking.js file
  return res.status(500).json({ error: 'Order tracking not available' });
});

app.post('/api/orders/:orderId/stop-tracking', async (req, res) => {
  // Order tracking disabled - missing orderTracking.js file
  return res.status(500).json({ error: 'Order tracking not available' });
});

// Shopify Draft Order Creation
app.post('/apps/instant-import/create-draft-order', async (req, res) => {
  try {
    const { products, deliveryFees, totals, customer, originalUrls } = req.body;

    if (!SHOPIFY_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Shopify not configured. Please check API credentials.' });
    }

    if (!customer || !customer.email || !customer.name) {
      return res.status(400).json({ error: 'Customer information required' });
    }

    // Create line items for the draft order - each product becomes ONE line item with total landed cost
    const lineItems = [];

    // Add each product as a separate line item with its complete landed cost
    products.forEach(product => {
      if (product.price && product.price > 0) {
        // Calculate total landed cost for this product
        const itemPrice = Number(product.price) || 0;
        const usDelivery = Number(product.usDelivery) || 0;
        const freightCost = Number(product.freight?.amount) || Number(product.shippingCost) || Number(product.shipping_cost) || 0;

        const dutyAmount = computeDutyWharfage({
          itemUSD: itemPrice,
          usDeliveryUSD: usDelivery,
          bermudaFreightUSD: freightCost
        });

        const marginPct = Number(process.env.MARGIN_PCT || 20);

        // Total landed cost = item price + duty + shipping + margin
        const subtotal = itemPrice + dutyAmount + freightCost;
        const marginAmount = subtotal * (marginPct / 100);
        const totalLandedCost = subtotal + marginAmount;

        lineItems.push({
          title: product.name,
          price: totalLandedCost.toFixed(2),
          quantity: 1,
          properties: [
            { name: 'Source URL', value: product.url },
            { name: 'Retailer', value: product.retailer },
            { name: 'Category', value: product.category },
            { name: 'Item Price', value: `$${itemPrice.toFixed(2)}` },
            { name: 'Duty + Wharfage (26.5%)', value: `$${dutyAmount.toFixed(2)}` },
            { name: 'Shipping', value: `$${freightCost.toFixed(2)}` },
            { name: 'Margin', value: `$${marginAmount.toFixed(2)} (${marginPct}%)` }
          ]
        });
      }
    });
    
    // Create the draft order
    const draftOrderData = {
      draft_order: {
        line_items: lineItems,
        customer: {
          email: customer.email,
          first_name: customer.name.split(' ')[0],
          last_name: customer.name.split(' ').slice(1).join(' ') || ''
        },
        email: customer.email,
        note: `Import Calculator Order\n\nOriginal URLs:\n${originalUrls}`,
        tags: 'import-calculator, ocean-freight',
        tax_exempt: true,
        send_receipt: false,
        send_fulfillment_receipt: false
      }
    };
    
    console.log(`📝 Creating draft order for ${customer.email}...`);
    
    // Make request to Shopify
    const shopifyResponse = await axios.post(
      `https://${SHOPIFY_DOMAIN}/admin/api/2023-10/draft_orders.json`,
      draftOrderData,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const draftOrder = shopifyResponse.data.draft_order;
    console.log(`✅ Draft order ${draftOrder.name} created successfully`);
    
    // Don't send invoice automatically - let customer complete checkout
    res.json({
      success: true,
      draftOrderId: draftOrder.id,
      draftOrderNumber: draftOrder.name,
      invoiceUrl: draftOrder.invoice_url,
      checkoutUrl: `https://${SHOPIFY_DOMAIN}/admin/draft_orders/${draftOrder.id}`,
      totalAmount: totals.grandTotal
    });
    
  } catch (error) {
    console.error('Draft order creation error:', error.response?.data || error);
    res.status(500).json({ 
      error: 'Failed to create draft order. Please try again or contact support.',
      details: error.response?.data?.errors || error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📍 Admin Panel: http://localhost:${PORT}/admin (admin:1064)`);
});
