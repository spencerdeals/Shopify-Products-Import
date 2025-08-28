const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const ApifyScraper = require('./apifyScraper');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const SCRAPING_TIMEOUT = 30000;  // 30 seconds timeout
const MAX_CONCURRENT_SCRAPES = 2;
const BERMUDA_DUTY_RATE = 0.265;
const USE_SCRAPINGBEE = !!SCRAPINGBEE_API_KEY;

// Initialize Apify scraper
const apifyScraper = new ApifyScraper(APIFY_API_KEY);
const USE_APIFY = apifyScraper.isAvailable();

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Apify - ${USE_APIFY ? '✅ ENABLED (All Retailers)' : '❌ DISABLED (Missing API Key)'}`);
console.log(`2. Fallback: ScrapingBee - ${USE_SCRAPINGBEE ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log('');
console.log('📊 SCRAPING STRATEGY:');
if (USE_APIFY && USE_SCRAPINGBEE) {
  console.log('✅ OPTIMAL: Apify → ScrapingBee → Intelligent Estimation');
} else if (USE_APIFY && !USE_SCRAPINGBEE) {
  console.log('⚠️  LIMITED: Apify → Intelligent Estimation (No ScrapingBee fallback)');
} else if (!USE_APIFY && USE_SCRAPINGBEE) {
  console.log('⚠️  LIMITED: ScrapingBee → Intelligent Estimation (No Apify primary)');
} else {
  console.log('❌ MINIMAL: Intelligent Estimation only (No scrapers configured)');
}
console.log('=====================');

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Fix for Railway X-Forwarded-For warning
app.set('trust proxy', true);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, '../web')));

// CRITICAL: Health check MUST be before rate limiter
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    scraping: {
      primary: USE_APIFY ? 'Apify' : 'None',
      fallback: USE_SCRAPINGBEE ? 'ScrapingBee' : 'None',
      strategy: USE_APIFY && USE_SCRAPINGBEE ? 'Optimal' : 
                USE_APIFY || USE_SCRAPINGBEE ? 'Limited' : 'Minimal'
    },
    shopifyConfigured: !!SHOPIFY_ACCESS_TOKEN
  });
});

// Root route - serve frontend HTML
app.get('/', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend', 'index.html');
  res.sendFile(frontendPath, (err) => {
    if (err) {
      console.error('Error serving frontend:', err);
      // Fallback to API info if frontend not found
      res.json({
        message: 'Frontend not found - API is running',
        endpoints: {
          health: '/health',
          scrape: 'POST /api/scrape',
          createOrder: 'POST /apps/instant-import/create-draft-order'
        }
      });
    }
  });
});

// Rate limiter (after health check) - Fix trust proxy error
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  trustProxy: 1, // Trust first proxy only
  keyGenerator: (req) => req.ip // Use IP for rate limiting
});
app.use('/api/', limiter);

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
  const cubicFeet = volume / 1728;
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
      width: 5 + Math.random() * 2,
      height: 1 + Math.random() * 1
    },
    'toys': { 
      length: 12 + Math.random() * 8,
      width: 10 + Math.random() * 6,
      height: 8 + Math.random() * 4
    },
    'sports': { 
      length: 24 + Math.random() * 20,
      width: 16 + Math.random() * 10,
      height: 12 + Math.random() * 8
    },
    'home-decor': { 
      length: 12 + Math.random() * 8,
      width: 12 + Math.random() * 8,
      height: 12 + Math.random() * 8
    },
    'general': { 
      length: 20 + Math.random() * 12,
      width: 16 + Math.random() * 8,
      height: 10 + Math.random() * 6
    }
  };
  
  const base = baseEstimates[category] || baseEstimates.general;
  
  // Apply 1.5x buffer for estimates since we're guessing
  return {
    length: Math.round(base.length * 1.5 * 100) / 100,
    width: Math.round(base.width * 1.5 * 100) / 100,
    height: Math.round(base.height * 1.5 * 100) / 100
  };
}

// ===== NEW INTELLIGENT ESTIMATION FUNCTIONS START HERE =====

