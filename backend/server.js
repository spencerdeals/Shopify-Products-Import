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
const USE_APIFY_FOR_AMAZON = apifyScraper.isAvailable();

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log(`ScrapingBee: ${USE_SCRAPINGBEE ? 'Enabled' : 'Disabled'}`);
console.log(`Apify (Amazon): ${USE_APIFY_FOR_AMAZON ? 'Enabled' : 'Disabled'}`);
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
    scrapingBee: USE_SCRAPINGBEE,
    apify: USE_APIFY_PRIMARY,
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
  
  length = Math.min(length, MAX_SINGLE_BOX);
  width = Math.min(width, MAX_SINGLE_BOX); 
  height = Math.min(height, MAX_SINGLE_BOX);
  
  let volume = length * width * height;
  let cubicFeet = volume / 1728;
  
  // More realistic minimum cubic feet based on order value
  if (orderTotal > 300) {
    cubicFeet = Math.max(cubicFeet, 4.5); // Increased from 3.5
  }
  if (orderTotal > 500) {
    cubicFeet = Math.max(cubicFeet, 7.5); // Increased from 6
  }
  if (orderTotal > 1000) {
    cubicFeet = Math.max(cubicFeet, 12); // Increased from 10
  }
  if (orderTotal > 2000) {
    cubicFeet = Math.max(cubicFeet, 18); // Increased from 15
  }
  
  console.log(`Order value: ${orderTotal}, Cubic feet: ${cubicFeet.toFixed(2)}`);
  
  // INCREASED base rate from $7.50 to $12.50 per cubic foot
  const baseCost = cubicFeet * 12.5;
  
  // Add realistic handling fees based on order complexity
  let handlingFees = 35; // Base handling fee
  if (orderTotal > 500) handlingFees += 25; // Medium order complexity
  if (orderTotal > 1500) handlingFees += 40; // High order complexity
  if (orderTotal > 3000) handlingFees += 60; // Very high complexity
  
  console.log(`Base shipping: ${baseCost}, Handling fees: ${handlingFees}`);
  
  // YOUR MARGIN STRUCTURE (keeping the same)
  let marginMultiplier;
  if (orderTotal < 400) {
    marginMultiplier = 1.45; // 45% margin
  } else if (orderTotal < 1500) {
    marginMultiplier = 1.30; // 30% margin  
  } else {
    marginMultiplier = 1.20; // 20% margin
  }
  
  let finalCost = (baseCost + handlingFees) * marginMultiplier;
  
  // Set more realistic minimums
  const minShipping = orderTotal > 0 ? Math.max(75, orderTotal * 0.18) : 75; // Increased from 35 and 15%
  
  // INCREASED cap from 50% to 65% of order value for more realistic freight costs
  if (orderTotal > 0) {
    const maxReasonableShipping = orderTotal * 0.65; // Increased from 0.5
    if (finalCost > maxReasonableShipping) {
      console.log(`Shipping cost ${finalCost} exceeds 65% of order value, capping at ${maxReasonableShipping}`);
      finalCost = Math.min(finalCost, maxReasonableShipping);
    }
  }
  
  return Math.max(minShipping, Math.round(finalCost * 100) / 100);
}

// ScrapingBee integration - BASIC WORKING CONFIG
async function scrapingBeeRequest(url) {
  if (!SCRAPINGBEE_API_KEY) {
    throw new Error('ScrapingBee API key not configured');
  }
  
  try {
    const scrapingBeeUrl = 'https://app.scrapingbee.com/api/v1/';
    const params = new URLSearchParams({
      api_key: SCRAPINGBEE_API_KEY,
      url: url,
      render_js: 'true',
      premium_proxy: 'false',  // Disable premium proxy to avoid 400 errors
      country_code: 'us',
      wait: '2000'
    });

    console.log(`ScrapingBee request for: ${url}`);
    
    const response = await axios.get(`${scrapingBeeUrl}?${params.toString()}`, {
      timeout: SCRAPING_TIMEOUT
    });

    console.log(`ScrapingBee SUCCESS - response size: ${response.data.length} characters`);
    return response.data;
  } catch (error) {
    console.error(`ScrapingBee FAILED for ${url}:`, error.response?.data || error.message);
    throw error;
  }
}

