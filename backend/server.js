const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sdl2024admin';
const BERMUDA_DUTY_RATE = 0.265;
const SHIPPING_RATE_PER_CUBIC_FOOT = 6;
const CARD_FEE_RATE = 0.0325;
const TEST_MODE = process.env.TEST_MODE === 'true';
const DOCUMENTATION_FEE_PER_VENDOR = 10;

// Email configuration
const EMAIL_FROM = process.env.EMAIL_FROM || 'orders@sdl.bm';
const EMAIL_TO_ADMIN = process.env.EMAIL_TO_ADMIN || 'admin@sdl.bm';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';

// Google Sheets configuration
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? 
  JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY) : null;

// Load optional APIs
let google = null;
let sendgrid = null;

// Apify configuration
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const ENABLE_APIFY = true;

// Initialize Apify
let apifyClient = null;
try {
  if (ENABLE_APIFY && APIFY_API_KEY) {
    const { ApifyClient } = require('apify-client');
    apifyClient = new ApifyClient({ token: APIFY_API_KEY });
    console.log('✅ Apify initialized for multi-retailer scraping');
  }
} catch (error) {
  console.log('⚠️ Apify client not available:', error.message);
}

if (GOOGLE_SERVICE_ACCOUNT_KEY) {
  try {
    google = require('googleapis').google;
    console.log('✅ Google Sheets API configured');
  } catch (error) {
    console.log('⚠️ Google APIs not installed');
  }
}

if (SENDGRID_API_KEY) {
  try {
    sendgrid = require('@sendgrid/mail');
    sendgrid.setApiKey(SENDGRID_API_KEY);
    console.log('✅ SendGrid email configured');
  } catch (error) {
    console.log('⚠️ SendGrid not installed');
  }
}

// Learning Database
const LEARNING_DB_PATH = path.join(__dirname, 'learning_data.json');
const ORDERS_DB_PATH = path.join(__dirname, 'orders_data.json');

let LEARNING_DB = {
  products: {},
  patterns: {},
  retailer_stats: {},
  bol_patterns: {}
};

let ORDERS_DB = {
  orders: [],
  draft_orders: [],
  abandoned_carts: [],
  stats: {
    total_orders: 0,
    total_revenue: 0,
    average_order_value: 0
  }
};

// Load existing data
try {
  if (fs.existsSync(LEARNING_DB_PATH)) {
    LEARNING_DB = JSON.parse(fs.readFileSync(LEARNING_DB_PATH, 'utf8'));
    console.log('✅ Loaded learning database with', Object.keys(LEARNING_DB.products).length, 'products');
  }
} catch (error) {
  console.log('📝 Starting with fresh learning database');
}

try {
  if (fs.existsSync(ORDERS_DB_PATH)) {
    ORDERS_DB = JSON.parse(fs.readFileSync(ORDERS_DB_PATH, 'utf8'));
    console.log('✅ Loaded orders database with', ORDERS_DB.orders.length, 'orders');
  }
} catch (error) {
  console.log('📝 Starting with fresh orders database');
}

// Save functions
function saveLearningDB() {
  try {
    fs.writeFileSync(LEARNING_DB_PATH, JSON.stringify(LEARNING_DB, null, 2));
  } catch (error) {
    console.error('Error saving learning database:', error);
  }
}

function saveOrdersDB() {
  try {
    fs.writeFileSync(ORDERS_DB_PATH, JSON.stringify(ORDERS_DB, null, 2));
  } catch (error) {
    console.error('Error saving orders database:', error);
  }
}

// BOL-BASED SHIPPING PATTERNS
const BOL_PATTERNS = {
  furniture: {
    avgWeight: 348,
    avgCubicFeet: 49.5,
    dimensions: {
      sofa: { length: 84, width: 38, height: 36, weight: 185 },
      chair: { length: 36, width: 32, height: 38, weight: 65 },
      table: { length: 60, width: 36, height: 30, weight: 120 },
      dresser: { length: 60, width: 20, height: 48, weight: 250 },
      mattress: { length: 80, width: 60, height: 12, weight: 100 },
      cabinet: { length: 36, width: 18, height: 72, weight: 150 },
      default: { length: 48, width: 30, height: 36, weight: 150 }
    }
  },
  electronics: {
    avgWeight: 45,
    avgCubicFeet: 12,
    dimensions: {
      tv: { length: 55, width: 8, height: 35, weight: 45 },
      default: { length: 24, width: 18, height: 20, weight: 35 }
    }
  },
  appliances: {
    avgWeight: 220,
    avgCubicFeet: 55,
    dimensions: {
      refrigerator: { length: 36, width: 36, height: 70, weight: 350 },
      washer: { length: 30, width: 30, height: 40, weight: 200 },
      default: { length: 32, width: 32, height: 48, weight: 180 }
    }
  },
  toys: {
    avgWeight: 15,
    avgCubicFeet: 8,
    dimensions: {
      default: { length: 20, width: 16, height: 14, weight: 10 }
    }
  },
  clothing: {
    avgWeight: 5,
    avgCubicFeet: 3,
    dimensions: {
      default: { length: 14, width: 12, height: 4, weight: 3 }
    }
  },
  general: {
    avgWeight: 75,
    avgCubicFeet: 25,
    dimensions: {
      default: { length: 24, width: 20, height: 18, weight: 50 }
    }
  }
};

// FLAT-PACK INTELLIGENCE SYSTEM
function isFlatPackable(category, productName, retailer) {
  const name = productName.toLowerCase();
  
  const nonFlatPackable = [
    'refrigerator', 'fridge', 'washer', 'dryer', 'dishwasher', 
    'oven', 'stove', 'range', 'microwave',
    'mattress', 'box spring',
    'tv', 'television', 'monitor', 'computer',
    'sofa', 'couch', 'loveseat', 'recliner', 'sectional',
    'upholstered', 'ottoman'
  ];
  
  if (nonFlatPackable.some(item => name.includes(item))) {
    return false;
  }
  
  const flatPackRetailers = [
    'Wayfair', 'IKEA', 'Amazon', 'Target', 'Walmart', 
    'Overstock', 'Home Depot', 'Lowes', 'CB2', 
    'West Elm', 'Article', 'Ashley Furniture'
  ];
  
  const flatPackableItems = [
    'table', 'desk', 'console', 'buffet', 'sideboard',
    'bookshelf', 'shelf', 'shelving', 'cabinet', 'dresser',
    'nightstand', 'end table', 'coffee table', 'dining',
    'chair', 'stool', 'bench', 'bed frame', 'headboard',
    'wardrobe', 'armoire', 'vanity', 'cart', 'stand',
    'entertainment center', 'tv stand', 'media console',
    'patio', 'outdoor', 'garden', 'deck', 'gazebo',
    'filing', 'office', 'workstation',
    'storage', 'organizer', 'rack', 'tower'
  ];
  
  if (category === 'furniture') {
    if (flatPackRetailers.includes(retailer)) {
      if (flatPackableItems.some(item => name.includes(item))) {
        return true;
      }
    }
  }
  
  const flatPackKeywords = [
    'assembly required', 'requires assembly', 'easy assembly',
    'flat pack', 'flat-pack', 'flatpack', 'knockdown',
    'ready to assemble', 'rta', 'diy'
  ];
  
  if (flatPackKeywords.some(keyword => name.includes(keyword))) {
    return true;
  }
  
  if (category === 'furniture' && flatPackRetailers.includes(retailer)) {
    return true;
  }
  
  return false;
}

