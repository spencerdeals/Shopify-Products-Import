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
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '7Z45R9U0PVA9SCI5P4R6RACA0PZUVSWDGNXCZ0OV0EXA17FAVC0PANLM6FAFDDO1PE7MRSZX4JT3SDIG';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sdl2024admin';
const BERMUDA_DUTY_RATE = 0.265;
const SHIPPING_RATE_PER_CUBIC_FOOT = 7;
const SDL_MARGIN_RATE = 0.15;
const TEST_MODE = process.env.TEST_MODE === 'true';

// Email configuration (optional)
const EMAIL_FROM = process.env.EMAIL_FROM || 'orders@sdl.bm';
const EMAIL_TO_ADMIN = process.env.EMAIL_TO_ADMIN || 'admin@sdl.bm';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';

// Google Sheets configuration
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? 
  JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY) : null;

// Load Google APIs if configured
let google = null;
let sendgrid = null;

if (GOOGLE_SERVICE_ACCOUNT_KEY) {
  try {
    google = require('googleapis').google;
    console.log('✅ Google Sheets API configured');
  } catch (error) {
    console.log('⚠️ Google APIs not installed. Run: npm install googleapis');
  }
}

if (SENDGRID_API_KEY) {
  try {
    sendgrid = require('@sendgrid/mail');
    sendgrid.setApiKey(SENDGRID_API_KEY);
    console.log('✅ SendGrid email configured');
  } catch (error) {
    console.log('⚠️ SendGrid not installed. Run: npm install @sendgrid/mail');
  }
}

// Learning Database - In-Memory with File Persistence
const LEARNING_DB_PATH = path.join(__dirname, 'learning_data.json');
const ORDERS_DB_PATH = path.join(__dirname, 'orders_data.json');

let LEARNING_DB = {
  products: {},
  patterns: {},
  retailer_stats: {},
  bol_patterns: {}
};

let ORDERS_DB = {
  orders: [],
  draft_orders: [],
  abandoned_carts: [],
  stats: {
    total_orders: 0,
    total_revenue: 0,
    average_order_value: 0
  }
};

// Load existing data
try {
  if (fs.existsSync(LEARNING_DB_PATH)) {
    LEARNING_DB = JSON.parse(fs.readFileSync(LEARNING_DB_PATH, 'utf8'));
    console.log('✅ Loaded learning database with', Object.keys(LEARNING_DB.products).length, 'products');
  }
} catch (error) {
  console.log('📝 Starting with fresh learning database');
}

try {
  if (fs.existsSync(ORDERS_DB_PATH)) {
    ORDERS_DB = JSON.parse(fs.readFileSync(ORDERS_DB_PATH, 'utf8'));
    console.log('✅ Loaded orders database with', ORDERS_DB.orders.length, 'orders');
  }
} catch (error) {
  console.log('📝 Starting with fresh orders database');
}

// Save functions
function saveLearningDB() {
  try {
    fs.writeFileSync(LEARNING_DB_PATH, JSON.stringify(LEARNING_DB, null, 2));
  } catch (error) {
    console.error('Error saving learning database:', error);
  }
}

function saveOrdersDB() {
  try {
    fs.writeFileSync(ORDERS_DB_PATH, JSON.stringify(ORDERS_DB, null, 2));
  } catch (error) {
    console.error('Error saving orders database:', error);
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
console.log(`Google Sheets: ${GOOGLE_SERVICE_ACCOUNT_KEY ? 'ENABLED' : 'DISABLED'}`);
console.log('====================================\n');

// Middleware
app.use(cors({
  origin: ['https://sdl.bm', 'https://spencer-deals-ltd.myshopify.com', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.raw({ type: 'application/json' })); // For webhooks
app.set('trust proxy', true);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'ALLOWALL'); // Allow iframe embedding
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
    services: {
      shopify: !!SHOPIFY_ACCESS_TOKEN,
      email: !!sendgrid,
      google_sheets: !!GOOGLE_SERVICE_ACCOUNT_KEY,
      scraping: !!SCRAPINGBEE_API_KEY
    },
    stats: {
      products_learned: Object.keys(LEARNING_DB.products).length,
      total_orders: ORDERS_DB.orders.length,
      abandoned_carts: ORDERS_DB.abandoned_carts.length
    }
  });
});