// Extract better product name from URL when scraping fails
function extractProductNameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    
    // Amazon: Look for product names in URL
    if (path.includes('/dp/') || path.includes('/product/')) {
      const segments = path.split('/');
      for (let i = 0; i < segments.length; i++) {
        if (segments[i] === 'dp' || segments[i] === 'product') {
          // Look for readable text in nearby segments
          const nearby = segments.slice(Math.max(0, i-2), i+3);
          const readable = nearby.find(seg => seg.length > 3 && !/^[A-Z0-9]+$/.test(seg));
          if (readable) {
            return readable.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          }
        }
      }
    }
    
    // Wayfair: Extract from path
    if (urlObj.hostname.includes('wayfair')) {
      const match = path.match(/\/([^\/]+)-w\d+/);
      if (match) {
        return match[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      }
    }
    
    // Walmart: Extract from path
    if (urlObj.hostname.includes('walmart')) {
      const segments = path.split('/');
      const ipIndex = segments.indexOf('ip');
      if (ipIndex > -1 && segments[ipIndex + 1]) {
        const name = segments[ipIndex + 1].split('/')[0];
        return name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

// Simplified intelligent dimension estimation
function makeIntelligentDimensionEstimate(category, price) {
  // This is now handled by getIntelligentDimensions
  return null;
}

async function parseScrapingBeeHTML(html, url) {
  const retailer = detectRetailer(url);
  const result = {};
  
  console.log(`Parsing HTML for ${retailer}, content length: ${html.length}`);
  
  // Enhanced name extraction patterns
  const namePatterns = [
    /<h1[^>]*id="productTitle"[^>]*>([^<]+)</i,
    /<h1[^>]*class="[^"]*product-title[^"]*"[^>]*>([^<]+)</i,
    /<h1[^>]*data-automation-id="product-title"[^>]*>([^<]+)</i,
    /<h1[^>]*class="[^"]*sku-title[^"]*"[^>]*>([^<]+)</i,
    /<h1[^>]*itemprop="name"[^>]*>([^<]+)</i,
    /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i,
    /<title>([^<]+)</i,
    /<h1[^>]*>([^<]+)</i
  ];
  
  for (const pattern of namePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      result.name = match[1].trim()
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      console.log(`Found product name: ${result.name.substring(0, 50)}...`);
      break;
    }
  }
  
  // Enhanced image extraction patterns with Amazon debugging
  const imagePatterns = [
    // Amazon specific patterns - most comprehensive set
    /<img[^>]*id="landingImage"[^>]*src="([^"]+)"/i,
    /<img[^>]*id="landingImage"[^>]*data-src="([^"]+)"/i,
    /<img[^>]*id="landingImage"[^>]*data-old-hires="([^"]+)"/i,
    /<img[^>]*class="[^"]*a-dynamic-image[^"]*"[^>]*src="([^"]+)"/i,
    /<img[^>]*class="[^"]*a-dynamic-image[^"]*"[^>]*data-src="([^"]+)"/i,
    /<img[^>]*data-old-hires="([^"]+)"/i,
    /<img[^>]*data-a-dynamic-image="([^"]+)"/i,
    // Amazon JSON patterns
    /"hiRes":"([^"]+)"/i,
    /"large":"([^"]+\.jpg[^"]*)"/i,
    // Wayfair patterns
    /<img[^>]*data-automation-id="product-primary-image"[^>]*src="([^"]+)"/i,
    // Walmart patterns  
    /<img[^>]*data-automation-id="product-image"[^>]*src="([^"]+)"/i,
    // Generic patterns
    /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i,
    /<img[^>]*class="[^"]*product[^"]*image[^"]*"[^>]*src="([^"]+)"/i,
    /<img[^>]*class="[^"]*primary[^"]*"[^>]*src="([^"]+)"/i,
    /<img[^>]*alt="[^"]*product[^"]*"[^>]*src="([^"]+)"/i,
    // Fallback - any large image
    /<img[^>]*src="([^"]+)"[^>]*width="[45]\d\d"/i,
    /<img[^>]*width="[45]\d\d"[^>]*src="([^"]+)"/i
  ];
  
  console.log(`Trying ${imagePatterns.length} image patterns for ${retailer}`);
  
  for (let i = 0; i < imagePatterns.length; i++) {
    const pattern = imagePatterns[i];
    const match = html.match(pattern);
    if (match && match[1]) {
      let imageUrl = match[1];
      console.log(`Image pattern ${i + 1} matched: ${imageUrl.substring(0, 100)}...`);
      
      // Clean up relative URLs
      if (imageUrl.startsWith('//')) {
        imageUrl = 'https:' + imageUrl;
      } else if (imageUrl.startsWith('/')) {
        const urlObj = new URL(url);
        imageUrl = urlObj.origin + imageUrl;
      }
      
      // Validate the image URL looks reasonable
      if (imageUrl.includes('.jpg') || imageUrl.includes('.jpeg') || imageUrl.includes('.png') || imageUrl.includes('.webp')) {
        result.image = imageUrl;
        console.log(`Found product image: ${imageUrl.substring(0, 50)}...`);
        break;
      } else {
        console.log(`Rejected image URL (no valid extension): ${imageUrl.substring(0, 50)}...`);
      }
    }
  }
  
  if (!result.image && retailer === 'Amazon') {
    console.log('Amazon image extraction failed, checking for JSON data...');
    // Try to find Amazon's image data in JSON
    const jsonMatches = html.match(/"colorImages":\s*\{[^}]*"initial":\s*\[[^\]]*\{[^}]*"hiRes":"([^"]+)"/);
    if (jsonMatches && jsonMatches[1]) {
      result.image = jsonMatches[1];
      console.log(`Found Amazon image in JSON: ${jsonMatches[1].substring(0, 50)}...`);
    } else {
      console.log('No Amazon JSON image data found either');
    }
  }
  
  // Don't try to extract price - we'll let customers enter it manually
  result.price = null;
  
  return result;
}

