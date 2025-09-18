const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const { parseProduct } = require('./gptParser');
require('dotenv').config();
const UPCItemDB = require('./upcitemdb');
const OrderTracker = require('./orderTracking');
const ZyteScraper = require('./zyteScraper');
const ApifyActorScraper = require('./apifyActorScraper');
const AdaptiveScraper = require('./adaptiveScraper');

const app = express();
const PORT = process.env.PORT || 8080;

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

// Initialize order tracker
let orderTracker = null;
let adaptiveScraper = null;

OrderTracker.create().then(tracker => {
  orderTracker = tracker;
}).catch(error => {
  console.error('Failed to initialize order tracker:', error);
}
)
console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Zyte API - ${USE_ZYTE ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log(`2. Secondary: Apify Actors - ${USE_APIFY_ACTORS ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log(`3. Fallback: GPT Parser - ${process.env.OPENAI_API_KEY ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log(`4. Enhancement: UPCitemdb - ${USE_UPCITEMDB ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log('');
console.log('⚡ STRATEGY: Zyte API → Apify Actors → GPT Parser → Smart estimation');
console.log('=====================');

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
  
  // Calculate volume in cubic feet
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Base rate: $8 per cubic foot
  const baseCost = Math.max(15, cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT);
  
  // Add surcharges
  const oversizeFee = Math.max(dimensions.length, dimensions.width, dimensions.height) > 48 ? 50 : 0;
  const valueFee = price > 500 ? price * 0.02 : 0;
  const handlingFee = 15;
  
  const totalCost = baseCost + oversizeFee + valueFee + handlingFee;
  return Math.round(totalCost);
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
    inStock: primary.inStock !== undefined ? primary.inStock : secondary.inStock,
    variant: primary.variant || secondary.variant
  };
}

// Main product scraping function
async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  
  let productData = null;
  let scrapingMethod = 'none';
  
  console.log(`\n📦 Processing: ${url}`);
  console.log(`   Retailer: ${retailer}`);
  
  // STEP 1: Try Zyte API first
  if (USE_ZYTE) {
    try {
      console.log('   🕷️ Attempting Zyte API scrape...');
      productData = await zyteScraper.scrapeProduct(url);
      
      if (productData) {
        scrapingMethod = 'zyte';
        console.log('   ✅ Zyte API success');
        
        // Check if data is complete
        if (!isDataComplete(productData)) {
          console.log('   ⚠️ Zyte data incomplete, will try GPT for missing fields');
        }
      }
    } catch (error) {
      console.log('   ❌ Zyte API failed:', error.message);
      productData = null;
    }
  }
  
  // STEP 2: If Zyte failed or returned incomplete data, try GPT Parser
  if (USE_APIFY_ACTORS && (!productData || !isDataComplete(productData))) {
    try {
      console.log('   🎭 Attempting Apify Actor scrape...');
      const apifyData = await apifyActorScraper.scrapeProduct(url);
      
      if (apifyData) {
        if (!productData) {
          // Zyte failed completely, use Apify data
          productData = apifyData;
          scrapingMethod = 'apify-actor';
          console.log('   ✅ Using Apify Actor data (Zyte failed)');
        } else {
          // Merge data - keep Zyte data but fill in missing fields from Apify
          const mergedData = mergeProductData(productData, apifyData);
          
          // Log what was supplemented
          if (!productData.name && apifyData.name) {
            console.log('   ✅ Apify Actor provided missing name');
          }
          if (!productData.price && apifyData.price) {
            console.log('   ✅ Apify Actor provided missing price');
          }
          if (!productData.image && apifyData.image) {
            console.log('   ✅ Apify Actor provided missing image');
          }
          if (!productData.dimensions && apifyData.dimensions) {
            console.log('   ✅ Apify Actor provided missing dimensions');
          }
          
          productData = mergedData;
          scrapingMethod = 'zyte+apify-actor';
        }
      }
    } catch (error) {
      console.log('   ❌ Apify Actor failed:', error.message);
    }
  }
  
  // STEP 3: If Zyte and Apify failed or returned incomplete data, try GPT Parser
  if (process.env.OPENAI_API_KEY && (!productData || !isDataComplete(productData))) {
    try {
      console.log('   🤖 Attempting GPT Parser...');
      const gptData = await parseProduct(url);
      
      if (gptData) {
        if (!productData) {
          // Zyte failed completely, use GPT data
          productData = gptData;
          scrapingMethod = 'gpt';
          console.log('   ✅ Using GPT data (Zyte failed)');
        } else {
          // Merge data - keep Zyte data but fill in missing fields from GPT
          // Merge data - keep existing data but fill in missing fields from GPT
          const mergedData = mergeProductData(productData, gptData);
          
          // Log what was supplemented
          if (!productData.name && gptData.name) {
            console.log('   ✅ GPT provided missing name');
          }
          if (!productData.price && gptData.price) {
            console.log('   ✅ GPT provided missing price');
          }
          if (!productData.image && gptData.image) {
            console.log('   ✅ GPT provided missing image');
          }
          if (!productData.dimensions && gptData.dimensions) {
            console.log('   ✅ GPT provided missing dimensions');
          }
          
          productData = mergedData;
          scrapingMethod = scrapingMethod === 'zyte+apify-actor' ? 'zyte+apify-actor+gpt' : 
                          scrapingMethod === 'apify-actor' ? 'apify-actor+gpt' :
                          scrapingMethod === 'zyte' ? 'zyte+gpt' : scrapingMethod + '+gpt';
        }
      }
    } catch (error) {
      console.log('   ❌ GPT Parser failed:', error.message);
    }
  }
  
  // STEP 4: Try UPCitemdb if we have a product name but missing dimensions
  if (USE_UPCITEMDB && productData && productData.name && (!productData.dimensions || !productData.weight)) {
    try {
      console.log('   📦 Attempting UPCitemdb lookup...');
      const upcData = await upcItemDB.searchByName(productData.name);
      
      if (upcData) {
        // UPCitemdb returns PRODUCT dimensions, convert to BOX dimensions
        if (!productData.dimensions && upcData.dimensions) {
          const category = productData.category || categorizeProduct(productData.name || '', url);
          productData.dimensions = estimateBoxDimensions(upcData.dimensions, category);
          console.log('   ✅ UPCitemdb provided product dimensions, converted to box dimensions');
        }
        if (!productData.weight && upcData.weight) {
          productData.weight = upcData.weight;
          console.log('   ✅ UPCitemdb provided weight');
        }
        if (!productData.image && upcData.image) {
          productData.image = upcData.image;
          console.log('   ✅ UPCitemdb provided image');
        }
        scrapingMethod = scrapingMethod === 'estimation' ? 'upcitemdb' : scrapingMethod + '+upcitemdb';
      }
    } catch (error) {
      console.log('   ❌ UPCitemdb lookup failed:', error.message);
    }
  }
  
  // STEP 5: Use intelligent estimation for any missing data
  if (!productData) {
    // All methods failed completely
    productData = {
      name: 'Product from ' + retailer,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      category: null,
      variant: null
    };
    scrapingMethod = 'estimation';
    console.log('   ⚠️ All methods failed, using estimation');
   failureReasons.push('complete_failure');
  }
  
  // Fill in missing data with estimations
  const productName = productData.name || `Product from ${retailer}`;
  const category = productData.category || categorizeProduct(productName, url);
  
  if (!productData.dimensions) {
    productData.dimensions = estimateDimensions(category, productName);
    console.log('   📐 Estimated dimensions based on category:', category);
   if (scrapingMethod !== 'estimation') {
     failureReasons.push('no_dimensions');
   }
  }
  
  if (!productData.weight) {
    productData.weight = estimateWeight(productData.dimensions, category);
    console.log('   ⚖️ Estimated weight based on dimensions');
  }
  
  // Calculate shipping cost
  const shippingCost = calculateShippingCost(
    productData.dimensions,
    productData.weight,
    productData.price || 100
  );
  
  // Prepare final product object
  const product = {
    id: productId,
    url: url,
    name: productName,
    price: productData.price,
    image: productData.image || 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=SDL',
    category: category,
    retailer: retailer,
    dimensions: productData.dimensions,
    weight: productData.weight,
    shippingCost: shippingCost,
    scrapingMethod: scrapingMethod,
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
  
  console.log(`   💰 Shipping cost: $${shippingCost}`);
  console.log(`   📊 Data source: ${scrapingMethod}`);
  console.log(`   ✅ Product processed successfully\n`);
  
 // Record scraping attempt for learning
 if (adaptiveScraper) {
   const success = scrapingMethod !== 'estimation' && productData.name && productData.name !== `Product from ${retailer}`;
   adaptiveScraper.recordScrapingAttempt(url, retailer, success, productData, failureReasons)
     .catch(error => console.log('   ⚠️ Learning system error:', error.message));
 }
 
  return product;
}

// Batch processing with concurrency control
async function processBatch(urls, batchSize = MAX_CONCURRENT_SCRAPES) {
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
    
    // Log summary
    const zyteCount = products.filter(p => p.scrapingMethod?.includes('zyte')).length;
    const apifyActorCount = products.filter(p => p.scrapingMethod?.includes('apify-actor')).length;
    const gptCount = products.filter(p => p.scrapingMethod?.includes('gpt')).length;
    const upcitemdbCount = products.filter(p => p.scrapingMethod?.includes('upcitemdb')).length;
    const estimatedCount = products.filter(p => p.scrapingMethod === 'estimation').length;
    
    console.log('\n📊 SCRAPING SUMMARY:');
    console.log(`   Total products: ${products.length}`);
    console.log(`   Zyte API used: ${zyteCount}`);
    console.log(`   Apify Actors used: ${apifyActorCount}`);
    console.log(`   GPT Parser used: ${gptCount}`);
    console.log(`   UPCitemdb used: ${upcitemdbCount}`);
    console.log(`   Fully estimated: ${estimatedCount}`);
    console.log(`   Success rate: ${((products.length - estimatedCount) / products.length * 100).toFixed(1)}%\n`);
    
    res.json({ 
      products,
      summary: {
        total: products.length,
        scraped: products.length - estimatedCount,
        estimated: estimatedCount,
        scrapingMethods: {
          zyte: zyteCount,
          apifyActor: apifyActorCount,
          gpt: gptCount,
          upcitemdb: upcitemdbCount,
          estimation: estimatedCount
        }
      }
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape products' });
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
        title: 'Bermuda Import Duty (26.5%)',
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
        title: 'Ocean Freight & Handling to Bermuda',
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

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📍 Admin Panel: http://localhost:${PORT}/admin (admin:1064)`);
});