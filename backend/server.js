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

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));

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

// Rate limiters
const scrapeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many scraping requests',
  trustProxy: true
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

function categorizeProduct(name, url) {
  const text = (name + ' ' + url).toLowerCase();
  
  if (/\b(sofa|couch|chair|recliner|ottoman|table|desk|dresser|bed|mattress|furniture|dining|patio|console|buffet|cabinet|shelf|bookcase)\b/.test(text)) return 'furniture';
  if (/\b(tv|television|monitor|laptop|computer|tablet|phone|camera|speaker|headphone|electronic)\b/.test(text)) return 'electronics';
  if (/\b(refrigerator|fridge|washer|dryer|dishwasher|microwave|oven|stove|appliance)\b/.test(text)) return 'appliances';
  if (/\b(toy|game|puzzle|doll|lego|playset|bounce|slide|tikes)\b/.test(text)) return 'toys';
  if (/\b(shirt|pants|dress|jacket|shoes|clothing|apparel|wear)\b/.test(text)) return 'clothing';
  return 'general';
}

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
  
  // Special handling for patio sets
  if (name.includes('patio') || name.includes('outdoor') || name.includes('rattan')) {
    if (!name.includes('cushion') && !name.includes('umbrella')) {
      return true; // Most patio furniture is flat-packable
    }
  }
  
  if (category === 'furniture') {
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
    length: 1.0,
    width: 1.0,
    height: 0.15
  };
  
  // Special handling for patio sets
  if (name.includes('patio') || name.includes('outdoor') || name.includes('rattan')) {
    reductionProfile = {
      length: originalDimensions.length * 0.7,
      width: originalDimensions.width * 0.7,
      height: Math.max(12, originalDimensions.height * 0.2)
    };
  } else if (name.includes('table') || name.includes('desk')) {
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
  }
  
  const flatPackDims = {
    length: Math.round(reductionProfile.length),
    width: Math.round(reductionProfile.width),
    height: Math.round(reductionProfile.height)
  };
  
  console.log(`   📦 Flat-pack: ${originalDimensions.length}x${originalDimensions.width}x${originalDimensions.height} → ${flatPackDims.length}x${flatPackDims.width}x${flatPackDims.height}`);
  
  return flatPackDims;
}

function adjustFlatPackWeight(originalWeight, category) {
  if (category === 'furniture') {
    return Math.round(originalWeight * 0.85);
  }
  return originalWeight;
}

function estimateDimensionsFromPatterns(category, name, retailer) {
  const text = name.toLowerCase();
  
  // Check learning database first
  if (LEARNING_DB.patterns[category]) {
    const pattern = LEARNING_DB.patterns[category];
    if (pattern.dimensions && pattern.dimensions.length > 0) {
      const avgDims = pattern.dimensions[pattern.dimensions.length - 1];
      return avgDims;
    }
  }
  
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  
  if (category === 'furniture') {
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

function estimateWeightFromPatterns(dimensions, category) {
  // Check learning database first
  if (LEARNING_DB.patterns[category] && LEARNING_DB.patterns[category].weights) {
    const weights = LEARNING_DB.patterns[category].weights;
    if (weights.length > 0) {
      const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
      return Math.round(avgWeight);
    }
  }
  
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  const weightPerCubic = patterns.avgWeight / patterns.avgCubicFeet;
  const estimatedWeight = Math.max(10, cubicFeet * weightPerCubic);
  return Math.round(estimatedWeight);
}

// SIMPLIFIED SHIPPING CALCULATION
function calculateShippingCost(dimensions, weight, price) {
  if (!dimensions) {
    return Math.round(Math.max(25, price * 0.08));
  }
  
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Base ocean freight cost
  const baseCost = Math.max(15, cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT);
  
  // Heavy weight fee only (removed oversize and value fees)
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
  const totalShipping = Math.round(baseShipping + marginAmount + cardFee);
  
  return totalShipping;
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

// WAYFAIR-OPTIMIZED SCRAPING
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
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('   ✅ Apify got:', item.title ? item.title.substring(0, 50) : 'No title');
        
        // Extract price
        let price = null;
        if (item.price) {
          price = typeof item.price === 'string' ? 
            parseFloat(item.price.replace(/[^0-9.]/g, '')) : 
            parseFloat(item.price);
        } else if (item.salePrice) {
          price = parseFloat(item.salePrice);
        }
        
        // Extract variant
        let variant = null;
        if (item.selectedOptions && typeof item.selectedOptions === 'object') {
          variant = Object.entries(item.selectedOptions)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
        }
        
        return {
          price: price,
          title: item.title || item.name || 'Wayfair Product',
          image: item.images?.[0] || item.image,
          variant: variant,
          sku: item.sku || item.productId,
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
    return { ...learned, shippingCost: calculateShippingCost(learned.dimensions, learned.weight, learned.price) };
  }
  
  // Scrape product
  const scraped = await scrapeWithApifyAndBee(url);
  const productName = scraped.title || `${retailer} Product`;
  const category = categorizeProduct(productName, url);
  
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
  
  // Estimate missing data
  if (!dimensions) {
    dimensions = estimateDimensionsFromPatterns(category, productName, retailer);
    console.log('   📐 Estimated dimensions');
  }
  
  if (!weight) {
    weight = estimateWeightFromPatterns(dimensions, category);
    console.log('   ⚖️ Estimated weight');
  }
  
  // Apply flat-pack reduction if applicable
  let packaging = 'ASSEMBLED';
  const isFlatPack = isFlatPackable(category, productName, retailer);
  if (isFlatPack) {
    console.log(`   📦 FLAT-PACK DETECTED`);
    dimensions = calculateFlatPackDimensions(dimensions, productName);
    weight = adjustFlatPackWeight(weight, category);
    packaging = 'FLAT-PACK';
  }
  
  // Calculate shipping
  const shippingCost = calculateShippingCost(dimensions, weight, scraped.price || 100);
  
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
  console.log(`   Volume: ${cubicFeet.toFixed(1)} ft³`);
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
    
    console.log(`\n========================================`);
    console.log(`RESULTS: ${successful}/${products.length} successful`);
    console.log(`========================================\n`);
    
    res.json({ 
      products,
      summary: {
        total: products.length,
        successful: successful,
        fromCache: fromCache,
        failed: products.length - successful
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