function calculateFlatPackDimensions(originalDimensions, productName) {
  const name = productName.toLowerCase();
  
  let reductionProfile = {
    length: 1.0,
    width: 1.0,
    height: 0.15
  };
  
  if (name.includes('table') || name.includes('desk') || name.includes('console') || name.includes('buffet')) {
    reductionProfile = {
      length: Math.min(originalDimensions.length, 72),
      width: originalDimensions.width * 1.0,
      height: Math.max(6, originalDimensions.height * 0.12)
    };
  } else if (name.includes('chair') || name.includes('stool')) {
    reductionProfile = {
      length: originalDimensions.length * 0.8,
      width: originalDimensions.width * 0.8,
      height: Math.max(8, originalDimensions.height * 0.25)
    };
  } else if (name.includes('shelf') || name.includes('bookcase') || name.includes('bookshelf')) {
    reductionProfile = {
      length: originalDimensions.length * 1.0,
      width: Math.max(12, originalDimensions.width * 0.3),
      height: Math.max(4, originalDimensions.height * 0.1)
    };
  } else if (name.includes('dresser') || name.includes('cabinet') || name.includes('wardrobe')) {
    reductionProfile = {
      length: originalDimensions.length * 0.9,
      width: originalDimensions.width * 1.0,
      height: Math.max(8, originalDimensions.height * 0.15)
    };
  } else if (name.includes('bed')) {
    reductionProfile = {
      length: Math.min(originalDimensions.length * 0.9, 84),
      width: originalDimensions.width * 0.5,
      height: Math.max(6, originalDimensions.height * 0.2)
    };
  }
  
  const flatPackDims = {
    length: Math.round(reductionProfile.length),
    width: Math.round(reductionProfile.width),
    height: Math.round(reductionProfile.height)
  };
  
  flatPackDims.length = Math.max(3, flatPackDims.length);
  flatPackDims.width = Math.max(3, flatPackDims.width);
  flatPackDims.height = Math.max(3, flatPackDims.height);
  
  console.log(`   📦 Flat-pack reduction: ${originalDimensions.length}x${originalDimensions.width}x${originalDimensions.height} → ${flatPackDims.length}x${flatPackDims.width}x${flatPackDims.height}`);
  
  return flatPackDims;
}

function adjustFlatPackWeight(originalWeight, category) {
  if (category === 'furniture') {
    return Math.round(originalWeight * 0.85);
  }
  return originalWeight;
}

console.log('=== SDL IMPORT CALCULATOR SERVER ===');
console.log(`Environment: ${TEST_MODE ? 'TEST' : 'PRODUCTION'}`);
console.log(`Port: ${PORT}`);
console.log(`Shopify: ${SHOPIFY_ACCESS_TOKEN ? 'CONNECTED' : 'NOT CONFIGURED'}`);
console.log(`Email: ${sendgrid ? 'ENABLED' : 'DISABLED'}`);
console.log(`Google Sheets: ${GOOGLE_SERVICE_ACCOUNT_KEY ? 'ENABLED' : 'DISABLED'}`);
console.log(`Apify: ${ENABLE_APIFY && apifyClient ? '✅ ENABLED (Multi-retailer)' : '❌ DISABLED'}`);
console.log(`  - API Key: ${APIFY_API_KEY ? 'SET' : 'MISSING'}`);
console.log(`ScrapingBee: ${SCRAPINGBEE_API_KEY ? '✅ ENABLED (Fallback)' : '❌ DISABLED'}`);
console.log(`  - API Key: ${SCRAPINGBEE_API_KEY ? 'SET' : 'MISSING'}`);
console.log('Margin Structure: TIERED on Total Order Value');
console.log(`Documentation Fee: $${DOCUMENTATION_FEE_PER_VENDOR} per vendor`);
console.log('Flat-Pack Intelligence: ENABLED');
console.log('Variant & Thumbnail Support: ENHANCED');
console.log('\n🔧 SCRAPING STRATEGY:');
if (ENABLE_APIFY && apifyClient && SCRAPINGBEE_API_KEY) {
  console.log('✅ OPTIMAL: Apify (Amazon/Wayfair/General) → ScrapingBee AI → Estimation');
} else if (ENABLE_APIFY && apifyClient) {
  console.log('⚠️  GOOD: Apify only → Estimation (No ScrapingBee fallback)');
} else if (SCRAPINGBEE_API_KEY) {
  console.log('⚠️  LIMITED: ScrapingBee AI only → Estimation (No Apify)');
} else {
  console.log('❌ MINIMAL: Estimation only (No scrapers configured)');
}
console.log('====================================\n');

// Middleware
app.use(cors({
  origin: ['https://sdl.bm', 'https://spencer-deals-ltd.myshopify.com', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.raw({ type: 'application/json' }));
app.set('trust proxy', true);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: TEST_MODE ? 'test' : 'production',
    marginStructure: 'tiered on total order',
    features: {
      flatPackIntelligence: true,
      variantSupport: true,
      thumbnailSupport: true
    },
    services: {
      shopify: !!SHOPIFY_ACCESS_TOKEN,
      email: !!sendgrid,
      google_sheets: !!GOOGLE_SERVICE_ACCOUNT_KEY,
      scraping: !!SCRAPINGBEE_API_KEY,
      apify: ENABLE_APIFY && !!apifyClient
    },
    stats: {
      products_learned: Object.keys(LEARNING_DB.products).length,
      total_orders: ORDERS_DB.orders.length,
      abandoned_carts: ORDERS_DB.abandoned_carts.length
    }
  });
});

