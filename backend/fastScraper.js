const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const ZyteScraper = require('./zyteScraper');
const { parseProduct } = require('./gptParser');
const BOLHistoricalData = require('./bolHistoricalData');
const OrderTracker = require('./orderTracking');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize scrapers
const zyteScraper = new ZyteScraper();
const bolData = new BOLHistoricalData();
let orderTracker = null;

// Initialize order tracker
OrderTracker.create().then(tracker => {
  orderTracker = tracker;
  console.log('✅ Order tracking initialized');
}).catch(err => {
  console.log('⚠️ Order tracking disabled:', err.message);
});

console.log('🚀 SDL Import Calculator Starting...');
console.log(`📍 Server will run on: http://localhost:${PORT}`);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    zyte: zyteScraper.enabled ? 'enabled' : 'disabled'
  });
});

// Main scraping endpoint
app.post('/api/scrape', async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'No URLs provided' });
    }

    console.log(`🔍 Processing ${urls.length} products...`);
    const products = [];

    for (const url of urls) {
      try {
        console.log(`\n📦 Processing: ${url}`);
        
        let productData = null;
        let method = 'estimation';

        // Try Zyte first
        if (zyteScraper.enabled) {
          try {
            console.log('   🕷️ Trying Zyte...');
            productData = await zyteScraper.scrapeProduct(url);
            if (productData && productData.name) {
              method = 'zyte';
              console.log('   ✅ Zyte success');
            }
          } catch (error) {
            console.log('   ❌ Zyte failed:', error.message);
          }
        }

        // Try GPT parser as fallback
        if (!productData || !productData.name) {
          try {
            console.log('   🤖 Trying GPT parser...');
            productData = await parseProduct(url);
            if (productData && productData.name) {
              method = 'gpt';
              console.log('   ✅ GPT success');
            }
          } catch (error) {
            console.log('   ❌ GPT failed:', error.message);
          }
        }

        // Create product with estimation if needed
        if (!productData || !productData.name) {
          productData = {
            name: `Product from ${detectRetailer(url)}`,
            price: null,
            image: null,
            dimensions: null,
            weight: null
          };
          method = 'estimation';
        }

        // Ensure we have dimensions
        if (!productData.dimensions) {
          const category = categorizeProduct(productData.name || '', url);
          productData.dimensions = estimateDimensions(category);
          console.log('   📐 Estimated dimensions');
        }

        // Ensure we have weight
        if (!productData.weight) {
          productData.weight = estimateWeight(productData.dimensions);
          console.log('   ⚖️ Estimated weight');
        }

        // Calculate shipping
        const shippingCost = calculateShippingCost(productData.dimensions, productData.weight, productData.price || 100);

        const product = {
          id: Date.now() + Math.random().toString(36).substr(2, 9),
          url: url,
          name: productData.name,
          price: productData.price,
          image: productData.image || 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=Product',
          dimensions: productData.dimensions,
          weight: productData.weight,
          shippingCost: shippingCost,
          retailer: detectRetailer(url),
          category: categorizeProduct(productData.name || '', url),
          method: method
        };

        products.push(product);
        console.log(`   ✅ Product processed: $${shippingCost} shipping`);

      } catch (error) {
        console.error(`❌ Failed to process ${url}:`, error.message);
        products.push({
          id: Date.now() + Math.random().toString(36).substr(2, 9),
          url: url,
          name: 'Failed to load product',
          price: null,
          image: 'https://placehold.co/400x400/FF5722/FFFFFF/png?text=Error',
          dimensions: { length: 24, width: 18, height: 12 },
          weight: 10,
          shippingCost: 50,
          retailer: detectRetailer(url),
          category: 'general',
          method: 'error',
          error: true
        });
      }
    }

    console.log(`\n✅ Processed ${products.length} products`);
    res.json({ products });

  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to process products' });
  }
});

// Store pending order
app.post('/api/store-pending-order', (req, res) => {
  const orderId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  // In a real app, store this in a database
  global.pendingOrders = global.pendingOrders || new Map();
  global.pendingOrders.set(orderId, {
    data: req.body,
    timestamp: Date.now()
  });
  
  // Clean up after 1 hour
  setTimeout(() => {
    if (global.pendingOrders) {
      global.pendingOrders.delete(orderId);
    }
  }, 3600000);
  
  res.json({ orderId, success: true });
});

// Get pending order
app.get('/api/get-pending-order/:orderId', (req, res) => {
  global.pendingOrders = global.pendingOrders || new Map();
  const order = global.pendingOrders.get(req.params.orderId);
  
  if (order) {
    res.json(order.data);
    global.pendingOrders.delete(req.params.orderId);
  } else {
    res.status(404).json({ error: 'Order not found or expired' });
  }
});

// Create draft order (Shopify)
app.post('/apps/instant-import/create-draft-order', async (req, res) => {
  try {
    const { products, deliveryFees, totals, customer } = req.body;
    
    console.log(`📝 Creating order for ${customer.email}...`);
    
    // Simulate order creation
    const orderId = 'SDL-' + Date.now();
    
    res.json({
      success: true,
      draftOrderId: orderId,
      draftOrderNumber: orderId,
      totalAmount: totals.grandTotal,
      message: 'Order created successfully'
    });
    
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ 
      error: 'Failed to create order',
      details: error.message
    });
  }
});

// Utility functions
function detectRetailer(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    if (domain.includes('amazon')) return 'Amazon';
    if (domain.includes('wayfair')) return 'Wayfair';
    if (domain.includes('target')) return 'Target';
    if (domain.includes('walmart')) return 'Walmart';
    if (domain.includes('bestbuy')) return 'Best Buy';
    if (domain.includes('homedepot')) return 'Home Depot';
    if (domain.includes('lowes')) return 'Lowes';
    return 'Unknown';
  } catch (e) {
    return 'Unknown';
  }
}

function categorizeProduct(name, url) {
  const text = (name + ' ' + url).toLowerCase();
  
  if (/\b(sofa|sectional|chair|table|bed|mattress|furniture)\b/.test(text)) return 'furniture';
  if (/\b(tv|television|laptop|phone|electronics)\b/.test(text)) return 'electronics';
  if (/\b(refrigerator|washer|dryer|appliance)\b/.test(text)) return 'appliances';
  if (/\b(shirt|pants|clothing|apparel)\b/.test(text)) return 'clothing';
  
  return 'general';
}

function estimateDimensions(category) {
  const estimates = {
    'furniture': { length: 60, width: 36, height: 30 },
    'electronics': { length: 24, width: 16, height: 8 },
    'appliances': { length: 30, width: 30, height: 36 },
    'clothing': { length: 12, width: 10, height: 4 },
    'general': { length: 18, width: 12, height: 10 }
  };
  
  return estimates[category] || estimates['general'];
}

function estimateWeight(dimensions) {
  const volume = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = volume / 1728;
  return Math.max(5, Math.round(cubicFeet * 8));
}

function calculateShippingCost(dimensions, weight, price) {
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Base cost: $8 per cubic foot
  const baseCost = Math.max(15, cubicFeet * 8);
  
  // Add fees
  const oversizeFee = Math.max(dimensions.length, dimensions.width, dimensions.height) > 48 ? 50 : 0;
  const handlingFee = 15;
  
  return Math.round(baseCost + oversizeFee + handlingFee);
}

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Open: http://localhost:${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health\n`);
});