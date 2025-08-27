// === UPDATED server.js with better error handling ===
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { URL } = require('url');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration with safe defaults
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';
const SCRAPING_TIMEOUT = 25000;
const MAX_CONCURRENT_SCRAPES = 2;
const BERMUDA_DUTY_RATE = 0.265;
const USE_SCRAPINGBEE = !!SCRAPINGBEE_API_KEY;

// Log startup configuration (without sensitive data)
console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log(`ScrapingBee: ${USE_SCRAPINGBEE ? 'Enabled' : 'Disabled'}`);
console.log(`Shopify Token: ${SHOPIFY_ACCESS_TOKEN ? 'Set' : 'NOT SET - Draft orders will fail'}`);
console.log('=====================');

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50
});
app.use('/api/', limiter);

// === HEALTH CHECK ROUTE - MUST BE FIRST ===
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    scrapingBee: USE_SCRAPINGBEE,
    shopifyConfigured: !!SHOPIFY_ACCESS_TOKEN
  });
});

// Root route for basic testing
app.get('/', (req, res) => {
  res.json({
    message: 'Bermuda Import Calculator API',
    version: '2.0',
    endpoints: {
      health: '/health',
      scrape: 'POST /api/scrape',
      createOrder: 'POST /apps/instant-import/create-draft-order'
    }
  });
});

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
  
  const baseEstimates = {
    'furniture': { length: 48, width: 30, height: 36 },
    'electronics': { length: 18, width: 12, height: 8 },
    'appliances': { length: 30, width: 30, height: 36 },
    'clothing': { length: 12, width: 10, height: 2 },
    'books': { length: 8, width: 5, height: 1 },
    'toys': { length: 12, width: 10, height: 8 },
    'sports': { length: 24, width: 16, height: 12 },
    'home-decor': { length: 12, width: 12, height: 12 },
    'general': { length: 20, width: 16, height: 10 }
  };
  
  const base = baseEstimates[category] || baseEstimates.general;
  
  // Apply 1.5x buffer for estimates
  return {
    length: Math.round(base.length * 1.5 * 100) / 100,
    width: Math.round(base.width * 1.5 * 100) / 100,
    height: Math.round(base.height * 1.5 * 100) / 100
  };
}

function validateDimensions(dimensions, category, name) {
  const { length, width, height } = dimensions;
  
  if (length <= 0 || width <= 0 || height <= 0) {
    console.warn(`Invalid dimensions for ${name}: ${length}x${width}x${height}`);
    return estimateDimensions(category, name);
  }
  
  if (length > 120 || width > 120 || height > 120) {
    console.warn(`Unrealistic dimensions for ${name}: ${length}x${width}x${height}, using estimates`);
    return estimateDimensions(category, name);
  }
  
  return dimensions;
}

function calculateShippingCost(dimensions, weight, orderTotal = 0) {
  let { length, width, height } = dimensions;
  
  const MAX_SINGLE_BOX = 96;
  length = Math.min(length, MAX_SINGLE_BOX);
  width = Math.min(width, MAX_SINGLE_BOX); 
  height = Math.min(height, MAX_SINGLE_BOX);
  
  let volume = length * width * height;
  let cubicFeet = volume / 1728;
  
  // Minimum cubic feet based on order value
  if (orderTotal > 300) cubicFeet = Math.max(cubicFeet, 3.5);
  if (orderTotal > 500) cubicFeet = Math.max(cubicFeet, 6);
  if (orderTotal > 1000) cubicFeet = Math.max(cubicFeet, 10);
  if (orderTotal > 2000) cubicFeet = Math.max(cubicFeet, 15);
  
  const baseCost = cubicFeet * 7.5;
  
  let marginMultiplier;
  if (orderTotal < 400) {
    marginMultiplier = 1.45;
  } else if (orderTotal < 1500) {
    marginMultiplier = 1.30;
  } else {
    marginMultiplier = 1.20;
  }
  
  let finalCost = baseCost * marginMultiplier;
  const minShipping = orderTotal > 0 ? Math.max(35, orderTotal * 0.15) : 35;
  
  if (orderTotal > 0) {
    const maxReasonableShipping = orderTotal * 0.5;
    if (finalCost > maxReasonableShipping) {
      finalCost = Math.min(finalCost, maxReasonableShipping);
    }
  }
  
  return Math.max(minShipping, Math.round(finalCost * 100) / 100);
}