// Rate limiters
const scrapeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many scraping requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.connection.remoteAddress || 
           req.ip;
  },
  skip: (req) => {
    return req.path === '/health';
  }
});

const orderRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many order attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.connection.remoteAddress || 
           req.ip;
  }
});

// Utilities
function generateOrderId() {
  return 'SDL' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

function detectRetailer(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    
    if (domain.includes('amazon.com')) return 'Amazon';
    if (domain.includes('wayfair.com')) return 'Wayfair';
    if (domain.includes('walmart.com')) return 'Walmart';
    if (domain.includes('target.com')) return 'Target';
    if (domain.includes('bestbuy.com')) return 'Best Buy';
    if (domain.includes('homedepot.com')) return 'Home Depot';
    if (domain.includes('lowes.com')) return 'Lowes';
    if (domain.includes('costco.com')) return 'Costco';
    if (domain.includes('ikea.com')) return 'IKEA';
    if (domain.includes('ebay.com')) return 'eBay';
    if (domain.includes('etsy.com')) return 'Etsy';
    if (domain.includes('overstock.com')) return 'Overstock';
    if (domain.includes('bedbathandbeyond.com')) return 'Bed Bath & Beyond';
    if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
    if (domain.includes('potterybarn.com')) return 'Pottery Barn';
    if (domain.includes('westelm.com')) return 'West Elm';
    if (domain.includes('cb2.com')) return 'CB2';
    if (domain.includes('article.com')) return 'Article';
    if (domain.includes('ashleyfurniture.com')) return 'Ashley Furniture';
    if (domain.includes('lazyboy.com')) return 'La-Z-Boy';
    if (domain.includes('macys.com')) return 'Macys';
    if (domain.includes('nordstrom.com')) return 'Nordstrom';
    if (domain.includes('sephora.com')) return 'Sephora';
    if (domain.includes('ulta.com')) return 'Ulta';
    if (domain.includes('nike.com')) return 'Nike';
    if (domain.includes('adidas.com')) return 'Adidas';
    if (domain.includes('gap.com')) return 'Gap';
    if (domain.includes('oldnavy.com')) return 'Old Navy';
    if (domain.includes('lunafurn.com')) return 'Luna Furniture';
    
    return 'Other Retailer';
  } catch (e) {
    return 'Unknown Retailer';
  }
}

function isSDLDomain(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    const blockedPatterns = ['spencer-deals-ltd.myshopify.com', 'sdl.bm', 'spencer-deals'];
    return blockedPatterns.some(pattern => domain.includes(pattern));
  } catch (e) {
    return false;
  }
}

function categorizeProduct(name, url) {
  const text = (name + ' ' + url).toLowerCase();
  
  if (/\b(sofa|couch|chair|recliner|ottoman|table|desk|dresser|bed|mattress|furniture|dining|patio|console|buffet|cabinet|shelf|bookcase)\b/.test(text)) return 'furniture';
  if (/\b(tv|television|monitor|laptop|computer|tablet|phone|camera|speaker|headphone|electronic)\b/.test(text)) return 'electronics';
  if (/\b(refrigerator|fridge|washer|dryer|dishwasher|microwave|oven|stove|appliance)\b/.test(text)) return 'appliances';
  if (/\b(toy|game|puzzle|doll|lego|playset|bounce|slide|tikes)\b/.test(text)) return 'toys';
  if (/\b(shirt|pants|dress|jacket|shoes|clothing|apparel|wear)\b/.test(text)) return 'clothing';
  return 'general';
}

// Learning functions with variant tracking
function learnFromProduct(url, productData) {
  LEARNING_DB.products[url] = {
    ...productData,
    last_updated: new Date().toISOString(),
    times_seen: (LEARNING_DB.products[url]?.times_seen || 0) + 1
  };
  
  if (productData.category && productData.price) {
    if (!LEARNING_DB.patterns[productData.category]) {
      LEARNING_DB.patterns[productData.category] = {
        prices: [],
        weights: [],
        dimensions: [],
        variants: []
      };
    }
    
    const pattern = LEARNING_DB.patterns[productData.category];
    if (productData.price) pattern.prices.push(productData.price);
    if (productData.weight) pattern.weights.push(productData.weight);
    if (productData.dimensions) pattern.dimensions.push(productData.dimensions);
    if (productData.variant) pattern.variants.push(productData.variant);
    
    if (pattern.prices.length > 100) pattern.prices.shift();
    if (pattern.weights.length > 100) pattern.weights.shift();
    if (pattern.dimensions.length > 100) pattern.dimensions.shift();
    if (pattern.variants && pattern.variants.length > 100) pattern.variants.shift();
  }
  
  const retailer = productData.retailer;
  if (!LEARNING_DB.retailer_stats[retailer]) {
    LEARNING_DB.retailer_stats[retailer] = { 
      attempts: 0, 
      successes: 0,
      variants_found: 0,
      thumbnails_found: 0,
      flat_packed: 0
    };
  }
  LEARNING_DB.retailer_stats[retailer].attempts++;
  if (productData.price) {
    LEARNING_DB.retailer_stats[retailer].successes++;
  }
  if (productData.variant) {
    LEARNING_DB.retailer_stats[retailer].variants_found++;
    console.log(`   🎨 Variant captured: ${productData.variant}`);
  }
  if (productData.thumbnail && productData.thumbnail !== productData.image) {
    LEARNING_DB.retailer_stats[retailer].thumbnails_found++;
    console.log(`   🖼️ Separate thumbnail captured`);
  }
  if (productData.isFlatPack) {
    LEARNING_DB.retailer_stats[retailer].flat_packed++;
  }
  
  saveLearningDB();
}

function getLearnedData(url) {
  if (LEARNING_DB.products[url]) {
    const learned = LEARNING_DB.products[url];
    const hoursSinceUpdate = (Date.now() - new Date(learned.last_updated).getTime()) / (1000 * 60 * 60);
    
    if (hoursSinceUpdate < 24) {
      console.log('   📚 Using learned data from previous scrape');
      return learned;
    }
  }
  return null;
}