// Enhanced product context extraction
async function extractFullProductContext(html, url) {
  const context = {
    title: '',
    description: '',
    bulletPoints: [],
    specifications: {},
    price: 0,
    weight: 0,
    brand: '',
    modelNumber: '',
    category: ''
  };

  // Title extraction (multiple patterns)
  const titlePatterns = [
    /<h1[^>]*id="productTitle"[^>]*>([^<]+)</i,
    /<h1[^>]*class="[^"]*product-title[^"]*"[^>]*>([^<]+)</i,
    /<h1[^>]*>([^<]+)</i,
    /<title>([^<]+)</i,
    /property="og:title" content="([^"]+)"/i
  ];
  
  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match) {
      context.title = match[1].trim()
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/<[^>]*>/g, '');
      break;
    }
  }

  // Extract weight (often available even when dimensions aren't)
  const weightPatterns = [
    /(?:weight|Weight)[:\s]+(\d+\.?\d*)\s*(?:lbs?|pounds?)/i,
    /(?:weight|Weight)[:\s]+(\d+\.?\d*)\s*(?:kg|kilograms?)/i,
    /(?:Item Weight|Product Weight)[:\s]+(\d+\.?\d*)\s*(?:lbs?|pounds?)/i,
    /(\d+\.?\d*)\s*(?:lbs?|pounds?)\s+(?:weight|Weight)/i,
    /"weight":\s*"?(\d+\.?\d*)/i,
    /Weight[^<]*<[^>]*>([^<]*\d+\.?\d*\s*(?:lbs?|pounds?))/i
  ];
  
  for (const pattern of weightPatterns) {
    const match = html.match(pattern);
    if (match) {
      let weight = parseFloat(match[1]);
      if (pattern.toString().includes('kg')) {
        weight = weight * 2.205; // Convert kg to lbs
      }
      if (weight > 0 && weight < 1000) { // Sanity check
        context.weight = weight;
        console.log(`Found product weight: ${weight} lbs`);
        break;
      }
    }
  }

  // Extract bullet points (often contain size info)
  const bulletMatches = html.matchAll(/<li[^>]*>([^<]{10,200})</gi);
  for (const match of bulletMatches) {
    context.bulletPoints.push(match[1]);
  }

  // Extract price if available
  const pricePatterns = [
    /class="a-price-whole">([0-9,]+)/i,
    /class="a-price[^"]*"[^>]*>\s*<span[^>]*>\$([0-9,.]+)/i,
    /"price":\s*"([0-9,.]+)"/i,
    /data-price="([0-9,.]+)"/i
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price > 0) {
        context.price = price;
        break;
      }
    }
  }

  return context;
}