// ScrapingBee integration
async function scrapingBeeRequest(url) {
  if (!SCRAPINGBEE_API_KEY) {
    throw new Error('ScrapingBee API key not configured');
  }
  
  try {
    const scrapingBeeUrl = 'https://app.scrapingbee.com/api/v1/';
    const params = new URLSearchParams({
      api_key: SCRAPINGBEE_API_KEY,
      url: url,
      render_js: 'true',
      premium_proxy: 'true',
      country_code: 'us',
      wait: '2000',
      block_ads: 'true',
      block_resources: 'false'
    });

    const response = await axios.get(`${scrapingBeeUrl}?${params.toString()}`, {
      timeout: SCRAPING_TIMEOUT
    });

    return response.data;
  } catch (error) {
    console.error('ScrapingBee request failed:', error.message);
    throw error;
  }
}

async function parseScrapingBeeHTML(html, url) {
  const retailer = detectRetailer(url);
  const result = {};
  
  const namePatterns = [
    /<h1[^>]*id="productTitle"[^>]*>([^<]+)</i,
    /<h1[^>]*class="[^"]*product-title[^"]*"[^>]*>([^<]+)</i,
    /<h1[^>]*>([^<]+)</i
  ];
  
  for (const pattern of namePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      result.name = match[1].trim().replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]*>/g, '');
      break;
    }
  }
  
  const pricePatterns = [
    /class="a-price-whole">([0-9,]+)/i,
    /class="a-price[^"]*"[^>]*>\s*<span[^>]*>\$([0-9,.]+)/i,
    /"price":\s*"([0-9,.]+)"/i
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const priceStr = match[1].replace(/,/g, '');
      const price = parseFloat(priceStr);
      if (!isNaN(price) && price > 0) {
        result.price = price;
        break;
      }
    }
  }
  
  const imagePatterns = [
    /<img[^>]*id="landingImage"[^>]*src="([^"]+)"/i,
    /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i
  ];
  
  for (const pattern of imagePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      result.image = match[1];
      break;
    }
  }
  
  return result;
}

async function findSimilarProductDimensions(productName, category, originalPrice) {
  console.log(`Searching for similar products to: ${productName}`);
  
  // For now, return intelligent estimate based on price
  return makeIntelligentDimensionEstimate(category, originalPrice);
}

function makeIntelligentDimensionEstimate(category, price) {
  console.log(`Making intelligent estimate for ${category} at ${price}`);
  
  let sizeMultiplier = 1;
  if (price > 200) sizeMultiplier = 1.2;
  if (price > 500) sizeMultiplier = 1.4;
  if (price > 1000) sizeMultiplier = 1.6;
  if (price > 2000) sizeMultiplier = 1.8;
  
  const base = estimateDimensions(category);
  
  return {
    length: Math.min(96, base.length * sizeMultiplier),
    width: Math.min(72, base.width * sizeMultiplier),
    height: Math.min(72, base.height * sizeMultiplier),
    source: 'intelligent-estimate',
    confidence: 'low'
  };
}

