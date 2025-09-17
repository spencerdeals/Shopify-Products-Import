const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const ApifyScraper = require('./apifyScraper');
const OrderTracker = require('./orderTracking');
const { parseProduct } = require('./gptParser');
require('dotenv').config();
const UPCItemDB = require('./upcitemdb');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY || '';
const upcItemDB = new UPCItemDB(UPCITEMDB_API_KEY);
const USE_UPCITEMDB = !!UPCITEMDB_API_KEY;
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const BERMUDA_DUTY_RATE = 0.265;
const USE_SCRAPINGBEE = !!SCRAPINGBEE_API_KEY;
const SHIPPING_RATE_PER_CUBIC_FOOT = 8;

// FAST timeouts for speed
const APIFY_TIMEOUT = 45000;        // 45 seconds max
const SCRAPINGBEE_TIMEOUT = 20000;  // 20 seconds max
const BASIC_TIMEOUT = 8000;         // 8 seconds max
const MAX_CONCURRENT_SCRAPES = 3;

// Initialize services
const apifyScraper = new ApifyScraper(APIFY_API_KEY);
const USE_APIFY = apifyScraper.isAvailable();
const orderTracker = new OrderTracker();

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Apify - ${USE_APIFY ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`2. Secondary: ScrapingBee - ${USE_SCRAPINGBEE ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`3. Fallback: GPT Parser - ✅ ENABLED`);
console.log(`4. Enhancement: UPCitemdb - ${USE_UPCITEMDB ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log('');
console.log('⚡ SPEED SETTINGS:');
console.log(`   Apify timeout: ${APIFY_TIMEOUT/1000}s`);
console.log(`   ScrapingBee timeout: ${SCRAPINGBEE_TIMEOUT/1000}s`);
console.log(`   Basic timeout: ${BASIC_TIMEOUT/1000}s`);
console.log('=====================');

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', true);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Health check BEFORE rate limiter
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    scraping: {
      apify: USE_APIFY,
      scrapingbee: USE_SCRAPINGBEE,
      gpt: true,
      upcitemdb: USE_UPCITEMDB
    }
  });
});

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
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
      'spencerdeals'
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
  
  // Enhanced category estimates
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
    inStock: primary.inStock !== undefined ? primary.inStock : secondary.inStock
  };
}

