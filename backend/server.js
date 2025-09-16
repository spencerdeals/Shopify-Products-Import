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
const SDL_MARGIN_RATE = 0.15; // Fixed 15%
const CARD_FEE_RATE = 0.035; // 3.5% credit card fee (hidden in shipping)
const TEST_MODE = process.env.TEST_MODE === 'true';
const DOCUMENTATION_FEE_PER_VENDOR = 10;

// Email configuration
const EMAIL_FROM = process.env.EMAIL_FROM || 'orders@sdl.bm';
const EMAIL_TO_ADMIN = process.env.EMAIL_TO_ADMIN || 'admin@sdl.bm';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';

// Load optional APIs
let sendgrid = null;

// Apify configuration
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const ENABLE_APIFY = true;

// UPCitemdb configuration
const UPCItemDB = require('./upcitemdb');
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY || '';
const upcItemDB = new UPCItemDB(UPCITEMDB_API_KEY);
const USE_UPCITEMDB = !!UPCITEMDB_API_KEY;

// Initialize Apify
let apifyClient = null;
try {
  if (ENABLE_APIFY && APIFY_API_KEY) {
    const { ApifyClient } = require('apify-client');
    apifyClient = new ApifyClient({ token: APIFY_API_KEY });
    console.log('✅ Apify initialized for enhanced scraping');
  }
} catch (error) {
  console.log('⚠️ Apify client not available:', error.message);
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

// Simple learning database (JSON file fallback)
const LEARNING_DB_PATH = path.join(__dirname, 'learning_data.json');
let LEARNING_DB = {
  products: {},
  patterns: {},
  retailer_stats: {}
};

try {
  if (fs.existsSync(LEARNING_DB_PATH)) {
    LEARNING_DB = JSON.parse(fs.readFileSync(LEARNING_DB_PATH, 'utf8'));
    console.log('✅ Loaded learning database with', Object.keys(LEARNING_DB.products).length, 'products');
  }
} catch (error) {
  console.log('📝 Starting with fresh learning database');
}

function saveLearningDB() {
  try {
    fs.writeFileSync(LEARNING_DB_PATH, JSON.stringify(LEARNING_DB, null, 2));
  } catch (error) {
    console.error('Error saving learning database:', error);
  }
}

console.log('=== SDL IMPORT CALCULATOR SERVER ===');
console.log(`Environment: ${TEST_MODE ? 'TEST' : 'PRODUCTION'}`);
console.log(`Port: ${PORT}`);
console.log(`Shopify: ${SHOPIFY_ACCESS_TOKEN ? 'CONNECTED' : 'NOT CONFIGURED'}`);
console.log(`Email: ${sendgrid ? 'ENABLED' : 'DISABLED'}`);
console.log(`UPCitemdb: ${USE_UPCITEMDB ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`Apify: ${ENABLE_APIFY && apifyClient ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`ScrapingBee: ${SCRAPINGBEE_API_KEY ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log('Margin: FIXED 15% + 3.5% card fee (hidden)');
console.log('====================================\n');

// Middleware
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', true);

// Security headers for iframe embedding
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
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

// Debug: Check what files exist
console.log('Current directory:', __dirname);
console.log('Looking for frontend at:', path.join(__dirname, '../frontend'));
try {
  const frontendPath = path.join(__dirname, '../frontend');
  if (fs.existsSync(frontendPath)) {
    const files = fs.readdirSync(frontendPath);
    console.log('Frontend files found:', files);
  } else {
    console.log('❌ Frontend directory not found at expected location');
  }
} catch (err) {
  console.error('Error checking frontend directory:', err);
}

// CRITICAL: ROOT ROUTE MUST BE FIRST - BEFORE ANY STATIC MIDDLEWARE
app.get('/', (req, res) => {
  console.log('Root route handler triggered');
  const indexPath = path.join(__dirname, '../frontend/index.html');
  
  console.log('Attempting to serve:', indexPath);
  console.log('File exists?', fs.existsSync(indexPath));
  
  if (fs.existsSync(indexPath)) {
    res.type('html');
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend index.html not found at: ' + indexPath);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: TEST_MODE ? 'test' : 'production',
    marginStructure: 'fixed-15%',
    cardFee: '3.5% (hidden)',
    services: {
      shopify: !!SHOPIFY_ACCESS_TOKEN,
      upcitemdb: USE_UPCITEMDB,
      apify: !!apifyClient,
      scrapingBee: !!SCRAPINGBEE_API_KEY
    }
  });
});

// NOW serve static files for CSS, JS, images
app.use(express.static(path.join(__dirname, '../frontend')));

// Rate limiters
const scrapeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many scraping requests',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'default'
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
    if (domain.includes('overstock.com')) return 'Overstock';
    if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
    if (domain.includes('potterybarn.com')) return 'Pottery Barn';
    if (domain.includes('westelm.com')) return 'West Elm';
    if (domain.includes('cb2.com')) return 'CB2';
    if (domain.includes('article.com')) return 'Article';
    if (domain.includes('ashleyfurniture.com')) return 'Ashley Furniture';
    
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

// INTELLIGENT PRODUCT ANALYSIS SYSTEM
function analyzeProductIntelligently(name, category, retailer) {
  const analysis = {
    productType: null,
    estimatedDimensions: null,
    estimatedWeight: null,
    confidence: 0,
    isFlatPackLikely: false,
    reasoning: []
  };
  
  const nameLower = name.toLowerCase();
  
  // EXTRACT DIMENSIONS FROM NAME (many products have dimensions in title)
  const dimPattern = /(\d+(?:\.\d+)?)\s*(?:"|''|inches?|in)?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:"|''|inches?|in)?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:"|''|inches?|in)?/;
  const dimMatch = name.match(dimPattern);
  
  if (dimMatch) {
    analysis.estimatedDimensions = {
      length: parseFloat(dimMatch[1]),
      width: parseFloat(dimMatch[2]),
      height: parseFloat(dimMatch[3])
    };
    analysis.confidence = 0.9;
    analysis.reasoning.push('Dimensions found in product name');
  }
  
  // SPECIFIC PRODUCT TYPE DETECTION
  if (nameLower.includes('bar stool') || nameLower.includes('counter stool')) {
    analysis.productType = 'bar-stool';
    if (!analysis.estimatedDimensions) {
      analysis.estimatedDimensions = { length: 18, width: 18, height: 30 };
      analysis.estimatedWeight = 25;
    }
  } else if (nameLower.includes('5 piece') && (nameLower.includes('patio') || nameLower.includes('rattan'))) {
    analysis.productType = 'patio-set-5pc';
    analysis.isFlatPackLikely = true;
    if (!analysis.estimatedDimensions) {
      // Flat-packed patio set
      analysis.estimatedDimensions = { length: 48, width: 36, height: 12 };
      analysis.estimatedWeight = 120;
    }
  } else if (nameLower.includes('sofa') && nameLower.includes('seating group')) {
    analysis.productType = 'outdoor-sofa-set';
    analysis.isFlatPackLikely = true;
    if (!analysis.estimatedDimensions) {
      analysis.estimatedDimensions = { length: 50, width: 40, height: 14 };
      analysis.estimatedWeight = 140;
    }
  } else if (nameLower.includes('chair') && !nameLower.includes('stool')) {
    analysis.productType = 'chair';
    if (!analysis.estimatedDimensions) {
      analysis.estimatedDimensions = { length: 28, width: 28, height: 35 };
      analysis.estimatedWeight = 35;
    }
  } else if (nameLower.includes('table')) {
    analysis.productType = 'table';
    if (!analysis.estimatedDimensions) {
      analysis.estimatedDimensions = { length: 48, width: 30, height: 30 };
      analysis.estimatedWeight = 60;
    }
  }
  
  // NUMBER OF PIECES DETECTION (affects dimensions)
  const piecesMatch = nameLower.match(/(\d+)\s*(?:-)?piece/);
  if (piecesMatch) {
    const pieces = parseInt(piecesMatch[1]);
    if (pieces >= 4 && category.includes('outdoor')) {
      analysis.isFlatPackLikely = true;
      analysis.reasoning.push(`${pieces}-piece set likely ships flat-packed`);
    }
  }
  
  // RETAILER-SPECIFIC LOGIC
  if (retailer === 'Wayfair' && category.includes('furniture')) {
    analysis.isFlatPackLikely = true;
    analysis.reasoning.push('Wayfair furniture typically ships flat-packed');
  }
  
  return analysis;
}

function categorizeProduct(name, url) {
  const text = (name + ' ' + url).toLowerCase();
  
  // More specific categorization
  if (/\b(sofa|couch|sectional|loveseat|seating group|living room)\b/.test(text)) {
    if (/\b(patio|outdoor|rattan|wicker|garden)\b/.test(text)) return 'furniture-outdoor';
    return 'furniture-sofa';
  }
  if (/\b(chair|stool|barstool|counter height|swivel|dining chair|office chair)\b/.test(text)) return 'furniture-chair';
  if (/\b(table|desk|console|buffet|sideboard)\b/.test(text)) return 'furniture-table';
  if (/\b(dresser|wardrobe|cabinet|shelf|bookcase|storage)\b/.test(text)) return 'furniture-storage';
  if (/\b(bed|mattress|headboard|frame)\b/.test(text)) return 'furniture-bed';
  if (/\b(patio|outdoor|rattan|wicker|garden)\b/.test(text)) return 'furniture-outdoor';
  if (/\b(tv|television|monitor|laptop|computer|tablet|phone|camera|speaker|headphone|electronic)\b/.test(text)) return 'electronics';
  if (/\b(refrigerator|fridge|washer|dryer|dishwasher|microwave|oven|stove|appliance)\b/.test(text)) return 'appliances';
  if (/\b(toy|game|puzzle|doll|lego|playset|bounce|slide|tikes)\b/.test(text)) return 'toys';
  if (/\b(shirt|pants|dress|jacket|shoes|clothing|apparel|wear)\b/.test(text)) return 'clothing';
  return 'general';
}

// FLAT-PACK INTELLIGENCE SYSTEM
function isFlatPackable(category, productName, retailer) {
  const name = productName.toLowerCase();
  
  // Items that are NEVER flat-packed
  const nonFlatPackable = [
    'refrigerator', 'fridge', 'washer', 'dryer', 'dishwasher', 
    'oven', 'stove', 'range', 'microwave',
    'mattress', 'box spring',
    'tv', 'television', 'monitor', 'computer',
    'upholstered sofa', 'upholstered couch', 'recliner', 'sectional'
  ];
  
  if (nonFlatPackable.some(item => name.includes(item))) {
    return false;
  }
  
  // OUTDOOR/PATIO FURNITURE - Usually flat-packed
  if (category === 'furniture-outdoor' || name.includes('patio') || name.includes('outdoor')) {
    // Rattan, wicker, and aluminum outdoor furniture is almost always flat-packed
    if (name.includes('rattan') || name.includes('wicker') || name.includes('aluminum')) {
      return true;
    }
    // Multi-piece sets are flat-packed
    if (name.match(/\d+\s*(?:pc|piece)/)) {
      return true;
    }
    // Outdoor tables and chairs usually flat-pack
    if (name.includes('table') || name.includes('chair') || name.includes('set')) {
      return true;
    }
  }
  
  // Retailers known for flat-pack
  const flatPackRetailers = [
    'Wayfair', 'IKEA', 'Amazon', 'Target', 'Walmart', 
    'Overstock', 'Home Depot', 'Lowes', 'CB2', 
    'West Elm', 'Article', 'Ashley Furniture'
  ];
  
  // Specific items that are usually flat-packed
  const flatPackableItems = [
    'table', 'desk', 'console', 'buffet', 'sideboard',
    'bookshelf', 'shelf', 'shelving', 'cabinet', 'dresser',
    'nightstand', 'end table', 'coffee table', 'dining',
    'bar stool', 'counter stool', 'bench', 'bed frame', 'headboard',
    'wardrobe', 'armoire', 'vanity', 'cart', 'stand',
    'entertainment center', 'tv stand', 'media console',
    'gazebo', 'pergola', 'shed',
    'filing', 'office', 'workstation',
    'storage', 'organizer', 'rack', 'tower'
  ];
  
  if (category.startsWith('furniture')) {
    if (flatPackRetailers.includes(retailer)) {
      if (flatPackableItems.some(item => name.includes(item))) {
        return true;
      }
    }
  }
  
  return false;
}

function calculateFlatPackDimensions(originalDimensions, productName) {
  const name = productName.toLowerCase();
  
  let reductionProfile = {
    length: originalDimensions.length,
    width: originalDimensions.width,
    height: originalDimensions.height * 0.15
  };
  
  // PATIO/OUTDOOR SETS - Much smaller when flat-packed
  if (name.includes('patio') || name.includes('outdoor') || name.includes('rattan')) {
    if (name.includes('5 piece') || name.includes('5-piece')) {
      // 5-piece patio set in boxes
      reductionProfile = {
        length: Math.min(originalDimensions.length * 0.6, 48),
        width: Math.min(originalDimensions.width * 0.6, 36),
        height: Math.max(10, originalDimensions.height * 0.25)
      };
    } else {
      reductionProfile = {
        length: originalDimensions.length * 0.7,
        width: originalDimensions.width * 0.7,
        height: Math.max(8, originalDimensions.height * 0.2)
      };
    }
  } else if (name.includes('bar stool') || name.includes('counter stool')) {
    // Stools pack very small
    reductionProfile = {
      length: originalDimensions.length * 0.9,
      width: originalDimensions.width * 0.9,
      height: Math.max(6, originalDimensions.height * 0.3)
    };
  } else if (name.includes('table')) {
    // Tables pack flat
    reductionProfile = {
      length: Math.min(originalDimensions.length, 60),
      width: originalDimensions.width,
      height: Math.max(5, originalDimensions.height * 0.1)
    };
  } else if (name.includes('chair')) {
    reductionProfile = {
      length: originalDimensions.length * 0.8,
      width: originalDimensions.width * 0.8,
      height: Math.max(8, originalDimensions.height * 0.25)
    };
  }
  
  const flatPackDims = {
    length: Math.round(reductionProfile.length),
    width: Math.round(reductionProfile.width),
    height: Math.round(reductionProfile.height)
  };
  
  console.log(`   📦 Flat-pack: ${originalDimensions.length}×${originalDimensions.width}×${originalDimensions.height}" → ${flatPackDims.length}×${flatPackDims.width}×${flatPackDims.height}"`);
  
  return flatPackDims;
}

function adjustFlatPackWeight(originalWeight, category) {
  // Flat-pack items typically weigh 10-15% less due to hardware separation
  if (category.startsWith('furniture')) {
    return Math.round(originalWeight * 0.85);
  }
  return originalWeight;
}

function estimateDimensionsFromPatterns(category, name, retailer) {
  const text = name.toLowerCase();
  
  // First, try intelligent analysis
  const analysis = analyzeProductIntelligently(name, category, retailer);
  if (analysis.estimatedDimensions && analysis.confidence > 0.5) {
    console.log(`   🤖 Smart dimensions: ${JSON.stringify(analysis.estimatedDimensions)} (${analysis.reasoning.join(', ')})`);
    return analysis.estimatedDimensions;
  }
  
  // Check learning database
  if (LEARNING_DB.patterns[category]) {
    const pattern = LEARNING_DB.patterns[category];
    if (pattern.dimensions && pattern.dimensions.length > 0) {
      const avgDims = pattern.dimensions[pattern.dimensions.length - 1];
      return avgDims;
    }
  }
  
  // Specific dimensions by category with more granular sizes
  const specificDimensions = {
    'furniture-outdoor': {
      'set': { length: 48, width: 36, height: 12 },  // Flat-packed
      'chair': { length: 28, width: 28, height: 35 },
      'table': { length: 48, width: 30, height: 6 },   // Flat-packed
      'default': { length: 40, width: 30, height: 15 }
    },
    'furniture-chair': {
      'stool': { length: 18, width: 18, height: 30 },
      'dining': { length: 24, width: 22, height: 36 },
      'office': { length: 28, width: 28, height: 40 },
      'default': { length: 28, width: 28, height: 35 }
    },
    'furniture-sofa': {
      'sectional': { length: 108, width: 36, height: 36 },
      'loveseat': { length: 60, width: 36, height: 36 },
      'default': { length: 84, width: 36, height: 36 }
    },
    'furniture-table': {
      'coffee': { length: 48, width: 24, height: 18 },
      'dining': { length: 60, width: 36, height: 30 },
      'desk': { length: 48, width: 24, height: 30 },
      'default': { length: 48, width: 30, height: 30 }
    }
  };
  
  // Get category-specific dimensions
  if (specificDimensions[category]) {
    const catDims = specificDimensions[category];
    
    // Try to match specific type
    for (const [type, dims] of Object.entries(catDims)) {
      if (type !== 'default' && text.includes(type)) {
        return dims;
      }
    }
    
    return catDims.default;
  }
  
  // Fallback to general estimates
  const generalEstimates = {
    'electronics': { length: 24, width: 18, height: 20 },
    'appliances': { length: 32, width: 32, height: 48 },
    'toys': { length: 20, width: 16, height: 14 },
    'clothing': { length: 14, width: 12, height: 4 },
    'general': { length: 24, width: 20, height: 18 }
  };
  
  const baseCat = category.split('-')[0];
  return generalEstimates[baseCat] || generalEstimates.general;
}

function estimateWeightFromPatterns(dimensions, category, name = '') {
  const text = name ? name.toLowerCase() : '';
  
  // Specific weight estimates
  if (text.includes('bar stool') || text.includes('counter stool')) return 25;
  if (text.includes('5 piece') && text.includes('patio')) return 120;
  if (text.includes('seating group')) return 140;
  if (text.includes('chair') && !text.includes('stool')) return 35;
  
  // Check learning database
  if (LEARNING_DB.patterns[category] && LEARNING_DB.patterns[category].weights) {
    const weights = LEARNING_DB.patterns[category].weights;
    if (weights.length > 0) {
      const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
      return Math.round(avgWeight);
    }
  }
  
  // Calculate based on volume and material density
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  const densities = {
    'furniture-outdoor': 2.5,  // Light (aluminum, wicker)
    'furniture-chair': 3,      // Medium light
    'furniture-sofa': 4,       // Medium
    'furniture-table': 5,       // Medium heavy
    'furniture-storage': 6,     // Heavy (wood)
    'electronics': 8,           // Dense
    'appliances': 10,           // Very dense
    'clothing': 1,              // Very light
    'toys': 2,                  // Light
    'general': 4                // Medium
  };
  
  const density = densities[category] || densities.general;
  const estimatedWeight = Math.max(10, cubicFeet * density);
  
  return Math.round(estimatedWeight);
}

// SHIPPING COST SANITY CHECK - REALISTIC FOR BERMUDA
function performShippingSanityCheck(shippingCost, productPrice, category, dimensions) {
  const issues = [];
  let adjustedCost = shippingCost;
  
  // Check 1: Shipping can exceed product price for Bermuda
  // Only flag if shipping is MORE than double the price AND over $400
  if (shippingCost > productPrice * 2 && shippingCost > 400) {
    issues.push('Shipping seems excessive for this category');
  }
  
  // Check 2: Absolute maximums by category (realistic for Bermuda ocean freight)
  const maxShippingByCategory = {
    'furniture-outdoor': 350,  // Patio sets
    'furniture-chair': 120,     // Single chairs
    'furniture-sofa': 400,      // Sofas
    'furniture-table': 250,     // Tables
    'furniture-storage': 300,   // Dressers
    'furniture-bed': 350,       // Beds
    'electronics': 150,         // TVs, etc
    'appliances': 450,          // Large appliances
    'toys': 80,                 // Toys
    'clothing': 40,             // Clothing
    'general': 200              // General items
  };
  
  const maxAllowed = maxShippingByCategory[category] || 200;
  if (adjustedCost > maxAllowed) {
    issues.push(`Exceeds category maximum of $${maxAllowed}`);
    adjustedCost = maxAllowed;
  }
  
  // Check 3: Minimum shipping for Bermuda
  if (adjustedCost < 35) {
    adjustedCost = 35;  // Minimum shipping cost for Bermuda
  }
  
  // Check 4: Volume-based maximum
  if (dimensions) {
    const cubicFeet = (dimensions.length * dimensions.width * dimensions.height) / 1728;
    const maxPerCubicFoot = 10;  // $10 per cubic foot for Bermuda
    const volumeBasedMax = Math.max(35, cubicFeet * maxPerCubicFoot);
    
    if (adjustedCost > volumeBasedMax && cubicFeet < 50) {
      // Only apply volume cap for items under 50 cubic feet
      issues.push(`Volume-based adjustment from ${cubicFeet.toFixed(1)} cu ft`);
      adjustedCost = Math.min(adjustedCost, volumeBasedMax);
    }
  }
  
  if (issues.length > 0) {
    console.log(`   ⚠️ Shipping sanity check: ${issues.join(', ')}`);
    console.log(`   ✅ Adjusted shipping: $${shippingCost} → $${Math.round(adjustedCost)}`);
  }
  
  return Math.round(adjustedCost);
}

// SIMPLIFIED SHIPPING CALCULATION WITH SANITY CHECKS
function calculateShippingCost(dimensions, weight, price, category) {
  if (!dimensions) {
    return Math.round(Math.max(35, price * 0.08));
  }
  
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Base ocean freight cost
  const baseCost = Math.max(15, cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT);
  
  // Heavy weight fee
  const heavyWeightFee = weight > 150 ? weight * 0.25 : 0;
  
  // Handling fee
  const handlingFee = 15;
  
  // Calculate base shipping
  const baseShipping = baseCost + heavyWeightFee + handlingFee;
  
  // Add SDL margin (15%)
  const marginAmount = baseShipping * SDL_MARGIN_RATE;
  
  // Calculate total order value for card fee
  const estimatedTotal = price + (price * BERMUDA_DUTY_RATE) + baseShipping + marginAmount;
  
  // Add hidden credit card fee (3.5% of estimated total)
  const cardFee = estimatedTotal * CARD_FEE_RATE;
  
  // Total shipping includes margin and hidden card fee
  const totalShipping = baseShipping + marginAmount + cardFee;
  
  // APPLY SANITY CHECK
  const finalShipping = performShippingSanityCheck(totalShipping, price, category, dimensions);
  
  return finalShipping;
}

// Learning functions
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
        dimensions: []
      };
    }
    
    const pattern = LEARNING_DB.patterns[productData.category];
    if (productData.price) pattern.prices.push(productData.price);
    if (productData.weight) pattern.weights.push(productData.weight);
    if (productData.dimensions) pattern.dimensions.push(productData.dimensions);
    
    // Keep only last 100 entries
    if (pattern.prices.length > 100) pattern.prices.shift();
    if (pattern.weights.length > 100) pattern.weights.shift();
    if (pattern.dimensions.length > 100) pattern.dimensions.shift();
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

// WAYFAIR-OPTIMIZED SCRAPING WITH VARIANT SUPPORT
async function scrapeWithApifyAndBee(url) {
  const retailer = detectRetailer(url);
  
  // WAYFAIR WITH APIFY (YOUR PURCHASED ACTOR)
  if (retailer === 'Wayfair' && apifyClient) {
    try {
      console.log('   🔄 Using Apify Wayfair actor...');
      
      const run = await apifyClient.actor('123webdata/wayfair-scraper').call({
        productUrls: [url],
        includeOptionDetails: true,
        includeAllImages: true,
        proxy: {
          useApifyProxy: true,
          apifyProxyCountry: 'US'
        },
        maxRequestRetries: 3
      });
      
      console.log('   ⏳ Waiting for Wayfair data...');
      await apifyClient.run(run.id).waitForFinish({ waitSecs: 60 });
      
      const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
      
      console.log('   📋 Items returned:', items?.length || 0);
      
      if (items && items.length > 0) {
        const item = items[0];
        
        // Extract price
        let price = null;
        let salePrice = null;
        let regularPrice = null;
        
        if (item.price) {
          if (typeof item.price === 'object') {
            salePrice = item.price.value || item.price.amount || parseFloat(item.price.toString());
          } else {
            salePrice = typeof item.price === 'string' ? 
              parseFloat(item.price.replace(/[^0-9.]/g, '')) : 
              item.price;
          }
        }
        
        if (item.regular_price) {
          regularPrice = typeof item.regular_price === 'string' ? 
            parseFloat(item.regular_price.replace(/[^0-9.]/g, '')) : 
            item.regular_price;
        }
        
        // Use regular price if available, otherwise sale price
        if (regularPrice && regularPrice > 0) {
          price = regularPrice;
          console.log(`   💰 Using regular price: ${regularPrice}`);
        } else if (salePrice && salePrice > 0) {
          price = salePrice;
          console.log(`   💰 Using sale price: ${salePrice}`);
        }
        
        // Extract variant information
        let variant = null;
        
        if (item.selectedOptions && typeof item.selectedOptions === 'object') {
          const options = [];
          for (const [key, value] of Object.entries(item.selectedOptions)) {
            if (value && value !== 'null' && value !== 'undefined') {
              const cleanKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              options.push(`${cleanKey}: ${value}`);
            }
          }
          if (options.length > 0) {
            variant = options.join(', ');
          }
        }
        
        // Extract image
        let image = item.mainImage || item.primaryImage || item.image;
        if (!image && item.images && Array.isArray(item.images) && item.images.length > 0) {
          image = item.images[0];
        }
        
        const title = item.title || item.name || item.productName || 'Wayfair Product';
        
        console.log('   ✅ Apify got:', title.substring(0, 50));
        console.log('   💰 Price:', price || 'Not found');
        console.log('   🎨 Variant:', variant || 'None');
        
        return {
          price: price,
          title: title,
          image: image,
          variant: variant,
          sku: item.sku || item.productId || item.itemNumber,
          success: true
        };
      }
    } catch (error) {
      console.log('   ⚠️ Apify failed:', error.message);
    }
  }
  
  // FALLBACK TO SCRAPINGBEE FOR ALL RETAILERS
  if (SCRAPINGBEE_API_KEY) {
    try {
      console.log('   🐝 Using ScrapingBee...');
      
      const response = await axios({
        method: 'GET',
        url: 'https://app.scrapingbee.com/api/v1',
        params: {
          api_key: SCRAPINGBEE_API_KEY,
          url: url,
          premium_proxy: 'true',
          country_code: 'us',
          render_js: 'true',
          wait: '3000',
          ai_extract_rules: JSON.stringify({
            price: "Product Price in USD",
            title: "Product Title or Name",
            variant: "Selected options, color, size",
            image: "Main Product Image URL",
            sku: "SKU or Product ID"
          })
        },
        timeout: 20000
      });
      
      const data = response.data;
      
      return {
        price: data.price ? parseFloat(data.price.toString().replace(/[^0-9.]/g, '')) : null,
        title: data.title || 'Product',
        image: data.image,
        variant: data.variant,
        sku: data.sku,
        success: !!data.title
      };
      
    } catch (error) {
      console.log('   ❌ ScrapingBee failed:', error.message);
    }
  }
  
  return {
    price: null,
    title: `Product from ${retailer}`,
    image: null,
    variant: null,
    sku: null,
    success: false
  };
}

// MAIN PRODUCT PROCESSING
async function processProduct(url, index, urls) {
  console.log(`[${index + 1}/${urls.length}] Processing: ${url.substring(0, 80)}...`);
  
  const retailer = detectRetailer(url);
  console.log(`   Retailer: ${retailer}`);
  
  // Check learned data
  const learned = getLearnedData(url);
  if (learned && learned.price) {
    const category = learned.category || categorizeProduct(learned.name || '', url);
    return { ...learned, shippingCost: calculateShippingCost(learned.dimensions, learned.weight, learned.price, category) };
  }
  
  // Scrape product
  const scraped = await scrapeWithApifyAndBee(url);
  const productName = scraped.title || `${retailer} Product`;
  const category = categorizeProduct(productName, url);
  
  // INTELLIGENT PRODUCT ANALYSIS
  const analysis = analyzeProductIntelligently(productName, category, retailer);
  console.log(`   📊 Product type: ${analysis.productType || category}`);
  
  // Get dimensions and weight
  let dimensions = null;
  let weight = null;
  
  // Try UPCitemdb if available
  if (USE_UPCITEMDB && productName && scraped.success) {
    try {
      console.log('   🔍 Checking UPCitemdb...');
      const upcData = await upcItemDB.searchByName(productName);
      
      if (upcData) {
        if (upcData.dimensions) {
          dimensions = {
            length: Math.round(upcData.dimensions.length * 1.25),
            width: Math.round(upcData.dimensions.width * 1.25),
            height: Math.round(upcData.dimensions.height * 1.25)
          };
          console.log('   ✅ UPCitemdb provided dimensions');
        }
        if (upcData.weight) {
          weight = upcData.weight;
          console.log('   ✅ UPCitemdb provided weight');
        }
      }
    } catch (error) {
      console.log('   ⚠️ UPCitemdb failed');
    }
  }
  
  // Use intelligent analysis dimensions if available
  if (!dimensions && analysis.estimatedDimensions) {
    dimensions = analysis.estimatedDimensions;
    console.log('   🤖 Using AI-analyzed dimensions');
  }
  
  // Estimate missing data
  if (!dimensions) {
    dimensions = estimateDimensionsFromPatterns(category, productName, retailer);
    console.log('   📐 Estimated dimensions');
  }
  
  if (!weight) {
    weight = analysis.estimatedWeight || estimateWeightFromPatterns(dimensions, category, productName);
    console.log('   ⚖️ Estimated weight');
  }
  
  // Apply flat-pack reduction if detected by intelligent analysis
  let packaging = 'ASSEMBLED';
  const isFlatPack = analysis.isFlatPackLikely || isFlatPackable(category, productName, retailer);
  if (isFlatPack) {
    console.log(`   📦 FLAT-PACK DETECTED`);
    dimensions = calculateFlatPackDimensions(dimensions, productName);
    weight = adjustFlatPackWeight(weight, category);
    packaging = 'FLAT-PACK';
  }
  
  // Calculate shipping with category awareness
  const shippingCost = calculateShippingCost(dimensions, weight, scraped.price || 100, category);
  
  const product = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    url: url,
    name: productName,
    variant: scraped.variant,
    thumbnail: scraped.image,
    sku: scraped.sku,
    price: scraped.price,
    image: scraped.image || 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=No+Image',
    category: category,
    retailer: retailer,
    dimensions: dimensions,
    weight: weight,
    isFlatPack: isFlatPack,
    packaging: packaging,
    shippingCost: shippingCost,
    intelligentAnalysis: analysis,
    dataCompleteness: {
      hasName: !!scraped.title,
      hasPrice: !!scraped.price,
      hasImage: !!scraped.image,
      hasVariant: !!scraped.variant,
      hasSku: !!scraped.sku
    },
    fromCache: false
  };
  
  const cubicFeet = (dimensions.length * dimensions.width * dimensions.height) / 1728;
  console.log(`   Price: ${scraped.price ? '$' + scraped.price : 'Not found'}`);
  console.log(`   Variant: ${scraped.variant || 'Not specified'}`);
  console.log(`   Packaging: ${packaging}`);
  console.log(`   Dimensions: ${dimensions.length}×${dimensions.width}×${dimensions.height}" (${cubicFeet.toFixed(1)} ft³)`);
  console.log(`   Weight: ${weight} lbs`);
  console.log(`   Shipping: $${shippingCost}`);
  
  // Learn from this product
  learnFromProduct(url, product);
  
  return product;
}

// SCRAPING ENDPOINT
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
    console.log(`========================================\n`);
    
    const products = [];
    
    for (let i = 0; i < urls.length; i++) {
      try {
        const product = await processProduct(urls[i], i, urls);
        products.push(product);
      } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
        
        const retailer = detectRetailer(urls[i]);
        products.push({
          id: Date.now() + Math.random().toString(36).substr(2, 9),
          url: urls[i],
          name: 'Product from ' + retailer,
          price: null,
          image: 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=Not+Found',
          category: 'general',
          retailer: retailer,
          dimensions: estimateDimensionsFromPatterns('general', '', retailer),
          weight: 50,
          shippingCost: 60,
          error: true
        });
      }
    }
    
    const successful = products.filter(p => p.price).length;
    const fromCache = products.filter(p => p.fromCache).length;
    const withVariants = products.filter(p => p.variant).length;
    
    console.log(`\n========================================`);
    console.log(`RESULTS: ${successful}/${products.length} successful`);
    console.log(`With variants: ${withVariants}`);
    console.log(`========================================\n`);
    
    res.json({ 
      products,
      summary: {
        total: products.length,
        successful: successful,
        fromCache: fromCache,
        failed: products.length - successful,
        withVariants: withVariants
      }
    });
    
  } catch (error) {
    console.error('❌ Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape products' });
  }
});

// Prepare Shopify checkout
app.post('/api/prepare-shopify-checkout', async (req, res) => {
  try {
    const checkoutId = generateOrderId();
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
  console.log(`📍 API Health: http://localhost:${PORT}/health\n`);
});
