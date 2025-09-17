const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const ApifyScraper = require('./apifyScraper');
require('dotenv').config();
const UPCItemDB = require('./upcitemdb');
// const learningSystem = require('./learningSystem');  // TODO: Re-enable with PostgreSQL later

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';

// Enhanced UPCitemdb API key detection
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY || 
                         process.env.UPC_ITEMDB_API_KEY || 
                         process.env.UPCITEMDB_KEY || '';

console.log('🔍 Environment Variable Debug:');
console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`   UPCITEMDB_API_KEY exists: ${!!process.env.UPCITEMDB_API_KEY}`);
console.log(`   UPCITEMDB_API_KEY length: ${process.env.UPCITEMDB_API_KEY ? process.env.UPCITEMDB_API_KEY.length : 0}`);
console.log(`   UPCITEMDB_API_KEY preview: ${process.env.UPCITEMDB_API_KEY ? process.env.UPCITEMDB_API_KEY.substring(0, 8) + '...' : 'undefined'}`);

const upcItemDB = new UPCItemDB(UPCITEMDB_API_KEY);
const USE_UPCITEMDB = !!UPCITEMDB_API_KEY;
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const SCRAPING_TIMEOUT = 15000;  // 15 seconds timeout
const MAX_CONCURRENT_SCRAPES = 2;
const BERMUDA_DUTY_RATE = 0.265;
const USE_SCRAPINGBEE = !!SCRAPINGBEE_API_KEY;
const SHIPPING_RATE_PER_CUBIC_FOOT = 15; // $15 per cubic foot - more realistic for ocean freight
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sdl2024admin';

// Initialize Apify scraper
const apifyScraper = new ApifyScraper(APIFY_API_KEY);
const USE_APIFY = apifyScraper.isAvailable();

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Apify - ${USE_APIFY ? '✅ ENABLED (Specialized Actors)' : '❌ DISABLED (Missing API Key)'}`);
console.log(`2. Fallback: ScrapingBee - ${USE_SCRAPINGBEE ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log(`3. Basic Scraper - ✅ ENABLED (Always Available)`);
console.log(`4. Dimension Data: UPCitemdb - ${USE_UPCITEMDB ? '✅ ENABLED (Key: ' + UPCITEMDB_API_KEY.substring(0, 8) + '...)' : '❌ DISABLED (Missing API Key)'}`);
console.log('');
console.log('📊 SCRAPING STRATEGY:');
if (USE_APIFY && USE_SCRAPINGBEE && USE_UPCITEMDB) {
  console.log('✅ OPTIMAL: Specialized Apify Actors → ScrapingBee → UPCitemdb → AI Estimation');
} else if (USE_APIFY && USE_SCRAPINGBEE) {
  console.log('✅ OPTIMAL: Apify → ScrapingBee → Basic → UPCitemdb → AI Estimation');
} else if (USE_APIFY && USE_SCRAPINGBEE) {
  console.log('⚠️  GOOD: Specialized Apify Actors → ScrapingBee → AI Estimation (No UPCitemdb)');
} else if (USE_APIFY && !USE_SCRAPINGBEE) {
  console.log('⚠️  LIMITED: Specialized Apify Actors → AI Estimation (No ScrapingBee fallback)');
} else if (!USE_APIFY && USE_SCRAPINGBEE) {
  console.log('⚠️  LIMITED: ScrapingBee → Basic → AI Estimation (No Apify primary)');
} else {
  console.log('❌ MINIMAL: Basic → AI Estimation only (No premium scrapers configured)');
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
      basic: 'Always Available',
      dimensions: USE_UPCITEMDB ? 'UPCitemdb' : 'None',
      strategy: USE_APIFY && USE_SCRAPINGBEE && USE_UPCITEMDB ? 'Optimal' : 
                USE_APIFY && USE_SCRAPINGBEE ? 'Good' :
                USE_APIFY || USE_SCRAPINGBEE ? 'Limited' : 'Minimal'
    },
    shopifyConfigured: !!SHOPIFY_ACCESS_TOKEN
  });
});

// Test endpoint for UPCitemdb
app.get('/test-upc', async (req, res) => {
  console.log('🧪 UPCitemdb test endpoint called');
  console.log(`   API Key available: ${!!UPCITEMDB_API_KEY}`);
  console.log(`   UPCitemdb enabled: ${USE_UPCITEMDB}`);
  
  if (!USE_UPCITEMDB) {
    return res.json({ 
      success: false, 
      message: 'UPCitemdb not configured',
      debug: {
        apiKeySet: !!UPCITEMDB_API_KEY,
        apiKeyLength: UPCITEMDB_API_KEY ? UPCITEMDB_API_KEY.length : 0,
        environmentCheck: process.env.UPCITEMDB_API_KEY ? 'SET' : 'NOT SET'
      }
    });
  }
  
  try {
    const testProduct = await upcItemDB.searchByName('Apple iPhone 15 Pro');
    res.json({
      success: true,
      testProduct: testProduct,
      message: testProduct ? 'UPCitemdb is working!' : 'UPCitemdb connected but no results for test query'
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
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
          createOrder: 'POST /apps/instant-import/create-draft-order',
          testUpc: '/test-upc'
        }
      });
    }
  });
});

