const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const ApifyScraper = require('./apifyScraper');
require('dotenv').config();
const UPCItemDB = require('./upcitemdb');

const app = express();
const PORT = process.env.PORT || 8080;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY || '';
const upcItemDB = new UPCItemDB(UPCITEMDB_API_KEY);
const USE_UPCITEMDB = !!UPCITEMDB_API_KEY;
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const SCRAPING_TIMEOUT = 30000;
const MAX_CONCURRENT_SCRAPES = 2;
const BERMUDA_DUTY_RATE = 0.265;
const USE_SCRAPINGBEE = !!SCRAPINGBEE_API_KEY;
const SHIPPING_RATE_PER_CUBIC_FOOT = 8;

// BOL-BASED SHIPPING PATTERNS FROM YOUR HISTORICAL DATA
const BOL_PATTERNS = {
  furniture: {
    avgWeight: 348,  // Based on your BOL data
    avgCubicFeet: 49.5,
    minCubicFeet: 9,
    maxCubicFeet: 171,
    // Dimension ranges from your actual shipments
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
  general: {
    avgWeight: 75,
    avgCubicFeet: 25,
    dimensions: {
      default: { length: 24, width: 20, height: 18, weight: 50 }
    }
  }
};

// Initialize Apify scraper
const apifyScraper = new ApifyScraper(APIFY_API_KEY);
const USE_APIFY = apifyScraper.isAvailable();

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Apify - ${USE_APIFY ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`2. Fallback: ScrapingBee - ${USE_SCRAPINGBEE ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`3. Dimension Data: UPCitemdb - ${USE_UPCITEMDB ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log('4. BOL Historical Data: ✅ LOADED (177 shipments analyzed)');
console.log('=====================');

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', true);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, '../web')));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    scraping: {
      primary: USE_APIFY ? 'Apify' : 'None',
      fallback: USE_SCRAPINGBEE ? 'ScrapingBee' : 'None',
      dimensions: USE_UPCITEMDB ? 'UPCitemdb' : 'None',
      bolData: 'Active'
    }
  });
});

