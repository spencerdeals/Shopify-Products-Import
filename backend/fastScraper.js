const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const { parseProduct } = require('./boxEstimator');
require('dotenv').config();
const UPCItemDB = require('./upcitemdb');
const OrderTracker = require('./orderTracking');
const ZyteScraper = require('./zyteScraper');
const { parseProduct } = require('./gptParser');
const ApifyActorScraper = require('./apifyActorScraper');
const { parseProduct: parseWithGPT } = require('./gptParser');
const BOLHistoricalData = require('./bolHistoricalData');
const AdaptiveScraper = require('./adaptiveScraper');

// Simple, working scraper approach
const MAX_CONCURRENT = 1; // Process one at a time to avoid issues

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY || '';
const upcItemDB = new UPCItemDB(UPCITEMDB_API_KEY);
const USE_UPCITEMDB = !!UPCITEMDB_API_KEY;
const SCRAPING_TIMEOUT = 30000;
const MAX_CONCURRENT_SCRAPES = 2;
const BERMUDA_DUTY_RATE = 0.265;
const SHIPPING_RATE_PER_CUBIC_FOOT = 8;

// Initialize scrapers
const zyteScraper = new ZyteScraper();
const USE_ZYTE = zyteScraper.enabled;
const apifyActorScraper = new ApifyActorScraper(process.env.APIFY_API_KEY);
const USE_APIFY_ACTORS = apifyActorScraper.isAvailable();
const USE_GPT_FALLBACK = !!process.env.OPENAI_API_KEY;

// Confidence threshold for triggering GPT fallback
const CONFIDENCE_THRESHOLD = 0.3; // If Zyte confidence < 30%, try GPT

// Initialize BOL historical data system
const bolHistory = new BOLHistoricalData();
bolHistory.initialize().then(() => {
  console.log('📚 BOL Historical Data System Ready');
  bolHistory.getInsights();
}).catch(error => {
  console.error('❌ BOL History initialization failed:', error);
});

// Initialize order tracker
const adaptiveScraper = new AdaptiveScraper();
const bolData = new BOLHistoricalData();

let orderTracker = null;