// FAST ScrapingBee scraper
async function scrapeWithScrapingBee(url) {
  if (!USE_SCRAPINGBEE) {
    throw new Error('ScrapingBee not configured');
  }

  try {
    console.log('🐝 Starting FAST ScrapingBee extraction...');
    const startTime = Date.now();
    
    const response = await Promise.race([
      axios({
        method: 'GET',
        url: 'https://app.scrapingbee.com/api/v1/',
        params: {
          api_key: SCRAPINGBEE_API_KEY,
          url: url,
          premium_proxy: 'false',
          country_code: 'us',
          render_js: 'false',
          block_resources: 'true',
          wait: '1000'
        },
        timeout: SCRAPINGBEE_TIMEOUT
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('ScrapingBee timeout')), SCRAPINGBEE_TIMEOUT)
      )
    ]);

    console.log(`   ✅ ScrapingBee completed in ${Date.now() - startTime}ms`);
    
    const html = response.data;
    if (!html || typeof html !== 'string') {
      throw new Error('No HTML content received');
    }
    
    const productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      inStock: true
    };

    // Wayfair-specific extraction patterns
    const wayfairTitlePatterns = [
      /<h1[^>]*data-enzyme-id="ProductTitle"[^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*class="[^"]*ProductDetailInfoBlock-productTitle[^"]*"[^>]*>([^<]+)<\/h1>/i,
      /<title[^>]*>([^|]+)\s*\|/i,
      /<h1[^>]*>([^<]+)<\/h1>/i
    ];
    
    for (const pattern of wayfairTitlePatterns) {
      const match = html.match(pattern);
      if (match && match[1].trim()) {
        productData.name = match[1].trim().replace(/&[^;]+;/g, '').substring(0, 200);
        console.log('   📝 Found title');
        break;
      }
    }

    // Wayfair-specific price patterns
    const wayfairPricePatterns = [
      /data-enzyme-id="PriceBlock"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      /class="[^"]*MoneyPrice[^"]*"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      /"currentPrice":\s*"?\$?(\d+(?:,\d{3})*(?:\.\d{2})?)"?/i,
      /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g
    ];
    
    for (const pattern of wayfairPricePatterns) {
      if (pattern.global) {
        const matches = [...html.matchAll(pattern)];
        for (const match of matches) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (price > 10 && price < 50000) {
            productData.price = price;
            console.log('   💰 Found price: $' + price);
            break;
          }
        }
      } else {
        const match = html.match(pattern);
        if (match) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (price > 10 && price < 50000) {
            productData.price = price;
            console.log('   💰 Found price: $' + price);
            break;
          }
        }
      }
      if (productData.price) break;
    }

    // Wayfair dimensions
    const wayfairDimPatterns = [
      /Overall:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
      /Dimensions[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i
    ];
    
    for (const pattern of wayfairDimPatterns) {
      const match = html.match(pattern);
      if (match) {
        const dims = {
          length: parseFloat(match[1]),
          width: parseFloat(match[2]),
          height: parseFloat(match[3])
        };
        if (dims.length > 0 && dims.width > 0 && dims.height > 0) {
          productData.dimensions = dims;
          console.log('   📏 Found dimensions');
          break;
        }
      }
    }

    // Extract main product image
    const wayfairImagePatterns = [
      /data-hb="MediaGallery"[^>]*>[\s\S]*?src="([^"]+)"/i,
      /class="[^"]*MediaGallery[^"]*"[^>]*>[\s\S]*?src="([^"]+)"/i,
      /property="og:image"[^>]+content="([^"]+)"/i
    ];
    
    for (const pattern of wayfairImagePatterns) {
      const match = html.match(pattern);
      if (match && match[1].startsWith('http')) {
        productData.image = match[1];
        console.log('   🖼️ Found image');
        break;
      }
    }

    return productData;

  } catch (error) {
    console.error('❌ ScrapingBee failed:', error.message);
    throw error;
  }
}

// Main product scraping function with FAST timeouts
async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  
  let productData = null;
  let scrapingMethod = 'none';
  
  console.log(`\n📦 Processing: ${url}`);
  console.log(`   Retailer: ${retailer}`);
  
  // STEP 1: Try Apify first (45 second timeout)
  if (USE_APIFY) {
    try {
      console.log('   🔄 Attempting Apify scrape...');
      
      const apifyPromise = apifyScraper.scrapeProduct(url);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Apify timeout')), APIFY_TIMEOUT)
      );
      
      productData = await Promise.race([apifyPromise, timeoutPromise]);
      
      if (productData) {
        scrapingMethod = 'apify';
        console.log('   ✅ Apify returned data');
        
        if (!isDataComplete(productData)) {
          console.log('   ⚠️ Apify data incomplete, will try ScrapingBee');
        }
      }
    } catch (error) {
      console.log('   ❌ Apify failed:', error.message);
      productData = null;
    }
  }
  
  // STEP 2: Try ScrapingBee if needed (20 second timeout)
  if (USE_SCRAPINGBEE && (!productData || !isDataComplete(productData))) {
    try {
      console.log('   🐝 Attempting ScrapingBee...');
      const scrapingBeeData = await scrapeWithScrapingBee(url);
      
      if (scrapingBeeData) {
        if (!productData) {
          productData = scrapingBeeData;
          scrapingMethod = 'scrapingbee';
          console.log('   ✅ Using ScrapingBee data');
        } else {
          const mergedData = mergeProductData(productData, scrapingBeeData);
          productData = mergedData;
          scrapingMethod = 'apify+scrapingbee';
        }
      }
    } catch (error) {
      console.log('   ❌ ScrapingBee failed:', error.message);
    }
  }
  
  // STEP 3: Try GPT parser as fallback
  if (!productData || !productData.name || !productData.price) {
    try {
      console.log('   🧠 Falling back to GPT parser...');
      const gptData = await parseProduct(url);
      
      if (gptData) {
        if (!productData) {
          productData = gptData;
          scrapingMethod = 'gpt';
        } else {
          productData = mergeProductData(productData, gptData);
          scrapingMethod = scrapingMethod + '+gpt';
        }
        console.log('   ✅ GPT parser succeeded');
      }
    } catch (error) {
      console.log('   ❌ GPT parser failed:', error.message);
    }
  }
  
  // STEP 4: Try UPCitemdb for missing dimensions
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
        scrapingMethod = scrapingMethod === 'estimation' ? 'upcitemdb' : scrapingMethod + '+upcitemdb';
      }
    } catch (error) {
      console.log('   ❌ UPCitemdb lookup failed:', error.message);
    }
  }
  
  // STEP 5: Use estimation for missing data
  if (!productData) {
    productData = {
      name: 'Product from ' + retailer,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      category: null
    };
    scrapingMethod = 'estimation';
    console.log('   ⚠️ All methods failed, using estimation');
  }
  
  // Fill in missing data
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

