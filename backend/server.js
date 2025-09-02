const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '7Z45R9U0PVA9SCI5P4R6RACA0PZUVSWDGNXCZ0OV0EXA17FAVC0PANLM6FAFDDO1PE7MRSZX4JT3SDIG';
const BERMUDA_DUTY_RATE = 0.265;
const SHIPPING_RATE_PER_CUBIC_FOOT = 8;

// Learning Database - In-Memory with File Persistence
const LEARNING_DB_PATH = path.join(__dirname, 'learning_data.json');
let LEARNING_DB = {
  products: {},      // URL -> product data mapping
  patterns: {},      // Category patterns
  retailer_stats: {}, // Success rates by retailer
  bol_patterns: {}   // BOL historical patterns
};

// Load existing learning data
try {
  if (fs.existsSync(LEARNING_DB_PATH)) {
    LEARNING_DB = JSON.parse(fs.readFileSync(LEARNING_DB_PATH, 'utf8'));
    console.log('✅ Loaded learning database with', Object.keys(LEARNING_DB.products).length, 'products');
  }
} catch (error) {
  console.log('📝 Starting with fresh learning database');
}

// Save learning data
function saveLearningDB() {
  try {
    fs.writeFileSync(LEARNING_DB_PATH, JSON.stringify(LEARNING_DB, null, 2));
  } catch (error) {
    console.error('Error saving learning database:', error);
  }
}

// BOL-BASED SHIPPING PATTERNS FROM YOUR HISTORICAL DATA
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

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log('ScrapingBee: ENABLED');
console.log('Learning System: ACTIVE');
console.log('BOL Database: 177 historical shipments');
console.log('=====================\n');

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', true);

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    port: PORT,
    learning: {
      products_learned: Object.keys(LEARNING_DB.products).length,
      patterns_identified: Object.keys(LEARNING_DB.patterns).length
    }
  });
});

// Root route
app.get('/', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend', 'index.html');
  res.sendFile(frontendPath, (err) => {
    if (err) {
      res.json({ message: 'API is running', health: '/health' });
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
  max: 100,
  trustProxy: 1
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
    if (domain.includes('walmart.com')) return 'Walmart';
    if (domain.includes('target.com')) return 'Target';
    if (domain.includes('bestbuy.com')) return 'Best Buy';
    if (domain.includes('homedepot.com')) return 'Home Depot';
    if (domain.includes('lowes.com')) return 'Lowes';
    if (domain.includes('costco.com')) return 'Costco';
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
  
  if (/\b(sofa|couch|chair|recliner|ottoman|table|desk|dresser|bed|mattress|furniture|dining|patio)\b/.test(text)) return 'furniture';
  if (/\b(tv|television|monitor|laptop|computer|tablet|phone|camera|speaker|headphone|electronic)\b/.test(text)) return 'electronics';
  if (/\b(refrigerator|fridge|washer|dryer|dishwasher|microwave|oven|stove|appliance)\b/.test(text)) return 'appliances';
  if (/\b(toy|game|puzzle|doll|lego|playset|bounce|slide|tikes)\b/.test(text)) return 'toys';
  if (/\b(shirt|pants|dress|jacket|shoes|clothing|apparel|wear)\b/.test(text)) return 'clothing';
  if (/\b(pallet|jack|industrial|warehouse|manual|lift)\b/.test(text)) return 'industrial';
  return 'general';
}

// LEARNING FUNCTIONS
function learnFromProduct(url, productData) {
  // Save product data for future use
  LEARNING_DB.products[url] = {
    ...productData,
    last_updated: new Date().toISOString(),
    times_seen: (LEARNING_DB.products[url]?.times_seen || 0) + 1
  };
  
  // Update category patterns
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
    
    // Keep only last 100 samples per category
    if (pattern.prices.length > 100) pattern.prices.shift();
    if (pattern.weights.length > 100) pattern.weights.shift();
    if (pattern.dimensions.length > 100) pattern.dimensions.shift();
  }
  
  // Update retailer success stats
  const retailer = productData.retailer;
  if (!LEARNING_DB.retailer_stats[retailer]) {
    LEARNING_DB.retailer_stats[retailer] = {
      attempts: 0,
      successes: 0
    };
  }
  LEARNING_DB.retailer_stats[retailer].attempts++;
  if (productData.price) {
    LEARNING_DB.retailer_stats[retailer].successes++;
  }
  
  // Save to disk
  saveLearningDB();
}

function getLearnedData(url) {
  // Check if we've seen this URL before
  if (LEARNING_DB.products[url]) {
    const learned = LEARNING_DB.products[url];
    const hoursSinceUpdate = (Date.now() - new Date(learned.last_updated).getTime()) / (1000 * 60 * 60);
    
    // Use cached data if less than 24 hours old
    if (hoursSinceUpdate < 24) {
      console.log('   📚 Using learned data from previous scrape');
      return learned;
    }
  }
  return null;
}

function estimateDimensionsFromBOL(category, name = '') {
  const text = name.toLowerCase();
  
  // First check learned patterns
  if (LEARNING_DB.patterns[category] && LEARNING_DB.patterns[category].dimensions.length > 0) {
    const dims = LEARNING_DB.patterns[category].dimensions;
    const avgDim = dims[dims.length - 1]; // Use most recent
    console.log('   📊 Using learned dimensions from', dims.length, 'previous', category, 'products');
    return avgDim;
  }
  
  // Fall back to BOL patterns
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  
  if (category === 'furniture') {
    if (text.includes('sofa') || text.includes('couch') || text.includes('sectional')) {
      return patterns.dimensions.sofa;
    } else if (text.includes('chair') || text.includes('recliner')) {
      return patterns.dimensions.chair;
    } else if (text.includes('table')) {
      return patterns.dimensions.table;
    } else if (text.includes('dresser')) {
      return patterns.dimensions.dresser;
    } else if (text.includes('mattress')) {
      return patterns.dimensions.mattress;
    }
  }
  
  const dims = patterns.dimensions.default;
  const variance = 0.85 + Math.random() * 0.3;
  
  return {
    length: Math.round(dims.length * variance),
    width: Math.round(dims.width * variance),
    height: Math.round(dims.height * variance)
  };
}

function estimateWeightFromBOL(dimensions, category) {
  // Check learned patterns first
  if (LEARNING_DB.patterns[category] && LEARNING_DB.patterns[category].weights.length > 0) {
    const weights = LEARNING_DB.patterns[category].weights;
    const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
    console.log('   📊 Using learned weight from', weights.length, 'previous', category, 'products');
    return Math.round(avgWeight);
  }
  
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  const weightPerCubic = patterns.avgWeight / patterns.avgCubicFeet;
  const estimatedWeight = Math.max(10, cubicFeet * weightPerCubic);
  return Math.round(estimatedWeight);
}

function calculateShippingCost(dimensions, weight, price) {
  if (!dimensions) {
    return Math.max(25, price * 0.15);
  }
  
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  const baseCost = Math.max(15, cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT);
  const oversizeFee = Math.max(dimensions.length, dimensions.width, dimensions.height) > 60 ? 75 : 0;
  const heavyWeightFee = weight > 150 ? weight * 0.25 : 0;
  const valueFee = price > 500 ? price * 0.02 : 0;
  const handlingFee = 15;
  
  const totalCost = baseCost + oversizeFee + heavyWeightFee + valueFee + handlingFee;
  return Math.round(totalCost);
}

// SCRAPING WITH LEARNING
async function scrapeWithScrapingBee(url) {
  const retailer = detectRetailer(url);
  
  try {
    console.log('   🐝 ScrapingBee requesting...');
    
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
          price: "Product Price",
          title: "Product Title",
          image: "Product Image URL"
        })
      },
      timeout: 30000
    });
    
    const data = response.data;
    
    let price = null;
    let title = data.title || null;
    let image = data.image || null;
    
    // Parse price
    if (data.price) {
      const priceStr = data.price.toString();
      const priceMatch = priceStr.match(/\$?([\d,]+\.?\d*)/);
      if (priceMatch) {
        price = parseFloat(priceMatch[1].replace(/,/g, ''));
      }
    }
    
    return { price, title, image };
    
  } catch (error) {
    console.log('   ❌ ScrapingBee error:', error.message);
    return { price: null, title: null, image: null };
  }
}

