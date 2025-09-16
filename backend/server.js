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
const SHIPPING_RATE_PER_CUBIC_FOOT = 8;  // $8 per cubic foot for ocean freight
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
  retailer_stats: {},
  dimension_patterns: {}
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
console.log(`Ocean Freight Rate: $${SHIPPING_RATE_PER_CUBIC_FOOT} per cubic foot`);
console.log('Margin: FIXED 15% + 3.5% card fee (hidden in shipping)');
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
    shippingRate: `$${SHIPPING_RATE_PER_CUBIC_FOOT}/cubic foot`,
    services: {
      shopify: !!SHOPIFY_ACCESS_TOKEN,
      upcitemdb: USE_UPCITEMDB,
      apify: !!apifyClient,
      scrapingBee: !!SCRAPINGBEE_API_KEY
    }
  });
});

// Serve complete-order page
app.get('/complete-order.html', (req, res) => {
  const completePath = path.join(__dirname, '../frontend', 'complete-order.html');
  res.sendFile(completePath, (err) => {
    if (err) {
      console.error('Error serving complete-order page:', err);
      res.redirect('/');
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

// Store pending orders temporarily (in memory for now, could use Redis later)
const pendingOrders = new Map();

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

// COMPREHENSIVE DIMENSION EXTRACTION SYSTEM
function extractDimensionsFromText(text) {
  if (!text) return null;
  
  // Multiple regex patterns to catch different dimension formats
  const patterns = [
    // Standard format: 30" x 24" x 36"
    /(\d+(?:\.\d+)?)\s*(?:"|''|inches?|in)?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:"|''|inches?|in)?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:"|''|inches?|in)?/,
    // L x W x H format
    /(?:L|Length):\s*(\d+(?:\.\d+)?).+?(?:W|Width):\s*(\d+(?:\.\d+)?).+?(?:H|Height):\s*(\d+(?:\.\d+)?)/i,
    // Dimensions: format
    /Dimensions?:\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/i,
    // Package dimensions
    /Package\s+Dimensions?:\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/i,
    // Overall dimensions
    /Overall:\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/i,
    // Product size
    /Size:\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const dims = {
        length: parseFloat(match[1]),
        width: parseFloat(match[2]),
        height: parseFloat(match[3])
      };
      
      // Validate dimensions are reasonable
      if (dims.length > 0 && dims.length < 200 && 
          dims.width > 0 && dims.width < 200 && 
          dims.height > 0 && dims.height < 200) {
        return dims;
      }
    }
  }
  
  return null;
}

// Extract weight from text
function extractWeightFromText(text) {
  if (!text) return null;
  
  const patterns = [
    { regex: /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?|lb\.?)/i, multiplier: 1 },
    { regex: /(\d+(?:\.\d+)?)\s*(?:kilograms?|kgs?|kg\.?)/i, multiplier: 2.205 },
    { regex: /(\d+(?:\.\d+)?)\s*(?:ounces?|oz\.?)/i, multiplier: 0.0625 },
    { regex: /Weight:\s*(\d+(?:\.\d+)?)/i, multiplier: 1 }
  ];
  
  for (const { regex, multiplier } of patterns) {
    const match = text.match(regex);
    if (match) {
      const weight = parseFloat(match[1]) * multiplier;
      if (weight > 0 && weight < 2000) {
        return Math.round(weight * 10) / 10;
      }
    }
  }
  
  return null;
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
  
  // EXTRACT DIMENSIONS FROM NAME
  const dims = extractDimensionsFromText(name);
  if (dims) {
    analysis.estimatedDimensions = dims;
    analysis.confidence = 0.9;
    analysis.reasoning.push('Dimensions found in product name');
  }
  
  // SPECIFIC PRODUCT TYPE DETECTION WITH ACCURATE DIMENSIONS
  if (nameLower.includes('bar stool') || nameLower.includes('counter stool')) {
    analysis.productType = 'bar-stool';
    if (!analysis.estimatedDimensions) {
      analysis.estimatedDimensions = { length: 18, width: 18, height: 30 };
      analysis.estimatedWeight = 25;
    }
  } else if (nameLower.includes('5 piece') || nameLower.includes('5-piece')) {
    if (nameLower.includes('patio') || nameLower.includes('rattan') || nameLower.includes('outdoor')) {
      analysis.productType = 'patio-set-5pc';
      analysis.isFlatPackLikely = true;
      if (!analysis.estimatedDimensions) {
        // 5-piece patio sets typically ship in 2-3 large boxes
        analysis.estimatedDimensions = { length: 54, width: 42, height: 24 };
        analysis.estimatedWeight = 150;
      }
    } else if (nameLower.includes('dining')) {
      analysis.productType = 'dining-set-5pc';
      analysis.isFlatPackLikely = true;
      if (!analysis.estimatedDimensions) {
        analysis.estimatedDimensions = { length: 60, width: 40, height: 20 };
        analysis.estimatedWeight = 180;
      }
    }
  } else if (nameLower.includes('sofa') || nameLower.includes('couch')) {
    if (nameLower.includes('sectional')) {
      analysis.productType = 'sectional-sofa';
      if (!analysis.estimatedDimensions) {
        analysis.estimatedDimensions = { length: 108, width: 42, height: 36 };
        analysis.estimatedWeight = 250;
      }
    } else if (nameLower.includes('loveseat')) {
      analysis.productType = 'loveseat';
      if (!analysis.estimatedDimensions) {
        analysis.estimatedDimensions = { length: 64, width: 38, height: 36 };
        analysis.estimatedWeight = 120;
      }
    } else {
      analysis.productType = 'sofa';
      if (!analysis.estimatedDimensions) {
        analysis.estimatedDimensions = { length: 84, width: 38, height: 36 };
        analysis.estimatedWeight = 160;
      }
    }
  } else if (nameLower.includes('mattress')) {
    if (nameLower.includes('king')) {
      analysis.productType = 'mattress-king';
      if (!analysis.estimatedDimensions) {
        analysis.estimatedDimensions = { length: 80, width: 76, height: 12 };
        analysis.estimatedWeight = 140;
      }
    } else if (nameLower.includes('queen')) {
      analysis.productType = 'mattress-queen';
      if (!analysis.estimatedDimensions) {
        analysis.estimatedDimensions = { length: 80, width: 60, height: 12 };
        analysis.estimatedWeight = 120;
      }
    }
  } else if (nameLower.includes('table')) {
    if (nameLower.includes('coffee')) {
      analysis.productType = 'coffee-table';
      analysis.isFlatPackLikely = true;
      if (!analysis.estimatedDimensions) {
        analysis.estimatedDimensions = { length: 48, width: 24, height: 18 };
        analysis.estimatedWeight = 50;
      }
    } else if (nameLower.includes('dining')) {
      analysis.productType = 'dining-table';
      analysis.isFlatPackLikely = true;
      if (!analysis.estimatedDimensions) {
        analysis.estimatedDimensions = { length: 72, width: 42, height: 30 };
        analysis.estimatedWeight = 120;
      }
    }
  } else if (nameLower.includes('chair')) {
    if (nameLower.includes('office')) {
      analysis.productType = 'office-chair';
      if (!analysis.estimatedDimensions) {
        analysis.estimatedDimensions = { length: 28, width: 28, height: 42 };
        analysis.estimatedWeight = 40;
      }
    } else if (nameLower.includes('dining')) {
      analysis.productType = 'dining-chair';
      analysis.isFlatPackLikely = true;
      if (!analysis.estimatedDimensions) {
        analysis.estimatedDimensions = { length: 22, width: 20, height: 38 };
        analysis.estimatedWeight = 25;
      }
    } else {
      analysis.productType = 'chair';
      if (!analysis.estimatedDimensions) {
        analysis.estimatedDimensions = { length: 30, width: 30, height: 36 };
        analysis.estimatedWeight = 35;
      }
    }
  }
  
  // Detect flat-pack from keywords
  if (nameLower.includes('assembly required') || 
      nameLower.includes('easy assembly') || 
      nameLower.includes('flat pack') ||
      nameLower.includes('rta') ||
      retailer === 'IKEA' ||
      (retailer === 'Wayfair' && category.includes('furniture'))) {
    analysis.isFlatPackLikely = true;
    analysis.reasoning.push('Flat-pack detected from keywords/retailer');
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

// CONVERT PRODUCT DIMENSIONS TO SHIPPING BOX DIMENSIONS
function calculateBoxDimensions(productDims, category, isFlatPack = false) {
  if (!productDims) return null;
  
  let boxDims = { ...productDims };
  
  // If flat-packed, reduce height significantly
  if (isFlatPack) {
    boxDims = {
      length: Math.round(productDims.length * 1.1),
      width: Math.round(productDims.width * 1.1),
      height: Math.round(Math.max(6, productDims.height * 0.3))
    };
    console.log(`   📦 Flat-pack adjustment applied`);
  } else {
    // Add packaging material based on category
    const paddingFactors = {
      'electronics': 1.4,      // Lots of protective packaging
      'appliances': 1.2,
      'furniture-outdoor': 1.15,
      'furniture-sofa': 1.1,
      'furniture-chair': 1.2,
      'furniture-table': 1.15,
      'furniture-storage': 1.15,
      'furniture-bed': 1.1,
      'toys': 1.3,
      'clothing': 1.5,         // Bags/boxes much bigger than items
      'general': 1.25
    };
    
    const factor = paddingFactors[category] || 1.25;
    
    boxDims = {
      length: Math.round(productDims.length * factor),
      width: Math.round(productDims.width * factor),
      height: Math.round(productDims.height * factor)
    };
  }
  
  return boxDims;
}

// PROPER SHIPPING COST CALCULATION
function calculateShippingCost(dimensions, weight, price, category) {
  if (!dimensions) {
    // No dimensions - use weight-based estimate
    if (weight) {
      const estimatedCubicFeet = weight / 10; // Rough estimate
      return Math.round(Math.max(50, estimatedCubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT * 1.4));
    }
    // Fallback to price-based
    return Math.round(Math.max(50, price * 0.12));
  }
  
  // Calculate volume in cubic feet
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  console.log(`   📐 Box dimensions: ${dimensions.length}×${dimensions.width}×${dimensions.height}" = ${cubicFeet.toFixed(2)} ft³`);
  
  // Base ocean freight cost
  let baseCost = cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT;
  
  // Minimum shipping cost
  baseCost = Math.max(35, baseCost);
  
  // Add handling fee based on weight
  let handlingFee = 15;
  if (weight > 100) handlingFee = 25;
  if (weight > 200) handlingFee = 40;
  
  // Oversized fee for large dimensions
  const longestSide = Math.max(dimensions.length, dimensions.width, dimensions.height);
  let oversizeFee = 0;
  if (longestSide > 60) oversizeFee = 30;
  if (longestSide > 84) oversizeFee = 60;
  if (longestSide > 108) oversizeFee = 100;
  
  // Calculate subtotal
  const shippingSubtotal = baseCost + handlingFee + oversizeFee;
  
  // Add SDL margin (15%)
  const marginAmount = shippingSubtotal * SDL_MARGIN_RATE;
  
  // Calculate estimated total for card fee calculation
  const estimatedTotal = price + (price * BERMUDA_DUTY_RATE) + shippingSubtotal + marginAmount;
  
  // Add hidden credit card fee (3.5% of estimated total)
  const cardFee = estimatedTotal * CARD_FEE_RATE;
  
  // Total shipping includes everything
  const totalShipping = Math.round(shippingSubtotal + marginAmount + cardFee);
  
  console.log(`   💰 Shipping breakdown: Base $${baseCost.toFixed(2)} + Handling $${handlingFee} + Oversize $${oversizeFee} + Margin/Fees = $${totalShipping}`);
  
  return totalShipping;
}

// Learning functions
function learnFromProduct(url, productData) {
  LEARNING_DB.products[url] = {
    ...productData,
    last_updated: new Date().toISOString(),
    times_seen: (LEARNING_DB.products[url]?.times_seen || 0) + 1
  };
  
  // Store dimension patterns by product name patterns
  if (productData.name && productData.dimensions) {
    const nameKey = productData.name.toLowerCase().substring(0, 30);
    if (!LEARNING_DB.dimension_patterns[nameKey]) {
      LEARNING_DB.dimension_patterns[nameKey] = [];
    }
    LEARNING_DB.dimension_patterns[nameKey].push({
      dimensions: productData.dimensions,
      weight: productData.weight,
      timestamp: new Date().toISOString()
    });
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

// ENHANCED WAYFAIR SCRAPING WITH VARIANT SUPPORT
async function scrapeWithApifyAndBee(url) {
  const retailer = detectRetailer(url);
  
  // WAYFAIR WITH APIFY
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
      
      if (items && items.length > 0) {
        const item = items[0];
        
        // Extract price
        let price = null;
        if (item.price) {
          if (typeof item.price === 'object') {
            price = item.price.value || item.price.amount || parseFloat(item.price.toString());
          } else {
            price = typeof item.price === 'string' ? 
              parseFloat(item.price.replace(/[^0-9.]/g, '')) : 
              item.price;
          }
        }
        
        // Try to get regular price
        if (!price && item.regular_price) {
          price = typeof item.regular_price === 'string' ? 
            parseFloat(item.regular_price.replace(/[^0-9.]/g, '')) : 
            item.regular_price;
        }
        
        // Extract variant from URL parameters
        let variant = null;
        try {
          const urlObj = new URL(url);
          const piid = urlObj.searchParams.get('piid');
          if (piid) {
            variant = `Variant ID: ${piid}`;
            
            // Try to get more details from the item data
            if (item.selectedOptions) {
              const options = [];
              for (const [key, value] of Object.entries(item.selectedOptions)) {
                if (value && value !== 'null') {
                  options.push(`${key}: ${value}`);
                }
              }
              if (options.length > 0) {
                variant = options.join(', ');
              }
            }
          }
        } catch (e) {
          // URL parsing failed
        }
        
        // Extract dimensions from description or specifications
        let dimensions = null;
        let weight = null;
        
        const textToSearch = [
          item.description,
          item.specifications,
          item.details,
          JSON.stringify(item)
        ].join(' ');
        
        dimensions = extractDimensionsFromText(textToSearch);
        weight = extractWeightFromText(textToSearch);
        
        const title = item.title || item.name || 'Wayfair Product';
        
        console.log('   ✅ Apify scraped:', title.substring(0, 50));
        console.log('   💰 Price:', price || 'Not found');
        console.log('   🎨 Variant:', variant || 'Not detected');
        if (dimensions) console.log('   📏 Dimensions found in data');
        if (weight) console.log('   ⚖️ Weight found in data');
        
        return {
          price: price,
          title: title,
          image: item.mainImage || item.image,
          variant: variant,
          sku: item.sku,
          dimensions: dimensions,
          weight: weight,
          success: true
        };
      }
    } catch (error) {
      console.log('   ⚠️ Apify failed:', error.message);
    }
  }
  
  // FALLBACK TO SCRAPINGBEE WITH AI EXTRACTION
  if (SCRAPINGBEE_API_KEY) {
    try {
      console.log('   🐝 Using ScrapingBee AI extraction...');
      
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
            variant: "Selected options, color, size, configuration",
            image: "Main Product Image URL",
            dimensions: "Product dimensions, package dimensions, overall dimensions",
            weight: "Product weight, item weight, shipping weight",
            specifications: "All product specifications and details"
          })
        },
        timeout: 20000
      });
      
      const data = response.data;
      
      // Extract dimensions and weight from AI response
      let dimensions = null;
      let weight = null;
      
      if (data.dimensions) {
        dimensions = extractDimensionsFromText(data.dimensions);
      }
      if (!dimensions && data.specifications) {
        dimensions = extractDimensionsFromText(data.specifications);
      }
      
      if (data.weight) {
        weight = extractWeightFromText(data.weight);
      }
      if (!weight && data.specifications) {
        weight = extractWeightFromText(data.specifications);
      }
      
      return {
        price: data.price ? parseFloat(data.price.toString().replace(/[^0-9.]/g, '')) : null,
        title: data.title || 'Product',
        image: data.image,
        variant: data.variant,
        dimensions: dimensions,
        weight: weight,
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
    dimensions: null,
    weight: null,
    success: false
  };
}

// MAIN PRODUCT PROCESSING WITH COMPREHENSIVE DIMENSION EXTRACTION
async function processProduct(url, index, urls) {
  console.log(`[${index + 1}/${urls.length}] Processing: ${url.substring(0, 80)}...`);
  
  const retailer = detectRetailer(url);
  console.log(`   Retailer: ${retailer}`);
  
  // Check learned data
  const learned = getLearnedData(url);
  if (learned && learned.price) {
    const category = learned.category || categorizeProduct(learned.name || '', url);
    const boxDims = calculateBoxDimensions(learned.dimensions, category, learned.isFlatPack);
    const shipping = calculateShippingCost(boxDims, learned.weight, learned.price, category);
    return { ...learned, dimensions: boxDims, shippingCost: shipping };
  }
  
  // STEP 1: Scrape with Apify/ScrapingBee
  const scraped = await scrapeWithApifyAndBee(url);
  const productName = scraped.title || `${retailer} Product`;
  const category = categorizeProduct(productName, url);
  
  // STEP 2: Intelligent product analysis
  const analysis = analyzeProductIntelligently(productName, category, retailer);
  console.log(`   📊 Product type: ${analysis.productType || category}`);
  
  // STEP 3: Get best dimensions (prioritize scraped data)
  let productDimensions = scraped.dimensions || analysis.estimatedDimensions;
  let weight = scraped.weight || analysis.estimatedWeight;
  
  // STEP 4: Try UPCitemdb if we still need dimensions
  if (USE_UPCITEMDB && productName && (!productDimensions || !weight)) {
    try {
      console.log('   🔍 Checking UPCitemdb...');
      const upcData = await upcItemDB.searchByName(productName);
      
      if (upcData) {
        if (!productDimensions && upcData.dimensions) {
          productDimensions = upcData.dimensions;
          console.log('   ✅ UPCitemdb provided dimensions');
        }
        if (!weight && upcData.weight) {
          weight = upcData.weight;
          console.log('   ✅ UPCitemdb provided weight');
        }
      }
    } catch (error) {
      console.log('   ⚠️ UPCitemdb failed');
    }
  }
  
  // STEP 5: Final fallback estimations
  if (!productDimensions) {
    // Use category-based estimation
    const categoryEstimates = {
      'furniture-outdoor': { length: 48, width: 36, height: 30 },
      'furniture-sofa': { length: 84, width: 38, height: 36 },
      'furniture-chair': { length: 30, width: 30, height: 36 },
      'furniture-table': { length: 60, width: 36, height: 30 },
      'furniture-storage': { length: 40, width: 20, height: 60 },
      'furniture-bed': { length: 80, width: 60, height: 40 },
      'electronics': { length: 24, width: 20, height: 18 },
      'appliances': { length: 36, width: 36, height: 48 },
      'toys': { length: 20, width: 16, height: 14 },
      'clothing': { length: 14, width: 12, height: 4 },
      'general': { length: 24, width: 20, height: 18 }
    };
    
    productDimensions = categoryEstimates[category] || categoryEstimates.general;
    console.log('   📐 Using category-based dimensions');
  }
  
  if (!weight) {
    // Estimate weight from dimensions
    const cubicFeet = (productDimensions.length * productDimensions.width * productDimensions.height) / 1728;
    const densities = {
      'furniture-outdoor': 3,
      'furniture-sofa': 5,
      'furniture-chair': 4,
      'furniture-table': 6,
      'furniture-storage': 7,
      'furniture-bed': 4,
      'electronics': 10,
      'appliances': 12,
      'toys': 2,
      'clothing': 1,
      'general': 5
    };
    weight = Math.round(cubicFeet * (densities[category] || 5));
    console.log('   ⚖️ Estimated weight from dimensions');
  }
  
  // STEP 6: Convert to shipping box dimensions
  const isFlatPack = analysis.isFlatPackLikely;
  const boxDimensions = calculateBoxDimensions(productDimensions, category, isFlatPack);
  
  // STEP 7: Calculate accurate shipping cost
  const shippingCost = calculateShippingCost(boxDimensions, weight, scraped.price || 100, category);
  
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
    productDimensions: productDimensions,
    dimensions: boxDimensions,
    weight: weight,
    isFlatPack: isFlatPack,
    packaging: isFlatPack ? 'FLAT-PACK' : 'ASSEMBLED',
    shippingCost: shippingCost,
    intelligentAnalysis: analysis,
    dataCompleteness: {
      hasName: !!scraped.title,
      hasPrice: !!scraped.price,
      hasImage: !!scraped.image,
      hasVariant: !!scraped.variant,
      hasDimensions: !!scraped.dimensions,
      hasWeight: !!scraped.weight
    },
    fromCache: false
  };
  
  const cubicFeet = (boxDimensions.length * boxDimensions.width * boxDimensions.height) / 1728;
  console.log(`   💵 Price: ${scraped.price ? '$' + scraped.price : 'Not found'}`);
  console.log(`   🎨 Variant: ${scraped.variant || 'Not specified'}`);
  console.log(`   📦 Packaging: ${product.packaging}`);
  console.log(`   📏 Product: ${productDimensions.length}×${productDimensions.width}×${productDimensions.height}"`);
  console.log(`   📦 Shipping box: ${boxDimensions.length}×${boxDimensions.width}×${boxDimensions.height}" (${cubicFeet.toFixed(1)} ft³)`);
  console.log(`   ⚖️ Weight: ${weight} lbs`);
  console.log(`   🚢 Ocean freight: $${shippingCost}`);
  
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
    console.log(`Ocean Freight Rate: $${SHIPPING_RATE_PER_CUBIC_FOOT}/cubic foot`);
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
          dimensions: { length: 24, width: 20, height: 18 },
          weight: 50,
          shippingCost: 100,
          error: true
        });
      }
    }
    
    const successful = products.filter(p => p.price).length;
    const withVariants = products.filter(p => p.variant).length;
    const withDimensions = products.filter(p => p.dataCompleteness?.hasDimensions).length;
    
    console.log(`\n========================================`);
    console.log(`RESULTS: ${successful}/${products.length} with prices`);
    console.log(`With variants: ${withVariants}`);
    console.log(`With exact dimensions: ${withDimensions}`);
    console.log(`========================================\n`);
    
    res.json({ 
      products,
      summary: {
        total: products.length,
        successful: successful,
        withVariants: withVariants,
        withDimensions: withDimensions
      }
    });
    
  } catch (error) {
    console.error('❌ Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape products' });
  }
});

