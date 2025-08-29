const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const ApifyScraper = require('./apifyScraper');
require('dotenv').config();
const learningSystem = require('./learningSystem');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const SCRAPING_TIMEOUT = 30000;  // 30 seconds timeout
const MAX_CONCURRENT_SCRAPES = 2;
const BERMUDA_DUTY_RATE = 0.265;
const USE_SCRAPINGBEE = !!SCRAPINGBEE_API_KEY;

// Initialize Apify scraper
const apifyScraper = new ApifyScraper(APIFY_API_KEY);
const USE_APIFY = apifyScraper.isAvailable();

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Apify - ${USE_APIFY ? '✅ ENABLED (All Retailers)' : '❌ DISABLED (Missing API Key)'}`);
console.log(`2. Fallback: ScrapingBee - ${USE_SCRAPINGBEE ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log('');
console.log('📊 SCRAPING STRATEGY:');
if (USE_APIFY && USE_SCRAPINGBEE) {
  console.log('✅ OPTIMAL: Apify → ScrapingBee → Intelligent Estimation');
} else if (USE_APIFY && !USE_SCRAPINGBEE) {
  console.log('⚠️  LIMITED: Apify → Intelligent Estimation (No ScrapingBee fallback)');
} else if (!USE_APIFY && USE_SCRAPINGBEE) {
  console.log('⚠️  LIMITED: ScrapingBee → Intelligent Estimation (No Apify primary)');
} else {
  console.log('❌ MINIMAL: Intelligent Estimation only (No scrapers configured)');
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
      strategy: USE_APIFY && USE_SCRAPINGBEE ? 'Optimal' : 
                USE_APIFY || USE_SCRAPINGBEE ? 'Limited' : 'Minimal'
    },
    shopifyConfigured: !!SHOPIFY_ACCESS_TOKEN
  });
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
          createOrder: 'POST /apps/instant-import/create-draft-order'
        }
      });
    }
  });
});

// Rate limiter (after health check) - Fix trust proxy error
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  trustProxy: 1, // Trust first proxy only
  keyGenerator: (req) => req.ip // Use IP for rate limiting
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

function calculateShippingCost(dimensions, weight, price) {
  const volume = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = volume / 1728;
  const dimWeight = cubicFeet * 10;
  const billableWeight = Math.max(weight, dimWeight);
  
  let baseCost = 0;
  if (billableWeight < 10) baseCost = 25;
  else if (billableWeight < 30) baseCost = 45;
  else if (billableWeight < 50) baseCost = 65;
  else if (billableWeight < 100) baseCost = 85;
  else if (billableWeight < 200) baseCost = 120;
  else baseCost = 150 + (billableWeight - 200) * 0.5;
  
  const oversizeFee = Math.max(dimensions.length, dimensions.width, dimensions.height) > 48 ? 25 : 0;
  const valueFee = price > 500 ? price * 0.015 : 0;
  const handlingFee = 10;
  
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

// ScrapingBee scraping function - SIMPLIFIED VERSION
async function scrapeWithScrapingBee(url) {
  if (!USE_SCRAPINGBEE) {
    throw new Error('ScrapingBee not configured');
  }

  try {
    console.log('🐝 Starting ScrapingBee scrape for:', url);
    
    // Simplified request without complex extract_rules
    const response = await axios({
      method: 'GET',
      url: 'https://app.scrapingbee.com/api/v1/',
      params: {
        api_key: SCRAPINGBEE_API_KEY,
        url: url,
        render_js: 'false',
        block_ads: 'true'
      },
      timeout: SCRAPING_TIMEOUT
    });

    const html = response.data;
    console.log('✅ ScrapingBee returned HTML, parsing data...');
    
    // Parse HTML manually
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

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      productData.name = titleMatch[1]
        .replace(/ - Amazon\.com.*$/i, '')
        .replace(/ \| .*$/i, '')
        .trim();
    }

    // Extract price
    const pricePatterns = [
      /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/,
      /price[^>]*>\s*\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      /span[^>]*class="[^"]*price[^"]*"[^>]*>\s*\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i
    ];
    
    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match) {
        productData.price = parseFloat(match[1].replace(/,/g, ''));
        break;
      }
    }

    // Extract image
    const imagePatterns = [
      /id="landingImage"[^>]*src="([^"]+)"/,
      /class="[^"]*main[^"]*image[^"]*"[^>]*src="([^"]+)"/i,
      /data-old-hires="([^"]+)"/,
      /data-a-dynamic-image="{"([^"]+)":/
    ];
    
    for (const pattern of imagePatterns) {
      const match = html.match(pattern);
      if (match) {
        productData.image = match[1];
        break;
      }
    }

    // Try to find dimensions in the HTML
    const dimensionMatch = html.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches|in|")/i);
    if (dimensionMatch) {
      productData.dimensions = {
        length: parseFloat(dimensionMatch[1]),
        width: parseFloat(dimensionMatch[2]),
        height: parseFloat(dimensionMatch[3])
      };
    }

    // Try to find weight
    const weightMatch = html.match(/(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i);
    if (weightMatch) {
      productData.weight = parseFloat(weightMatch[1]);
    }

    console.log('📦 ScrapingBee parsed:', {
      hasName: !!productData.name,
      hasPrice: !!productData.price,
      hasImage: !!productData.image,
      hasDimensions: !!productData.dimensions
    });

    return productData;

  } catch (error) {
    console.error('❌ ScrapingBee scrape failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      if (error.response.status === 400) {
        console.error('Bad Request - Check API key and parameters');
      }
    }
    throw error;
  }
}