// AI-like product classification based on context
function classifyProductFromContext(context) {
  const title = (context.title + ' ' + context.bulletPoints.join(' ')).toLowerCase();
  
  // Detailed classification rules
  const classifications = {
    'small-electronics': {
      keywords: ['phone', 'earbuds', 'airpods', 'watch', 'charger', 'cable', 'adapter', 'power bank', 'case', 'bluetooth', 'wireless earphone'],
      maxWeight: 2,
      typicalDensity: 0.15, // cubic feet per pound (very dense small items)
      sizeLimit: 2
    },
    'medium-electronics': {
      keywords: ['laptop', 'tablet', 'ipad', 'monitor', 'keyboard', 'printer', 'console', 'speaker', 'soundbar', 'playstation', 'xbox'],
      maxWeight: 20,
      typicalDensity: 0.25,
      sizeLimit: 5
    },
    'large-electronics': {
      keywords: ['tv', 'television', 'refrigerator', 'washer', 'dryer', 'dishwasher', 'microwave'],
      maxWeight: 200,
      typicalDensity: 0.4,
      sizeLimit: 20
    },
    'books': {
      keywords: ['book', 'paperback', 'hardcover', 'textbook', 'novel', 'pages', 'reading', 'bible', 'dictionary'],
      maxWeight: 5,
      typicalDensity: 0.08,
      sizeLimit: 1
    },
    'clothing': {
      keywords: ['shirt', 'pants', 'dress', 'jacket', 'shoes', 'clothing', 'apparel', 'wear', 'jeans', 'sweater', 'hoodie'],
      maxWeight: 5,
      typicalDensity: 1.5,
      sizeLimit: 3
    },
    'toys': {
      keywords: ['toy', 'game', 'puzzle', 'play', 'kids', 'children', 'lego', 'doll', 'action figure', 'board game'],
      maxWeight: 10,
      typicalDensity: 1.0,
      sizeLimit: 4
    },
    'small-furniture': {
      keywords: ['lamp', 'stool', 'nightstand', 'shelf', 'mirror', 'cushion', 'pillow', 'ottoman', 'end table'],
      maxWeight: 30,
      typicalDensity: 0.5,
      sizeLimit: 8
    },
    'large-furniture': {
      keywords: ['sofa', 'couch', 'bed', 'mattress', 'table', 'desk', 'dresser', 'cabinet', 'chair', 'recliner'],
      maxWeight: 300,
      typicalDensity: 0.4,
      sizeLimit: 30
    },
    'tools': {
      keywords: ['tool', 'drill', 'saw', 'hammer', 'wrench', 'kit', 'hardware', 'screwdriver', 'power tool'],
      maxWeight: 30,
      typicalDensity: 0.2,
      sizeLimit: 3
    },
    'sports': {
      keywords: ['ball', 'bat', 'golf', 'tennis', 'fitness', 'weights', 'bike', 'bicycle', 'exercise', 'workout'],
      maxWeight: 50,
      typicalDensity: 0.6,
      sizeLimit: 10
    }
  };

  // Find best classification match
  let bestMatch = 'general';
  let bestScore = 0;
  
  for (const [category, config] of Object.entries(classifications)) {
    let score = 0;
    
    // Check keywords
    for (const keyword of config.keywords) {
      if (title.includes(keyword)) {
        score += 10;
      }
    }
    
    // Weight compatibility check
    if (context.weight > 0) {
      if (context.weight <= config.maxWeight) {
        score += 5;
      } else {
        score -= 10; // Penalize if weight doesn't match category
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = category;
    }
  }

  return {
    category: bestMatch,
    confidence: bestScore >= 10 ? 'high' : bestScore >= 5 ? 'medium' : 'low',
    config: classifications[bestMatch] || {
      typicalDensity: 0.3,
      maxWeight: 50,
      sizeLimit: 5
    }
  };
}

// Smart dimension estimation using classification + weight
function calculateDimensionsFromClassification(classification, context) {
  const { category, confidence, config } = classification;
  
  // If we have weight, use it with category-specific density
  if (context.weight > 0) {
    let cubicFeet = context.weight * config.typicalDensity;
    
    // Cap cubic feet based on category size limits
    cubicFeet = Math.min(cubicFeet, config.sizeLimit);
    
    // Minimum size sanity check
    cubicFeet = Math.max(cubicFeet, 0.5);
    
    console.log(`Weight-based calculation: ${context.weight} lbs × ${config.typicalDensity} density = ${cubicFeet} cubic feet`);
    
    // Category-specific dimension ratios
    const ratios = {
      'small-electronics': { l: 1.5, w: 1.2, h: 0.8 },
      'medium-electronics': { l: 1.4, w: 1.1, h: 0.7 },
      'large-electronics': { l: 1.2, w: 0.8, h: 1.5 },
      'books': { l: 1.2, w: 0.9, h: 0.3 },
      'clothing': { l: 1.3, w: 1.0, h: 0.4 },
      'toys': { l: 1.2, w: 1.0, h: 0.9 },
      'small-furniture': { l: 1.3, w: 1.0, h: 1.1 },
      'large-furniture': { l: 1.5, w: 1.0, h: 0.8 },
      'tools': { l: 1.4, w: 0.8, h: 0.6 },
      'sports': { l: 1.3, w: 0.9, h: 0.8 },
      'general': { l: 1.2, w: 1.0, h: 0.8 }
    };
    
    const ratio = ratios[category] || ratios.general;
    const baseDim = Math.cbrt(cubicFeet * 1728);
    
    return {
      length: Math.round(baseDim * ratio.l * 100) / 100,
      width: Math.round(baseDim * ratio.w * 100) / 100,
      height: Math.round(baseDim * ratio.h * 100) / 100,
      confidence: confidence,
      method: 'weight-based',
      cubicFeet: cubicFeet
    };
  }
  
  // Price-based fallback with category awareness
  if (context.price > 0) {
    const priceFactors = {
      'small-electronics': { base: 0.5, max: 2 },
      'medium-electronics': { base: 1, max: 5 },
      'large-electronics': { base: 3, max: 20 },
      'books': { base: 0.3, max: 1 },
      'clothing': { base: 0.8, max: 3 },
      'toys': { base: 1, max: 4 },
      'small-furniture': { base: 2, max: 8 },
      'large-furniture': { base: 5, max: 30 },
      'tools': { base: 0.5, max: 3 },
      'sports': { base: 1.5, max: 10 },
      'general': { base: 1, max: 5 }
    };
    
    const factor = priceFactors[category] || priceFactors.general;
    
    // Price-based size estimation
    let estimatedCubicFeet = factor.base;
    if (context.price < 50) estimatedCubicFeet = factor.base * 0.5;
    else if (context.price < 100) estimatedCubicFeet = factor.base * 0.75;
    else if (context.price < 200) estimatedCubicFeet = factor.base;
    else if (context.price < 500) estimatedCubicFeet = factor.base * 1.5;
    else if (context.price < 1000) estimatedCubicFeet = factor.base * 2;
    else estimatedCubicFeet = factor.base * 3;
    
    // Cap at category maximum
    estimatedCubicFeet = Math.min(estimatedCubicFeet, factor.max);
    
    console.log(`Price-based calculation: $${context.price} in ${category} = ${estimatedCubicFeet} cubic feet`);
    
    const baseDim = Math.cbrt(estimatedCubicFeet * 1728);
    
    return {
      length: Math.round(baseDim * 1.3 * 100) / 100,
      width: Math.round(baseDim * 1.0 * 100) / 100,
      height: Math.round(baseDim * 0.7 * 100) / 100,
      confidence: 'low',
      method: 'price-based',
      cubicFeet: estimatedCubicFeet
    };
  }
  
  // Ultimate fallback - category defaults (much smaller than before)
  const defaults = {
    'small-electronics': { l: 8, w: 6, h: 3 },
    'medium-electronics': { l: 16, w: 12, h: 8 },
    'large-electronics': { l: 36, w: 24, h: 20 },
    'books': { l: 9, w: 6, h: 2 },
    'clothing': { l: 14, w: 10, h: 3 },
    'toys': { l: 12, w: 10, h: 8 },
    'small-furniture': { l: 24, w: 20, h: 18 },
    'large-furniture': { l: 48, w: 36, h: 30 },
    'tools': { l: 12, w: 8, h: 6 },
    'sports': { l: 20, w: 14, h: 10 },
    'general': { l: 12, w: 10, h: 8 }
  };
  
  const def = defaults[category] || defaults.general;
  
  return {
    length: def.l,
    width: def.w,
    height: def.h,
    confidence: 'fallback',
    method: 'category-default',
    cubicFeet: (def.l * def.w * def.h) / 1728
  };
}

// Extract dimensions directly from HTML
function extractDimensionsFromHTML(html) {
  const dimensionPatterns = [
    /(?:Dimensions|Size|Measurements)[^:]*:\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)/i,
    /(\d+\.?\d*)"?\s*W\s*[x×]\s*(\d+\.?\d*)"?\s*D\s*[x×]\s*(\d+\.?\d*)"?\s*H/i,
    /(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*(?:inches|in|")/i,
    /"dimension"[^}]*"value":\s*"(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)"/i
  ];
  
  for (const pattern of dimensionPatterns) {
    const match = html.match(pattern);
    if (match) {
      const dims = {
        length: parseFloat(match[2]) || parseFloat(match[1]),
        width: parseFloat(match[1]) || parseFloat(match[2]),
        height: parseFloat(match[3])
      };
      
      console.log(`Raw dimensions found: ${dims.length} x ${dims.width} x ${dims.height}`);
      
      // STRICT validation - dimensions must be reasonable for shipping
      if (dims.length > 0 && dims.length <= 96 &&  // Max 8 feet
          dims.width > 0 && dims.width <= 96 &&    // Max 8 feet  
          dims.height > 0 && dims.height <= 96 &&   // Max 8 feet
          dims.length >= 0.5 && dims.width >= 0.5 && dims.height >= 0.5) { // Min half inch
        
        // Calculate cubic feet to double-check
        const cubicFeet = (dims.length * dims.width * dims.height) / 1728;
        console.log(`Calculated cubic feet: ${cubicFeet}`);
        
        // Reject if cubic feet is unreasonable
        if (cubicFeet > 50) {
          console.log(`Cubic feet too large (${cubicFeet}), rejecting scraped dimensions`);
          return null;
        }
        
        // Apply 1.2x buffer to scraped dimensions
        return {
          length: dims.length * 1.2,
          width: dims.width * 1.2,
          height: dims.height * 1.2
        };
      } else {
        console.log(`Dimensions failed validation: L:${dims.length} W:${dims.width} H:${dims.height}`);
      }
    }
  }
  
  return null;
}

// Main integration function
async function getIntelligentDimensions(html, url, productPrice) {
  // Step 1: Try direct dimension extraction first
  const directDims = extractDimensionsFromHTML(html);
  if (directDims) {
    console.log('Found dimensions directly from HTML');
    return { ...directDims, confidence: 'high', method: 'scraped' };
  }
  
  // Step 2: Extract full context
  const context = await extractFullProductContext(html, url);
  context.price = productPrice || context.price;
  
  console.log(`Extracted context - Weight: ${context.weight} lbs, Price: $${context.price}, Title: ${context.title.substring(0, 50)}...`);
  
  // Step 3: Classify the product
  const classification = classifyProductFromContext(context);
  console.log(`Product classified as: ${classification.category} (confidence: ${classification.confidence})`);
  
  // Step 4: Calculate dimensions based on classification
  const dimensions = calculateDimensionsFromClassification(classification, context);
  
  // Step 5: Apply confidence-based buffer
  const bufferMap = {
    'high': 1.1,
    'medium': 1.2,
    'low': 1.3,
    'fallback': 1.5
  };
  
  const buffer = bufferMap[dimensions.confidence];
  console.log(`Applying ${buffer}x buffer based on ${dimensions.confidence} confidence`);
  
  return {
    length: Math.round(dimensions.length * buffer * 100) / 100,
    width: Math.round(dimensions.width * buffer * 100) / 100,
    height: Math.round(dimensions.height * buffer * 100) / 100,
    source: dimensions.method,
    confidence: dimensions.confidence,
    category: classification.category,
    estimatedCubicFeet: dimensions.cubicFeet
  };
}

// ===== END OF NEW INTELLIGENT ESTIMATION FUNCTIONS =====

function validateDimensions(dimensions, category, name) {
  const { length, width, height } = dimensions;
  
  if (length <= 0 || width <= 0 || height <= 0) {
    console.warn(`Invalid dimensions for ${name}: ${length}x${width}x${height}`);
    return estimateDimensions(category, name);
  }
  
  if (length > 120 || width > 120 || height > 120) {
    console.warn(`Unrealistic dimensions for ${name}: ${length}x${width}x${height}, using estimates`);
    return estimateDimensions(category, name);
  }
  
  return dimensions;
}

function calculateShippingCost(dimensions, weight, orderTotal = 0) {
  let { length, width, height } = dimensions;
  
  const MAX_SINGLE_BOX = 96;
  
  // Calculate dimensional weight
  const dimensionalWeight = (length * width * height) / 166;
  const billableWeight = Math.max(weight, dimensionalWeight);
  
  // Base shipping cost calculation
  let shippingCost = 15; // Base rate
  
  // Add weight-based charges
  if (billableWeight > 10) {
    shippingCost += (billableWeight - 10) * 2;
  }
  
  // Add size-based charges for oversized items
  if (length > 48 || width > 48 || height > 48) {
    shippingCost += 25; // Oversized handling fee
  }
  
  // Apply Bermuda duty
  const dutyAmount = orderTotal * BERMUDA_DUTY_RATE;
  
  return {
    shipping: Math.round(shippingCost * 100) / 100,
    duty: Math.round(dutyAmount * 100) / 100,
    total: Math.round((shippingCost + dutyAmount) * 100) / 100
  };
}