async function scrapeProduct(url) {
  const retailer = detectRetailer(url);
  
  if (USE_SCRAPINGBEE) {
    try {
      console.log(`Using ScrapingBee for ${retailer}: ${url}`);
      const html = await scrapingBeeRequest(url);
      const productData = await parseScrapingBeeHTML(html, url);
      
      if (productData.name) {
        const category = categorizeProduct(productData.name || '', url);
        let dimensions = productData.dimensions;
        
        if (!dimensions) {
          dimensions = makeIntelligentDimensionEstimate(category, productData.price || 0);
        }
        
        const validatedDimensions = validateDimensions(dimensions, category, productData.name);
        const weight = estimateWeight(validatedDimensions, category);
        const shippingCost = calculateShippingCost(validatedDimensions, weight, productData.price || 0);

        return {
          id: generateProductId(),
          name: productData.name || 'Unknown Product',
          price: productData.price || null,
          image: productData.image || 'https://placehold.co/120x120/7CB342/FFFFFF/png?text=SDL',
          retailer: retailer,
          category: category,
          dimensions: validatedDimensions,
          weight: weight,
          shippingCost: shippingCost,
          url: url,
          needsManualPrice: !productData.price,
          quantity: 1,
          scraped: true,
          method: 'ScrapingBee'
        };
      }
    } catch (error) {
      console.log(`ScrapingBee failed for ${url}:`, error.message);
    }
  }

  // Fallback data
  const category = categorizeProduct('', url);
  const dimensions = estimateDimensions(category);
  const weight = estimateWeight(dimensions, category);
  const shippingCost = calculateShippingCost(dimensions, weight, 0);

  return {
    id: generateProductId(),
    name: `${retailer} Product`,
    price: null,
    image: 'https://placehold.co/120x120/7CB342/FFFFFF/png?text=SDL',
    retailer: retailer,
    category: category,
    dimensions: dimensions,
    weight: weight,
    shippingCost: shippingCost,
    url: url,
    needsManualPrice: true,
    quantity: 1,
    scraped: false,
    method: 'Fallback'
  };
}

// API Routes
app.post('/api/scrape', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ success: false, error: 'URLs array is required' });
    }
    if (urls.length > 20) {
      return res.status(400).json({ success: false, error: 'Maximum 20 URLs allowed per request' });
    }

    const validUrls = urls.filter(url => {
      try { new URL(url); return true; } catch { return false; }
    });

    if (validUrls.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid URLs provided' });
    }

    console.log(`Starting to scrape ${validUrls.length} products...`);
    
    const products = [];
    for (let i = 0; i < validUrls.length; i += MAX_CONCURRENT_SCRAPES) {
      const batch = validUrls.slice(i, i + MAX_CONCURRENT_SCRAPES);
      const batchPromises = batch.map(url => 
        Promise.race([
          scrapeProduct(url),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), SCRAPING_TIMEOUT))
        ]).catch(error => {
          console.error(`Failed to scrape ${url}:`, error.message);
          return null;
        })
      );
      const batchResults = await Promise.allSettled(batchPromises);
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          products.push(result.value);
        }
      });
    }

    const groupedProducts = {};
    products.forEach(product => {
      if (!groupedProducts[product.retailer]) {
        groupedProducts[product.retailer] = { retailer: product.retailer, products: [] };
      }
      groupedProducts[product.retailer].products.push(product);
    });

    const stats = {
      count: products.length,
      scraped: products.filter(p => p.scraped).length,
      pricesFound: products.filter(p => p.price).length,
      retailers: Object.keys(groupedProducts)
    };

    console.log(`Scraping completed:`, stats);
    res.json({
      success: true,
      products: products,
      groupedProducts: groupedProducts,
      ...stats
    });

  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ success: false, error: error.message || 'Scraping failed' });
  }
});