// Dimension parsing helper
function parseDimensionString(str) {
  if (!str || typeof str !== 'string') return null;

  const patterns = [
    /(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*(?:inches|in|")?/i,
    /(\d+\.?\d*)"?\s*[WL]\s*[x×]\s*(\d+\.?\d*)"?\s*[DW]\s*[x×]\s*(\d+\.?\d*)"?\s*[HT]/i,
    /L:\s*(\d+\.?\d*).*W:\s*(\d+\.?\d*).*H:\s*(\d+\.?\d*)/i
  ];

  for (const pattern of patterns) {
    const match = str.match(pattern);
    if (match) {
      const length = parseFloat(match[1]);
      const width = parseFloat(match[2]);
      const height = parseFloat(match[3]);
      
      if (length > 0 && width > 0 && height > 0 && 
          length < 200 && width < 200 && height < 200) {
        return { length, width, height };
      }
    }
  }

  return null;
}

// Weight parsing helper
function parseWeightString(weightStr) {
  if (typeof weightStr === 'number') return weightStr;
  if (typeof weightStr !== 'string') return null;

  const patterns = [
    { regex: /(\d+\.?\d*)\s*(?:pounds?|lbs?)/i, multiplier: 1 },
    { regex: /(\d+\.?\d*)\s*(?:kilograms?|kgs?)/i, multiplier: 2.205 },
    { regex: /(\d+\.?\d*)\s*(?:grams?|g)/i, multiplier: 0.00220462 },
    { regex: /(\d+\.?\d*)\s*(?:ounces?|oz)/i, multiplier: 0.0625 }
  ];

  for (const { regex, multiplier } of patterns) {
    const match = weightStr.match(regex);
    if (match) {
      const weight = parseFloat(match[1]) * multiplier;
      if (weight > 0 && weight < 1000) {
        return Math.round(weight * 10) / 10;
      }
    }
  }

  return null;
}

// Main product scraping function
async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  
  let productData = null;
  let scrapingMethod = 'none';
  
  console.log(`\n📦 Processing: ${url}`);
  console.log(`   Retailer: ${retailer}`);
  
  // STEP 1: Always try Apify first for all retailers
  if (USE_APIFY) {
    try {
      console.log('   🔄 Attempting Apify scrape...');
      
      // Use the universal scrapeProduct method from apifyScraper
      productData = await apifyScraper.scrapeProduct(url);
      
      if (productData) {
        scrapingMethod = 'apify';
        console.log('   ✅ Apify returned data');
        
        // Check if data is complete
        if (!isDataComplete(productData)) {
          console.log('   ⚠️ Apify data incomplete, will try ScrapingBee for missing fields');
        }
      }
    } catch (error) {
      console.log('   ❌ Apify failed:', error.message);
      productData = null;
    }
  }
  
  // STEP 2: If Apify failed or returned incomplete data, try ScrapingBee
  if (USE_SCRAPINGBEE && (!productData || !isDataComplete(productData))) {
    try {
      console.log('   🐝 Attempting ScrapingBee scrape...');
      const scrapingBeeData = await scrapeWithScrapingBee(url);
      
      if (scrapingBeeData) {
        if (!productData) {
          // Apify failed completely, use ScrapingBee data
          productData = scrapingBeeData;
          scrapingMethod = 'scrapingbee';
          console.log('   ✅ Using ScrapingBee data (Apify failed)');
        } else {
          // Merge data - keep Apify data but fill in missing fields from ScrapingBee
          const mergedData = mergeProductData(productData, scrapingBeeData);
          
          // Log what was supplemented
          if (!productData.name && scrapingBeeData.name) {
            console.log('   ✅ ScrapingBee provided missing name');
          }
          if (!productData.image && scrapingBeeData.image) {
            console.log('   ✅ ScrapingBee provided missing image');
          }
          if (!productData.dimensions && scrapingBeeData.dimensions) {
            console.log('   ✅ ScrapingBee provided missing dimensions');
          }
          
          productData = mergedData;
          scrapingMethod = 'apify+scrapingbee';
        }
      }
    } catch (error) {
      console.log('   ❌ ScrapingBee failed:', error.message);
    }
  }
  
  // STEP 3: Use intelligent estimation for any missing data
  if (!productData) {
    // Both scrapers failed completely
    productData = {
      name: 'Product from ' + retailer,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      category: null
    };
    scrapingMethod = 'estimation';
    console.log('   ⚠️ Both scrapers failed, using estimation');
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
    console.log('   Strategy: Apify (primary) → ScrapingBee (backup) → Estimation (fallback)\n');
    
    const products = await processBatch(urls);
    
    // Log summary
    const apifyCount = products.filter(p => p.scrapingMethod === 'apify').length;
    const scrapingBeeCount = products.filter(p => p.scrapingMethod === 'scrapingbee').length;
    const combinedCount = products.filter(p => p.scrapingMethod === 'apify+scrapingbee').length;
    const estimatedCount = products.filter(p => p.scrapingMethod === 'estimation').length;
    
    console.log('\n📊 SCRAPING SUMMARY:');
    console.log(`   Total products: ${products.length}`);
    console.log(`   Apify only: ${apifyCount}`);
    console.log(`   ScrapingBee only: ${scrapingBeeCount}`);
    console.log(`   Combined (Apify + ScrapingBee): ${combinedCount}`);
    console.log(`   Estimated: ${estimatedCount}`);
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
          combined: combinedCount,
          estimation: estimatedCount
        }
      }
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape products' });
  }
});