function estimateDimensionsFromBOL(category, name = '', retailer = '') {
  const text = name.toLowerCase();
  
  if (LEARNING_DB.patterns[category] && LEARNING_DB.patterns[category].dimensions.length > 0) {
    const dims = LEARNING_DB.patterns[category].dimensions;
    const avgDim = dims[dims.length - 1];
    return avgDim;
  }
  
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  
  if (category === 'furniture') {
    if (retailer === 'Wayfair' || retailer === 'IKEA' || retailer === 'Amazon') {
      let baseDims;
      
      if (text.includes('sofa') || text.includes('couch')) {
        baseDims = patterns.dimensions.sofa;
      } else if (text.includes('chair')) {
        baseDims = patterns.dimensions.chair;
      } else if (text.includes('table') || text.includes('console') || text.includes('buffet')) {
        baseDims = patterns.dimensions.table;
      } else if (text.includes('dresser')) {
        baseDims = patterns.dimensions.dresser;
      } else if (text.includes('cabinet')) {
        baseDims = patterns.dimensions.cabinet;
      } else {
        baseDims = patterns.dimensions.default;
      }
      
      return {
        length: baseDims.length,
        width: Math.round(baseDims.width * 0.9),
        height: Math.round(baseDims.height * 0.9)
      };
    }
    
    if (text.includes('sofa') || text.includes('couch')) return patterns.dimensions.sofa;
    if (text.includes('chair')) return patterns.dimensions.chair;
    if (text.includes('table')) return patterns.dimensions.table;
    if (text.includes('dresser')) return patterns.dimensions.dresser;
    if (text.includes('mattress')) return patterns.dimensions.mattress;
    if (text.includes('cabinet')) return patterns.dimensions.cabinet;
  }
  
  const dims = patterns.dimensions.default;
  const variance = 0.85 + Math.random() * 0.3;
  
  return {
    length: Math.round(dims.length * variance),
    width: Math.round(dims.width * variance),
    height: Math.round(dims.height * variance)
  };
}

function estimateWeightFromBOL(dimensions, category) {
  if (LEARNING_DB.patterns[category] && LEARNING_DB.patterns[category].weights.length > 0) {
    const weights = LEARNING_DB.patterns[category].weights;
    const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
    return Math.round(avgWeight);
  }
  
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  const weightPerCubic = patterns.avgWeight / patterns.avgCubicFeet;
  const estimatedWeight = Math.max(10, cubicFeet * weightPerCubic);
  return Math.round(estimatedWeight);
}

// MARGIN CALCULATION ON TOTAL ORDER VALUE
function calculateSDLMargin(cubicFeet, landedCost) {
  let marginRate;
  if (cubicFeet < 5) {
    marginRate = 0.20;
  } else if (cubicFeet < 10) {
    marginRate = 0.25;
  } else if (cubicFeet < 20) {
    marginRate = 0.22;
  } else if (cubicFeet < 50) {
    marginRate = 0.18;
  } else {
    marginRate = 0.15;
  }
  
  if (landedCost > 5000) {
    marginRate = Math.min(marginRate, 0.12);
  } else if (landedCost > 3000) {
    marginRate = Math.min(marginRate, 0.15);
  } else if (landedCost > 1000) {
    marginRate = Math.min(marginRate, 0.18);
  }
  
  console.log(`   📊 Margin calculation: ${cubicFeet.toFixed(1)} ft³, $${landedCost.toFixed(2)} → ${(marginRate * 100).toFixed(0)}%`);
  
  return marginRate;
}

function roundToNinetyFive(amount) {
  const rounded = Math.floor(amount) + 0.95;
  return rounded;
}

// SIMPLIFIED SHIPPING CALCULATION (NO OVERSIZE/HEAVY FEES)
function calculateShippingCost(dimensions, weight, price) {
  if (!dimensions) {
    return Math.round(Math.max(25, price * 0.15));
  }
  
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Simple calculation: just volumetric rate + handling
  const baseCost = Math.max(15, cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT);
  const handlingFee = 15;
  
  const totalCost = baseCost + handlingFee;
  return Math.round(totalCost);
}