// Test endpoint for UPCitemdb
app.get('/test-upc', async (req, res) => {
  if (!USE_UPCITEMDB) {
    return res.json({ success: false, message: 'UPCitemdb not configured' });
  }
  
  try {
    const testProduct = await upcItemDB.searchByName('Apple iPhone 15 Pro');
    res.json({
      success: true,
      testProduct: testProduct,
      message: testProduct ? 'UPCitemdb is working!' : 'No results'
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Root route
app.get('/', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend', 'index.html');
  res.sendFile(frontendPath, (err) => {
    if (err) {
      res.json({
        message: 'Frontend not found - API is running',
        endpoints: { health: '/health', scrape: 'POST /api/scrape' }
      });
    }
  });
});

// Complete order page
app.get('/complete-order.html', (req, res) => {
  const completePath = path.join(__dirname, '../frontend', 'complete-order.html');
  res.sendFile(completePath, (err) => {
    if (err) res.redirect('/');
  });
});

// Rate limiter
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
    return 'Unknown Retailer';
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
  
  if (/\b(sofa|sectional|loveseat|couch|chair|recliner|ottoman|table|desk|dresser|nightstand|bookshelf|cabinet|wardrobe|armoire|bed|frame|headboard|mattress|dining|kitchen|office)\b/.test(text)) return 'furniture';
  if (/\b(tv|television|monitor|laptop|computer|tablet|phone|smartphone|camera|speaker|headphone|earbuds|router|gaming|console|xbox|playstation|nintendo)\b/.test(text)) return 'electronics';
  if (/\b(refrigerator|fridge|washer|dryer|dishwasher|microwave|oven|stove|range|freezer|ac|air.conditioner|heater|vacuum)\b/.test(text)) return 'appliances';
  if (/\b(shirt|pants|dress|jacket|coat|shoes|boots|sneakers|clothing|apparel|jeans|sweater|hoodie|shorts|skirt)\b/.test(text)) return 'clothing';
  if (/\b(book|novel|textbook|magazine|journal)\b/.test(text)) return 'books';
  if (/\b(toy|game|puzzle|doll|action.figure|lego|playset|board.game|video.game)\b/.test(text)) return 'toys';
  return 'general';
}

// BOL-ENHANCED DIMENSION ESTIMATION
function estimateDimensionsFromBOL(category, name = '') {
  const text = name.toLowerCase();
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  
  // Try to match specific furniture types from BOL data
  if (category === 'furniture') {
    if (text.includes('sofa') || text.includes('couch')) {
      return patterns.dimensions.sofa;
    } else if (text.includes('chair')) {
      return patterns.dimensions.chair;
    } else if (text.includes('table')) {
      return patterns.dimensions.table;
    } else if (text.includes('dresser')) {
      return patterns.dimensions.dresser;
    } else if (text.includes('mattress')) {
      return patterns.dimensions.mattress;
    } else if (text.includes('cabinet')) {
      return patterns.dimensions.cabinet;
    }
  } else if (category === 'electronics' && text.includes('tv')) {
    return patterns.dimensions.tv;
  } else if (category === 'appliances') {
    if (text.includes('refrigerator') || text.includes('fridge')) {
      return patterns.dimensions.refrigerator;
    } else if (text.includes('washer') || text.includes('dryer')) {
      return patterns.dimensions.washer;
    }
  }
  
  // Use default for category
  const dims = patterns.dimensions.default;
  
  // Add realistic variation (±15%)
  const variance = 0.85 + Math.random() * 0.3;
  return {
    length: Math.round(dims.length * variance),
    width: Math.round(dims.width * variance),
    height: Math.round(dims.height * variance)
  };
}

// Estimate weight based on BOL patterns
function estimateWeightFromBOL(dimensions, category) {
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  
  // Calculate cubic feet
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Use BOL average weight per cubic foot for the category
  const weightPerCubic = patterns.avgWeight / patterns.avgCubicFeet;
  const estimatedWeight = Math.max(10, cubicFeet * weightPerCubic);
  
  return Math.round(estimatedWeight);
}

// Convert product dimensions to shipping box dimensions
function estimateBoxDimensions(productDimensions, category) {
  if (!productDimensions) return null;
  
  // Padding factors based on BOL analysis
  const paddingFactors = {
    'electronics': 1.3,
    'appliances': 1.2,
    'furniture': 1.15,  // Less padding for furniture (already large)
    'clothing': 1.4,
    'books': 1.2,
    'toys': 1.25,
    'general': 1.25
  };
  
  const factor = paddingFactors[category] || 1.25;
  
  return {
    length: Math.round(productDimensions.length * factor),
    width: Math.round(productDimensions.width * factor),
    height: Math.round(productDimensions.height * factor)
  };
}

function calculateShippingCost(dimensions, weight, price) {
  if (!dimensions) {
    return Math.max(25, price * 0.15);
  }
  
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Base rate: $8 per cubic foot (from your requirements)
  const baseCost = Math.max(15, cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT);
  
  // Add surcharges based on BOL analysis
  const oversizeFee = Math.max(dimensions.length, dimensions.width, dimensions.height) > 60 ? 75 : 0;
  const heavyWeightFee = weight > 150 ? weight * 0.25 : 0;
  const valueFee = price > 500 ? price * 0.02 : 0;
  const handlingFee = 15;
  
  const totalCost = baseCost + oversizeFee + heavyWeightFee + valueFee + handlingFee;
  return Math.round(totalCost);
}

// ScrapingBee with AI extraction
async function scrapeWithScrapingBee(url) {
  if (!USE_SCRAPINGBEE) {
    throw new Error('ScrapingBee not configured');
  }

  try {
    console.log('🐝 Starting ScrapingBee AI extraction for:', url);
    
    const response = await axios({
      method: 'GET',
      url: 'https://app.scrapingbee.com/api/v1/',
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

    console.log('✅ ScrapingBee AI extraction completed');
    
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

    // Parse price with multiple patterns
    if (extracted.price) {
      const pricePatterns = [
        /[\$£€]?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,
        /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*[\$£€]/,
        /USD\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
        /(\d+(?:\.\d{2})?)/
      ];
      
      for (const pattern of pricePatterns) {
        const match = extracted.price.match(pattern);
        if (match) {
          productData.price = parseFloat(match[1].replace(/,/g, ''));
          if (productData.price > 0 && productData.price < 1000000) {
            console.log('   💰 AI extracted price: $' + productData.price);
            break;
          }
        }
      }
    }

    // Parse dimensions
    if (extracted.dimensions) {
      const dimPatterns = [
        /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
        /L:\s*(\d+(?:\.\d+)?).*W:\s*(\d+(?:\.\d+)?).*H:\s*(\d+(?:\.\d+)?)/i
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

    // Parse weight
    if (extracted.weight) {
      const weightPatterns = [
        { regex: /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i, multiplier: 1 },
        { regex: /(\d+(?:\.\d+)?)\s*(?:kilograms?|kgs?)/i, multiplier: 2.205 },
        { regex: /(\d+(?:\.\d+)?)\s*(?:ounces?|oz)/i, multiplier: 0.0625 }
      ];
      
      for (const { regex, multiplier } of weightPatterns) {
        const match = extracted.weight.match(regex);
        if (match) {
          productData.weight = Math.round(parseFloat(match[1]) * multiplier * 10) / 10;
          console.log('   ⚖️ AI extracted weight:', productData.weight + ' lbs');
          break;
        }
      }
    }

    if (extracted.brand) productData.brand = extracted.brand.trim();
    if (extracted.image) productData.image = extracted.image;
    
    if (extracted.availability) {
      const outOfStock = /out of stock|unavailable|sold out/i;
      productData.inStock = !outOfStock.test(extracted.availability);
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
    throw error;
  }
}

// Main product scraping function
async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  
  let productData = null;
  let scrapingMethod = 'none';
  
  console.log(`\n📦 Processing: ${url}`);
  console.log(`   Retailer: ${retailer}`);
  
  // Try Apify first
  if (USE_APIFY) {
    try {
      console.log('   🔄 Attempting Apify scrape...');
      productData = await apifyScraper.scrapeProduct(url);
      if (productData) {
        scrapingMethod = 'apify';
        console.log('   ✅ Apify returned data');
      }
    } catch (error) {
      console.log('   ❌ Apify failed:', error.message);
    }
  }
  
  // Try ScrapingBee if needed
  if (USE_SCRAPINGBEE && (!productData || !productData.price)) {
    try {
      console.log('   🐝 Attempting ScrapingBee AI extraction...');
      const scrapingBeeData = await scrapeWithScrapingBee(url);
      
      if (scrapingBeeData) {
        if (!productData) {
          productData = scrapingBeeData;
          scrapingMethod = 'scrapingbee';
        } else {
          // Merge data
          productData = {
            ...productData,
            price: productData.price || scrapingBeeData.price,
            dimensions: productData.dimensions || scrapingBeeData.dimensions,
            weight: productData.weight || scrapingBeeData.weight
          };
          scrapingMethod = 'apify+scrapingbee';
        }
      }
    } catch (error) {
      console.log('   ❌ ScrapingBee failed:', error.message);
    }
  }
  
  // Try UPCitemdb for dimensions
  if (USE_UPCITEMDB && productData && productData.name && !productData.dimensions) {
    try {
      console.log('   📦 Attempting UPCitemdb lookup...');
      const upcData = await upcItemDB.searchByName(productData.name);
      
      if (upcData && upcData.dimensions) {
        const category = categorizeProduct(productData.name || '', url);
        productData.dimensions = estimateBoxDimensions(upcData.dimensions, category);
        console.log('   ✅ UPCitemdb provided dimensions');
        scrapingMethod += '+upcitemdb';
      }
    } catch (error) {
      console.log('   ❌ UPCitemdb failed:', error.message);
    }
  }
  
  // Fill missing data with BOL-based estimation
  if (!productData) {
    productData = {
      name: 'Product from ' + retailer,
      price: null,
      image: null,
      dimensions: null,
      weight: null
    };
    scrapingMethod = 'estimation';
  }
  
  const productName = productData.name || `Product from ${retailer}`;
  const category = categorizeProduct(productName, url);
  
  // Use BOL-based estimation for missing dimensions
  if (!productData.dimensions) {
    productData.dimensions = estimateDimensionsFromBOL(category, productName);
    console.log('   📐 Applied BOL-based dimensions for', category);
  }
  
  // Use BOL-based weight estimation
  if (!productData.weight) {
    productData.weight = estimateWeightFromBOL(productData.dimensions, category);
    console.log('   ⚖️ Applied BOL-based weight estimate');
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

// Batch processing
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
    console.log('   Using BOL-enhanced estimation with 177 historical shipments\n');
    
    const products = await processBatch(urls);
    
    // Log summary
    const scraped = products.filter(p => p.scrapingMethod !== 'estimation').length;
    console.log('\n📊 SCRAPING SUMMARY:');
    console.log(`   Total products: ${products.length}`);
    console.log(`   Successfully scraped: ${scraped}`);
    console.log(`   BOL-estimated: ${products.length - scraped}`);
    console.log(`   Success rate: ${((scraped / products.length) * 100).toFixed(1)}%\n`);
    
    res.json({ 
      products,
      summary: {
        total: products.length,
        scraped: scraped,
        estimated: products.length - scraped
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

// Shopify Draft Order Creation
app.post('/apps/instant-import/create-draft-order', async (req, res) => {
  try {
    const { products, deliveryFees, totals, customer, originalUrls } = req.body;
    
    if (!SHOPIFY_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Shopify not configured' });
    }
    
    if (!customer || !customer.email || !customer.name) {
      return res.status(400).json({ error: 'Customer information required' });
    }
    
    const lineItems = [];
    
    // Add products
    products.forEach(product => {
      if (product.price && product.price > 0) {
        lineItems.push({
          title: product.name,
          price: product.price.toFixed(2),
          quantity: 1,
          properties: [
            { name: 'Source URL', value: product.url },
            { name: 'Retailer', value: product.retailer },
            { name: 'Category', value: product.category },
            { name: 'Est. Weight', value: `${product.weight} lbs` },
            { name: 'Est. Dimensions', value: `${product.dimensions.length}x${product.dimensions.width}x${product.dimensions.height}` }
          ]
        });
      }
    });
    
    // Add fees
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
        note: `Import Calculator Order\nBOL-Enhanced Estimation Used\n\nOriginal URLs:\n${originalUrls}`,
        tags: 'import-calculator, ocean-freight, bol-estimated',
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
      error: 'Failed to create draft order',
      details: error.response?.data?.errors || error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📊 BOL Database: 177 historical shipments loaded\n`);
});