async function scrapeProduct(url) {
  const retailer = detectRetailer(url);
  
  // APIFY INTEGRATION FOR AMAZON
  if (retailer === 'Amazon' && USE_APIFY_FOR_AMAZON) {
    try {
      console.log(`🎯 Using Apify for Amazon product: ${url}`);
      const apifyData = await apifyScraper.scrapeAmazon(url);
      
      if (apifyData && (apifyData.name || apifyData.price)) {
        const category = categorizeProduct(apifyData.name || '', url);
        
        let dimensions = apifyData.dimensions;
        let dimensionSource = 'apify-scraped';
        let confidence = 'high';
        
        if (!dimensions) {
          console.log(`No dimensions from Apify, using intelligent estimation...`);
          const intelligentDims = await getIntelligentDimensions('', url, apifyData.price);
          dimensions = intelligentDims;
          dimensionSource = intelligentDims.source || 'intelligent-estimate';
          confidence = intelligentDims.confidence || 'medium';
        }
        
        const validatedDimensions = validateDimensions(dimensions, category, apifyData.name);
        const weight = apifyData.weight || estimateWeight(validatedDimensions, category);
        const shippingCost = calculateShippingCost(validatedDimensions, weight, apifyData.price || 0);
        
        return {
          id: generateProductId(),
          name: apifyData.name || 'Amazon Product',
          price: apifyData.price,
          image: apifyData.image || 'https://placehold.co/120x120/FF9800/FFFFFF/png?text=Amazon',
          retailer: retailer,
          category: apifyData.category || category,
          dimensions: validatedDimensions,
          dimensionSource: dimensionSource,
          confidence: confidence,
          weight: weight,
          shippingCost: shippingCost,
          url: url,
          needsManualPrice: !apifyData.price,
          priceMessage: !apifyData.price ? 'Please enter product price manually' : null,
          quantity: 1,
          scraped: true,
          method: 'Apify',
          brand: apifyData.brand,
          inStock: apifyData.inStock,
          estimateWarning: confidence !== 'high' ? 
            `Dimensions ${dimensionSource === 'apify-scraped' ? 'scraped' : 'estimated'} - Confidence: ${confidence}` : null
        };
      }
    } catch (error) {
      console.log(`⚠️ Apify failed for Amazon, falling back to ScrapingBee:`, error.message);
      // Fall through to ScrapingBee
    }
  }
  
  // SCRAPINGBEE FOR ALL OTHER RETAILERS (AND AMAZON FALLBACK)
  if (USE_SCRAPINGBEE) {
    try {
      console.log(`Using ScrapingBee for ${retailer}: ${url}`);
      const html = await scrapingBeeRequest(url);
      const productData = await parseScrapingBeeHTML(html, url);
      
      if (productData.name || html.length > 1000) { // If we got HTML content
        const category = categorizeProduct(productData.name || '', url);
        let dimensions;
        let dimensionSource;
        let confidence;
        
        // Use intelligent dimension estimation
        console.log(`Using intelligent dimension estimation...`);
        const intelligentDims = await getIntelligentDimensions(
          html, 
          url, 
          productData.price
        );
        
        dimensions = intelligentDims;
        dimensionSource = intelligentDims.source || 'intelligent-estimate';
        confidence = intelligentDims.confidence || 'low';
        
        const validatedDimensions = validateDimensions(dimensions, category, productData.name);
        const weight = estimateWeight(validatedDimensions, category);
        const shippingCost = calculateShippingCost(validatedDimensions, weight, productData.price || 0);

        return {
          id: generateProductId(),
          name: productData.name || 'Unknown Product',
          price: productData.price || null,
          image: productData.image || 'https://placehold.co/120x120/7CB342/FFFFFF/png?text=SDL',
          retailer: retailer,
          category: category,
          dimensions: validatedDimensions,
          dimensionSource: dimensionSource,
          confidence: confidence,
          weight: weight,
          shippingCost: shippingCost,
          url: url,
          needsManualPrice: !productData.price,
          priceMessage: !productData.price ? 'Price could not be detected automatically' : null,
          quantity: 1,
          scraped: true,
          method: 'ScrapingBee',
          estimateWarning: confidence !== 'high' ? 
            `ESTIMATED DIMENSIONS (${dimensionSource}, confidence: ${confidence}) - Manual verification recommended` : null
        };
      }
    } catch (error) {
      console.log(`ScrapingBee failed for ${url}:`, error.message);
    }
  }

  // Fallback data creation with intelligent estimation
  console.log(`Creating fallback data for ${retailer}: ${url}`);
  const intelligentDims = await getIntelligentDimensions('', url, null);
  const category = categorizeProduct('', url);
  const dimensions = intelligentDims;
  const weight = estimateWeight(dimensions, category);
  const shippingCost = calculateShippingCost(dimensions, weight, 0);

  // Try to extract a better name from URL
  const extractedName = extractProductNameFromUrl(url);
  const productName = extractedName ? `${extractedName} (${retailer})` : `${retailer} Product`;

  return {
    id: generateProductId(),
    name: productName,
    price: null,
    image: retailer === 'Amazon' ? 
      'https://placehold.co/120x120/FF9800/FFFFFF/png?text=Amazon' : 
      'https://placehold.co/120x120/7CB342/FFFFFF/png?text=SDL',
    retailer: retailer,
    category: category,
    dimensions: dimensions,
    dimensionSource: intelligentDims.source || 'fallback-estimate',
    confidence: intelligentDims.confidence || 'low',
    weight: weight,
    shippingCost: shippingCost,
    url: url,
    needsManualPrice: true,
    priceMessage: 'Price detection needed',
    quantity: 1,
    scraped: false,
    method: 'Fallback',
    estimateWarning: 'ESTIMATED DIMENSIONS (fallback) - Manual verification required'
  };
}