// STORE PENDING ORDER FOR SHOPIFY CHECKOUT
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

// RETRIEVE PENDING ORDER
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

// CREATE SHOPIFY DRAFT ORDER WITH CUSTOM LINE ITEMS
app.post('/apps/instant-import/create-draft-order', async (req, res) => {
  try {
    const { products, deliveryFees, totals, customer, originalUrls } = req.body;
    
    if (!SHOPIFY_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Shopify not configured. Please check API credentials.' });
    }
    
    if (!customer || !customer.email || !customer.name) {
      return res.status(400).json({ error: 'Customer information required' });
    }
    
    console.log(`\n📝 Creating Shopify Draft Order`);
    console.log(`   Customer: ${customer.email}`);
    console.log(`   Products: ${products.length}`);
    console.log(`   Total: $${totals.grandTotal.toFixed(2)}`);
    
    // Create line items for the draft order
    const lineItems = [];
    
    // Add each product as a custom line item
    products.forEach(product => {
      if (product.price && product.price > 0) {
        const quantity = product.quantity || 1;
        
        // Add product with variant info if available
        const productTitle = product.variant ? 
          `${product.name} - ${product.variant}` : 
          product.name;
        
        lineItems.push({
          title: productTitle,
          price: product.price.toFixed(2),
          quantity: quantity,
          properties: [
            { name: 'Source URL', value: product.url },
            { name: 'Retailer', value: product.retailer },
            { name: 'Category', value: product.category },
            { name: 'SKU', value: product.sku || 'N/A' },
            { name: 'Dimensions', value: `${product.dimensions?.length}×${product.dimensions?.width}×${product.dimensions?.height}"` },
            { name: 'Weight', value: `${product.weight} lbs` }
          ],
          taxable: false  // We handle duty separately
        });
        
        console.log(`   ✓ Added: ${productTitle.substring(0, 50)}...`);
      }
    });
    
    // Add import duty as a line item
    if (totals.dutyAmount > 0) {
      lineItems.push({
        title: 'Bermuda Import Duty (26.5%)',
        price: totals.dutyAmount.toFixed(2),
        quantity: 1,
        taxable: false,
        properties: [
          { name: 'Calculation', value: `26.5% of $${totals.totalItemCost.toFixed(2)}` }
        ]
      });
      console.log(`   ✓ Added: Import Duty $${totals.dutyAmount.toFixed(2)}`);
    }
    
    // Add delivery fees if any
    if (deliveryFees) {
      Object.entries(deliveryFees).forEach(([vendor, fee]) => {
        if (fee > 0) {
          lineItems.push({
            title: `${vendor} US Delivery Fee`,
            price: fee.toFixed(2),
            quantity: 1,
            taxable: false
          });
          console.log(`   ✓ Added: ${vendor} Delivery Fee $${fee.toFixed(2)}`);
        }
      });
    }
    
    // Add ocean freight & handling as a line item
    if (totals.totalShippingCost > 0) {
      lineItems.push({
        title: 'Ocean Freight & Handling to Bermuda',
        price: totals.totalShippingCost.toFixed(2),
        quantity: 1,
        taxable: false,
        properties: [
          { name: 'Service', value: 'Container shipping via Elizabeth, NJ' },
          { name: 'Rate', value: `$${SHIPPING_RATE_PER_CUBIC_FOOT}/cubic foot` }
        ]
      });
      console.log(`   ✓ Added: Ocean Freight $${totals.totalShippingCost.toFixed(2)}`);
    }
    
    // Create the draft order data
    const draftOrderData = {
      draft_order: {
        line_items: lineItems,
        customer: {
          email: customer.email,
          first_name: customer.name.split(' ')[0],
          last_name: customer.name.split(' ').slice(1).join(' ') || ''
        },
        email: customer.email,
        note: `Import Calculator Order\n\nOriginal Product URLs:\n${originalUrls || products.map(p => p.url).join('\n')}`,
        tags: 'import-calculator, ocean-freight, bermuda-import',
        tax_exempt: true,  // We handle duty manually
        send_receipt: false,
        send_fulfillment_receipt: false,
        billing_address: {
          first_name: customer.name.split(' ')[0],
          last_name: customer.name.split(' ').slice(1).join(' ') || '',
          address1: customer.address || '614 Progress Street',
          city: customer.city || 'Elizabeth',
          province: customer.province || 'NJ',
          country: 'US',
          zip: customer.zip || '07201'
        }
      }
    };
    
    console.log(`\n📤 Sending to Shopify...`);
    
    // Make request to Shopify
    const shopifyResponse = await axios.post(
      `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/draft_orders.json`,
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
    console.log(`   Invoice URL: ${draftOrder.invoice_url}`);
    
    // Return the checkout URL for redirect
    res.json({
      success: true,
      draftOrderId: draftOrder.id,
      draftOrderNumber: draftOrder.name,
      invoiceUrl: draftOrder.invoice_url,
      checkoutUrl: draftOrder.invoice_url,  // Customer can complete checkout here
      totalAmount: totals.grandTotal
    });
    
  } catch (error) {
    console.error('❌ Draft order creation error:', error.response?.data || error);
    res.status(500).json({ 
      error: 'Failed to create draft order. Please try again or contact support.',
      details: error.response?.data?.errors || error.message
    });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health\n`);
});