// Shopify Draft Order Creation
app.post('/apps/instant-import/create-draft-order', async (req, res) => {
  try {
    const { products, deliveryFees, totals, customer, originalUrls } = req.body;
    
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
        price: totals.totalShippingCost.toFixed(2),
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
        send_receipt: true,
        send_fulfillment_receipt: false
      }
    };
    
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
    
    // Send the invoice to the customer
    await axios.post(
      `https://${SHOPIFY_DOMAIN}/admin/api/2023-10/draft_orders/${draftOrder.id}/send_invoice.json`,
      {
        draft_order_invoice: {
          to: customer.email,
          from: 'orders@sdl.bm',
          subject: `Your SDL Import Order #${draftOrder.name} - Ready for Payment`,
          custom_message: `Thank you for using SDL Instant Imports!\n\nYour import order has been created and is ready for payment. The total includes all items, import duties, and shipping to Bermuda.\n\nExpected delivery: 3-5 weeks after payment.\n\nClick the link below to complete your purchase.`
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    
    res.json({
      success: true,
      draftOrderId: draftOrder.id,
      draftOrderNumber: draftOrder.name,
      invoiceUrl: draftOrder.invoice_url,
      totalAmount: totals.grandTotal
    });
    
  } catch (error) {
    console.error('Draft order creation error:', error.response?.data || error);
    res.status(500).json({ error: 'Failed to create draft order' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health\n`);
});