// API Routes
app.post('/api/scrape', async (req, res) => {
  try {
    let { urls } = req.body;
    
    console.log('Received scrape request with URLs:', urls);
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ success: false, error: 'URLs array is required' });
    }

    // BACKEND FAILSAFE: Split concatenated URLs that may have been incorrectly parsed by frontend
    const expandedUrls = [];
    urls.forEach(urlString => {
      // Split each URL string by spaces, then filter for valid URLs
      const splitUrls = urlString.split(/\s+/)
        .map(url => url.trim())
        .filter(url => url.startsWith('http') && url.length > 10);
      
      expandedUrls.push(...splitUrls);
    });
    
    console.log('URLs after backend expansion:', expandedUrls);
    
    if (expandedUrls.length > 20) {
      return res.status(400).json({ success: false, error: 'Maximum 20 URLs allowed per request' });
    }

    const validUrls = expandedUrls.filter(url => {
      try { 
        new URL(url); 
        return url.length > 10;
      } catch { 
        return false; 
      }
    });

    console.log('Valid URLs after filtering:', validUrls);

    if (validUrls.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid URLs provided' });
    }

    // Check for SDL domains
    const sdlUrls = validUrls.filter(url => isSDLDomain(url));
    if (sdlUrls.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'SDL products should be ordered directly through our catalog, not imported.' 
      });
    }

    console.log(`Starting to scrape ${validUrls.length} products...`);
    console.log(`Using ${USE_APIFY_FOR_AMAZON ? 'Apify for Amazon,' : ''} ${USE_SCRAPINGBEE ? 'ScrapingBee for others' : 'Fallback mode only'}`);
    
    const products = [];
    for (let i = 0; i < validUrls.length; i += MAX_CONCURRENT_SCRAPES) {
      const batch = validUrls.slice(i, i + MAX_CONCURRENT_SCRAPES);
      const batchPromises = batch.map(url => 
        Promise.race([
          scrapeProduct(url),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), SCRAPING_TIMEOUT))
        ]).catch(error => {
          console.error(`Failed to scrape ${url}:`, error.message);
          return null;
        })
      );
      const batchResults = await Promise.allSettled(batchPromises);
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          products.push(result.value);
        }
      });
    }

    const groupedProducts = {};
    products.forEach(product => {
      if (!groupedProducts[product.retailer]) {
        groupedProducts[product.retailer] = { retailer: product.retailer, products: [] };
      }
      groupedProducts[product.retailer].products.push(product);
    });

    const stats = {
      count: products.length,
      scraped: products.filter(p => p.scraped).length,
      pricesFound: products.filter(p => p.price).length,
      dimensionsFound: products.filter(p => p.dimensionSource === 'scraped' || p.dimensionSource === 'apify-scraped').length,
      intelligentEstimates: products.filter(p => p.dimensionSource === 'weight-based' || p.dimensionSource === 'price-based').length,
      fallbacksUsed: products.filter(p => p.confidence === 'fallback').length,
      apifyUsed: products.filter(p => p.method === 'Apify').length,
      retailers: Object.keys(groupedProducts)
    };

    console.log(`Scraping completed:`, stats);
    res.json({
      success: true,
      products: products,
      groupedProducts: groupedProducts,
      ...stats
    });

  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ success: false, error: error.message || 'Scraping failed' });
  }
});