// Admin route
app.get('/admin', (req, res) => {
  // Check for basic auth
  const auth = req.headers.authorization;
  
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="SDL Admin Access"');
    return res.status(401).send('Authentication required');
  }
  
  // Decode basic auth
  const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  const username = credentials[0];
  const password = credentials[1];
  
  // Check credentials (username: admin, password from env)
  if (username !== 'admin' || password !== ADMIN_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="SDL Admin Access"');
    return res.status(401).send('Invalid credentials');
  }
  
  // Serve admin page if authenticated
  const adminPath = path.join(__dirname, '../frontend', 'admin.html');
  res.sendFile(adminPath, (err) => {
    if (err) {
      console.error('Error serving admin page:', err);
      res.status(404).send('Admin page not found');
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

// Admin authentication middleware
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="SDL Admin"');
    return res.status(401).send('Authentication required');
  }
  
  const credentials = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  const username = credentials[0];
  const password = credentials[1];
  
  const adminPassword = process.env.ADMIN_PASSWORD || 'sdl2024admin';
  
  if (username === 'admin' && password === adminPassword) {
    console.log('✅ Admin authenticated successfully');
    next();
  } else {
    console.log('❌ Admin authentication failed');
    res.setHeader('WWW-Authenticate', 'Basic realm="SDL Admin"');
    res.status(401).send('Invalid credentials');
  }
}

// Admin routes - MUST be before rate limiter and static files
app.get('/pages/imports/admin', requireAuth, (req, res) => {
  const adminPath = path.join(__dirname, '../frontend', 'admin.html');
  res.sendFile(adminPath, (err) => {
    if (err) {
      console.error('Error serving admin page:', err);
      res.status(404).send('Admin page not found');
    }
  });
});

app.get('/admin', requireAuth, (req, res) => {
  const adminPath = path.join(__dirname, '../frontend', 'admin.html');
  res.sendFile(adminPath, (err) => {
    if (err) {
      console.error('Error serving admin page:', err);
      res.status(404).send('Admin page not found');
    }
  });
});

app.get('/admin.html', requireAuth, (req, res) => {
  const adminPath = path.join(__dirname, '../frontend', 'admin.html');
  res.sendFile(adminPath, (err) => {
    if (err) {
      console.error('Error serving admin page:', err);
      res.status(404).send('Admin page not found');
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

// Apply flat-pack reduction to assembled furniture dimensions
function applyFlatPackReduction(assembledDimensions) {
  // Flat-pack reduction factors:
  // - Length: stays roughly the same (longest piece)
  // - Width: reduced significantly (pieces stacked)  
  // - Height: reduced dramatically (thin flat box)
  
  return {
    length: assembledDimensions.length * 1.0,  // No reduction - longest piece determines length
    width: assembledDimensions.width * 0.6,   // 40% reduction - pieces stacked narrower
    height: assembledDimensions.height * 0.25 // 75% reduction - flat box instead of full height
  };
}

function estimateDimensions(category, name = '') {
  const text = name.toLowerCase();
  
  // Detect multi-piece sets first
  const pieceMatch = text.match(/(\d+)\s*[-\s]*piece/i);
  const pieceCount = pieceMatch ? parseInt(pieceMatch[1]) : 1;
  
  // Check if dimensions are in the name
  const dimMatch = text.match(/(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)/);
  if (dimMatch) {
    const dims = {
      length: Math.max(1, parseFloat(dimMatch[1]) * 1.2),
      width: Math.max(1, parseFloat(dimMatch[2]) * 1.2), 
      height: Math.max(1, parseFloat(dimMatch[3]) * 1.2)
    };
    
    if (dims.length <= 120 && dims.width <= 120 && dims.height <= 120) {
      // If multi-piece, multiply total volume by piece count
      if (pieceCount > 1) {
        const volumeMultiplier = Math.sqrt(pieceCount); // Not linear - some efficiency in packing
        dims.length *= volumeMultiplier;
      }
      return dims;
    }
  }
  
  // Detect if item is flat-packed
  const isFlatPacked = detectFlatPacked(name, category);
  
  const baseEstimates = {
    'furniture': { 
      length: 48 + Math.random() * 30,  // Base furniture size
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
  
  let dimensions = {
    length: Math.round(estimate.length * 10) / 10,
    width: Math.round(estimate.width * 10) / 10,
    height: Math.round(estimate.height * 10) / 10
  };
  
  // Apply multi-piece multiplier for furniture
  if (category === 'furniture' && pieceCount > 1) {
    console.log(`   📦 Detected ${pieceCount}-piece furniture set`);
    
    // Multi-piece sets need more space - not linear scaling
    const volumeMultiplier = Math.min(pieceCount * 0.7, 4); // Cap at 4x for very large sets
    
    // Distribute the extra volume across all dimensions
    const linearMultiplier = Math.pow(volumeMultiplier, 1/3);
    dimensions.length *= linearMultiplier;
    dimensions.width *= linearMultiplier;
    dimensions.height *= linearMultiplier;
    
    console.log(`   📏 Applied ${pieceCount}-piece multiplier: ${volumeMultiplier.toFixed(2)}x volume`);
  }
  
  // Apply flat-pack reduction if detected
  if (category === 'furniture' && detectFlatPacked(name, category)) {
    dimensions = applyFlatPackReduction(dimensions, name);
  }
  
  return {
    length: Math.round(dimensions.length * 10) / 10,
    width: Math.round(dimensions.width * 10) / 10,
    height: Math.round(dimensions.height * 10) / 10
  };
}

// Detect if furniture item is flat-packed
function detectFlatPacked(productName, category) {
  if (category !== 'furniture') return false;
  
  const name = productName.toLowerCase();
  const url = ''; // We could pass URL here if needed
  
  // Flat-pack indicators
  const flatPackKeywords = [
    'assembly required', 'some assembly', 'easy assembly', 'self assembly',
    'flat pack', 'flatpack', 'flat-pack', 'unassembled',
    'diy', 'build yourself', 'assemble yourself',
    'knock down', 'rta', 'ready to assemble'
  ];
  
  // Retailers known for flat-pack
  const flatPackRetailers = [
    'ikea', 'wayfair', 'overstock', 'amazon', 'walmart'
  ];
  
  // Pre-assembled indicators  
  const preAssembledKeywords = [
    'fully assembled', 'pre-assembled', 'ready to use', 'no assembly',
    'assembled', 'delivered assembled', 'white glove', 'setup included'
  ];
  
  // Check for pre-assembled first (overrides flat-pack)
  for (const keyword of preAssembledKeywords) {
    if (name.includes(keyword)) {
      console.log(`   📦 Detected PRE-ASSEMBLED: "${keyword}"`);
      return false;
    }
  }
  
  // Check for flat-pack keywords
  for (const keyword of flatPackKeywords) {
    if (name.includes(keyword)) {
      console.log(`   📦 Detected FLAT-PACKED: "${keyword}"`);
      return true;
    }
  }
  
  // Check retailer patterns (most furniture from these is flat-packed)
  for (const retailer of flatPackRetailers) {
    if (name.includes(retailer)) {
      console.log(`   📦 Detected FLAT-PACKED retailer: "${retailer}"`);
      return true;
    }
  }
  
  // Default assumption for furniture (most modern furniture is flat-packed)
  console.log(`   📦 Default assumption: FLAT-PACKED furniture`);
  return true;
}

// Convert product dimensions to shipping box dimensions
function estimateBoxDimensions(productDimensions, category) {
  if (!productDimensions) return null;
  
  // Add realistic packaging padding based on category
  const paddingFactors = {
    'electronics': 1.25,  // Moderate padding for fragile items
    'appliances': 1.15,   // Minimal padding - usually well-packed
    'furniture': 1.05,    // Very little padding - often flat-packed
    'clothing': 1.3,      // More padding for soft goods
    'books': 1.1,         // Minimal padding
    'toys': 1.2,          // Moderate padding
    'sports': 1.15,       // Usually compact packaging
    'home-decor': 1.25,   // Moderate padding for fragile items
    'tools': 1.1,         // Usually compact
    'garden': 1.15,       // Usually efficient packaging
    'general': 1.2
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
    // No dimensions available, use 0.98x the item price
    const fallbackCost = Math.max(25, (price || 100) * 0.98);
    return fallbackCost;
  }
  
  // Calculate volume in cubic feet
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Base rate: $15 per cubic foot (increased from $8)
  const baseCost = Math.max(25, cubicFeet * 15);
  
  // Add realistic surcharges for furniture
  const oversizeFee = Math.max(dimensions.length, dimensions.width, dimensions.height) > 48 ? 75 : 0;
  const valueFee = price > 300 ? price * 0.03 : 0; // 3% for items over $300
  const handlingFee = 25; // Increased base handling
  const fuelSurcharge = baseCost * 0.15; // 15% fuel surcharge
  
  const totalCost = baseCost + oversizeFee + valueFee + handlingFee + fuelSurcharge;
  
  return Math.round(totalCost);
}

// Enhanced shipping calculation with detailed breakdown for admin
function calculateDetailedShippingCost(dimensions, weight, price, category, pieceCount = 1, isFlatPacked = false) {
  const breakdown = {
    // Dimension details
    boxDimensions: dimensions,
    cubicInches: 0,
    cubicFeet: 0,
    boxCount: pieceCount,
    
    // Cost breakdown
    baseCost: 0,
    oversizeFee: 0,
    valueFee: 0,
    handlingFee: 15,
    fuelSurcharge: 0,
    insuranceFee: 0,
    
    // Business costs (hidden from customer)
    actualShippingCost: 0,  // What we actually pay
    profitMargin: 0,        // Our markup
    cardProcessingFee: 0,   // 2.9% + $0.30
    
    // Totals
    subtotal: 0,
    customerPrice: 0
  };
  
  if (!dimensions) {
    // No dimensions - use price-based estimate
    breakdown.customerPrice = Math.max(25, price * 0.15);
    breakdown.actualShippingCost = breakdown.customerPrice * 0.6; // 40% markup
    return breakdown;
  }
  
  // Calculate volume
  breakdown.cubicInches = dimensions.length * dimensions.width * dimensions.height;
  breakdown.cubicFeet = breakdown.cubicInches / 1728;
  
  // Base cost calculation
  breakdown.baseCost = Math.max(25, breakdown.cubicFeet * 8); // $8 per cubic foot
  
  // Oversize fee
  breakdown.oversizeFee = Math.max(dimensions.length, dimensions.width, dimensions.height) > 48 ? 75 : 0;
  
  // Value-based insurance fee
  breakdown.valueFee = price > 500 ? price * 0.02 : 0;
  
  // Fuel surcharge (12% of base cost)
  breakdown.fuelSurcharge = Math.round(breakdown.baseCost * 0.12);
  
  // Insurance fee for high-value items
  breakdown.insuranceFee = price > 1000 ? Math.round(price * 0.005) : 0;
  
  // Calculate subtotal (what customer sees as "shipping")
  breakdown.subtotal = breakdown.baseCost + breakdown.oversizeFee + breakdown.valueFee + 
                      breakdown.handlingFee + breakdown.fuelSurcharge + breakdown.insuranceFee;
  
  // Our actual shipping cost (what we pay - typically 60% of what we charge)
  breakdown.actualShippingCost = Math.round(breakdown.subtotal * 0.6);
  
  // Our profit margin
  breakdown.profitMargin = breakdown.subtotal - breakdown.actualShippingCost;
  
  // Card processing fee (2.9% + $0.30 on the shipping amount)
  breakdown.cardProcessingFee = Math.round((breakdown.subtotal * 0.029) + 0.30);
  
  // Final customer price
  breakdown.customerPrice = Math.round(breakdown.subtotal);
  
  return breakdown;
}

// Calculate total order with hidden profit margin and card fees
function calculateOrderTotals(products, deliveryFees) {
  const totalProductCost = products.reduce((sum, product) => sum + (product.price || 0), 0);
  const totalShipping = products.reduce((sum, product) => sum + (product.shippingCost || 0), 0);
  const totalDelivery = Object.values(deliveryFees).reduce((sum, fee) => sum + fee, 0);
  const dutyAmount = totalProductCost * BERMUDA_DUTY_RATE;
  
  // Calculate subtotal before fees
  const subtotal = totalProductCost + dutyAmount + totalShipping + totalDelivery;
  
  // Calculate hidden fees
  const profitMargin = subtotal * 0.15; // 15% profit margin
  const cardFee = subtotal * 0.0375; // 3.75% card processing fee
  const totalHiddenFees = profitMargin + cardFee;
  
  // Hide fees in "Shipping & Handling" 
  const adjustedShipping = totalShipping + totalHiddenFees;
  
  return {
    subtotal: totalProductCost,
    dutyAmount: dutyAmount,
    totalShippingCost: Math.round(adjustedShipping), // Hidden fees included here
    totalDeliveryFees: totalDelivery,
    grandTotal: Math.round(totalProductCost + dutyAmount + adjustedShipping + totalDelivery),
    // Internal tracking (not shown to customer)
    _hiddenFees: {
      profitMargin: Math.round(profitMargin),
      cardFee: Math.round(cardFee),
      total: Math.round(totalHiddenFees)
    }
  };
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
    inStock: primary.inStock !== undefined ? primary.inStock : secondary.inStock
  };
}

// Intelligent data fusion - combines the BEST data from multiple sources
function fuseProductData(dataArray) {
  if (!dataArray || dataArray.length === 0) return null;
  
  // Filter out null/undefined data
  const validData = dataArray.filter(data => data && typeof data === 'object');
  if (validData.length === 0) return null;
  
  const fused = {
    name: null,
    price: null,
    image: null,
    dimensions: null,
    weight: null,
    brand: null,
    category: null,
    inStock: true
  };
  
  // Name: Choose the longest, most descriptive name
  const names = validData.map(d => d.name).filter(Boolean);
  if (names.length > 0) {
    fused.name = names.reduce((best, current) => 
      (current && current.length > (best?.length || 0)) ? current : best
    );
  }
  
  // Price: Use median of valid prices to avoid outliers
  const prices = validData.map(d => d.price).filter(p => p && p > 0 && p < 50000);
  if (prices.length > 0) {
    prices.sort((a, b) => a - b);
    fused.price = prices[Math.floor(prices.length / 2)];
  }
  
  // Image: Prefer non-placeholder images
  const images = validData.map(d => d.image).filter(Boolean);
  fused.image = images.find(img => !img.includes('placeholder') && !img.includes('loading')) || images[0];
  
  // Dimensions: Choose the most complete dimensions
  const dimensionsArray = validData.map(d => d.dimensions).filter(Boolean);
  if (dimensionsArray.length > 0) {
    fused.dimensions = dimensionsArray.reduce((best, current) => {
      if (!best) return current;
      if (!current) return best;
      const bestComplete = (best.length > 0 ? 1 : 0) + (best.width > 0 ? 1 : 0) + (best.height > 0 ? 1 : 0);
      const currentComplete = (current.length > 0 ? 1 : 0) + (current.width > 0 ? 1 : 0) + (current.height > 0 ? 1 : 0);
      return currentComplete > bestComplete ? current : best;
    });
  }
  
  // Weight: Choose the most realistic weight
  const weights = validData.map(d => d.weight).filter(w => w && w > 0 && w < 1000);
  if (weights.length > 0) {
    weights.sort((a, b) => a - b);
    fused.weight = weights[Math.floor(weights.length / 2)];
  }
  
  // Brand: Choose the first valid brand
  fused.brand = validData.find(d => d.brand)?.brand || null;
  
  // Category: Choose the first valid category
  fused.category = validData.find(d => d.category)?.category || null;
  
  // Stock: If any source says out of stock, consider it out of stock
  fused.inStock = validData.every(d => d.inStock !== false);
  
  console.log('   🔄 Data fusion results:', {
    sources: validData.length,
    hasName: !!fused.name,
    hasPrice: !!fused.price,
    hasImage: !!fused.image,
    hasDimensions: !!fused.dimensions,
    hasWeight: !!fused.weight
  });
  
  return fused;
}

// Basic web scraper function - NEW FALLBACK
async function scrapeWithBasicScraper(url) {
  try {
    console.log('🔧 Starting basic scraper for:', url);
    const startTime = Date.now();
    
    const response = await axios({
      method: 'GET',
      url: url,
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    const html = response.data;
    
    // Extract title
    let title = '';
    const titlePatterns = [
      /<title[^>]*>([^<]+)<\/title>/i,
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i
    ];
    
    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        title = match[1].trim().replace(/&[^;]+;/g, '').substring(0, 100);
        console.log('✅ Found title with pattern:', title.substring(0, 50));
        break;
      }
    }
    
    // Extract price with enhanced patterns
    let price = null;
    const pricePatterns = [
      /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,
      /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*\$/g,
      /price[^>]*>.*?\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi,
      /"price"[^}]*"(\d+\.?\d*)"/gi,
      /\$\s*(\d+\s*\.\s*\d{2})/g // Handle spaced decimals like "$ 123 . 45"
    ];
    
    for (const pattern of pricePatterns) {
      const matches = [...html.matchAll(pattern)];
      for (const match of matches) {
        const priceStr = match[1].replace(/[,\s]/g, '');
        const numPrice = parseFloat(priceStr);
        if (numPrice >= 1 && numPrice <= 50000) {
          price = numPrice;
          break;
        }
      }
      if (price) break;
    }
    
    // Extract image
    let image = '';
    const imagePatterns = [
      /<img[^>]*src="([^"]+)"[^>]*(?:class="[^"]*(?:product|main|primary)[^"]*"|id="[^"]*(?:product|main|primary)[^"]*")/i,
      /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i,
      /<img[^>]*src="([^"]+)"[^>]*alt="[^"]*product[^"]*"/i
    ];
    
    for (const pattern of imagePatterns) {
      const match = html.match(pattern);
      if (match && match[1] && !match[1].includes('placeholder') && !match[1].includes('loading')) {
        image = match[1];
        if (image.startsWith('//')) image = 'https:' + image;
        else if (image.startsWith('/')) image = new URL(url).origin + image;
        break;
      }
    }
    
    console.log(`   ✅ Basic scraper completed in ${Date.now() - startTime}ms`);
    
    return {
      name: title || null,
      price: price,
      image: image || null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true
    };

  } catch (error) {
    console.error('❌ Basic scraper failed:', error.message);
    throw error;
  }
}

// ScrapingBee scraping function - ENHANCED WITH AI EXTRACTION
async function scrapeWithScrapingBee(url) {
  if (!USE_SCRAPINGBEE) {
    throw new Error('ScrapingBee not configured');
  }

  try {
    console.log('🐝 Starting ScrapingBee AI extraction for:', url);
    const startTime = Date.now();
    
    // Use AI extraction for universal compatibility
    const response = await axios({
      method: 'GET',
      url: 'https://app.scrapingbee.com/api/v1/',
      params: {
        api_key: SCRAPINGBEE_API_KEY,
        url: url,
        premium_proxy: 'true',
        country_code: 'us',
        render_js: 'true',
        wait: '2000',  // Reduced wait time
        ai_extract_rules: JSON.stringify({
          price: "Product Price in USD",
          title: "Product Title or Name",
          description: "Product Description",
          dimensions: "Product Dimensions, Package Dimensions, or Size",
          weight: "Product Weight or Shipping Weight",
          brand: "Brand Name or Manufacturer",
          availability: "Stock Status or Availability",
          image: "Main Product Image URL"
        })
      },
      timeout: SCRAPING_TIMEOUT
    });

    console.log(`   ✅ ScrapingBee AI extraction completed in ${Date.now() - startTime}ms`);
    
    // Parse the AI-extracted data
    const extracted = response.data;
    
    const productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true
    };

    // Extract product name
    if (extracted.title) {
      productData.name = extracted.title.trim();
      console.log('   📝 AI extracted title:', productData.name.substring(0, 50) + '...');
    }

    // Parse the price from AI extraction - robust parsing
    if (extracted.price) {
      // Try multiple patterns to extract price
      const pricePatterns = [
        /[\$£€]?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,  // $123.45 or 123.45
        /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*[\$£€]/,  // 123.45$
        /USD\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,     // USD 123.45
        /(\d+(?:\.\d{2})?)/,                        // Just numbers
        /\$\s*(\d+\s*\.\s*\d{2})/                  // Spaced decimals
      ];
      
      for (const pattern of pricePatterns) {
        const match = extracted.price.match(pattern);
        if (match) {
          const priceStr = match[1].replace(/[,\s]/g, '');
          productData.price = parseFloat(priceStr);
          if (productData.price > 0 && productData.price < 1000000) {
            console.log('   💰 AI extracted price: $' + productData.price);
            break;
          }
        }
      }
    }

    // Parse dimensions if AI found them
    if (extracted.dimensions) {
      const dimPatterns = [
        /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
        /L:\s*(\d+(?:\.\d+)?).*W:\s*(\d+(?:\.\d+)?).*H:\s*(\d+(?:\.\d+)?)/i,
        /(\d+(?:\.\d+)?)"?\s*[WL]\s*[x×]\s*(\d+(?:\.\d+)?)"?\s*[DW]\s*[x×]\s*(\d+(?:\.\d+)?)"?\s*[HT]/i
      ];
      
      for (const pattern of dimPatterns) {
        const match = extracted.dimensions.match(pattern);
        if (match) {
          productData.dimensions = {
            length: parseFloat(match[1]),
            width: parseFloat(match[2]),
            height: parseFloat(match[3])
          };
          console.log('   📏 AI extracted dimensions:', productData.dimensions);
          break;
        }
      }
    }

    // Parse weight if AI found it
    if (extracted.weight) {
      const weightPatterns = [
        /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
        /(\d+(?:\.\d+)?)\s*(?:kilograms?|kgs?)/i,
        /(\d+(?:\.\d+)?)\s*(?:ounces?|oz)/i
      ];
      
      for (const pattern of weightPatterns) {
        const match = extracted.weight.match(pattern);
        if (match) {
          let weight = parseFloat(match[1]);
          // Convert to pounds if needed
          if (/kg/i.test(extracted.weight)) weight *= 2.205;
          if (/oz/i.test(extracted.weight)) weight *= 0.0625;
          
          productData.weight = Math.round(weight * 10) / 10;
          console.log('   ⚖️ AI extracted weight:', productData.weight + ' lbs');
          break;
        }
      }
    }

    // Extract brand
    if (extracted.brand) {
      productData.brand = extracted.brand.trim();
    }

    // Extract image URL
    if (extracted.image) {
      productData.image = extracted.image;
    }

    // Check availability
    if (extracted.availability) {
      const outOfStockKeywords = /out of stock|unavailable|sold out|not available/i;
      productData.inStock = !outOfStockKeywords.test(extracted.availability);
    }

    console.log('📦 ScrapingBee AI results:', {
      hasName: !!productData.name,
      hasPrice: !!productData.price,
      hasImage: !!productData.image,
      hasDimensions: !!productData.dimensions,
      hasWeight: !!productData.weight
    });

    return productData;

  } catch (error) {
    console.error('❌ ScrapingBee AI extraction failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      if (error.response.status === 400) {
        console.error('Bad Request - Check API key and parameters');
      }
    }
    throw error;
  }
}

// Main product scraping function
async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  
  console.log(`\n📦 Processing: ${url}`);
  console.log(`   Retailer: ${retailer}`);
  console.log('   🚀 Starting parallel multi-source scraping...');
  
  const startTime = Date.now();
  const scrapingPromises = [];
  const scrapingMethods = [];
  
  // Launch all scrapers in parallel for maximum speed and accuracy
  if (USE_APIFY) {
    scrapingPromises.push(
      Promise.resolve().then(() => apifyScraper.scrapeProduct(url))
        .then(data => ({ source: 'apify', data, success: true }))
        .catch(error => ({ source: 'apify', error: error.message, success: false }))
    );
    scrapingMethods.push('apify');
  }
  
  if (USE_SCRAPINGBEE) {
    scrapingPromises.push(
      Promise.resolve().then(() => scrapeWithScrapingBee(url))
        .then(data => ({ source: 'scrapingbee', data, success: true }))
        .catch(error => ({ source: 'scrapingbee', error: error.message, success: false }))
    );
    scrapingMethods.push('scrapingbee');
  }
  
  // Always include basic scraper as fallback
  scrapingPromises.push(
    Promise.resolve().then(() => scrapeWithBasicScraper(url))
      .then(data => ({ source: 'basic', data, success: true }))
      .catch(error => ({ source: 'basic', error: error.message, success: false }))
  );
  scrapingMethods.push('basic');
  
  // UPCitemdb lookup (if available)
  if (USE_UPCITEMDB) {
    scrapingPromises.push(
      Promise.resolve().then(async () => {
        // Extract potential product name from URL for UPC search
        const urlParts = url.split('/').pop().split('-').join(' ');
        return await upcItemDB.searchByName(urlParts);
      })
      .then(data => ({ source: 'upcitemdb', data, success: true }))
      .catch(error => ({ source: 'upcitemdb', error: error.message, success: false }))
    );
    scrapingMethods.push('upcitemdb');
  }
  
  console.log(`   🔄 Launching ${scrapingPromises.length} scrapers: ${scrapingMethods.join(', ')}`);
  
  // Wait for all scrapers to complete (or timeout)
  const results = await Promise.allSettled(scrapingPromises.map(p => 
    Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), SCRAPING_TIMEOUT))
    ])
  ));
  
  console.log(`   ⏱️  All scrapers completed in ${Date.now() - startTime}ms`);
  
  // Process results
  const successfulResults = [];
  const failedResults = [];
  
  results.forEach((result, index) => {
    const method = scrapingMethods[index];
    if (result.status === 'fulfilled' && result.value.success) {
      console.log(`   ✅ ${method}: SUCCESS`);
      successfulResults.push(result.value);
    } else {
      const error = result.status === 'rejected' ? result.reason.message : result.value.error;
      console.log(`   ❌ ${method}: FAILED - ${error}`);
      failedResults.push({ method, error });
    }
  });
  
  if (successfulResults.length === 0) {
    throw new Error(`All scraping methods failed: ${failedResults.map(f => `${f.method}: ${f.error}`).join(', ')}`);
  }
  
  // Fuse data from all successful sources
  const dataArray = successfulResults.map(r => r.data).filter(Boolean);
  let productData = fuseProductData(dataArray);
  
  if (!productData) {
    throw new Error('No valid product data extracted from any source');
  }
  
  // Categorize product
  const category = categorizeProduct(productData.name || '', url);
  productData.category = category;
  
  // Estimate missing dimensions
  if (!productData.dimensions) {
    console.log('   📏 No dimensions found - using AI estimation');
    productData.dimensions = estimateDimensions(category, productData.name);
  }
  
  // Estimate missing weight
  if (!productData.weight && productData.dimensions) {
    productData.weight = estimateWeight(productData.dimensions, category);
  }
  
  // Calculate shipping box dimensions
  const boxDimensions = estimateBoxDimensions(productData.dimensions, category);
  
  // Calculate shipping cost
  const shippingCost = calculateShippingCost(boxDimensions, productData.weight, productData.price);
  
  // Build final product object
  const finalProduct = {
    id: productId,
    url: url,
    retailer: retailer,
    name: productData.name || 'Unknown Product',
    price: productData.price || 0,
    image: productData.image || '/placeholder-image.jpg',
    category: category,
    brand: productData.brand || null,
    inStock: productData.inStock !== false,
    
    // Dimensions and shipping
    dimensions: productData.dimensions,
    boxDimensions: boxDimensions,
    weight: productData.weight || estimateWeight(productData.dimensions || { length: 12, width: 12, height: 12 }, category),
    shippingCost: shippingCost,
    
    // Metadata
    scrapedAt: new Date().toISOString(),
    scrapingMethods: successfulResults.map(r => r.source),
    dataQuality: isDataComplete(productData) ? 'complete' : 'partial'
  };
  
  console.log(`   ✅ Product processed successfully:`);
  console.log(`      Name: ${finalProduct.name.substring(0, 50)}...`);
  console.log(`      Price: $${finalProduct.price}`);
  console.log(`      Category: ${finalProduct.category}`);
  console.log(`      Dimensions: ${finalProduct.dimensions?.length}×${finalProduct.dimensions?.width}×${finalProduct.dimensions?.height}`);
  console.log(`      Shipping: $${finalProduct.shippingCost}`);
  console.log(`      Data Quality: ${finalProduct.dataQuality}`);
  console.log(`      Sources: ${finalProduct.scrapingMethods.join(', ')}`);
  
  return finalProduct;
}

