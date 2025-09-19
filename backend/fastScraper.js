const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const ZyteScraper = require('./zyteScraper');
require('dotenv').config();
const UPCItemDB = require('./upcitemdb');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY || '';
const upcItemDB = new UPCItemDB(UPCITEMDB_API_KEY);
const USE_UPCITEMDB = !!UPCITEMDB_API_KEY;
const SCRAPING_TIMEOUT = 30000;  // 30 seconds timeout
const MAX_CONCURRENT_SCRAPES = 2;
const BERMUDA_DUTY_RATE = 0.265;
const SHIPPING_RATE_PER_CUBIC_FOOT = 8; // $8 per cubic foot as discussed

// Initialize Zyte scraper
const zyteScraper = new ZyteScraper();
const USE_ZYTE = zyteScraper.enabled;

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Zyte - ${USE_ZYTE ? '✅ ENABLED (All Retailers)' : '❌ DISABLED (Missing API Key)'}`);
console.log(`2. Dimension Data: UPCitemdb - ${USE_UPCITEMDB ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log('');
console.log('📊 SCRAPING STRATEGY:');
if (USE_ZYTE && USE_UPCITEMDB) {
  console.log('✅ OPTIMAL: Zyte → UPCitemdb → AI Estimation');
} else if (USE_ZYTE) {
  console.log('⚠️  GOOD: Zyte → AI Estimation (No UPCitemdb)');
} else {
  console.log('❌ MINIMAL: AI Estimation only (No Zyte configured)');
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
      primary: USE_ZYTE ? 'Zyte' : 'None',
      dimensions: USE_UPCITEMDB ? 'UPCitemdb' : 'None',
      strategy: USE_ZYTE && USE_UPCITEMDB ? 'Optimal' : 
                USE_ZYTE ? 'Good' : 'Minimal'
    },
    shopifyConfigured: !!SHOPIFY_ACCESS_TOKEN
  });
});

// Test endpoint for UPCitemdb
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

function calculateShippingCost(dimensions, weight, price, retailer) {
  // Special handling for IKEA - NEW 40% METHOD
  if (retailer === 'IKEA') {
    const oceanFreight = price * 0.40; // 40% of retail value
    const handling = 15;
    const subtotal = price + oceanFreight + handling;
    const margin = subtotal * 0.20; // 20% margin on total cost
    const totalShipping = oceanFreight + handling + margin;
    
    console.log(`   🛏️ IKEA Special Calculation:
      Product: $${price}
      Ocean Freight (40%): $${oceanFreight.toFixed(2)}
      Handling: $${handling}
      Subtotal: $${subtotal.toFixed(2)}
      Margin (20%): $${margin.toFixed(2)}
      Total Shipping: $${totalShipping.toFixed(2)}
      (Subject to manual review)`);
    
    return Math.round(totalShipping);
  }
  
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
    inStock: primary.inStock !== undefined ? primary.inStock : secondary.inStock
  };
}

// Check if retailer needs manual entry
function needsManualEntry(retailer) {
  const manualRetailers = ['Crate & Barrel', 'CB2', 'Pottery Barn', 'West Elm'];
  return manualRetailers.includes(retailer);
}