app.post('/apps/instant-import/create-draft-order', async (req, res) => {
  try {
    const { customer, products, deliveryFees, totals, originalUrls, quote } = req.body;
    
    if (!SHOPIFY_ACCESS_TOKEN) {
      return res.status(500).json({ 
        success: false, 
        message: 'Shopify not configured. Please set SHOPIFY_ACCESS_TOKEN environment variable.' 
      });
    }
    
    if (!customer || !products || !Array.isArray(products)) {
      return res.status(400).json({ success: false, message: 'Customer and products are required' });
    }

    const lineItems = products.map(product => {
      const title = `${product.name} (${product.retailer})`;
      const properties = [
        { name: 'Product URL', value: product.url },
        { name: 'Retailer', value: product.retailer },
        { name: 'Category', value: product.category },
        { name: 'Dimensions', value: `${product.dimensions.length.toFixed(1)}" x ${product.dimensions.width.toFixed(1)}" x ${product.dimensions.height.toFixed(1)}"` },
        { name: 'Dimension Source', value: product.dimensionSource || 'estimate' },
        { name: 'Confidence', value: product.confidence || 'unknown' },
        { name: 'Weight', value: `${product.weight} lbs` },
        { name: 'Ocean Freight Cost', value: `$${product.shippingCost}` }
      ];
      return {
        title: title,
        price: product.price || 0,
        quantity: product.quantity || 1,
        properties: properties,
        custom: true,
        taxable: false
      };
    });

    if (deliveryFees && Object.keys(deliveryFees).length > 0) {
      Object.entries(deliveryFees).forEach(([retailer, fee]) => {
        if (fee > 0) {
          lineItems.push({
            title: `USA Delivery Fee - ${retailer}`,
            price: fee,
            quantity: 1,
            custom: true,
            taxable: false
          });
        }
      });
    }

    if (totals && totals.dutyAmount > 0) {
      lineItems.push({
        title: 'Bermuda Import Duty (26.5%)',
        price: totals.dutyAmount,
        quantity: 1,
        custom: true,
        taxable: false
      });
    }

    const customerNote = `
BERMUDA IMPORT QUOTE ESTIMATE - ${new Date().toLocaleDateString()}

CUSTOMER: ${customer.name} (${customer.email})

⚠️  IMPORTANT: This is an ESTIMATE based on scraped data. Manual verification required before final pricing.

COST BREAKDOWN:
- Product Cost: $${(totals.totalItemCost || 0).toFixed(2)}
- USA Delivery Fees: $${(totals.totalDeliveryFees || 0).toFixed(2)}
- Bermuda Duty (26.5%): $${(totals.dutyAmount || 0).toFixed(2)}
- Ocean Freight (ESTIMATED): $${(totals.totalShippingCost || 0).toFixed(2)}
- TOTAL ESTIMATE: $${(totals.grandTotal || 0).toFixed(2)}

DIMENSION SOURCES:
${products.map(p => `• ${p.name}: ${p.dimensionSource || 'unknown'} (${p.confidence || 'unknown'} confidence)`).join('\n')}

MANUAL VERIFICATION NEEDED FOR:
${products.filter(p => p.confidence === 'low' || p.confidence === 'fallback').length > 0 ? 
  `• Products with low confidence dimensions:\n${products.filter(p => p.confidence === 'low' || p.confidence === 'fallback').map(p => `  - ${p.name}`).join('\n')}\n` : ''}
${products.filter(p => p.needsManualPrice).length > 0 ? 
  `• Products requiring price verification:\n${products.filter(p => p.needsManualPrice).map(p => `  - ${p.name}`).join('\n')}\n` : ''}

FREIGHT FORWARDER: Sealine Freight - Elizabeth, NJ 07201-614

ORIGINAL URLS:
${originalUrls ? originalUrls.map((url, i) => `${i+1}. ${url}`).join('\n') : 'No URLs provided'}

This quote was generated using the SDL Instant Import Calculator.
Final pricing subject to manual verification and adjustment.
        `.trim();

    const shopifyData = {
      draft_order: {
        line_items: lineItems,
        customer: {
          email: customer.email,
          first_name: customer.name.split(' ')[0] || customer.name,
          last_name: customer.name.split(' ').slice(1).join(' ') || ''
        },
        note: customerNote,
        email: customer.email,
        invoice_sent_at: null,
        invoice_url: null,
        name: `#IMP${Date.now().toString().slice(-6)}`,
        status: 'open',
        tags: 'instant-import,bermuda-freight,quote,estimated-dimensions'
      }
    };

    console.log('Creating Shopify draft order...');
    const response = await axios.post(
      `https://${SHOPIFY_DOMAIN}/admin/api/2023-10/draft_orders.json`,
      shopifyData,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    const draftOrder = response.data.draft_order;
    console.log(`Draft order created: ${draftOrder.name}`);

    res.json({
      success: true,
      draftOrderId: draftOrder.id,
      draftOrderNumber: draftOrder.name,
      orderUrl: `https://${SHOPIFY_DOMAIN}/admin/draft_orders/${draftOrder.id}`,
      invoiceUrl: draftOrder.invoice_url,
      totalPrice: draftOrder.total_price,
      message: 'Draft order created successfully'
    });
  } catch (error) {
    console.error('Draft order creation error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.errors || error.message || 'Failed to create draft order'
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// CRITICAL: Bind to 0.0.0.0 for Railway
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Bermuda Import Calculator Backend running on port ${PORT}`);
  console.log(`✅ Health check available at: http://0.0.0.0:${PORT}/health`);
  console.log(`✅ Frontend served at: http://0.0.0.0:${PORT}/`);
  console.log(`✅ Ready to process import quotes with intelligent dimension estimation!`);
  console.log(`✅ Apify integration ${USE_APIFY_FOR_AMAZON ? 'ACTIVE' : 'DISABLED'} for Amazon products`);
}).on('error', (err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;
