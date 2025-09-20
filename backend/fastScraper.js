// SDL Import Calculator - Fast Multi-Source Product Scraper
// Combines GPT parsing with Zyte API for reliable product data extraction

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

// Import scrapers
const { parseProduct } = require('./gptParser');
const ZyteScraper = require('./zyteScraper');
const AdaptiveScraper = require('./adaptiveScraper');
const OrderTracker = require('./orderTracking');

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize scrapers
const zyteScraper = new ZyteScraper();
const adaptiveScraper = new AdaptiveScraper();
let orderTracker = null;

// Initialize order tracker
OrderTracker.create().then(tracker => {
  orderTracker = tracker;
  console.log('✅ Order tracker initialized');
}).catch(error => {
  console.error('❌ Failed to initialize order tracker:', error);
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('frontend'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Utility functions
function detectRetailer(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    if (domain.includes('amazon.com')) return 'Amazon';
    if (domain.includes('wayfair.com')) return 'Wayfair';
    if (domain.includes('target.com')) return 'Target';
    if (domain.includes('walmart.com')) return 'Walmart';
    if (domain.includes('bestbuy.com')) return 'Best Buy';
    if (domain.includes('homedepot.com')) return 'Home Depot';
    if (domain.includes('lowes.com')) return 'Lowes';
    if (domain.includes('costco.com')) return 'Costco';
    if (domain.includes('macys.com')) return 'Macys';
    if (domain.includes('ikea.com')) return 'IKEA';
    if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
    if (domain.includes('westelm.com')) return 'West Elm';
    if (domain.includes('potterybarn.com')) return 'Pottery Barn';
    return 'Unknown';
  } catch (e) {
    return 'Unknown';
  }
}

function estimateShippingBox(product) {
  const dimensions = product.dimensions;
  if (!dimensions || !dimensions.length || !dimensions.width || !dimensions.height) {
    return null;
  }

  const { length, width, height } = dimensions;
  const cubicInches = length * width * height;
  const cubicFeet = cubicInches / 1728;

  // Add 2-4 inches padding for packaging
  const paddedLength = length + 3;
  const paddedWidth = width + 3;
  const paddedHeight = height + 3;
  const paddedCubicFeet = (paddedLength * paddedWidth * paddedHeight) / 1728;

  return {
    length: paddedLength,
    width: paddedWidth,
    height: paddedHeight,
    cubic_feet: paddedCubicFeet,
    confidence: 85,
    reasoning: 'Estimated with 3" padding for packaging materials'
  };
}

function calculateShippingCost(product) {
  const shippingRatePerCubicFoot = 8.00;
  const handlingFee = 15.00;
  const oversizeThreshold = 48; // inches
  const oversizeFee = 50.00;
  const highValueThreshold = 500;
  const highValueFeeRate = 0.02; // 2%

  let shippingBox = product.estimated_shipping_box;
  
  if (!shippingBox && product.dimensions) {
    shippingBox = estimateShippingBox(product);
  }

  if (!shippingBox || !shippingBox.cubic_feet) {
    return {
      baseCost: 25.00,
      oversizeFee: 0,
      highValueFee: 0,
      handlingFee: handlingFee,
      total: 25.00 + handlingFee,
      reasoning: 'Default shipping cost - no dimensions available'
    };
  }

  const baseCost = Math.max(15, shippingBox.cubic_feet * shippingRatePerCubicFoot);
  
  const isOversize = Math.max(shippingBox.length, shippingBox.width, shippingBox.height) > oversizeThreshold;
  const oversizeFeeAmount = isOversize ? oversizeFee : 0;
  
  const isHighValue = product.price > highValueThreshold;
  const highValueFee = isHighValue ? product.price * highValueFeeRate : 0;
  
  const total = baseCost + oversizeFeeAmount + highValueFee + handlingFee;

  return {
    baseCost,
    oversizeFee: oversizeFeeAmount,
    highValueFee,
    handlingFee,
    total,
    reasoning: `${shippingBox.cubic_feet.toFixed(2)} ft³ @ $${shippingRatePerCubicFoot}/ft³${isOversize ? ' + oversize' : ''}${isHighValue ? ' + high value' : ''}`
  };
}

// Main scraping endpoint
app.post('/api/scrape', async (req, res) => {
  console.log('🚀 Scraping request received');
  
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of URLs to scrape'
      });
    }

    if (urls.length > 10) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 10 URLs allowed per request'
      });
    }

    console.log(`📦 Processing ${urls.length} products...`);
    
    const results = [];
    const errors = [];
    let totalShippingCost = 0;
    let totalProductCost = 0;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].trim();
      console.log(`\n🔍 [${i + 1}/${urls.length}] Processing: ${url.substring(0, 60)}...`);
      
      try {
        const retailer = detectRetailer(url);
        console.log(`   🏪 Detected retailer: ${retailer}`);
        
        let product = null;
        let scrapeMethod = 'unknown';
        
        // Try Zyte first for better reliability
        if (zyteScraper.enabled) {
          try {
            console.log('   🕷️ Trying Zyte API...');
            product = await zyteScraper.scrapeProduct(url);
            scrapeMethod = 'zyte';
            console.log('   ✅ Zyte scraping successful');
          } catch (zyteError) {
            console.log('   ⚠️ Zyte failed, falling back to GPT parser...');
          }
        }
        
        // Fallback to GPT parser
        if (!product) {
          try {
            console.log('   🤖 Using GPT parser...');
            product = await parseProduct(url);
            scrapeMethod = 'gpt';
            console.log('   ✅ GPT parsing successful');
          } catch (gptError) {
            console.error('   ❌ GPT parser failed:', gptError.message);
            throw gptError;
          }
        }

        if (!product || !product.name || !product.price) {
          throw new Error('Invalid product data - missing name or price');
        }

        // Record scraping attempt for adaptive learning
        await adaptiveScraper.recordScrapingAttempt(url, retailer, true, product);

        // Add retailer info
        product.retailer = retailer;
        product.scrapeMethod = scrapeMethod;

        // Estimate shipping box if not provided
        if (!product.estimated_shipping_box && product.dimensions) {
          product.estimated_shipping_box = estimateShippingBox(product);
        }

        // Calculate shipping costs
        const shippingCalculation = calculateShippingCost(product);
        product.shippingCost = shippingCalculation.total;
        product.shippingBreakdown = shippingCalculation;

        // Add to totals
        totalProductCost += product.price;
        totalShippingCost += product.shippingCost;

        results.push(product);
        console.log(`   💰 Product: $${product.price} | Shipping: $${product.shippingCost.toFixed(2)}`);

      } catch (error) {
        console.error(`   ❌ Failed to scrape ${url}:`, error.message);
        
        // Record failed attempt
        const retailer = detectRetailer(url);
        await adaptiveScraper.recordScrapingAttempt(url, retailer, false, null, [error.message]);
        
        errors.push({
          url,
          error: error.message,
          retailer
        });
      }
    }

    // Calculate totals
    const dutyRate = 0.265; // 26.5%
    const deliveryFeePerRetailer = 25.00;
    
    const subtotal = totalProductCost;
    const dutyAmount = subtotal * dutyRate;
    const uniqueRetailers = new Set(results.map(p => p.retailer)).size;
    const totalDeliveryFees = uniqueRetailers * deliveryFeePerRetailer;
    const grandTotal = subtotal + dutyAmount + totalShippingCost + totalDeliveryFees;

    const response = {
      success: true,
      products: results,
      errors: errors.length > 0 ? errors : undefined,
      summary: {
        totalProducts: results.length,
        successfulScrapes: results.length,
        failedScrapes: errors.length,
        uniqueRetailers
      },
      totals: {
        subtotal,
        dutyAmount,
        totalShippingCost,
        totalDeliveryFees,
        grandTotal
      },
      breakdown: {
        dutyRate: `${(dutyRate * 100).toFixed(1)}%`,
        deliveryFeePerRetailer: deliveryFeePerRetailer,
        shippingRatePerCubicFoot: 8.00
      }
    };

    console.log(`\n📊 Scraping completed: ${results.length}/${urls.length} successful`);
    console.log(`💰 Grand Total: $${grandTotal.toFixed(2)}`);
    
    res.json(response);

  } catch (error) {
    console.error('💥 Scraping error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error during scraping'
    });
  }
});