OrderTracker.create().then(tracker => {
  orderTracker = tracker;
}).catch(error => {
  console.error('Failed to initialize order tracker:', error);
});

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Zyte API - ${USE_ZYTE ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log(`2. Fallback: GPT Parser - ${USE_GPT_FALLBACK ? '✅ ENABLED' : '❌ DISABLED (Missing OpenAI Key)'}`);
console.log(`3. BOL Historical Data - ✅ ENABLED (Volume Patterns)`);
console.log(`4. UPCitemdb - ${USE_UPCITEMDB ? '✅ ENABLED (Premium API)' : '❌ DISABLED (Missing API Key)'}`);
console.log(`5. Confidence Threshold: ${CONFIDENCE_THRESHOLD} (${CONFIDENCE_THRESHOLD * 100}%)`);
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
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    scraping: {
      primary: USE_ZYTE ? 'Zyte API' : 'None',
      fallback: process.env.OPENAI_API_KEY ? 'GPT Parser' : 'None',
      dimensions: USE_UPCITEMDB ? 'UPCitemdb' : 'None'
    },
    shopifyConfigured: !!SHOPIFY_ACCESS_TOKEN
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

// Root route - serve frontend HTML
app.get('/', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend', 'index.html');
  res.sendFile(frontendPath, (err) => {
    if (err) {
      console.error('Error serving frontend:', err);
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

// Rate limiter (after health check)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  trustProxy: 1,
  keyGenerator: (req) => req.ip
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
    if (domain.includes('walmart.com')) return 'Walmart';
    if (domain.includes('bestbuy.com')) return 'Best Buy';
    if (domain.includes('homedepot.com')) return 'Home Depot';
    if (domain.includes('lowes.com')) return 'Lowes';
    if (domain.includes('costco.com')) return 'Costco';
    if (domain.includes('macys.com')) return 'Macys';
    if (domain.includes('ikea.com')) return 'IKEA';
    if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
    if (domain.includes('cb2.com')) return 'CB2';
    if (domain.includes('westelm.com')) return 'West Elm';
    if (domain.includes('potterybarn.com')) return 'Pottery Barn';
    return 'Unknown';
  } catch (e) {
    return 'Unknown';
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

function calculateShippingCost(dimensions, weight, price) {
  if (!dimensions) {
    // No dimensions available, use a default based on price
    return Math.max(25, price * 0.15);
  }
  
  console.log(`   🧮 DETAILED Shipping calculation:`);
  console.log(`   📦 Input dimensions: ${dimensions.length}" × ${dimensions.width}" × ${dimensions.height}"`);
  
  // Calculate volume in cubic feet
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  console.log(`   📊 VOLUME CALCULATION:`);
  console.log(`   📊   ${dimensions.length} × ${dimensions.width} × ${dimensions.height} = ${cubicInches.toFixed(0)} cubic inches`);
  console.log(`   📊   ${cubicInches.toFixed(0)} ÷ 1728 = ${cubicFeet.toFixed(3)} cubic feet`);
  
  // Base rate: $8 per cubic foot
  const baseCost = Math.max(15, cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT);
  console.log(`   💰 BASE COST CALCULATION:`);
  console.log(`   💰   ${cubicFeet.toFixed(3)} × $${SHIPPING_RATE_PER_CUBIC_FOOT} = $${(cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT).toFixed(2)}`);
  console.log(`   💰   Math.max(15, ${(cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT).toFixed(2)}) = $${baseCost.toFixed(2)}`);
  
  // Add handling fee
  const handlingFee = 15;
  console.log(`   📋 HANDLING FEE: $${handlingFee}`);
  
  // Calculate base shipping cost
  const baseShippingCost = baseCost + handlingFee;
  
  // Calculate total landed cost before margin
  const dutyAmount = price * 0.265;
  const deliveryFee = 25;
  const landedCostBeforeMargin = price + dutyAmount + baseShippingCost + deliveryFee;
  
  // Calculate 20% margin on total landed cost
  const margin = landedCostBeforeMargin * 0.20;
  console.log(`   🎯 MARGIN CALCULATION (20% of total landed cost):`);
  console.log(`   🎯   Product: $${price.toFixed(2)}`);
  console.log(`   🎯   Duty (26.5%): $${dutyAmount.toFixed(2)}`);
  console.log(`   🎯   Base Shipping: $${baseShippingCost.toFixed(2)}`);
  console.log(`   🎯   Delivery: $${deliveryFee.toFixed(2)}`);
  console.log(`   🎯   Landed Cost Before Margin: $${landedCostBeforeMargin.toFixed(2)}`);
  console.log(`   🎯   20% Margin: $${landedCostBeforeMargin.toFixed(2)} × 0.20 = $${margin.toFixed(2)}`);
  
  // Add margin to shipping cost (margin is hidden in shipping)
  const finalShippingCost = baseShippingCost + margin;
  
  console.log(`   💰 FINAL SHIPPING COST:`);
  console.log(`   💰   Base Shipping: $${baseShippingCost.toFixed(2)}`);
  console.log(`   💰   + Margin: $${margin.toFixed(2)}`);
  console.log(`   💰   = Final Shipping: $${finalShippingCost.toFixed(2)}`);
  
  // IKEA specific debugging
  if (dimensions.length < 30 && dimensions.width < 30 && dimensions.height < 30) {
    console.log(`   🚨 SUSPICIOUS: All dimensions under 30" - this might be packaging for one component!`);
    console.log(`   🚨 For furniture, expected dimensions should be 60"+ for at least one dimension`);
  }
  
  return Math.round(finalShippingCost);
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

// Smart UPCitemdb lookup for dimensions
async function getUPCDimensions(productName) {
  if (!USE_UPCITEMDB || !productName) return null;
  
  try {
    console.log(`   🔍 UPCitemdb lookup for: "${productName.substring(0, 50)}..."`);
    const upcData = await upcItemDB.searchByName(productName);
    
    if (upcData && upcData.dimensions) {
      console.log(`   ✅ UPCitemdb found BOX dimensions: ${upcData.dimensions.length}" × ${upcData.dimensions.width}" × ${upcData.dimensions.height}"`);
      
      // UPCitemdb already provides shipping box dimensions
      const boxDimensions = upcData.dimensions;
      
      console.log(`   📦 Using UPCitemdb BOX dimensions: ${boxDimensions.length}" × ${boxDimensions.width}" × ${boxDimensions.height}"`);
      return boxDimensions;
    }
    
    console.log('   ❌ UPCitemdb: No dimensions found');
    return null;
  } catch (error) {
    console.log('   ❌ UPCitemdb lookup failed:', error.message);
    return null;
  }
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
  // Kitchen systems - typically 4-8 boxes
  else if (/\b(kitchen|cabinet.*set|knoxhult|enhet)\b/.test(name)) {
    if (price > 1000) {
      boxMultiplier = 8; // Full kitchen
      confidence = 'high';
    } else if (price > 500) {
      boxMultiplier = 5; // Partial kitchen
      confidence = 'medium';
    } else {
      boxMultiplier = 4; // Small kitchen set
      confidence = 'medium';
    }
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
  // Dining sets - typically 2-3 boxes (table + chairs)
  else if (/\b(dining|table.*chair|chair.*table)\b/.test(name)) {
    boxMultiplier = 3;
    confidence = 'medium';
  }
  // Large storage/shelving - typically 2-3 boxes for tall units
  else if (/\b(bookshelf|shelf.*unit|billy|hemnes.*bookcase|kallax)\b/.test(name) && price > 200) {
    boxMultiplier = 3;
    confidence = 'medium';
  }
  // Large desks - typically 2 boxes
  else if (/\b(desk|workstation|office.*table)\b/.test(name) && price > 300) {
    boxMultiplier = 2;
    confidence = 'medium';
  }
  
  if (boxMultiplier > 1) {
    const totalVolume = volume * boxMultiplier;
    const totalCubicFeet = totalVolume / 1728;
    
    // Estimate combined dimensions (assuming boxes stack/combine efficiently)
    const avgDimension = Math.cbrt(volume);
    const scaleFactor = Math.cbrt(boxMultiplier);
    
    const estimatedDimensions = {
      length: Math.round(singleBoxDimensions.length * scaleFactor * 10) / 10,
      width: Math.round(singleBoxDimensions.width * scaleFactor * 10) / 10,
      height: Math.round(singleBoxDimensions.height * scaleFactor * 10) / 10
    };
    
    console.log(`   📊 Multi-box estimate: ${boxMultiplier} boxes (${confidence} confidence)`);
    console.log(`   📦 Total volume: ${totalCubicFeet.toFixed(2)} ft³`);
    console.log(`   📏 Estimated combined dimensions: ${estimatedDimensions.length}" × ${estimatedDimensions.width}" × ${estimatedDimensions.height}"`);
    
    return {
      boxCount: boxMultiplier,
      confidence: confidence,
      dimensions: estimatedDimensions,
      singleBoxVolume: volume / 1728,
      totalVolume: totalCubicFeet
    };
  }
  
  return {
    boxCount: 1,
    confidence: 'high',
    dimensions: singleBoxDimensions,
    singleBoxVolume: volume / 1728,
    totalVolume: volume / 1728
  };
}

function extractProductFromContent(content, url, retailer, category) {
  console.log('🔍 Extracting product data from manual content...');
  
  const productData = {
    name: null,
    price: null,
    image: null,
    dimensions: null,
    weight: null
  };
  
  // Extract product name from content
  const namePatterns = [
    /product[^:]*:\s*([^\n\r]{10,100})/i,
    /title[^:]*:\s*([^\n\r]{10,100})/i,
    /<h1[^>]*>([^<]{10,100})<\/h1>/i,
    /name[^:]*:\s*([^\n\r]{10,100})/i
  ];
  
  for (const pattern of namePatterns) {
    const match = content.match(pattern);
    if (match && match[1].trim()) {
      productData.name = match[1].trim().substring(0, 200);
      console.log(`   📝 Extracted name: ${productData.name.substring(0, 50)}...`);
      break;
    }
  }
  
  // Extract price from content
  const pricePatterns = [
    /\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g,
    /price[^$]*\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/gi,
    /cost[^$]*\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/gi
  ];
  
  for (const pattern of pricePatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price > 10 && price < 50000) {
        productData.price = price;
        console.log(`   💰 Extracted price: $${productData.price}`);
        break;
      }
    }
    if (productData.price) break;
  }
  
  // CRITICAL: Extract REAL product dimensions from content
  console.log('🔍 Searching for product dimensions in content...');
  const dimPatterns = [
    // Standard dimension formats
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|"|'')/i,
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)/i,
    // Labeled dimensions
    /dimensions?[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
    /overall[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
    /size[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
    // L x W x H format
    /L:\s*(\d+(?:\.\d+)?)[^0-9]*W:\s*(\d+(?:\.\d+)?)[^0-9]*H:\s*(\d+(?:\.\d+)?)/i,
    /length[^:]*:\s*(\d+(?:\.\d+)?)[^0-9]*width[^:]*:\s*(\d+(?:\.\d+)?)[^0-9]*height[^:]*:\s*(\d+(?:\.\d+)?)/i,
    // Individual measurements
    /width[^:]*:\s*(\d+(?:\.\d+)?)[^0-9]*depth[^:]*:\s*(\d+(?:\.\d+)?)[^0-9]*height[^:]*:\s*(\d+(?:\.\d+)?)/i,
    // Product-specific formats
    /assembled[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
    /product[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i
  ];
  
  for (const pattern of dimPatterns) {
    const match = content.match(pattern);
    if (match) {
      let length = parseFloat(match[1]);
      let width = parseFloat(match[2]);
      let height = parseFloat(match[3]);
      
      // Convert cm to inches if needed
      if (content.toLowerCase().includes('cm') || content.toLowerCase().includes('centimeter')) {
        length = length / 2.54;
        width = width / 2.54;
        height = height / 2.54;
        console.log('   📐 Converted from cm to inches');
      }
      
      // Validate dimensions are reasonable
      if (length > 0 && width > 0 && height > 0 && 
          length < 200 && width < 200 && height < 200) {
        
        // CRITICAL: Add packaging padding based on category
        const paddingFactors = {
          'electronics': 1.3,      // 30% padding for fragile items
          'appliances': 1.2,       // 20% padding
          'furniture': 1.15,       // 15% padding for sturdy items
          'high-end-furniture': 1.15, // 15% padding for quality items
          'outdoor': 1.15,         // 15% padding for outdoor furniture
          'clothing': 1.4,         // 40% padding for soft goods
          'books': 1.2,            // 20% padding
          'toys': 1.25,            // 25% padding
          'sports': 1.2,           // 20% padding
          'home-decor': 1.35,      // 35% padding for fragile decor
          'tools': 1.15,           // 15% padding
          'garden': 1.2,           // 20% padding
          'general': 1.25          // 25% padding default
        };
        
        const paddingFactor = paddingFactors[category] || 1.25;
        
        productData.dimensions = {
          length: Math.round(length * paddingFactor * 10) / 10,
          width: Math.round(width * paddingFactor * 10) / 10,
          height: Math.round(height * paddingFactor * 10) / 10
        };
        
        console.log(`   📐 Found product dimensions: ${length}" × ${width}" × ${height}"`);
        console.log(`   📦 Added ${((paddingFactor - 1) * 100).toFixed(0)}% packaging padding for ${category}`);
        console.log(`   📦 Final shipping dimensions: ${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
        break;
      }
    }
  }
  
  // If no dimensions found, try to extract from URL or use category-based estimation
  if (!productData.dimensions) {
    console.log('   ⚠️ No dimensions found in content, trying URL extraction...');
    
    // Try to extract size from URL (like "85" from "mallorca-85-wood-outdoor-sofa")
    const urlSizeMatch = url.match(/[-_](\d{2,3})[-_]/);
    if (urlSizeMatch) {
      const extractedSize = parseInt(urlSizeMatch[1]);
      if (extractedSize >= 20 && extractedSize <= 120) {
        // Use extracted size as length, estimate width/height based on category
        const categoryRatios = {
          'furniture': { w: 0.4, h: 0.35 },
          'high-end-furniture': { w: 0.4, h: 0.35 },
          'outdoor': { w: 0.4, h: 0.35 },
          'electronics': { w: 0.6, h: 0.4 },
          'general': { w: 0.5, h: 0.4 }
        };
        
        const ratio = categoryRatios[category] || categoryRatios['general'];
        const paddingFactor = 1.15; // 15% padding
        
        productData.dimensions = {
          length: Math.round(extractedSize * paddingFactor * 10) / 10,
          width: Math.round(extractedSize * ratio.w * paddingFactor * 10) / 10,
          height: Math.round(extractedSize * ratio.h * paddingFactor * 10) / 10
        };
        
        console.log(`   📐 Extracted size ${extractedSize}" from URL`);
        console.log(`   📦 Estimated shipping dimensions: ${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
      }
    }
  }
  
  // Last resort: reasonable category-based estimates (NOT random!)
  if (!productData.dimensions) {
    console.log('   ⚠️ No dimensions found anywhere, using category-based estimate...');
    
    const categoryEstimates = {
      'high-end-furniture': { length: 72, width: 32, height: 30 },
      'furniture': { length: 48, width: 30, height: 36 },
      'outdoor': { length: 78, width: 34, height: 32 },
      'electronics': { length: 24, width: 16, height: 12 },
      'appliances': { length: 30, width: 30, height: 48 },
      'clothing': { length: 14, width: 12, height: 3 },
      'books': { length: 10, width: 7, height: 2 },
      'toys': { length: 16, width: 14, height: 12 },
      'sports': { length: 30, width: 24, height: 16 },
      'home-decor': { length: 18, width: 15, height: 18 },
      'tools': { length: 20, width: 15, height: 8 },
      'garden': { length: 30, width: 24, height: 18 },
      'general': { length: 18, width: 15, height: 12 }
    };
    
    const estimate = categoryEstimates[category] || categoryEstimates['general'];
    const paddingFactor = 1.15; // 15% padding
    
    productData.dimensions = {
      length: Math.round(estimate.length * paddingFactor * 10) / 10,
      width: Math.round(estimate.width * paddingFactor * 10) / 10,
      height: Math.round(estimate.height * paddingFactor * 10) / 10
    };
    
    console.log(`   📦 Category-based estimate with packaging: ${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
  }
  
  // Extract weight from content
  const weightPatterns = [
    /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
    /weight[^:]*:\s*(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
    /(\d+(?:\.\d+)?)\s*(?:kilograms?|kgs?)/i
  ];
  
  for (const pattern of weightPatterns) {
    const match = content.match(pattern);
    if (match) {
      let weight = parseFloat(match[1]);
      // Convert to pounds if needed
      if (/kg/i.test(match[0])) weight *= 2.205;
      
      productData.weight = Math.round(weight * 10) / 10;
      console.log(`   ⚖️ Extracted weight: ${productData.weight} lbs`);
      break;
    }
  }
  
  return productData;
}

// Enhanced product scraping with three-tier system
async function scrapeProductEnhanced(url) {
  const retailer = detectRetailer(url);
  console.log(`🕷️ Enhanced scraping for ${retailer}: ${url.substring(0, 60)}...`);
  
  let product = null;
  let method = 'none';
  let confidence = 0;
  
  try {
    // Tier 1: Try Zyte first (fastest, most reliable)
    if (zyteScraper && zyteScraper.enabled) {
      try {
        console.log('   🎯 Trying Zyte API...');
        product = await zyteScraper.scrapeProduct(url);
        method = 'zyte';
        confidence = product.confidence || 0.8;
        
        // Record success for adaptive learning
        await adaptiveScraper.recordScrapingAttempt(url, retailer, true, product);
        
        console.log(`   ✅ Zyte success (confidence: ${(confidence * 100).toFixed(0)}%)`);
      } catch (error) {
        console.log(`   ❌ Zyte failed: ${error.message}`);
        await adaptiveScraper.recordScrapingAttempt(url, retailer, false, null, ['zyte_failed']);
      }
    }
    
    // Tier 2: Try GPT parsing if Zyte failed
    if (!product) {
      try {
        console.log('   🤖 Trying GPT parsing...');
        product = await parseWithGPT(url);
        method = 'gpt';
        confidence = 0.7;
        
        // Record success
        await adaptiveScraper.recordScrapingAttempt(url, retailer, true, product);
        
        console.log('   ✅ GPT parsing success');
      } catch (error) {
        console.log(`   ❌ GPT parsing failed: ${error.message}`);
        await adaptiveScraper.recordScrapingAttempt(url, retailer, false, null, ['gpt_failed']);
      }
    }
    
    // Tier 3: Manual content prompt for blocked sites
    if (!product) {
      console.log('   📝 Both automated methods failed - requesting manual content');
      
      // Check if this is a known blocked retailer
      const blockedRetailers = ['Crate & Barrel', 'CB2', 'West Elm', 'Pottery Barn'];
      const isBlocked = blockedRetailers.includes(retailer);
      
      return {
        requiresManualContent: true,
        url: url,
        retailer: retailer,
        isBlocked: isBlocked,
        message: isBlocked 
          ? `${retailer} blocks automated scraping. Please copy and paste the product page content.`
          : 'Automated scraping failed. Please copy and paste the product page content.',
        method: 'manual_required',
        confidence: 0
      };
    }
    
    // Enhance product with smart estimates if needed
    if (product && !product.dimensions) {
      console.log('   📐 No dimensions found, using smart estimation...');
      
      const category = categorizeProduct(product.name, url);
      const smartEstimate = await bolHistory.getSmartEstimate(product.name, category, retailer);
      
      if (smartEstimate && smartEstimate.confidence > 0.5) {
        product.dimensions = smartEstimate.dimensions;
        product.weight = estimateWeight(product.dimensions, category);
        product.estimationSource = `BOL data (${smartEstimate.samples} samples, ${(smartEstimate.confidence * 100).toFixed(0)}% confidence)`;
        console.log(`   🎯 Applied BOL-based estimate: ${smartEstimate.reasoning}`);
      } else {
        product.dimensions = estimateDimensions(category, product.name);
        product.weight = estimateWeight(product.dimensions, category);
        product.estimationSource = `Category-based estimate (${category})`;
        console.log(`   📦 Applied category-based estimate for: ${category}`);
      }
    }
    
    // Calculate shipping cost
    if (product && product.dimensions) {
      product.shippingCost = calculateShippingCost(
        product.dimensions,
        product.weight || estimateWeight(product.dimensions, categorizeProduct(product.name, url)),
        product.price || 100
      );
    }
    
    // Add metadata
    product.method = method;
    product.confidence = confidence;
    product.retailer = retailer;
    product.url = url;
    
    return product;
    
  } catch (error) {
    console.error('❌ Enhanced scraping failed:', error);
    
    // Record failure
    await adaptiveScraper.recordScrapingAttempt(url, retailer, false, null, ['enhanced_scraping_failed']);
    
    throw error;
  }
}

// Main product scraping function
async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  
  let productData = null;
  let scrapingMethod = 'none';
  let confidence = null;
  
  console.log(`\n📦 Processing: ${url}`);
  console.log(`   Retailer: ${retailer}`);
  
  // STEP 1: Try Zyte API first
  try {
    console.log('   🕷️ Using Zyte API...');
    productData = await zyteScraper.scrapeProduct(url);
    confidence = productData?.confidence || null;
    scrapingMethod = 'zyte';
    
    if (confidence !== null) {
      console.log(`   📊 Zyte confidence: ${(confidence * 100).toFixed(1)}%`);
    }
    
    // Check if we got essential data - name AND price are required
    const hasEssentialData = productData && productData.name && productData.price;
    
    // Check if confidence is too low (likely blocked/failed)
    const lowConfidence = confidence !== null && confidence < CONFIDENCE_THRESHOLD;
    
    if (!hasEssentialData || lowConfidence) {
      if (!hasEssentialData) {
        console.log(`   ⚠️ Missing essential data (name: ${!!productData?.name}, price: ${!!productData?.price}), trying GPT fallback...`);
      }
      if (lowConfidence) {
        console.log(`   ⚠️ Low confidence (${(confidence * 100).toFixed(1)}% < ${CONFIDENCE_THRESHOLD * 100}%), trying GPT fallback...`);
      }
      throw new Error(`Zyte failed: ${!hasEssentialData ? 'missing essential data' : 'low confidence'}`);
    }
    
    console.log('   ✅ Zyte API success with good confidence');
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
      return {
        id: productId,
        url: url,
        name: productData.name,
        price: productData.price,
        image: productData.image,
        category: category,
        retailer: retailer,
        dimensions: productData.dimensions,
        weight: productData.weight,
        shippingCost: 0,
        scrapingMethod: 'ikea-components-required',
        confidence: confidence,
        variant: productData.variant,
        ikeaComponentsRequired: true,
        estimatedComponents: needsComponents.count,
        componentType: needsComponents.type,
        message: `This IKEA ${needsComponents.type} likely ships in ${needsComponents.count} separate packages. Please check "What's included" and provide URLs for each component.`,
        dataCompleteness: {
          hasName: !!productData.name,
          hasImage: !!productData.image,
          hasDimensions: !!productData.dimensions,
          hasWeight: !!productData.weight,
          hasPrice: !!productData.price,
          hasVariant: !!productData.variant
        }
      };
    }
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
  const productName = (productData && productData.name) || `Product from ${retailer}`;
  const productCategory = productData?.category || categorizeProduct(productName, url);
  // Handle category - safely convert object to string if needed
  let category = null;
  if (productData && productData.category) {
    category = productData.category;
  }
  if (typeof category === 'object' && category.name) {
    category = category.name; // Extract string from Zyte category object
  }
  if (!category || typeof category !== 'string') {
    category = categorizeProduct(productName, url);
  }
  
  console.log(`   📂 Final category: "${category}"`);
  
  if (!productData || !productData.dimensions) {
  }
  if (productData && productData.name && (!productData.dimensions || dimensionsLookSuspicious(productData.dimensions))) {
    console.log('   📚 Checking BOL historical data...');
    
    const bolEstimate = await bolHistory.getSmartEstimate(productData.name, category, retailer);
    
    if (bolEstimate && bolEstimate.confidence > 0.5) {
      console.log(`   ✅ BOL History match! (confidence: ${(bolEstimate.confidence * 100).toFixed(0)}%)`);
      console.log(`   📊 Based on ${bolEstimate.samples || 'multiple'} historical shipments`);
      console.log(`   📏 Historical dimensions: ${bolEstimate.dimensions.length}" × ${bolEstimate.dimensions.width}" × ${bolEstimate.dimensions.height}"`);
      
      // Use BOL data
      productData.dimensions = bolEstimate.dimensions;
      if (bolEstimate.weight && !productData.weight) {
        productData.weight = bolEstimate.weight;
      }
      
      // Update scraping method
      if (scrapingMethod === 'zyte') {
        scrapingMethod = 'zyte+bol-history';
      } else if (scrapingMethod === 'gpt-fallback') {
        scrapingMethod = 'gpt+bol-history';
      } else {
        scrapingMethod = 'bol-history';
      }
    } else {
      console.log('   ⚠️ No strong BOL history match, trying UPCitemdb...');
      
      // STEP 4: UPCitemdb lookup (you're paying for it, so use it!)
      const upcDimensions = await getUPCDimensions(productData.name);
      if (upcDimensions) {
        productData.dimensions = upcDimensions;
        console.log('   ✅ UPCitemdb provided accurate dimensions');
        
        if (scrapingMethod === 'zyte') {
          scrapingMethod = 'zyte+upcitemdb';
        } else if (scrapingMethod === 'gpt-fallback') {
          scrapingMethod = 'gpt+upcitemdb';
        } else {
          scrapingMethod = 'upcitemdb';
        }
      } else {
        console.log('   ❌ UPCitemdb found no dimensions, will use BOL category patterns...');
        
        // STEP 5: BOL category-level fallback
        const categoryEstimate = await bolHistory.getSmartEstimate('', category, retailer);
        if (categoryEstimate && categoryEstimate.dimensions) {
          productData.dimensions = categoryEstimate.dimensions;
          console.log('   📐 Using BOL category-level dimension estimate');
          scrapingMethod = scrapingMethod === 'none' ? 'bol-category-estimate' : scrapingMethod + '+bol-estimate';
        }
      }
    }
  }
  
  // STEP 6: Smart UPCitemdb lookup for missing data (even if BOL found dimensions)
  if (productData && productData.name && dimensionsLookSuspicious(productData ? productData.dimensions : null)) {
    const upcDimensions = await getUPCDimensions(productData.name);
    if (upcDimensions) {
      productData.dimensions = upcDimensions;
      console.log('   ✅ UPCitemdb override - provided more accurate dimensions');
      
      if (scrapingMethod === 'zyte') {
        scrapingMethod = 'zyte+upcitemdb';
      } else if (scrapingMethod === 'gpt-fallback') {
        scrapingMethod = 'gpt+upcitemdb';
      } else {
        scrapingMethod = scrapingMethod + '+upcitemdb';
      }
    }
  }
  
  // STEP 3.5: IKEA Multi-Box Estimation
  if (retailer === 'IKEA' && productData && productData.dimensions && productData.name && productData.price) {
    const ikeaEstimate = estimateIkeaMultiBoxShipping(productData.dimensions, productData.name, productData.price);
    
    if (ikeaEstimate.boxCount > 1) {
      productData.dimensions = ikeaEstimate.dimensions;
      productData.ikeaMultiBox = {
        estimatedBoxes: ikeaEstimate.boxCount,
        confidence: ikeaEstimate.confidence,
        singleBoxVolume: ikeaEstimate.singleBoxVolume,
        totalVolume: ikeaEstimate.totalVolume
      };
      
      if (scrapingMethod.includes('upcitemdb')) {
        scrapingMethod = scrapingMethod + '+ikea-multibox';
      } else {
        scrapingMethod = scrapingMethod + '+ikea-multibox';
      }
      
      console.log(`   🎯 Applied IKEA multi-box estimation (${ikeaEstimate.confidence} confidence)`);
    }
  }
  
  // STEP 7: Final fallback - intelligent estimation
  if (!productData || !productData.dimensions) {
    // Try BOL category patterns one more time
    const categoryEstimate = await bolHistory.getSmartEstimate('', category, retailer);
    
    if (categoryEstimate && categoryEstimate.dimensions) {
      productData.dimensions = categoryEstimate.dimensions;
      console.log('   📐 Using BOL category-level dimension estimate');
      scrapingMethod = scrapingMethod === 'none' ? 'bol-category-estimate' : scrapingMethod + '+bol-estimate';
    } else {
      // Final fallback to basic estimation
      const estimatedDimensions = estimateDimensions(category, productName);
      if (productData) {
        productData.dimensions = estimatedDimensions;
      } else {
        productData = { dimensions: estimatedDimensions };
      }
      if (!productData) productData = {};
      productData.dimensions = estimateDimensions(productCategory, productName);
      console.log('   📐 Estimated dimensions based on category:', productCategory);
      if (scrapingMethod === 'none') {
        scrapingMethod = 'estimation';
      }
    }
  }
  
  if (!productData || !productData.weight) {
    if (!productData) productData = {};
    const estimatedWeight = estimateWeight(productData.dimensions, category);
    if (productData) {
      productData.weight = estimatedWeight;
    } else {
      productData = { ...productData, weight: estimatedWeight };
    }
    productData.weight = estimateWeight(productData.dimensions, productCategory);
    console.log('   ⚖️ Estimated weight based on dimensions');
  }
  
  // Calculate shipping cost
  const shippingCost = calculateShippingCost(
    productData.dimensions,
    productData.weight,
    (productData && productData.price) ? productData.price : 100
  );
  
  // Prepare final product object
  const product = {
    id: productId,
    url: url,
    name: productName,
    price: (productData && productData.price) ? productData.price : null,
    image: (productData && productData.image) ? productData.image : 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=SDL',
    category: productCategory,
    retailer: retailer,
    dimensions: productData.dimensions,
    weight: productData.weight,
    shippingCost: shippingCost,
    scrapingMethod: scrapingMethod,
    confidence: confidence,
    variant: (productData && productData.variant) ? productData.variant : null,
    dataCompleteness: {
      hasName: !!(productData && productData.name),
      hasImage: !!(productData && productData.image),
      hasDimensions: !!(productData && productData.dimensions),
      hasWeight: !!(productData && productData.weight),
      hasPrice: !!(productData && productData.price),
      hasVariant: !!(productData && productData.variant),
      hasBOLHistory: scrapingMethod.includes('bol'),
      hasUPCitemdb: scrapingMethod.includes('upcitemdb')
    }
  };
  
  console.log(`   💰 Shipping cost: $${shippingCost}`);
  console.log(`   📊 Data source: ${scrapingMethod}`);
  if (confidence !== null) {
    console.log(`   🎯 Confidence: ${(confidence * 100).toFixed(1)}%`);
  }
  if (scrapingMethod.includes('bol')) {
    console.log(`   📚 Enhanced with BOL historical data`);
  }
  if (scrapingMethod.includes('upcitemdb')) {
    console.log(`   💎 Enhanced with UPCitemdb data`);
  }
  console.log(`   ✅ Product processed\n`);

  return product;
}

// Batch processing with concurrency control
async function processBatch(urls, batchSize = MAX_CONCURRENT) {
  const results = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
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
    results.push(...batchResults);
  }
  return results;
}

// API endpoint for scraping
app.post('/api/scrape', async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'No URLs provided' });
    }
    
    // Check for SDL domains
    const sdlUrls = urls.filter(url => isSDLDomain(url));
    if (sdlUrls.length > 0) {
      return res.status(400).json({ 
        error: 'SDL domain detected. This calculator is for importing products from other retailers.' 
      });
    }
    
    console.log(`\n🚀 Starting batch scrape for ${urls.length} products...`);
    
    const products = await processBatch(urls);
    console.log(`\n✅ Completed scraping ${products.length} products\n`);
    
    res.json({ 
      products
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape products' });
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
          variant: gptData.variant
        };
        
        // Fill in missing data with estimations
        if (!productData.dimensions) {
          productData.dimensions = estimateDimensions(category, productData.name);
        }
        
        // Smart UPCitemdb lookup for manual entry too
        if (productData.name && dimensionsLookSuspicious(productData.dimensions)) {
          console.log('   🔍 Checking UPCitemdb for manual entry dimensions...');
          const upcDimensions = await getUPCDimensions(productData.name);
          if (upcDimensions) {
            productData.dimensions = upcDimensions;
            console.log('   ✅ UPCitemdb provided dimensions for manual entry');
          }
        }
        
        if (!productData.weight) {
          productData.weight = estimateWeight(productData.dimensions, category);
        }
        
        const shippingCost = calculateShippingCost(
          productData.dimensions,
          productData.weight,
          productData.price
        );
        
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
          shippingCost: shippingCost,
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
  if (!orderTracker) {
    return res.status(500).json({ error: 'Order tracking not available' });
  }
  
  const { orderId } = req.params;
  const { retailerOrders } = req.body;
  
  const result = await orderTracker.startTracking(orderId, retailerOrders);
  res.json(result);
});

app.get('/api/orders/:orderId/tracking-status', async (req, res) => {
  if (!orderTracker) {
    return res.status(500).json({ error: 'Order tracking not available' });
  }
  
  const { orderId } = req.params;
  const status = await orderTracker.getTrackingStatus(orderId);
  res.json(status);
});

app.post('/api/orders/:orderId/stop-tracking', async (req, res) => {
  if (!orderTracker) {
    return res.status(500).json({ error: 'Order tracking not available' });
  }
  
  const { orderId } = req.params;
  const result = await orderTracker.stopTracking(orderId);
  res.json(result);
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
    
    // Create line items for the draft order
    const lineItems = [];
    
    // Add each product as a line item
    products.forEach(product => {
      if (product.price && product.price > 0) {
        lineItems.push({
          title: product.name,
          price: product.price.toFixed(2),
          quantity: 1,
          properties: [
            { name: 'Source URL', value: product.url },
            { name: 'Retailer', value: product.retailer },
            { name: 'Category', value: product.category }
          ]
        });
      }
    });
    
    // Add duty as a line item
    if (totals.dutyAmount > 0) {
      lineItems.push({
        title: 'Bermuda Duty + Wharfage (26.5%)',
        price: totals.dutyAmount.toFixed(2),
        quantity: 1,
        taxable: false
      });
    }
    
    // Add delivery fees as line items
    Object.entries(deliveryFees).forEach(([vendor, fee]) => {
      if (fee > 0) {
        lineItems.push({
          title: `${vendor} US Delivery Fee`,
          price: fee.toFixed(2),
          quantity: 1,
          taxable: false
        });
      }
    });
    
    // Add shipping cost as a line item
    if (totals.totalShippingCost > 0) {
      lineItems.push({
        title: 'Shipping & Handling to Bermuda',
        price: (totals.shippingCost || totals.totalShippingCost || 0).toFixed(2),
        quantity: 1,
        taxable: false
      });
    }
    
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

// Add API endpoint to view BOL statistics
app.get('/api/bol-stats', async (req, res) => {
  await bolHistory.initialize();
  
  const stats = {
    initialized: bolHistory.initialized,
    totalPatterns: bolHistory.volumePatterns.size,
    productKeywords: bolHistory.productPatterns.size,
    categories: {}
  };
  
  // Get category breakdown
  bolHistory.volumePatterns.forEach((volumeStats, category) => {
    stats.categories[category] = {
      samples: volumeStats.count,
      avgVolume: volumeStats.average.toFixed(2) + ' ft³',
      range: `${volumeStats.min.toFixed(1)}-${volumeStats.max.toFixed(1)} ft³`
    };
  });
  
  res.json(stats);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📍 Admin Panel: http://localhost:${PORT}/admin (admin:1064)`);
});