app.post('/apps/instant-import/create-draft-order', async (req, res) => {
  try {
    const { customer, products, deliveryFees, totals, originalUrls } = req.body;
    
    if (!SHOPIFY_ACCESS_TOKEN) {
      return res.status(500).json({ 
        success: false, 
        message: 'Shopify not configured. Please set SHOPIFY_ACCESS_TOKEN environment variable.' 
      });
    }
    
    if (!customer || !products || !Array.isArray(products)) {
      return res.status(400).json({ success: false, message: 'Customer and products are required' });
    }

    const lineItems = products.map(product => ({
      title: `${product.name} (${product.retailer})`,
      price: product.price || 0,
      quantity: product.quantity || 1,
      properties: [
        { name: 'Product URL', value: product.url },
        { name: 'Retailer', value: product.retailer },
        { name: 'Category', value: product.category },
        { name: 'Dimensions', value: `${Math.round(product.dimensions.length)}" x ${Math.round(product.dimensions.width)}" x ${Math.round(product.dimensions.height)}"` },
        { name: 'Weight', value: `${product.weight} lbs` },
        { name: 'Ocean Freight Cost', value: `${product.shippingCost}` }
      ],
      custom: true,
      taxable: false
    }));

    if (deliveryFees && Object.keys(deliveryFees).length > 0) {
      Object.entries(deliveryFees).forEach(([retailer, fee]) => {
        if (fee > 0) {
          lineItems.push({
            title: `USA Delivery Fee - ${retailer}`,
            price: fee,
            quantity: 1,
            custom: true,
            taxable: false
          });
        }
      });
    }

    if (totals && totals.dutyAmount > 0) {
      lineItems.push({
        title: 'Bermuda Import Duty (26.5%)',
        price: totals.dutyAmount,
        quantity: 1,
        custom: true,
        taxable: false
      });
    }

    const customerNote = `
BERMUDA IMPORT QUOTE ESTIMATE - ${new Date().toLocaleDateString()}

CUSTOMER: ${customer.name} (${customer.email})

COST BREAKDOWN:
• Product Cost: ${(totals.totalItemCost || 0).toFixed(2)}
• USA Delivery Fees: ${(totals.totalDeliveryFees || 0).toFixed(2)}
• Bermuda Duty (26.5%): ${(totals.dutyAmount || 0).toFixed(2)}
• Ocean Freight (ESTIMATED): ${(totals.totalShippingCost || 0).toFixed(2)}
• TOTAL ESTIMATE: ${(totals.grandTotal || 0).toFixed(2)}

This quote was generated using the SDL Instant Import Calculator.
Final pricing subject to manual verification and adjustment.
    `.trim();

    const shopifyData = {
      draft_order: {
        line_items: lineItems,
        customer: {
          email: customer.email,
          first_name: customer.name.split(' ')[0] || customer.name,
          last_name: customer.name.split(' ').slice(1).join(' ') || ''
        },
        note: customerNote,
        email: customer.email,
        name: `#IMP${Date.now().toString().slice(-6)}`,
        status: 'open',
        tags: 'instant-import,bermuda-freight,quote'
      }
    };

    console.log('Creating Shopify draft order...');
    const response = await axios.post(
      `https://${SHOPIFY_DOMAIN}/admin/api/2023-10/draft_orders.json`,
      shopifyData,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    const draftOrder = response.data.draft_order;
    console.log(`Draft order created: ${draftOrder.name}`);

    res.json({
      success: true,
      draftOrderId: draftOrder.id,
      draftOrderNumber: draftOrder.name,
      orderUrl: `https://${SHOPIFY_DOMAIN}/admin/draft_orders/${draftOrder.id}`,
      invoiceUrl: draftOrder.invoice_url,
      totalPrice: draftOrder.total_price,
      message: 'Draft order created successfully'
    });
  } catch (error) {
    console.error('Draft order creation error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.errors || error.message || 'Failed to create draft order'
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server with error handling
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Bermuda Import Calculator Backend running on port ${PORT}`);
  console.log(`✅ Health check available at: http://0.0.0.0:${PORT}/health`);
  console.log(`✅ Ready to process import quotes!`);
}).on('error', (err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;

// === package.json ===
{
  "name": "bermuda-import-calculator",
  "version": "2.0.0",
  "description": "Bermuda Import Calculator with ScrapingBee",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "engines": {
    "node": ">=16.0.0"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "axios": "^1.6.0",
    "express-rate-limit": "^7.1.5",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
