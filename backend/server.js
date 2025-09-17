const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const { parseProduct } = require('./gptParser');
const ApifyScraper = require('./apifyScraper');
const UPCItemDB = require('./upcitemdb');
const ProWebCrawler = require('./proWebCrawler');
const AmazonCrawler = require('./amazonCrawler');
const OrderTracker = require('./orderTracking');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1064';
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY || '';
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const SCRAPING_TIMEOUT = 30000;
const MAX_CONCURRENT_SCRAPES = 2;
const BERMUDA_DUTY_RATE = 0.265;
const SHIPPING_RATE_PER_CUBIC_FOOT = 8;

// Initialize services
console.log('✅ GPT Parser loaded successfully');
const apifyScraper = new ApifyScraper(APIFY_API_KEY);
const upcItemDB = new UPCItemDB(UPCITEMDB_API_KEY);
const proWebCrawler = new ProWebCrawler();
const amazonCrawler = new AmazonCrawler();
const orderTracker = new OrderTracker();

const USE_APIFY = apifyScraper.isAvailable();
const USE_UPCITEMDB = !!UPCITEMDB_API_KEY;
const USE_PROWEB = proWebCrawler.isAvailable();
const USE_AMAZON_CRAWLER = amazonCrawler.isAvailable();

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Amazon Specialist: Amazon-Crawler - ${USE_AMAZON_CRAWLER ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`2. Primary: Apify - ${USE_APIFY ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`3. Secondary: ProWebCrawler - ${USE_PROWEB ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`4. Tertiary: ScrapingBee - ✅ ENABLED`);
console.log(`5. Fallback: GPT Parser - ✅ ENABLED`);
console.log(`6. Enhancement: UPCitemdb - ${USE_UPCITEMDB ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log('=====================');

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', true);

// Serve static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    scraping: {
      amazonCrawler: USE_AMAZON_CRAWLER,
      apify: USE_APIFY,
      proWeb: USE_PROWEB,
      upcitemdb: USE_UPCITEMDB
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
  
  if (username === 'admin' && password === ADMIN_PASSWORD) {
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

app.get('/pages/imports/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin-calculator.html'));
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Complete order page
app.get('/complete-order.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/complete-order.html'));
});

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  trustProxy: 1,
  keyGenerator: (req) => req.ip
});
app.use('/api/', limiter);

// Utility functions
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
    return 'Unknown Retailer';
  } catch (e) {
    return 'Unknown Retailer';
  }
}

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

function estimateBoxDimensions(productDimensions, category) {
  if (!productDimensions) return null;
  
  const paddingFactors = {
    'electronics': 1.3,
    'appliances': 1.2,
    'furniture': 1.1,
    'clothing': 1.4,
    'books': 1.2,
    'toys': 1.25,
    'sports': 1.2,
    'home-decor': 1.35,
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
    return Math.max(25, price * 0.15);
  }
  
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  const baseCost = Math.max(15, cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT);
  const oversizeFee = Math.max(dimensions.length, dimensions.width, dimensions.height) > 48 ? 50 : 0;
  const valueFee = price > 500 ? price * 0.02 : 0;
  const handlingFee = 15;
  
  const totalCost = baseCost + oversizeFee + valueFee + handlingFee;
  return Math.round(totalCost);
}

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

function cleanVariant(variant) {
  if (!variant || typeof variant !== 'string') return null;
  
  const cleaned = variant.trim();
  
  if (cleaned.length < 3 || cleaned.length > 50) return null;
  if (/^[\d\-_]+$/.test(cleaned)) return null;
  if (/^(select|choose|option|default|click|tap)$/i.test(cleaned)) return null;
  
  return cleaned;
}

async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  const isAmazon = retailer === 'Amazon';
  
  let productData = null;
  let scrapingMethod = 'none';
  
  console.log(`\n📦 Processing: ${url}`);
  console.log(`   Retailer: ${retailer}`);
  
  // PARALLEL SCRAPING: Try multiple methods simultaneously for speed
  const scrapingPromises = [];
  const scrapingResults = [];
  
  // Add Amazon-Crawler for Amazon URLs
  if (isAmazon && USE_AMAZON_CRAWLER) {
    scrapingPromises.push(
      amazonCrawler.scrapeProduct(url)
        .then(data => ({ method: 'amazon-crawler', data, priority: 1 }))
        .catch(error => ({ method: 'amazon-crawler', error: error.message, priority: 1 }))
    );
  }
  
  // Add Apify (high priority for non-Amazon, medium for Amazon)
  if (USE_APIFY) {
    scrapingPromises.push(
      apifyScraper.scrapeProduct(url)
        .then(data => ({ method: 'apify', data, priority: isAmazon ? 2 : 1 }))
        .catch(error => ({ method: 'apify', error: error.message, priority: isAmazon ? 2 : 1 }))
    );
  }
  
  // Add ProWebCrawler (medium priority)
  if (USE_PROWEB) {
    scrapingPromises.push(
      proWebCrawler.scrapeProduct(url)
        .then(data => ({ method: 'proweb', data, priority: 3 }))
        .catch(error => ({ method: 'proweb', error: error.message, priority: 3 }))
    );
  }
  
  // Add GPT Parser (lowest priority, but still parallel)
  scrapingPromises.push(
    parseProduct(url)
      .then(data => ({ method: 'gpt', data, priority: 4 }))
      .catch(error => ({ method: 'gpt', error: error.message, priority: 4 }))
  );
  
  // Wait for all scraping methods to complete (with timeout)
  console.log(`   🚀 Running ${scrapingPromises.length} scrapers in parallel...`);
  const timeoutPromise = new Promise(resolve => 
    setTimeout(() => resolve({ method: 'timeout', error: 'Timeout reached' }), 25000)
  );
  
  try {
    const results = await Promise.allSettled([...scrapingPromises, timeoutPromise]);
    
    // Process successful results, sorted by priority
    const successfulResults = results
      .filter(result => result.status === 'fulfilled' && result.value.data)
      .map(result => result.value)
      .sort((a, b) => a.priority - b.priority);
    
    // Merge data from all successful scrapers
    let mergedData = null;
    const usedMethods = [];
    
    for (const result of successfulResults) {
      if (result.data) {
        if (!mergedData) {
          mergedData = result.data;
          usedMethods.push(result.method);
          console.log(`   ✅ Primary data from: ${result.method}`);
        } else {
          // Only merge if we're missing critical data
          const beforeMerge = isDataComplete(mergedData);
          mergedData = mergeProductData(mergedData, result.data);
          const afterMerge = isDataComplete(mergedData);
          
          if (!beforeMerge && afterMerge) {
            usedMethods.push(result.method);
            console.log(`   ✅ Enhanced with: ${result.method}`);
          }
        }
        
        // Stop merging if we have complete data
        if (isDataComplete(mergedData)) {
          break;
        }
      }
    }
    
    productData = mergedData;
    scrapingMethod = usedMethods.join('+');
    
    // Clean variant
    if (productData) {
      productData.variant = cleanVariant(productData.variant);
    }
    
  } catch (error) {
    console.log('   ❌ Parallel scraping failed:', error.message);
  }
  
  // STEP 2: Try UPCitemdb for missing dimensions (only if needed)
  if (USE_UPCITEMDB && productData && productData.name && (!productData.dimensions || !productData.weight)) {
    try {
      console.log('   📦 Attempting UPCitemdb lookup...');
      const upcData = await upcItemDB.searchByName(productData.name);
      
      if (upcData) {
        if (!productData.dimensions && upcData.dimensions) {
          const category = productData.category || categorizeProduct(productData.name || '', url);
          productData.dimensions = estimateBoxDimensions(upcData.dimensions, category);
          console.log('   ✅ UPCitemdb provided dimensions');
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
  
  // STEP 3: Use estimation for missing data
  if (!productData) {
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
    console.log('   WARNING All methods failed, using estimation');
  }
  
  // Fill in missing data with estimations
  const productName = productData.name || `Product from ${retailer}`;
  const category = productData.category || categorizeProduct(productName, url);
  
  if (!productData.dimensions) {
    productData.dimensions = estimateDimensions(category, productName);
    console.log('   📐 Estimated dimensions based on category:', category);
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
      hasPrice: !!productData.price
    }
  };
  
  console.log(`   💰 Shipping cost: $${shippingCost}`);
  console.log(`   📊 Data source: ${scrapingMethod}`);
  console.log(`   ✅ Product processed successfully\n`);
  
  return product;
}

async function processBatch(urls, batchSize = 4) { // Increased from 2 to 4
  const results = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    
    console.log(`\n🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(urls.length/batchSize)} (${batch.length} URLs)`);
    
    const batchResults = await Promise.allSettled(
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
    
    // Extract successful results
    const successfulResults = batchResults.map(result => 
      result.status === 'fulfilled' ? result.value : result.reason
    );
    
    results.push(...successfulResults);
    
    // Small delay between batches to avoid overwhelming servers
    if (i + batchSize < urls.length) {
      await new Promise(resolve => setTimeout(resolve, 500)); // Reduced from 2000ms
    }
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
    
    const sdlUrls = urls.filter(url => isSDLDomain(url));
    if (sdlUrls.length > 0) {
      return res.status(400).json({ 
        error: 'SDL domain detected. This calculator is for importing products from other retailers.' 
      });
    }
    
    console.log(`\n🚀 Starting batch scrape for ${urls.length} products...`);
    
    const products = await processBatch(urls);
    
    const amazonCount = products.filter(p => p.scrapingMethod?.includes('amazon-crawler')).length;
    const apifyCount = products.filter(p => p.scrapingMethod?.includes('apify')).length;
    const proWebCount = products.filter(p => p.scrapingMethod?.includes('proweb')).length;
    const gptCount = products.filter(p => p.scrapingMethod?.includes('gpt')).length;
    const upcitemdbCount = products.filter(p => p.scrapingMethod?.includes('upcitemdb')).length;
    const estimatedCount = products.filter(p => p.scrapingMethod === 'estimation').length;
    
    console.log('\n📊 SCRAPING SUMMARY:');
    console.log(`   Total products: ${products.length}`);
    console.log(`   Amazon-Crawler used: ${amazonCount}`);
    console.log(`   Apify used: ${apifyCount}`);
    console.log(`   ProWebCrawler used: ${proWebCount}`);
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
          amazonCrawler: amazonCount,
          apify: apifyCount,
          proWeb: proWebCount,
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

// Store pending orders temporarily
const pendingOrders = new Map();

app.post('/api/store-pending-order', (req, res) => {
  const orderId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  pendingOrders.set(orderId, {
    data: req.body,
    timestamp: Date.now()
  });
  
  setTimeout(() => pendingOrders.delete(orderId), 3600000);
  
  console.log(`📦 Stored pending order ${orderId}`);
  res.json({ orderId, success: true });
});

app.get('/api/get-pending-order/:orderId', (req, res) => {
  const order = pendingOrders.get(req.params.orderId);
  if (order) {
    console.log(`✅ Retrieved pending order ${req.params.orderId}`);
    res.json(order.data);
    pendingOrders.delete(req.params.orderId);
  } else {
    console.log(`❌ Order ${req.params.orderId} not found`);
    res.status(404).json({ error: 'Order not found or expired' });
  }
});

// Order tracking endpoints
app.post('/api/orders/:orderId/start-tracking', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { retailerOrders } = req.body;
    
    const result = await orderTracker.startTracking(orderId, retailerOrders);
    res.json(result);
  } catch (error) {
    console.error('Start tracking error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/orders/:orderId/stop-tracking', async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await orderTracker.stopTracking(orderId);
    res.json(result);
  } catch (error) {
    console.error('Stop tracking error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/orders/:orderId/tracking-status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await orderTracker.getTrackingStatus(orderId);
    res.json(result);
  } catch (error) {
    console.error('Get tracking status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
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
    
    const lineItems = [];
    
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
    
    if (totals.dutyAmount > 0) {
      lineItems.push({
        title: 'Bermuda Import Duty (26.5%)',
        price: totals.dutyAmount.toFixed(2),
        quantity: 1,
        taxable: false
      });
    }
    
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
    
    if (totals.totalShippingCost > 0) {
      lineItems.push({
        title: 'Ocean Freight & Handling to Bermuda',
        price: totals.totalShippingCost.toFixed(2),
        quantity: 1,
        taxable: false
      });
    }
    
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
  console.log(`📍 Admin Panel: http://localhost:${PORT}/admin (admin:${ADMIN_PASSWORD})\n`);
});