// APIFY-PRIORITIZED SCRAPING WITH SCRAPINGBEE FALLBACK
async function scrapeWithScrapingBee(url) {
  if (TEST_MODE) {
    return {
      price: 99.99,
      title: 'Test Product',
      image: 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=Test',
      thumbnail: 'https://placehold.co/100x100/7CB342/FFFFFF/png?text=Test',
      variant: 'Test Variant',
      sku: 'TEST-SKU-123'
    };
  }
  
  const retailer = detectRetailer(url);
  
  // AMAZON APIFY SCRAPER
  if (retailer === 'Amazon' && ENABLE_APIFY && apifyClient) {
    try {
      console.log('   🔄 Using junglee Amazon Crawler...');
      
      const run = await apifyClient.actor('junglee/Amazon-crawler').call({
        categoryOrProductUrls: [
          { url: url, method: "GET" }
        ],
        maxItemsPerStartUrl: 1,
        scraperProductDetails: true,
        locationDelverableRoutes: [
          "PRODUCT",
          "SEARCH", 
          "OFFERS"
        ],
        maxOffersPerStartUrl: 0,
        useCaptchaSolver: false,
        proxyCountry: "AUTO_SELECT_PROXY_COUNTRY"
      });
      
      console.log('   ⏳ Waiting for Amazon scraper to complete...');
      await apifyClient.run(run.id).waitForFinish({ waitSecs: 60 });
      const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('   ✅ Amazon scraping success!');
        
        // Extract price
        let price = null;
        if (item.price) {
          if (typeof item.price === 'object') {
            price = item.price.value || item.price.amount || item.price.current || null;
          } else if (typeof item.price === 'string') {
            const priceMatch = item.price.match(/[\d,]+\.?\d*/) || item.price.match(/\$\s*([\d,]+\.?\d*)/);
            price = priceMatch ? parseFloat(priceMatch[0].replace(',', '')) : null;
          } else {
            price = parseFloat(item.price);
          }
        }
        
        if (!price && item.offer?.price) {
          price = parseFloat(item.offer.price);
        }
        
        // Try additional price fields
        if (!price && item.currentPrice) {
          price = parseFloat(item.currentPrice.toString().replace(/[^\d.]/g, ''));
        }
        
        if (!price && item.priceRange) {
          const priceMatch = item.priceRange.match(/[\d,]+\.?\d*/);
          price = priceMatch ? parseFloat(priceMatch[0].replace(',', '')) : null;
        }
        
        // Extract variant from title or variations
        let variant = null;
        if (item.variationSelection) {
          variant = Object.entries(item.variationSelection)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
        } else if (item.selectedVariations) {
          variant = item.selectedVariations;
        }
        
        // Extract image
        const image = item.mainImage || item.image || item.images?.[0] || item.imageUrl || null;
        
        console.log('   💰 Price:', price || 'Not found');
        console.log('   🎨 Variant:', variant || 'Not specified');
        console.log('   📋 ASIN:', item.asin || 'Not found');
        
        return {
          price: price,
          title: item.title || item.name || 'Amazon Product',
          image: image,
          thumbnail: image,
          variant: variant,
          sku: item.asin || null,
          brand: item.brand || item.manufacturer || null
        };
      }
      
    } catch (apifyError) {
      console.log('   ⚠️ Amazon Apify scraping failed:', apifyError.message);
    }
  }
  
  // WAYFAIR APIFY SCRAPER
  if (retailer === 'Wayfair' && ENABLE_APIFY && apifyClient) {
    try {
      console.log('   🔄 Using 123webdata Wayfair Scraper...');
      
      let urlVariant = null;
      if (url.includes('piid=')) {
        const piidMatch = url.match(/piid=(\d+)/);
        if (piidMatch) {
          urlVariant = `Variant ID: ${piidMatch[1]}`;
          console.log(`   📎 URL contains variant: ${urlVariant}`);
        }
      }
      
      const run = await apifyClient.actor('123webdata/wayfair-scraper').call({
        productUrls: [url],
        includeOptionDetails: true,
        includeAllImages: true,
        maxRequestsPerCrawl: 10,
        maxRequestRetries: 3,
        proxy: {
          useApifyProxy: true,
          apifyProxyCountry: 'US'
        }
      });
      
      console.log('   ⏳ Waiting for Wayfair scraper to complete...');
      await apifyClient.run(run.id).waitForFinish({ waitSecs: 60 });
      const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('   ✅ Wayfair scraping success!');
        
        let price = null;
        if (item.price) {
          price = typeof item.price === 'string' ? 
            parseFloat(item.price.replace(/[^0-9.]/g, '')) : 
            item.price;
        } else if (item.salePrice) {
          price = parseFloat(item.salePrice);
        } else if (item.currentPrice) {
          price = parseFloat(item.currentPrice.toString().replace(/[^0-9.]/g, ''));
        } else if (item.priceRange) {
          const priceMatch = item.priceRange.match(/[\d,]+\.?\d*/);
          if (priceMatch) {
            price = parseFloat(priceMatch[0].replace(',', ''));
          }
        }
        
        let variant = null;
        let variantDetails = [];
        
        if (item.selectedOptions && typeof item.selectedOptions === 'object') {
          Object.entries(item.selectedOptions).forEach(([key, value]) => {
            if (value && value !== 'Default' && value !== 'None') {
              const cleanKey = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1').trim();
              variantDetails.push(`${cleanKey}: ${value}`);
            }
          });
        }
        
        if (!variantDetails.length && item.options) {
          if (Array.isArray(item.options)) {
            item.options.forEach(option => {
              if (option.selected) {
                variantDetails.push(`${option.name}: ${option.value}`);
              }
            });
          } else if (typeof item.options === 'object') {
            Object.entries(item.options).forEach(([key, value]) => {
              if (value && value !== 'Default') {
                variantDetails.push(`${key}: ${value}`);
              }
            });
          }
        }
        
        const variantFields = [
          { field: 'color', label: 'Color' },
          { field: 'selectedColor', label: 'Color' },
          { field: 'size', label: 'Size' },
          { field: 'selectedSize', label: 'Size' },
          { field: 'configuration', label: 'Configuration' },
          { field: 'material', label: 'Material' },
          { field: 'style', label: 'Style' },
          { field: 'finish', label: 'Finish' }
        ];
        
        variantFields.forEach(({ field, label }) => {
          if (item[field] && !variantDetails.some(v => v.includes(label))) {
            variantDetails.push(`${label}: ${item[field]}`);
          }
        });
        
        if (!variantDetails.length && item.title) {
          const titleMatch = item.title.match(/\(([^)]+)\)/);
          if (titleMatch) {
            variantDetails.push(titleMatch[1]);
          }
        }
        
        if (!variantDetails.length && urlVariant) {
          variantDetails.push(urlVariant);
        }
        
        variant = variantDetails.length > 0 ? variantDetails.join(', ') : null;
        
        let mainImage = null;
        let thumbnail = null;
        
        if (item.images && Array.isArray(item.images) && item.images.length > 0) {
          mainImage = item.images.find(img => img.includes('main') || img.includes('primary')) || item.images[0];
          
          thumbnail = item.images.find(img => 
            img.includes('thumb') || 
            img.includes('small') || 
            img.includes('100x100') ||
            img.includes('150x150')
          );
          
          if (!thumbnail && mainImage) {
            if (mainImage.includes('wayfair.com')) {
              thumbnail = mainImage
                .replace(/w=\d+/, 'w=100')
                .replace(/h=\d+/, 'h=100')
                .replace(/resize=\d+/, 'resize=100');
            } else if (mainImage.includes('wfcdn.com')) {
              thumbnail = mainImage.replace(/\/\d+x\d+\//, '/100x100/');
            } else {
              thumbnail = mainImage;
            }
          }
        } else {
          mainImage = item.image || item.mainImage || item.primaryImage || null;
          thumbnail = item.thumbnail || item.smallImage || mainImage;
        }
        
        const sku = item.sku || item.productId || item.itemNumber || null;
        
        console.log('   💰 Price:', price || 'Not found');
        console.log('   🎨 Variant:', variant || 'None detected');
        console.log('   🖼️ Images: Main:', !!mainImage, 'Thumb:', !!thumbnail);
        console.log('   📋 SKU:', sku || 'Not found');
        
        return {
          price: price,
          title: item.title || item.name || 'Wayfair Product',
          image: mainImage,
          thumbnail: thumbnail || mainImage,
          variant: variant,
          sku: sku,
          brand: item.brand || item.manufacturer || null
        };
      }
      
    } catch (apifyError) {
      console.log('   ⚠️ Wayfair Apify scraping failed:', apifyError.message);
    }
  }
  
  // GENERAL APIFY WEB SCRAPER FOR ALL OTHER RETAILERS
  if (ENABLE_APIFY && apifyClient && retailer !== 'Amazon' && retailer !== 'Wayfair') {
    try {
      console.log('   🔄 Using Apify Web Scraper for', retailer, '...');
      
      const run = await apifyClient.actor('apify/web-scraper').call({
        startUrls: [{ url: url }],
        pseudoUrls: [],
        linkSelector: '',
        keepUrlFragments: false,
        pageFunction: `
          async function pageFunction(context) {
            const { $, request } = context;
            
            // Price selectors
            const priceSelectors = [
              '.price-current',
              '.price-now',
              '.current-price',
              '.sale-price',
              '.product-price',
              '[data-testid="product-price"]',
              '.price',
              '[itemprop="price"]',
              'span.wux-price-display',
              '.pdp-price',
              '[data-price]',
              '.product-price-value',
              '.price-box .price',
              '.product-info .price',
              '.price-display',
              '.pricing-price__regular-price',
              '.priceView-customer-price span',
              '.price-format__main-price',
              '.styles__CurrentPrice',
              '.SFPrice'
            ];
            
            // Title selectors
            const titleSelectors = [
              'h1', 
              '[data-testid="product-title"]',
              '.product-title',
              '#productTitle',
              '[itemprop="name"]',
              '.product-name',
              '.product-info h1',
              '.pdp-title',
              '.sku-title h1',
              '.product-details__title',
              'h1.pl-Heading',
              'h1[data-test="product-title"]',
              'h1.Heading__StyledHeading',
              'h1.product-details__title'
            ];
            
            // Image selectors
            const imageSelectors = [
              '.primary-image img',
              '.product-image img',
              'img.mainImage',
              '[data-testid="product-image"] img',
              '.product-photo img',
              '#landingImage',
              '[itemprop="image"]',
              '.gallery-image img',
              'picture img',
              '.mediagallery__mainimage img',
              '.ProductDetailImageThumbnail img',
              '.ImageComponent img',
              'img.hover-zoom-hero-image',
              '.prod-hero-image img',
              '[data-test="product-image"] img',
              '.styles__ImageWrapper img'
            ];
            
            // Extract functions
            function extractText(selectors) {
              for (const selector of selectors) {
                const element = $(selector).first();
                if (element.length) {
                  const text = element.text().trim();
                  if (text && text.length > 0) {
                    return text;
                  }
                }
              }
              return null;
            }
            
            function extractImage(selectors) {
              for (const selector of selectors) {
                const element = $(selector).first();
                if (element.length) {
                  const src = element.attr('src') || element.attr('data-src') || element.attr('data-lazy');
                  if (src && !src.includes('placeholder') && !src.includes('loading')) {
                    return src;
                  }
                }
              }
              return null;
            }
            
            // Extract variant info
            function extractVariant() {
              const variantTexts = [];
              
              // Look for selected options
              $('[data-selected="true"], .selected-option, .variant-selected, .option-selected').each((i, el) => {
                const text = $(el).text().trim();
                if (text) variantTexts.push(text);
              });
              
              // Look for color/size selections
              $('.color-selected, .size-selected, [data-color], [data-size]').each((i, el) => {
                const $el = $(el);
                const color = $el.attr('data-color') || $el.attr('title');
                const size = $el.attr('data-size');
                if (color) variantTexts.push('Color: ' + color);
                if (size) variantTexts.push('Size: ' + size);
              });
              
              return variantTexts.join(', ') || null;
            }
            
            // Extract dimensions
            function extractDimensions() {
              const text = $('body').text();
              const patterns = [
                /(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*(?:inches|in|")/gi,
                /L:\s*(\d+\.?\d*).*W:\s*(\d+\.?\d*).*H:\s*(\d+\.?\d*)/gi,
                /Length:\s*(\d+\.?\d*).*Width:\s*(\d+\.?\d*).*Height:\s*(\d+\.?\d*)/gi,
                /(\d+\.?\d*)"?\s*[WL]\s*[x×]\s*(\d+\.?\d*)"?\s*[DW]\s*[x×]\s*(\d+\.?\d*)"?\s*[HT]/gi
              ];
              
              for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match && match[0]) {
                  return match[0];
                }
              }
              return null;
            }
            
            // Extract price more aggressively
            function extractPrice() {
              const priceText = extractText(priceSelectors);
              if (!priceText) return null;
              
              // Try multiple price patterns
              const patterns = [
                /\$\s*([\d,]+\.?\d*)/,
                /([\d,]+\.?\d*)\s*\$/,
                /USD\s*([\d,]+\.?\d*)/i,
                /([\d,]+\.?\d*)/
              ];
              
              for (const pattern of patterns) {
                const match = priceText.match(pattern);
                if (match) {
                  const price = parseFloat(match[1].replace(/,/g, ''));
                  if (price > 0 && price < 100000) {
                    return price;
                  }
                }
              }
              return null;
            }
            
            return {
              url: request.url,
              title: extractText(titleSelectors),
              price: extractPrice(),
              image: extractImage(imageSelectors),
              variant: extractVariant(),
              dimensions: extractDimensions(),
              description: $('.product-description, .product-details, .product-info').text().slice(0, 500),
              brand: $('.product-brand, .brand-name, [data-brand]').first().text().trim() || null
            };
          }
        `,
        proxyConfiguration: {
          useApifyProxy: true
        },
        maxRequestsPerCrawl: 10,
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: 60
      });

      console.log('   ⏳ Waiting for Web Scraper...');
      await apifyClient.run(run.id).waitForFinish({ waitSecs: 60 });
      const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('   ✅ Web Scraper success!');
        
        // Parse price
        let price = null;
        if (typeof item.price === 'number') {
          price = item.price;
        } else if (item.price) {
          price = parseFloat(item.price.toString().replace(/[^\d.]/g, ''));
        }
        
        console.log('   💰 Price:', price || 'Not found');
        console.log('   🎨 Variant:', item.variant || 'Not specified');
        
        return {
          price: price,
          title: item.title || 'Product',
          image: item.image,
          thumbnail: item.image,
          variant: item.variant,
          sku: null,
          brand: item.brand
        };
      }
      
    } catch (apifyError) {
      console.log('   ⚠️ Apify Web Scraper failed:', apifyError.message);
      
      // Try Pro Web Content Crawler as secondary fallback
      try {
        console.log('   🔄 Trying Pro Web Content Crawler...');
        
        const run = await apifyClient.actor('assertive_analogy/pro-web-content-crawler').call({
          startUrls: [{ url: url }],
          maxCrawlDepth: 0,
          maxCrawlPages: 1,
          maxRequestRetries: 3,
          proxyConfiguration: {
            useApifyProxy: true
          }
        });
        
        await apifyClient.run(run.id).waitForFinish({ waitSecs: 60 });
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        
        if (items && items.length > 0) {
          const item = items[0];
          console.log('   ✅ Pro Web Content Crawler success!');
          
          // Extract price from text content
          let price = null;
          if (item.text) {
            const pricePatterns = [
              /\$\s*([\d,]+\.?\d*)/,
              /Price:\s*\$?\s*([\d,]+\.?\d*)/i,
              /Cost:\s*\$?\s*([\d,]+\.?\d*)/i,
              /([\d,]+\.?\d*)\s*USD/i
            ];
            
            for (const pattern of pricePatterns) {
              const match = item.text.match(pattern);
              if (match) {
                price = parseFloat(match[1].replace(',', ''));
                if (price > 0 && price < 100000) break;
                price = null;
              }
            }
          }
          
          // Extract title from text if not available
          let title = item.title;
          if (!title && item.text) {
            const titleMatch = item.text.match(/^([^\n]{10,100})/);
            if (priceMatch) {
              title = titleMatch[1].trim();
            }
          }
          
          return {
            price: price,
            title: title || 'Product',
            image: item.images?.[0] || null,
            thumbnail: item.images?.[0] || null,
            variant: null,
            sku: null,
            brand: null
          };
        }
      } catch (error) {
        console.log('   ⚠️ Pro Web Content Crawler also failed:', error.message);
      }
    }
  }
  
  // SCRAPINGBEE AS LAST RESORT FALLBACK
  if (SCRAPINGBEE_API_KEY) {
    try {
      console.log('   🐝 All Apify scrapers failed, falling back to ScrapingBee...');
      
      let scrapingParams = {
        api_key: SCRAPINGBEE_API_KEY,
        url: url,
        premium_proxy: 'true',
        country_code: 'us',
        render_js: 'true',
        wait: '5000',
        timeout: 45000,
        block_ads: 'true',
        block_resources: 'false'
      };
      
      // Simplified AI extraction for fallback
      scrapingParams.ai_extract_rules = JSON.stringify({
        price: "Product Price, Sale Price, Current Price, or Regular Price in USD dollars",
        title: "Product Title or Name",
        image: "Main Product Image URL or Primary Image",
        variant: "Selected options like color, size, style, or configuration",
        sku: "SKU or Product ID",
        brand: "Brand Name or Manufacturer",
        availability: "Stock status or availability"
      });
      
      const response = await axios({
        method: 'GET',
        url: 'https://app.scrapingbee.com/api/v1',
        params: scrapingParams,
        timeout: 50000
      });
      
      const data = response.data;
      
      let price = null;
      if (data.price) {
        const pricePatterns = [
          /\$\s*([\d,]+\.?\d*)/,
          /([\d,]+\.?\d*)\s*\$/,
          /USD\s*([\d,]+\.?\d*)/i,
          /([\d,]+\.?\d*)/
        ];
        
        for (const pattern of pricePatterns) {
          const match = data.price.toString().match(pattern);
          if (match) {
            const testPrice = parseFloat(match[1].replace(/,/g, ''));
            if (testPrice > 0 && testPrice < 100000) {
              price = testPrice;
              break;
            }
          }
        }
      }
      
      console.log(`   💰 ScrapingBee Price: ${price || 'Not found'}`);
      console.log(`   📝 ScrapingBee Title: ${data.title || 'Not found'}`);
      
      return {
        price: price,
        title: data.title || 'Product',
        image: data.image || null,
        thumbnail: data.image || null,
        variant: data.variant || null,
        sku: data.sku || null,
        brand: data.brand || null
      };
      
    } catch (error) {
      console.log('   ❌ ScrapingBee also failed:', error.response?.status || error.message);
      if (error.response?.status === 422) {
        console.log('   ⚠️ ScrapingBee: Invalid URL or blocked content');
      } else if (error.response?.status === 429) {
        console.log('   ⚠️ ScrapingBee: Rate limit exceeded');
      }
    }
  }
  
  // If all scrapers failed, return minimal data
  console.log('   ❌ All scraping methods failed');
  return {
    price: null,
    title: 'Product from ' + retailer,
    image: null,
    thumbnail: null,
    variant: null,
    sku: null
  };
}