// MAIN PROCESSING - GUARANTEED TO RETURN A PRODUCT
async function processProduct(url, index, total) {
  console.log(`\n[${index}/${total}] Processing: ${url.substring(0, 80)}...`);
  
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  console.log(`   Retailer: ${retailer}`);
  
  // Check if we have learned data for this URL
  const learned = getLearnedData(url);
  if (learned && learned.price) {
    console.log('   ✅ Using cached data from learning system');
    return {
      ...learned,
      id: productId,
      url: url,
      fromCache: true
    };
  }
  
  // Try to scrape new data
  const scraped = await scrapeWithScrapingBee(url);
  
  // Build product object with whatever we have
  const productName = scraped.title || `${retailer} Product ${index}`;
  const category = categorizeProduct(productName, url);
  const dimensions = estimateDimensionsFromBOL(category, productName);
  const weight = estimateWeightFromBOL(dimensions, category);
  const shippingCost = calculateShippingCost(dimensions, weight, scraped.price || 100);
  
  const product = {
    id: productId,
    url: url,
    name: productName,
    price: scraped.price,
    image: scraped.image || `https://placehold.co/400x400/7CB342/FFFFFF/png?text=${encodeURIComponent(retailer)}`,
    category: category,
    retailer: retailer,
    dimensions: dimensions,
    weight: weight,
    shippingCost: shippingCost,
    scrapingMethod: scraped.price ? 'scrapingbee' : 'estimated',
    dataCompleteness: {
      hasName: !!scraped.title,
      hasPrice: !!scraped.price,
      hasImage: !!scraped.image,
      hasDimensions: true,
      hasWeight: true
    }
  };
  
  // Learn from this scrape
  learnFromProduct(url, product);
  
  console.log(`   Price: ${scraped.price ? '$' + scraped.price : 'Not found'}`);
  console.log(`   Category: ${category}`);
  console.log(`   Shipping: $${shippingCost}`);
  console.log(`   Learning: Saved for future use`);
  
  return product;
}