// Root route
app.get('/', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend', 'index.html');
  res.sendFile(frontendPath, (err) => {
    if (err) {
      console.error('Error serving frontend:', err);
      res.json({
        message: 'Frontend not found - API is running',
        endpoints: {
          health: '/health',
          scrape: 'POST /api/scrape'
        }
      });
    }
  });
});

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
    
    console.log(`\n🚀 Starting FAST batch scrape for ${urls.length} products...`);
    console.log('   Strategy: Apify → ScrapingBee → GPT → UPCitemdb → Estimation\n');
    
    const products = await processBatch(urls);
    
    // Log summary
    const apifyCount = products.filter(p => p.scrapingMethod?.includes('apify')).length;
    const scrapingBeeCount = products.filter(p => p.scrapingMethod?.includes('scrapingbee')).length;
    const gptCount = products.filter(p => p.scrapingMethod?.includes('gpt')).length;
    const upcitemdbCount = products.filter(p => p.scrapingMethod?.includes('upcitemdb')).length;
    const estimatedCount = products.filter(p => p.scrapingMethod === 'estimation').length;
    
    console.log('\n📊 SCRAPING SUMMARY:');
    console.log(`   Total products: ${products.length}`);
    console.log(`   Apify used: ${apifyCount}`);
    console.log(`   ScrapingBee used: ${scrapingBeeCount}`);
    console.log(`   GPT used: ${gptCount}`);
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
          apify: apifyCount,
          scrapingBee: scrapingBeeCount,
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

// Order tracking endpoints
app.post('/api/orders/:orderId/start-tracking', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { retailerOrders } = req.body;
    
    const result = await orderTracker.startTracking(orderId, retailerOrders);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/orders/:orderId/stop-tracking', async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await orderTracker.stopTracking(orderId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/orders/:orderId/tracking-status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await orderTracker.getTrackingStatus(orderId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

// Test endpoints
app.get('/test-upc', async (req, res) => {
  if (!USE_UPCITEMDB) {
    return res.json({ 
      success: false, 
      message: 'UPCitemdb not configured' 
    });
  }
  
  try {
    const testProduct = await upcItemDB.searchByName('Apple iPhone 15 Pro');
    res.json({
      success: true,
      testProduct: testProduct,
      message: testProduct ? 'UPCitemdb is working!' : 'UPCitemdb connected but no results'
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

// Admin page
app.get('/admin.html', (req, res) => {
  const adminPath = path.join(__dirname, '../frontend', 'admin.html');
  res.sendFile(adminPath, (err) => {
    if (err) {
      console.error('Error serving admin page:', err);
      res.redirect('/');
    }
  });
});

// Complete order page
app.get('/complete-order.html', (req, res) => {
  const completePath = path.join(__dirname, '../frontend', 'complete-order.html');
  res.sendFile(completePath, (err) => {
    if (err) {
      console.error('Error serving complete-order page:', err);
      res.redirect('/');
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📍 Admin Panel: http://localhost:${PORT}/admin.html\n`);
});