// Rate limiters
const scrapeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many scraping requests, please try again later'
});

const orderRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many order attempts, please try again later'
});

// Utilities
function generateOrderId() {
  return 'SDL' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

function detectRetailer(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    
    // Major retailers detection
    if (domain.includes('amazon.com')) return 'Amazon';
    if (domain.includes('wayfair.com')) return 'Wayfair';
    if (domain.includes('walmart.com')) return 'Walmart';
    if (domain.includes('target.com')) return 'Target';
    if (domain.includes('bestbuy.com')) return 'Best Buy';
    if (domain.includes('homedepot.com')) return 'Home Depot';
    if (domain.includes('lowes.com')) return 'Lowes';
    if (domain.includes('costco.com')) return 'Costco';
    if (domain.includes('ikea.com')) return 'IKEA';
    if (domain.includes('ebay.com')) return 'eBay';
    if (domain.includes('etsy.com')) return 'Etsy';
    if (domain.includes('overstock.com')) return 'Overstock';
    if (domain.includes('bedbathandbeyond.com')) return 'Bed Bath & Beyond';
    if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
    if (domain.includes('potterybarn.com')) return 'Pottery Barn';
    if (domain.includes('westelm.com')) return 'West Elm';
    if (domain.includes('cb2.com')) return 'CB2';
    if (domain.includes('article.com')) return 'Article';
    if (domain.includes('ashleyfurniture.com')) return 'Ashley Furniture';
    if (domain.includes('lazyboy.com')) return 'La-Z-Boy';
    if (domain.includes('macys.com')) return 'Macys';
    if (domain.includes('nordstrom.com')) return 'Nordstrom';
    if (domain.includes('sephora.com')) return 'Sephora';
    if (domain.includes('ulta.com')) return 'Ulta';
    if (domain.includes('nike.com')) return 'Nike';
    if (domain.includes('adidas.com')) return 'Adidas';
    if (domain.includes('gap.com')) return 'Gap';
    if (domain.includes('oldnavy.com')) return 'Old Navy';
    if (domain.includes('lunafurn.com')) return 'Luna Furniture';
    
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
  
  if (/\b(sofa|couch|chair|recliner|ottoman|table|desk|dresser|bed|mattress|furniture|dining|patio)\b/.test(text)) return 'furniture';
  if (/\b(tv|television|monitor|laptop|computer|tablet|phone|camera|speaker|headphone|electronic)\b/.test(text)) return 'electronics';
  if (/\b(refrigerator|fridge|washer|dryer|dishwasher|microwave|oven|stove|appliance)\b/.test(text)) return 'appliances';
  if (/\b(toy|game|puzzle|doll|lego|playset|bounce|slide|tikes)\b/.test(text)) return 'toys';
  if (/\b(shirt|pants|dress|jacket|shoes|clothing|apparel|wear)\b/.test(text)) return 'clothing';
  return 'general';
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
    
    // Keep only last 100 samples
    if (pattern.prices.length > 100) pattern.prices.shift();
    if (pattern.weights.length > 100) pattern.weights.shift();
    if (pattern.dimensions.length > 100) pattern.dimensions.shift();
  }
  
  const retailer = productData.retailer;
  if (!LEARNING_DB.retailer_stats[retailer]) {
    LEARNING_DB.retailer_stats[retailer] = { attempts: 0, successes: 0 };
  }
  LEARNING_DB.retailer_stats[retailer].attempts++;
  if (productData.price) {
    LEARNING_DB.retailer_stats[retailer].successes++;
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

function estimateDimensionsFromBOL(category, name = '') {
  const text = name.toLowerCase();
  
  if (LEARNING_DB.patterns[category] && LEARNING_DB.patterns[category].dimensions.length > 0) {
    const dims = LEARNING_DB.patterns[category].dimensions;
    const avgDim = dims[dims.length - 1];
    return avgDim;
  }
  
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  
  if (category === 'furniture') {
    if (text.includes('sofa') || text.includes('couch')) return patterns.dimensions.sofa;
    if (text.includes('chair')) return patterns.dimensions.chair;
    if (text.includes('table')) return patterns.dimensions.table;
    if (text.includes('dresser')) return patterns.dimensions.dresser;
    if (text.includes('mattress')) return patterns.dimensions.mattress;
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
  if (LEARNING_DB.patterns[category] && LEARNING_DB.patterns[category].weights.length > 0) {
    const weights = LEARNING_DB.patterns[category].weights;
    const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
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

// ==================== ORDER STAGE MANAGEMENT ====================

async function updateOrderStage(orderId, stage) {
  const stages = {
    1: 'payment-received',
    2: 'ordered-from-vendor',
    3: 'at-nj-warehouse',
    4: 'ready-for-delivery',
    5: 'delivered'
  };
  
  const stageDescriptions = {
    1: '💳 Payment Received - Need to order from vendor',
    2: '📦 Ordered from Vendor - Waiting for delivery to NJ',
    3: '🏭 At NJ Warehouse - Preparing for shipment',
    4: '✅ Ready for Delivery/Collection in Bermuda',
    5: '🎉 Delivered - Order complete'
  };
  
  try {
    const orderResponse = await axios.get(
      `https://${SHOPIFY_DOMAIN}/admin/api/2023-10/orders/${orderId}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        }
      }
    );
    
    const order = orderResponse.data.order;
    
    // Update tags based on stage
    let newTags = order.tags
      .split(',')
      .filter(tag => !tag.trim().startsWith('stage-'))
      .filter(tag => !tag.includes('IMPORT-ACTION-REQUIRED'));
    
    // Add new stage tag
    newTags.push(`stage-${stage}-${stages[stage]}`);
    
    // If stage 1, add action required tag
    if (stage === 1) {
      newTags.push('🚨IMPORT-ACTION-REQUIRED');
    }
    
    // Update order
    await axios.put(
      `https://${SHOPIFY_DOMAIN}/admin/api/2023-10/orders/${orderId}.json`,
      {
        order: {
          id: orderId,
          tags: newTags.join(','),
          note: order.note + `\n\n[${new Date().toISOString()}] Status Update: ${stageDescriptions[stage]}`
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        }
      }
    );
    
    console.log(`✅ Order ${orderId} updated to: ${stageDescriptions[stage]}`);
    return true;
    
  } catch (error) {
    console.error('Error updating order stage:', error.response?.data || error);
    return false;
  }
}

// Scraping function
async function scrapeWithScrapingBee(url) {
  if (TEST_MODE) {
    return {
      price: 99.99,
      title: 'Test Product',
      image: 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=Test'
    };
  }
  
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

// Process product
async function processProduct(url, index, total) {
  console.log(`\n[${index}/${total}] Processing: ${url.substring(0, 80)}...`);
  
  const productId = generateOrderId();
  const retailer = detectRetailer(url);
  console.log(`   Retailer: ${retailer}`);
  
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
  
  const scraped = await scrapeWithScrapingBee(url);
  
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
  
  learnFromProduct(url, product);
  
  console.log(`   Price: ${scraped.price ? '$' + scraped.price : 'Not found'}`);
  console.log(`   Shipping: $${shippingCost}`);
  
  return product;
}

// Email functions
async function sendOrderEmail(orderData) {
  if (!sendgrid) return;
  
  try {
    const msg = {
      to: EMAIL_TO_ADMIN,
      from: EMAIL_FROM,
      subject: `🚨 New Import Order: ${orderData.orderId}`,
      html: `
        <h2>🚨 New Import Order - ACTION REQUIRED</h2>
        <p><strong>Order ID:</strong> ${orderData.orderId}</p>
        <p><strong>Total:</strong> $${orderData.totals.grandTotal.toFixed(2)}</p>
        <p><strong>Products:</strong> ${orderData.products.length} items</p>
        <hr>
        <h3>Products to Order from Vendors:</h3>
        ${orderData.products.map(p => `
          <p>• ${p.name}<br>
          URL: ${p.url}<br>
          Price: $${p.price}</p>
        `).join('')}
        <hr>
        <p><strong>⚠️ ACTION REQUIRED: Order these items from the vendors!</strong></p>
      `
    };
    
    await sendgrid.send(msg);
    console.log('✉️ Import order email sent');
  } catch (error) {
    console.error('Email error:', error);
  }
}

// Google Sheets export
async function exportToGoogleSheets(orderData) {
  if (!google || !GOOGLE_SERVICE_ACCOUNT_KEY || !GOOGLE_SHEET_ID) {
    return;
  }
  
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: GOOGLE_SERVICE_ACCOUNT_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    
    const row = [
      new Date().toISOString(),
      orderData.orderId || '',
      orderData.customer?.email || 'Guest',
      orderData.customer?.name || '',
      orderData.products ? orderData.products.map(p => p.name).join('; ') : '',
      orderData.products ? orderData.products.map(p => p.url).join('\n') : '',
      orderData.totals?.totalItemCost || 0,
      orderData.totals?.dutyAmount || 0,
      orderData.totals?.totalShippingAndHandling || 0,
      orderData.totals?.grandTotal || 0,
      'stage-1-payment-received'
    ];
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Orders!A:K',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });
    
    console.log('✅ Order exported to Google Sheets');
  } catch (error) {
    console.error('Google Sheets error:', error);
  }
}

// Store order in database
function storeOrder(orderData) {
  const order = {
    ...orderData,
    id: orderData.orderId || generateOrderId(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    currentStage: 1
  };
  
  ORDERS_DB.orders.push(order);
  ORDERS_DB.stats.total_orders++;
  ORDERS_DB.stats.total_revenue += orderData.totals?.grandTotal || 0;
  ORDERS_DB.stats.average_order_value = ORDERS_DB.stats.total_revenue / ORDERS_DB.stats.total_orders;
  
  saveOrdersDB();
  return order;
}

// ==================== API ENDPOINTS ====================

// Scrape products
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
    console.log(`BATCH SCRAPE: ${urls.length} products`);
    console.log(`========================================`);
    
    const products = [];
    
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      
      try {
        const product = await processProduct(url, i + 1, urls.length);
        products.push(product);
      } catch (error) {
        console.error(`Error processing URL ${i + 1}:`, error.message);
        
        const retailer = detectRetailer(url);
        const fallbackProduct = {
          id: generateOrderId(),
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
      
      if (i < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    
    const successful = products.filter(p => p.dataCompleteness.hasPrice).length;
    const fromCache = products.filter(p => p.fromCache).length;
    
    console.log(`\n========================================`);
    console.log(`RESULTS: ${products.length} products processed`);
    console.log(`  Scraped: ${successful - fromCache}`);
    console.log(`  From cache: ${fromCache}`);
    console.log(`  Failed: ${products.length - successful}`);
    console.log(`========================================\n`);
    
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

// Create checkout/draft order with IMPORT visibility
app.post('/api/prepare-shopify-checkout', orderRateLimiter, async (req, res) => {
  try {
    const checkoutData = req.body;
    const orderId = generateOrderId();
    
    // Store order in database
    const order = storeOrder({
      ...checkoutData,
      orderId
    });
    
    // Export to Google Sheets
    await exportToGoogleSheets(order);
    
    // Send email notification
    await sendOrderEmail(order);
    
    // If no Shopify token, return contact message
    if (!SHOPIFY_ACCESS_TOKEN) {
      return res.json({
        orderId: orderId,
        redirectUrl: '/pages/contact',
        success: true,
        message: 'Order received! We will contact you shortly to complete payment.'
      });
    }
    
    // Create Shopify draft order
    const lineItems = [];
    
    // Add products
    checkoutData.products.forEach(product => {
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
    
    // Add duty
    if (checkoutData.totals.dutyAmount > 0) {
      lineItems.push({
        title: 'Bermuda Import Duty (26.5%)',
        price: checkoutData.totals.dutyAmount.toFixed(2),
        quantity: 1,
        taxable: false
      });
    }
    
    // Add delivery fees
    Object.entries(checkoutData.deliveryFees || {}).forEach(([vendor, fee]) => {
      if (fee > 0) {
        lineItems.push({
          title: `${vendor} US Delivery Fee`,
          price: fee.toFixed(2),
          quantity: 1,
          taxable: false
        });
      }
    });
    
    // Add shipping & handling
    if (checkoutData.totals.totalShippingAndHandling > 0) {
      lineItems.push({
        title: 'Ocean Freight & Handling to Bermuda',
        price: checkoutData.totals.totalShippingAndHandling.toFixed(2),
        quantity: 1,
        taxable: false
      });
    }
    
    const draftOrderData = {
      draft_order: {
        line_items: lineItems,
        note: `🚨 IMPORT ORDER - ACTION REQUIRED 🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ MANUALLY ORDER THESE ITEMS FROM VENDORS ⚠️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order ID: ${orderId}
Created: ${new Date().toISOString()}

PRODUCTS TO ORDER:
${checkoutData.products.map(p => `• ${p.name}\n  URL: ${p.url}\n  Price: $${p.price}`).join('\n\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
After ordering from vendors, update stage to "Ordered from Vendor"`,
        
        tags: '🚨IMPORT-ACTION-REQUIRED, import-calculator, stage-1-payment-received, needs-vendor-order',
        tax_exempt: true,
        send_receipt: true,
        send_fulfillment_receipt: true,
        note_attributes: [
          { name: '⚠️ ORDER TYPE', value: '🚨 IMPORT - MANUAL ACTION REQUIRED' },
          { name: '📦 STATUS', value: 'NEEDS VENDOR ORDERING' },
          { name: 'import_order', value: 'true' },
          { name: 'order_id', value: orderId },
          { name: 'current_stage', value: '1' }
        ]
      }
    };
    
    // Add customer if provided
    if (checkoutData.customer?.email) {
      draftOrderData.draft_order.customer = {
        email: checkoutData.customer.email,
        first_name: checkoutData.customer.name?.split(' ')[0] || '',
        last_name: checkoutData.customer.name?.split(' ').slice(1).join(' ') || ''
      };
    }
    
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
    
    // Update order with Shopify ID
    order.shopifyDraftOrderId = draftOrder.id;
    order.shopifyInvoiceUrl = draftOrder.invoice_url;
    saveOrdersDB();
    
    console.log(`✅ Import draft order ${draftOrder.name} created with ACTION REQUIRED flag`);
    
    // Return the invoice URL for direct checkout
    res.json({
      orderId: orderId,
      shopifyOrderId: draftOrder.id,
      redirectUrl: draftOrder.invoice_url,
      success: true
    });
    
  } catch (error) {
    console.error('Checkout error:', error.response?.data || error);
    
    // Still save the order even if Shopify fails
    const orderId = generateOrderId();
    storeOrder({
      ...req.body,
      orderId,
      error: error.message
    });
    
    res.json({
      orderId: orderId,
      redirectUrl: '/pages/contact',
      success: false,
      message: 'Order saved. Our team will contact you to complete the order.'
    });
  }
});

// Admin endpoints
app.get('/api/admin/orders', (req, res) => {
  const { password } = req.query;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json({
    orders: ORDERS_DB.orders,
    stats: ORDERS_DB.stats
  });
});

app.get('/api/admin/order/:orderId', (req, res) => {
  const { password } = req.query;
  const { orderId } = req.params;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const order = ORDERS_DB.orders.find(o => o.id === orderId || o.orderId === orderId);
  
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  
  res.json(order);
});

app.post('/api/admin/order/:orderId/status', (req, res) => {
  const { password, status } = req.body;
  const { orderId } = req.params;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const order = ORDERS_DB.orders.find(o => o.id === orderId || o.orderId === orderId);
  
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  
  order.status = status;
  order.updatedAt = new Date().toISOString();
  saveOrdersDB();
  
  res.json({ success: true, order });
});

// Update order stage endpoint
app.post('/api/admin/order/:orderId/stage', async (req, res) => {
  const { password, stage } = req.body;
  const { orderId } = req.params;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const success = await updateOrderStage(orderId, stage);
  
  const stageNames = {
    1: 'Payment Received',
    2: 'Ordered from Vendor',
    3: 'At NJ Warehouse',
    4: 'Ready for Delivery/Collection',
    5: 'Delivered'
  };
  
  // Update local database
  const order = ORDERS_DB.orders.find(o => 
    o.shopifyOrderId === orderId || 
    o.shopifyDraftOrderId === orderId || 
    o.id === orderId || 
    o.orderId === orderId
  );
  
  if (order) {
    order.currentStage = stage;
    order.stageUpdatedAt = new Date().toISOString();
    saveOrdersDB();
  }
  
  res.json({ 
    success,
    stage,
    stageName: stageNames[stage],
    message: success ? `Order updated to: ${stageNames[stage]}` : 'Failed to update order'
  });
});

// Learning insights
app.get('/api/learning-insights', (req, res) => {
  const insights = {
    total_products_learned: Object.keys(LEARNING_DB.products).length,
    categories_tracked: Object.keys(LEARNING_DB.patterns),
    retailer_success_rates: {},
    recent_products: []
  };
  
  Object.entries(LEARNING_DB.retailer_stats).forEach(([retailer, stats]) => {
    insights.retailer_success_rates[retailer] = {
      success_rate: ((stats.successes / stats.attempts) * 100).toFixed(1) + '%',
      total_attempts: stats.attempts
    };
  });
  
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

// Webhook endpoints
app.post('/webhooks/shopify/order-created', async (req, res) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const body = req.rawBody;
  
  // Verify webhook if secret is configured
  if (SHOPIFY_WEBHOOK_SECRET && hmac) {
    const hash = crypto
      .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
      .update(body, 'utf8')
      .digest('base64');
    
    if (hash !== hmac) {
      return res.status(401).send('Unauthorized');
    }
  }
  
  const order = req.body;
  console.log(`📦 Shopify order created: ${order.name}`);
  
  // Update our order record
  const ourOrderId = order.note_attributes?.find(attr => attr.name === 'order_id')?.value;
  if (ourOrderId) {
    const ourOrder = ORDERS_DB.orders.find(o => o.id === ourOrderId || o.orderId === ourOrderId);
    if (ourOrder) {
      ourOrder.shopifyOrderId = order.id;
      ourOrder.shopifyOrderNumber = order.name;
      ourOrder.status = 'confirmed';
      ourOrder.confirmedAt = new Date().toISOString();
      saveOrdersDB();
    }
  }
  
  res.status(200).send('OK');
});

app.post('/webhooks/shopify/order-updated', async (req, res) => {
  console.log(`📦 Shopify order updated: ${req.body.name}`);
  res.status(200).send('OK');
});

// Test endpoints (only in test mode)
if (TEST_MODE) {
  app.get('/api/test/create-sample-order', async (req, res) => {
    const testOrder = {
      products: [
        {
          name: 'Test Product 1',
          price: 99.99,
          url: 'https://example.com/product1',
          retailer: 'Test Store'
        }
      ],
      totals: {
        totalItemCost: 99.99,
        dutyAmount: 26.50,
        totalShippingAndHandling: 50,
        grandTotal: 176.49
      },
      customer: {
        email: 'test@example.com',
        name: 'Test Customer'
      }
    };
    
    const order = storeOrder(testOrder);
    res.json({ success: true, order });
  });
  
  app.get('/api/test/clear-data', (req, res) => {
    ORDERS_DB = {
      orders: [],
      draft_orders: [],
      abandoned_carts: [],
      stats: {
        total_orders: 0,
        total_revenue: 0,
        average_order_value: 0
      }
    };
    saveOrdersDB();
    res.json({ success: true, message: 'Test data cleared' });
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: TEST_MODE ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`💚 Health: http://localhost:${PORT}/health`);
  console.log(`📊 Admin Orders: http://localhost:${PORT}/api/admin/orders?password=${ADMIN_PASSWORD}`);
  if (TEST_MODE) {
    console.log(`🧪 Test Mode: ENABLED`);
    console.log(`   - Create test order: /api/test/create-sample-order`);
    console.log(`   - Clear test data: /api/test/clear-data`);
  }
  console.log('\n');
});