// API Routes

// Scrape product endpoint
app.post('/api/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    // Block SDL domains
    if (isSDLDomain(url)) {
      return res.status(400).json({ 
        error: 'Cannot import from Spencer Deals Ltd domains',
        blocked: true 
      });
    }
    
    console.log(`\n🔍 API Request: Scraping ${url}`);
    
    const product = await scrapeProduct(url);
    
    res.json({
      success: true,
      product: product,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Create draft order endpoint
app.post('/apps/instant-import/create-draft-order', async (req, res) => {
  try {
    const { products, customerInfo, deliveryFees } = req.body;
    
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Products array is required' });
    }
    
    if (!customerInfo || !customerInfo.email) {
      return res.status(400).json({ error: 'Customer email is required' });
    }
    
    console.log(`\n📝 Creating draft order for ${customerInfo.email} with ${products.length} products`);
    
    // Calculate totals
    const totals = calculateOrderTotals(products, deliveryFees || {});
    
    // Prepare line items for Shopify
    const lineItems = products.map(product => ({
      title: product.name,
      price: product.price.toString(),
      quantity: 1,
      requires_shipping: true,
      taxable: false,
      properties: [
        { name: 'Original URL', value: product.url },
        { name: 'Retailer', value: product.retailer },
        { name: 'Category', value: product.category },
        { name: 'Dimensions', value: `${product.dimensions?.length || 0}" × ${product.dimensions?.width || 0}" × ${product.dimensions?.height || 0}"` },
        { name: 'Weight', value: `${product.weight || 0} lbs` },
        { name: 'Shipping Cost', value: `$${product.shippingCost || 0}` }
      ]
    }));
    
    // Add duty as a line item
    if (totals.dutyAmount > 0) {
      lineItems.push({
        title: 'Bermuda Import Duty (26.5%)',
        price: totals.dutyAmount.toString(),
        quantity: 1,
        requires_shipping: false,
        taxable: false
      });
    }
    
    // Add shipping as a line item
    if (totals.totalShippingCost > 0) {
      lineItems.push({
        title: 'Shipping & Handling',
        price: totals.totalShippingCost.toString(),
        quantity: 1,
        requires_shipping: false,
        taxable: false
      });
    }
    
    // Add delivery fees
    if (totals.totalDeliveryFees > 0) {
      lineItems.push({
        title: 'Local Delivery',
        price: totals.totalDeliveryFees.toString(),
        quantity: 1,
        requires_shipping: false,
        taxable: false
      });
    }
    
    // Create draft order in Shopify
    const draftOrder = {
      draft_order: {
        line_items: lineItems,
        customer: {
          email: customerInfo.email,
          first_name: customerInfo.firstName || '',
          last_name: customerInfo.lastName || '',
          phone: customerInfo.phone || ''
        },
        shipping_address: customerInfo.shippingAddress ? {
          first_name: customerInfo.firstName || '',
          last_name: customerInfo.lastName || '',
          address1: customerInfo.shippingAddress.address1 || '',
          address2: customerInfo.shippingAddress.address2 || '',
          city: customerInfo.shippingAddress.city || '',
          province: customerInfo.shippingAddress.province || '',
          country: customerInfo.shippingAddress.country || 'BM',
          zip: customerInfo.shippingAddress.zip || ''
        } : null,
        note: `Instant Import Order - ${products.length} products imported`,
        tags: 'instant-import',
        use_customer_default_address: false
      }
    };
    
    // Send to Shopify
    const shopifyResponse = await axios.post(
      `https://${SHOPIFY_DOMAIN}/admin/api/2023-10/draft_orders.json`,
      draftOrder,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const createdOrder = shopifyResponse.data.draft_order;
    
    console.log(`✅ Draft order created: #${createdOrder.name} ($${totals.grandTotal})`);
    
    res.json({
      success: true,
      draftOrder: {
        id: createdOrder.id,
        name: createdOrder.name,
        total: totals.grandTotal,
        invoiceUrl: createdOrder.invoice_url,
        adminUrl: `https://${SHOPIFY_DOMAIN}/admin/draft_orders/${createdOrder.id}`
      },
      totals: totals,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Draft order creation failed:', error.message);
    if (error.response) {
      console.error('Shopify API Error:', error.response.data);
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Admin endpoint to get detailed shipping breakdown
app.post('/api/admin/shipping-breakdown', requireAuth, async (req, res) => {
  try {
    const { products } = req.body;
    
    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ error: 'Products array is required' });
    }
    
    const breakdowns = products.map(product => {
      const breakdown = calculateDetailedShippingCost(
        product.boxDimensions || product.dimensions,
        product.weight,
        product.price,
        product.category,
        1, // piece count
        false // flat packed
      );
      
      return {
        productId: product.id,
        productName: product.name,
        breakdown: breakdown
      };
    });
    
    res.json({
      success: true,
      breakdowns: breakdowns,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Shipping breakdown failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Catch-all route for frontend
app.get('*', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend', 'index.html');
  res.sendFile(frontendPath, (err) => {
    if (err) {
      res.status(404).send('Page not found');
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔧 Admin: http://localhost:${PORT}/admin (admin:${ADMIN_PASSWORD})`);
  console.log(`💊 Health: http://localhost:${PORT}/health`);
  console.log(`🧪 UPC Test: http://localhost:${PORT}/test-upc`);
});