// Process individual product
async function processProduct(url, index, urls) {
  console.log(`[${index + 1}/${urls.length}] Processing: ${url.substring(0, 80)}...`);
  
  const retailer = detectRetailer(url);
  console.log(`   Retailer: ${retailer}`);
  
  const learned = getLearnedData(url);
  if (learned && learned.price) {
    console.log('   📚 Using cached data from previous scrape');
    return { ...learned, fromCache: true };
  }
  
  // Add delay between requests to avoid rate limiting
  if (index > 0) {
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  const scraped = await scrapeWithScrapingBee(url);
  const productName = scraped.title || `${retailer} Product ${index + 1}`;
  const category = categorizeProduct(productName, url);
  
  let dimensions = scraped.dimensions || estimateDimensionsFromBOL(category, productName, retailer);
  let weight = scraped.weight || estimateWeightFromBOL(dimensions, category);
  let packaging = 'ASSEMBLED';
  
  const isFlatPack = isFlatPackable(category, productName, retailer);
  if (isFlatPack) {
    console.log(`   📦 FLAT-PACK DETECTED`);
    dimensions = calculateFlatPackDimensions(dimensions, productName);
    weight = adjustFlatPackWeight(weight, category);
    packaging = 'FLAT-PACK';
  }
  
  const baseShippingCost = calculateShippingCost(dimensions, weight, scraped.price || 100);
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Calculate total order value BEFORE margin
  const productPrice = scraped.price || 100;
  const dutyAmount = productPrice * BERMUDA_DUTY_RATE;
  const subtotal = productPrice + dutyAmount + baseShippingCost;
  
  // Apply margin to the TOTAL order value
  const marginRate = calculateSDLMargin(cubicFeet, subtotal);
  const marginAmount = Math.round(subtotal * marginRate);
  
  // Note: shipping cost displayed is just the base shipping without margin
  // The margin is applied to the entire order at checkout
  
  const product = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    url: url,
    name: productName,
    variant: scraped.variant || null,
    thumbnail: scraped.thumbnail || scraped.image,
    sku: scraped.sku || null,
    price: scraped.price,
    image: scraped.image || 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=No+Image',
    category: category,
    retailer: retailer,
    dimensions: dimensions,
    weight: weight,
    isFlatPack: isFlatPack,
    packaging: packaging,
    baseShippingCost: Math.round(baseShippingCost),
    marginRate: marginRate,
    marginAmount: marginAmount,
    shippingCost: Math.round(baseShippingCost), // Display just base shipping
    totalMarginOnOrder: marginAmount, // This is the margin on the entire order
    dataCompleteness: {
      hasName: !!scraped.title,
      hasPrice: !!scraped.price,
      hasImage: !!scraped.image,
      hasDimensions: !!scraped.dimensions,
      hasWeight: !!scraped.weight,
      hasVariant: !!scraped.variant,
      hasThumbnail: !!scraped.thumbnail && scraped.thumbnail !== scraped.image,
      hasSku: !!scraped.sku
    },
    fromCache: false
  };
  
  console.log(`   Price: ${scraped.price ? '$' + scraped.price : 'Not found'}`);
  console.log(`   Variant: ${scraped.variant || 'Not specified'}`);
  console.log(`   SKU: ${scraped.sku || 'Not found'}`);
  console.log(`   Thumbnail: ${scraped.thumbnail && scraped.thumbnail !== scraped.image ? 'Separate' : 'Same as main'}`);
  console.log(`   Packaging: ${packaging}`);
  console.log(`   Volume: ${cubicFeet.toFixed(1)} ft³`);
  console.log(`   Weight: ${weight} lbs`);
  console.log(`   Base Shipping: $${baseShippingCost}`);
  console.log(`   Order Subtotal: $${subtotal.toFixed(2)}`);
  console.log(`   Margin: ${(marginRate * 100).toFixed(0)}% of total order ($${marginAmount})`);
  console.log(`   Success: ${scraped.price ? 'YES' : 'NO'} - ${scraped.title ? 'Title found' : 'No title'}`);
  
  learnFromProduct(url, product);
  return product;
}

