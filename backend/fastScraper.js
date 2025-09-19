// backend/fastScraper.js - SDL Import Calculator Main Server
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const gptParser = require('./gptParser');
const ZyteScraper = require('./zyteScraper');
const AdaptiveScraper = require('./adaptiveScraper');
const BOLHistoricalData = require('./bolHistoricalData');
const OrderTracker = require('./orderTracking');

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize systems
let zyteScraper, adaptiveScraper, bolHistoricalData, orderTracker;

async function initializeSystems() {
  try {
    console.log('🚀 Initializing SDL Import Calculator Systems...');
    
    zyteScraper = new ZyteScraper();
    adaptiveScraper = new AdaptiveScraper();
    bolHistoricalData = new BOLHistoricalData();
    orderTracker = await OrderTracker.create();
    
    await adaptiveScraper.initialize();
    await bolHistoricalData.initialize();
    
    console.log('✅ All systems initialized successfully');
  } catch (error) {
    console.error('❌ System initialization failed:', error);
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Trust proxy for rate limiting
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

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

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

app.get('/admin-calculator', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin-calculator.html'));
});

app.get('/complete-order', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/complete-order.html'));
});

// API Routes
app.post('/api/scrape', async (req, res) => {
  try {
    console.log('📥 Received scrape request:', req.body);
    
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'URLs array is required' });
    }

    console.log(`🔍 Processing ${urls.length} URLs...`);
    const results = [];

    for (const url of urls) {
      try {
        console.log(`📡 Scraping: ${url.substring(0, 60)}...`);
        
        let product = null;
        let scrapeMethod = 'none';
        
        // Try GPT parser first
        try {
          product = await gptParser.parseProduct(url);
          scrapeMethod = 'gpt';
          console.log('✅ GPT parsing successful');
        } catch (gptError) {
          console.log('⚠️ GPT parsing failed:', gptError.message);
          
          // Fallback to Zyte if available
          if (zyteScraper && zyteScraper.enabled) {
            try {
              product = await zyteScraper.scrapeProduct(url);
              scrapeMethod = 'zyte';
              console.log('✅ Zyte scraping successful');
            } catch (zyteError) {
              console.log('⚠️ Zyte scraping failed:', zyteError.message);
            }
          }
        }

        // Validate that we have essential product data
        const hasEssentialData = product && product.name && product.price && product.price > 0;
        
        if (!hasEssentialData) {
          console.log('⚠️ No essential product data found, triggering manual prompt');
          
          // Create manual prompt product instead of setting to null
          const manualProduct = {
            url: url,
            name: null,
            price: null,
            image: null,
            dimensions: null,
            weight: null,
            retailer: detectRetailer(url),
            scrapeMethod: 'manual_required',
            manualPrompt: true,
            promptMessage: 'Unable to automatically extract product information. Please provide details manually.',
            promptFields: {
              name: 'Product Name',
              price: 'Price (USD)',
              length: 'Length (inches)',
              width: 'Width (inches)', 
              height: 'Height (inches)',
              weight: 'Weight (lbs) - optional'
            }
          };
          
          console.log('📝 Created manual prompt product:', JSON.stringify(manualProduct, null, 2));
          results.push(manualProduct);
          
          // Record failure for adaptive learning
          if (adaptiveScraper) {
            await adaptiveScraper.recordScrapingAttempt(url, detectRetailer(url), false, null, ['no_essential_data']);
          }
          
          continue; // Skip to next URL
        }
        
        // Process successful product
        if (product && hasEssentialData) {
          // Enhance with historical data if available
          if (bolHistoricalData && bolHistoricalData.initialized) {
            const productName = product.name || 'Unknown Product';
            const productCategory = categorizeProduct(productName, url);
            const retailer = detectRetailer(url);
            
            const smartEstimate = await bolHistoricalData.getSmartEstimate(
              productName,
              productCategory,
              retailer
            );
            
            if (smartEstimate && smartEstimate.confidence > 0.5) {
              product.dimensions = smartEstimate.dimensions;
              product.weight = estimateWeight(smartEstimate.dimensions, smartEstimate.category);
              product.historicalMatch = true;
              console.log(`📊 Applied historical data (confidence: ${(smartEstimate.confidence * 100).toFixed(0)}%)`);
            }
          }

          // Fill in missing data
          if (!product.dimensions) {
            const category = categorizeProduct(product.name || 'Unknown Product', url);
            product.dimensions = estimateDimensions(category, product.name);
            product.weight = estimateWeight(product.dimensions, category);
          }

          // Calculate shipping cost
          product.shippingCost = calculateShippingCost(
            product.dimensions,
            product.weight,
            product.price || 100
          );

          product.retailer = detectRetailer(url);
          product.scrapeMethod = scrapeMethod;
          
          results.push(product);
          
          // Record scraping attempt for adaptive learning
          if (adaptiveScraper) {
            await adaptiveScraper.recordScrapingAttempt(url, product.retailer, true, product);
          }
        }

      } catch (error) {
        console.error('❌ Error processing URL:', url, error);
        results.push({
          url: url,
          error: error.message,
          retailer: detectRetailer(url)
        });
      }
    }

    const response = {
      success: true,
      products: results.filter(r => !r.error),
      errors: results.filter(r => r.error),
      totalProcessed: urls.length
    };
    
    console.log('📊 Final API response:', JSON.stringify(response, null, 2));

    res.json(response);

  } catch (error) {
    console.error('❌ Scraping error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Order tracking routes
app.post('/api/orders/:orderId/start-tracking', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { retailerOrders } = req.body;
    
    if (!orderTracker) {
      return res.status(500).json({ success: false, message: 'Order tracking not available' });
    }
    
    const result = await orderTracker.startTracking(orderId, retailerOrders);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/orders/:orderId/tracking-status', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderTracker) {
      return res.status(500).json({ error: 'Order tracking not available' });
    }
    
    const status = await orderTracker.getTrackingStatus(orderId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/:orderId/stop-tracking', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderTracker) {
      return res.status(500).json({ success: false, message: 'Order tracking not available' });
    }
    
    const result = await orderTracker.stopTracking(orderId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

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
    if (domain.includes('cb2.com')) return 'CB2';
    if (domain.includes('westelm.com')) return 'West Elm';
    if (domain.includes('potterybarn.com')) return 'Pottery Barn';
    return 'Unknown';
  } catch (e) {
    return 'Unknown';
  }
}

function categorizeProduct(name, url) {
  const text = (name + ' ' + url).toLowerCase();
  
  if (/\b(crate|barrel|west.elm|pottery.barn|cb2|restoration.hardware)\b/.test(text)) {
    return 'high-end-furniture';
  }
  
  if (/\b(sofa|sectional|loveseat|couch|chair|recliner|ottoman|table|desk|dresser|nightstand|bookshelf|cabinet|wardrobe|armoire|bed|frame|headboard|mattress|dining|kitchen|office)\b/.test(text)) return 'furniture';
  if (/\b(outdoor|patio|garden|deck|poolside|backyard|exterior|weather|teak|wicker|rattan)\b/.test(text)) return 'outdoor';
  if (/\b(tv|television|monitor|laptop|computer|tablet|phone|smartphone|camera|speaker|headphone|earbuds|router|gaming|console|xbox|playstation|nintendo)\b/.test(text)) return 'electronics';
  if (/\b(lamp|light|lighting|chandelier|sconce|pendant|floor.lamp|table.lamp)\b/.test(text)) return 'lighting';
  if (/\b(rug|carpet|mat|runner)\b/.test(text)) return 'rugs';
  if (/\b(curtain|blind|shade|drape|window.treatment)\b/.test(text)) return 'window-treatments';
  if (/\b(pillow|cushion|throw|blanket|bedding|sheet|comforter|duvet)\b/.test(text)) return 'textiles';
  if (/\b(art|artwork|painting|print|poster|frame|mirror|wall.decor)\b/.test(text)) return 'decor';
  if (/\b(vase|candle|plant|pot|planter|decorative|ornament)\b/.test(text)) return 'accessories';
  if (/\b(appliance|refrigerator|stove|oven|microwave|dishwasher|washer|dryer)\b/.test(text)) return 'appliances';
  
  return 'general';
}

function estimateDimensions(category, productName) {
  const name = (productName || '').toLowerCase();
  
  // Extract any dimensions from the product name first
  const dimensionMatch = name.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
  if (dimensionMatch) {
    return {
      length: parseFloat(dimensionMatch[1]),
      width: parseFloat(dimensionMatch[2]),
      height: parseFloat(dimensionMatch[3])
    };
  }

  // Category-based estimation
  switch (category) {
    case 'high-end-furniture':
      if (name.includes('sofa') || name.includes('sectional')) {
        return { length: 84, width: 36, height: 32 };
      }
      if (name.includes('chair')) {
        return { length: 32, width: 32, height: 36 };
      }
      if (name.includes('table')) {
        return { length: 60, width: 36, height: 30 };
      }
      return { length: 48, width: 24, height: 30 };
      
    case 'furniture':
      if (name.includes('sofa') || name.includes('sectional')) {
        return { length: 78, width: 34, height: 30 };
      }
      if (name.includes('chair')) {
        return { length: 28, width: 28, height: 32 };
      }
      if (name.includes('table')) {
        return { length: 48, width: 30, height: 29 };
      }
      if (name.includes('dresser')) {
        return { length: 60, width: 18, height: 32 };
      }
      if (name.includes('bed')) {
        if (name.includes('king')) return { length: 80, width: 76, height: 14 };
        if (name.includes('queen')) return { length: 80, width: 60, height: 14 };
        return { length: 75, width: 54, height: 14 };
      }
      return { length: 36, width: 18, height: 24 };
      
    case 'outdoor':
      if (name.includes('table')) {
        return { length: 60, width: 36, height: 29 };
      }
      if (name.includes('chair')) {
        return { length: 24, width: 24, height: 36 };
      }
      return { length: 48, width: 24, height: 30 };
      
    case 'lighting':
      if (name.includes('chandelier')) {
        return { length: 24, width: 24, height: 36 };
      }
      if (name.includes('floor')) {
        return { length: 12, width: 12, height: 60 };
      }
      return { length: 12, width: 12, height: 18 };
      
    case 'rugs':
      if (name.includes('runner')) {
        return { length: 96, width: 30, height: 0.5 };
      }
      if (name.includes('large') || name.includes('9x12')) {
        return { length: 144, width: 108, height: 0.5 };
      }
      return { length: 96, width: 72, height: 0.5 };
      
    case 'electronics':
      if (name.includes('tv')) {
        return { length: 48, width: 28, height: 3 };
      }
      if (name.includes('laptop')) {
        return { length: 14, width: 10, height: 1 };
      }
      return { length: 12, width: 8, height: 6 };
      
    default:
      return { length: 24, width: 12, height: 12 };
  }
}

function estimateWeight(dimensions, category) {
  const volume = dimensions.length * dimensions.width * dimensions.height;
  
  // Weight estimation based on category and volume
  switch (category) {
    case 'high-end-furniture':
      return Math.max(15, Math.round(volume * 0.008)); // Heavier, quality materials
      
    case 'furniture':
      return Math.max(10, Math.round(volume * 0.006));
      
    case 'outdoor':
      return Math.max(8, Math.round(volume * 0.005)); // Weather-resistant materials
      
    case 'electronics':
      return Math.max(2, Math.round(volume * 0.01)); // Dense but compact
      
    case 'lighting':
      return Math.max(3, Math.round(volume * 0.003)); // Lighter materials
      
    case 'rugs':
      return Math.max(5, Math.round(volume * 0.02)); // Fabric density
      
    case 'textiles':
      return Math.max(1, Math.round(volume * 0.001)); // Very light
      
    case 'appliances':
      return Math.max(25, Math.round(volume * 0.015)); // Heavy materials
      
    default:
      return Math.max(5, Math.round(volume * 0.004));
  }
}

function calculateShippingCost(dimensions, weight, itemPrice) {
  // Base shipping calculation
  const volume = dimensions.length * dimensions.width * dimensions.height;
  const volumeWeight = volume / 166; // Dimensional weight factor
  const billableWeight = Math.max(weight, volumeWeight);
  
  // Base cost calculation
  let shippingCost = 15; // Base rate
  
  // Weight-based pricing
  if (billableWeight <= 10) {
    shippingCost += billableWeight * 2;
  } else if (billableWeight <= 50) {
    shippingCost += 20 + (billableWeight - 10) * 3;
  } else if (billableWeight <= 150) {
    shippingCost += 140 + (billableWeight - 50) * 4;
  } else {
    shippingCost += 540 + (billableWeight - 150) * 5;
  }
  
  // Size surcharges
  const maxDimension = Math.max(dimensions.length, dimensions.width, dimensions.height);
  if (maxDimension > 96) {
    shippingCost += 100; // Oversized surcharge
  } else if (maxDimension > 72) {
    shippingCost += 50;
  } else if (maxDimension > 48) {
    shippingCost += 25;
  }
  
  // Item value adjustment
  if (itemPrice > 1000) {
    shippingCost *= 1.2; // Premium handling
  } else if (itemPrice < 50) {
    shippingCost = Math.min(shippingCost, itemPrice * 0.5); // Cap at 50% of item value
  }
  
  // Final safeguards
  shippingCost = Math.max(15, Math.min(shippingCost, 800)); // Min $15, Max $800
  
  return Math.round(shippingCost);
}

// Start server
async function startServer() {
  await initializeSystems();
  
  app.listen(PORT, () => {
    console.log(`🚀 SDL Import Calculator running on port ${PORT}`);
    console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
    console.log(`🔧 Admin calculator: http://localhost:${PORT}/admin-calculator`);
    
    if (bolHistoricalData && bolHistoricalData.initialized) {
      bolHistoricalData.getInsights();
    }
  });
}

startServer().catch(console.error);