// Main product scraping function
async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  
  // Check if this retailer needs manual entry
  if (needsManualEntry(retailer)) {
    console.log(`\n📦 Processing: ${url}`);
    console.log(`   Retailer: ${retailer}`);
    console.log(`   🔧 Manual entry required for ${retailer}`);
    
    return {
      id: productId,
      url: url,
      name: `Product from ${retailer}`,
      price: null,
      image: null,
      category: 'general',
      retailer: retailer,
      dimensions: null,
      weight: null,
      shippingCost: 50, // Default estimate
      scrapingMethod: 'manual-required',
      manualEntryRequired: true,
      dataCompleteness: {
        hasName: false,
        hasImage: false,
        hasDimensions: false,
        hasWeight: false,
        hasPrice: false
      }
    };
  }
  
  let productData = null;
  let scrapingMethod = 'none';
  
  console.log(`\n📦 Processing: ${url}`);
  console.log(`   Retailer: ${retailer}`);
  
  // STEP 1: Always try Zyte first for all retailers
  if (USE_ZYTE) {
    try {
      console.log('   🔄 Attempting Zyte scrape...');
      
      // Use Zyte scraper
      productData = await zyteScraper.scrapeProduct(url);
      
      if (productData) {
        scrapingMethod = 'zyte';
        console.log('   ✅ Zyte returned data');
        
        // Check if data is complete
        if (!isDataComplete(productData)) {
          console.log('   ⚠️ Zyte data incomplete, will try UPCitemdb for missing fields');
        }
      }
    } catch (error) {
      console.log('   ❌ Zyte failed:', error.message);
      productData = null;
    }
  }
  
  // STEP 2: Try UPCitemdb if we have a product name but missing dimensions
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
  
  // STEP 3: Use intelligent estimation for any missing data
  if (!productData) {
    // All methods failed completely
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
    productData.price || 100,
    retailer
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

// API endpoint for processing manual content
app.post('/api/process-manual-content', async (req, res) => {
  try {
    const { url, htmlContent } = req.body;
    
    if (!url || !htmlContent) {
      return res.status(400).json({ error: 'URL and HTML content required' });
    }
    
    console.log(`🔧 Processing manual content for: ${url}`);
    
    // Use GPT parser to extract product data from HTML content
    const { parseProduct } = require('./gptParser');
    
    try {
      // Create a mock HTML structure for GPT parser
      const mockHtml = `<html><body>${htmlContent}</body></html>`;
      
      // Parse with GPT
      const productData = await parseProduct(url, { htmlContent: mockHtml });
      
      if (productData && productData.name && productData.price) {
        const retailer = detectRetailer(url);
        const category = categorizeProduct(productData.name, url);
        
        // Calculate shipping cost
        const shippingCost = calculateShippingCost(
          productData.dimensions,
          productData.weight,
          productData.price,
          retailer
        );
        
        const product = {
          id: generateProductId(),
          url: url,
          name: productData.name,
          price: productData.price,
          image: productData.image,
          category: category,
          retailer: retailer,
          dimensions: productData.dimensions || estimateDimensions(category, productData.name),
          weight: productData.weight || estimateWeight(productData.dimensions || estimateDimensions(category, productData.name), category),
          shippingCost: shippingCost,
          scrapingMethod: 'manual-gpt',
          dataCompleteness: {
            hasName: !!productData.name,
            hasImage: !!productData.image,
            hasDimensions: !!productData.dimensions,
            hasWeight: !!productData.weight,
            hasPrice: !!productData.price
          }
        };
        
        console.log(`✅ Manual processing successful: ${productData.name} - $${productData.price}`);
        
        res.json({ success: true, product });
      } else {
        throw new Error('Could not extract product data from content');
      }
      
    } catch (gptError) {
      console.error('GPT parsing failed:', gptError.message);
      
      // Fallback: create basic product with estimation
      const retailer = detectRetailer(url);
      const product = {
        id: generateProductId(),
        url: url,
        name: `Product from ${retailer}`,
        price: 100, // Default price
        image: null,
        category: 'general',
        retailer: retailer,
        dimensions: estimateDimensions('general'),
        weight: null,
        shippingCost: 50,
        scrapingMethod: 'manual-fallback',
        dataCompleteness: {
          hasName: false,
          hasImage: false,
          hasDimensions: false,
          hasWeight: false,
          hasPrice: false
        }
      };
      
      product.weight = estimateWeight(product.dimensions, 'general');
      
      res.json({ success: true, product });
    }
    
  } catch (error) {
    console.error('Manual processing error:', error);
    res.status(500).json({ error: 'Failed to process manual content' });
  }
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
    
    console.log(`\n🚀 Starting batch scrape for ${urls.length} products...`);
    console.log('   Strategy: Zyte → UPCitemdb → Estimation\n');
    
    const products = await processBatch(urls);
    
    // Log summary
    const zyteCount = products.filter(p => p.scrapingMethod?.includes('zyte')).length;
    const upcitemdbCount = products.filter(p => p.scrapingMethod?.includes('upcitemdb')).length;
    const estimatedCount = products.filter(p => p.scrapingMethod === 'estimation').length;
    const manualCount = products.filter(p => p.manualEntryRequired).length;
    
    console.log('\n📊 SCRAPING SUMMARY:');
    console.log(`   Total products: ${products.length}`);
    console.log(`   Zyte used: ${zyteCount}`);
    console.log(`   UPCitemdb used: ${upcitemdbCount}`);
    console.log(`   Manual entry required: ${manualCount}`);
    console.log(`   Fully estimated: ${estimatedCount}`);
    console.log(`   Success rate: ${((products.length - estimatedCount - manualCount) / products.length * 100).toFixed(1)}%\n`);
    
    res.json({ 
      products,
      summary: {
        total: products.length,
        scraped: products.length - estimatedCount - manualCount,
        estimated: estimatedCount,
        manual: manualCount,
        scrapingMethods: {
          zyte: zyteCount,
          upcitemdb: upcitemdbCount,
          estimation: estimatedCount,
          manual: manualCount
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
    if (totals.shippingCost > 0) {
      lineItems.push({
        title: 'Ocean Freight & Handling to Bermuda',
        price: totals.shippingCost.toFixed(2),
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
  console.log(`📍 API Health: http://localhost:${PORT}/health\n`);
});