// Scrape products endpoint
app.post('/api/scrape', scrapeRateLimiter, async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'No URLs provided' });
    }
    
    const sdlUrls = urls.filter(url => isSDLDomain(url));
    if (sdlUrls.length > 0) {
      return res.status(400).json({ 
        error: 'SDL domain detected. This calculator is for importing products from other retailers.' 
      });
    }
    
    console.log(`\n========================================`);
    console.log(`SCRAPING ${urls.length} PRODUCTS`);
    console.log(`Apify Status: ${ENABLE_APIFY && apifyClient ? 'ENABLED' : 'DISABLED'}`);
    console.log(`ScrapingBee Status: ${SCRAPINGBEE_API_KEY ? 'ENABLED' : 'DISABLED'}`);
    console.log(`========================================\n`);
    
    const products = [];
    
    for (let i = 0; i < urls.length; i++) {
      try {
        const product = await processProduct(urls[i], i, urls);
        products.push(product);
      } catch (error) {
        console.error(`   ❌ Failed to process: ${error.message}`);
        console.error(`   Stack trace:`, error.stack);
        
        const retailer = detectRetailer(urls[i]);
        products.push({
          id: Date.now() + Math.random().toString(36).substr(2, 9),
          url: urls[i],
          name: 'Product from ' + retailer + ' - Please check retailer website',
          variant: null,
          thumbnail: 'https://placehold.co/100x100/7CB342/FFFFFF/png?text=Not+Found',
          sku: null,
          price: null,
          image: 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=Not+Found',
          category: 'general',
          retailer: retailer,
          dimensions: estimateDimensionsFromBOL('general', '', retailer),
          weight: 50,
          shippingCost: 60,
          dataCompleteness: {
            hasName: false,
            hasPrice: false,
            hasImage: false,
            hasDimensions: false,
            hasWeight: false,
            hasVariant: false,
            hasThumbnail: false,
            hasSku: false
          },
          error: true,
          fromCache: false
        });
      }
    }
    
    const successful = products.filter(p => p.price).length;
    const fromCache = products.filter(p => p.fromCache).length;
    const flatPacked = products.filter(p => p.isFlatPack).length;
    const withVariants = products.filter(p => p.variant).length;
    const withThumbnails = products.filter(p => p.thumbnail && p.thumbnail !== p.image).length;
    const withImages = products.filter(p => p.image && !p.image.includes('placehold')).length;
    const withTitles = products.filter(p => p.name && !p.name.includes('Product from')).length;
    
    const marginDistribution = {};
    products.forEach(p => {
      const rate = Math.round((p.marginRate || 0.20) * 100);
      marginDistribution[rate] = (marginDistribution[rate] || 0) + 1;
    });
    
    console.log(`\n========================================`);
    console.log(`RESULTS: ${products.length} products processed`);
    console.log(`   With prices: ${successful}`);
    console.log(`   With titles: ${withTitles}`);
    console.log(`   With images: ${withImages}`);
    console.log(`   From cache: ${fromCache}`);
    console.log(`   Failed: ${products.length - successful}`);
    console.log(`   Flat-packed: ${flatPacked}`);
    console.log(`   With variants: ${withVariants}`);
    console.log(`   With thumbnails: ${withThumbnails}`);
    console.log(`   Margin distribution:`, marginDistribution);
    console.log(`   Success rate: ${((successful / products.length) * 100).toFixed(1)}%`);
    console.log(`========================================\n`);
    
    res.json({ 
      products,
      summary: {
        total: products.length,
        successful: successful,
        withTitles: withTitles,
        withImages: withImages,
        fromCache: fromCache,
        failed: products.length - successful,
        flatPacked: flatPacked,
        withVariants: withVariants,
        withThumbnails: withThumbnails,
        marginDistribution: marginDistribution,
        successRate: ((successful / products.length) * 100).toFixed(1) + '%'
      }
    });
    
  } catch (error) {
    console.error('❌ Scraping endpoint error:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Failed to scrape products',
      message: error.message 
    });
  }
});

// Admin orders endpoint
app.get('/api/admin/orders', async (req, res) => {
  const { password } = req.query;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json({
    orders: ORDERS_DB.orders,
    draft_orders: ORDERS_DB.draft_orders,
    stats: ORDERS_DB.stats
  });
});

// Prepare Shopify checkout endpoint
app.post('/api/prepare-shopify-checkout', async (req, res) => {
  try {
    const checkoutId = generateOrderId();
    
    // Store the order data temporarily
    ORDERS_DB.draft_orders.push({
      id: checkoutId,
      data: req.body,
      created_at: new Date().toISOString(),
      status: 'pending'
    });
    saveOrdersDB();
    
    // Return checkout URL for redirect
    const redirectUrl = `https://${SHOPIFY_DOMAIN}/pages/import-checkout?checkout=${checkoutId}`;
    
    res.json({
      checkoutId: checkoutId,
      redirectUrl: redirectUrl
    });
    
  } catch (error) {
    console.error('Error preparing checkout:', error);
    res.status(500).json({ error: 'Failed to prepare checkout' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📊 Admin Orders: http://localhost:${PORT}/api/admin/orders?password=${ADMIN_PASSWORD}\n`);
});