// Order tracking endpoints
app.post('/api/orders/:orderId/start-tracking', async (req, res) => {
  if (!orderTracker) {
    return res.status(500).json({ success: false, message: 'Order tracker not initialized' });
  }

  try {
    const { orderId } = req.params;
    const { retailerOrders } = req.body;

    const result = await orderTracker.startTracking(orderId, retailerOrders);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/orders/:orderId/tracking-status', async (req, res) => {
  if (!orderTracker) {
    return res.status(500).json({ success: false, message: 'Order tracker not initialized' });
  }

  try {
    const { orderId } = req.params;
    const status = await orderTracker.getTrackingStatus(orderId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/orders/:orderId/stop-tracking', async (req, res) => {
  if (!orderTracker) {
    return res.status(500).json({ success: false, message: 'Order tracker not initialized' });
  }

  try {
    const { orderId } = req.params;
    const result = await orderTracker.stopTracking(orderId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    scrapers: {
      gpt: !!process.env.OPENAI_API_KEY,
      zyte: zyteScraper.enabled,
      adaptive: true
    }
  });
});

// Admin authentication middleware
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required');
  }

  const credentials = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  const username = credentials[0];
  const password = credentials[1];

  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    next();
  } else {
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    res.status(401).send('Invalid credentials');
  }
}

// Admin routes
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

app.get('/admin-calculator', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin-calculator.html'));
});

// Serve main calculator
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 SDL Import Calculator running on port ${PORT}`);
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`🔧 Admin calculator: http://localhost:${PORT}/admin-calculator`);
  console.log(`🌐 Main calculator: http://localhost:${PORT}/`);
});