// API ENDPOINT - PROCESS ALL URLS WITHOUT DROPPING ANY
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
    
    console.log(`\n========================================`);
    console.log(`BATCH SCRAPE: ${urls.length} products`);
    console.log(`Learning DB: ${Object.keys(LEARNING_DB.products).length} products known`);
    console.log(`========================================`);
    
    const products = [];
    
    // Process EVERY URL - no exceptions
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      
      try {
        const product = await processProduct(url, i + 1, urls.length);
        products.push(product);
      } catch (error) {
        console.error(`Error processing URL ${i + 1}:`, error.message);
        
        // STILL ADD A PRODUCT EVEN ON ERROR
        const retailer = detectRetailer(url);
        const fallbackProduct = {
          id: generateProductId(),
          url: url,
          name: `${retailer} Product ${i + 1}`,
          price: null,
          image: `https://placehold.co/400x400/F44336/FFFFFF/png?text=Error`,
          category: 'general',
          retailer: retailer,
          dimensions: BOL_PATTERNS.general.dimensions.default,
          weight: 50,
          shippingCost: 100,
          scrapingMethod: 'error',
          error: true,
          dataCompleteness: {
            hasName: false,
            hasPrice: false,
            hasImage: false,
            hasDimensions: false,
            hasWeight: false
          }
        };
        products.push(fallbackProduct);
      }
      
      // Small delay between requests
      if (i < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    
    // Calculate summary
    const successful = products.filter(p => p.dataCompleteness.hasPrice).length;
    const fromCache = products.filter(p => p.fromCache).length;
    
    console.log(`\n========================================`);
    console.log(`RESULTS: ${products.length} products processed`);
    console.log(`  Scraped: ${successful - fromCache}`);
    console.log(`  From cache: ${fromCache}`);
    console.log(`  Failed: ${products.length - successful}`);
    console.log(`Learning DB now has ${Object.keys(LEARNING_DB.products).length} products`);
    console.log(`========================================\n`);
    
    // ALWAYS return exactly the number of products that were requested
    res.json({ 
      products: products,
      summary: {
        total: products.length,
        scraped: successful,
        fromCache: fromCache,
        failed: products.length - successful
      }
    });
    
  } catch (error) {
    console.error('Fatal scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape products: ' + error.message });
  }
});

// Learning insights endpoint
app.get('/api/learning-insights', (req, res) => {
  const insights = {
    total_products_learned: Object.keys(LEARNING_DB.products).length,
    categories_tracked: Object.keys(LEARNING_DB.patterns),
    retailer_success_rates: {},
    recent_products: []
  };
  
  // Calculate success rates
  Object.entries(LEARNING_DB.retailer_stats).forEach(([retailer, stats]) => {
    insights.retailer_success_rates[retailer] = {
      success_rate: ((stats.successes / stats.attempts) * 100).toFixed(1) + '%',
      total_attempts: stats.attempts
    };
  });
  
  // Get 5 most recent products
  const products = Object.values(LEARNING_DB.products)
    .sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated))
    .slice(0, 5);
  
  insights.recent_products = products.map(p => ({
    name: p.name,
    price: p.price,
    retailer: p.retailer,
    times_seen: p.times_seen
  }));
  
  res.json(insights);
});

// Store pending orders
const pendingOrders = new Map();

app.post('/api/store-pending-order', (req, res) => {
  const orderId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  pendingOrders.set(orderId, {
    data: req.body,
    timestamp: Date.now()
  });
  
  setTimeout(() => pendingOrders.delete(orderId), 3600000);
  
  console.log(`Stored pending order ${orderId}`);
  res.json({ orderId, success: true });
});

app.get('/api/get-pending-order/:orderId', (req, res) => {
  const order = pendingOrders.get(req.params.orderId);
  if (order) {
    console.log(`Retrieved pending order ${req.params.orderId}`);
    res.json(order.data);
    pendingOrders.delete(req.params.orderId);
  } else {
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
            { name: 'Retailer', value: product.retailer }
          ]
        });
      }
    });
    
    // Add duty
    if (totals.dutyAmount > 0) {
      lineItems.push({
        title: 'Bermuda Import Duty (26.5%)',
        price: totals.dutyAmount.toFixed(2),
        quantity: 1,
        taxable: false
      });
    }
    
    // Add delivery fees
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
    
    // Add shipping & handling (includes hidden SDL margin)
    if (totals.totalShippingAndHandling > 0) {
      lineItems.push({
        title: 'Shipping & Handling to Bermuda',
        price: totals.totalShippingAndHandling.toFixed(2),
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
    
    console.log(`Creating draft order for ${customer.email}...`);
    
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
    console.log(`Draft order ${draftOrder.name} created successfully`);
    
    res.json({
      success: true,
      draftOrderId: draftOrder.id,
      draftOrderNumber: draftOrder.name,
      invoiceUrl: draftOrder.invoice_url,
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
  console.log(`\nServer running on port ${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Learning insights: http://localhost:${PORT}/api/learning-insights\n`);
});
