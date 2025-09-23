// backend/fastScraper.js - Enhanced Multi-Method Scraper with Zyte Primary, GPT Secondary
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import scrapers and utilities
const ZyteScraper = require('./zyteScraper');
const BoxEstimator = require('./boxEstimator');
const AdaptiveScraper = require('./adaptiveScraper');

// Import GPT parser
let gptParser = null;
try {
  gptParser = require('./gptParser');
  console.log('✅ GPT Parser loaded successfully');
} catch (error) {
  console.log('⚠️ GPT Parser not available:', error.message);
}

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize components
const zyteScraper = new ZyteScraper();
const boxEstimator = new BoxEstimator();
const adaptiveScraper = new AdaptiveScraper();

console.log('=== SERVER STARTUP ===');
console.log('Port:', PORT);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log('1. Primary: Zyte API -', zyteScraper.enabled ? '✅ ENABLED' : '❌ DISABLED');
console.log('2. Secondary: GPT Parser -', gptParser ? '✅ ENABLED' : '❌ DISABLED');
console.log('3. Fallback: Adaptive Scraper - ✅ ENABLED');
console.log('');

// Enhanced CORS configuration
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:8080',
    'https://sdl.bm',
    'https://www.sdl.bm',
    /\.railway\.app$/,
    /\.vercel\.app$/,
    /\.netlify\.app$/
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Serve static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Health endpoints
app.get('/ping', (req, res) => {
  res.json({ ok: true });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    scrapers: {
      zyte: zyteScraper.enabled ? 'enabled' : 'disabled',
      gpt: gptParser ? 'enabled' : 'disabled',
      adaptive: 'enabled'
    }
  });
});

// Helper function to check if critical fields are missing
function missingCritical(product) {
  if (!product) return true;
  
  const hasCriticalFields = product.name && 
                           product.price && 
                           product.price > 0;
  
  const hasOptionalFields = product.dimensions || 
                           product.weight || 
                           product.image;
  
  // Missing critical fields or lacking any optional enrichment data
  return !hasCriticalFields || !hasOptionalFields;
}

// Helper function to detect which engine was used
function detectEngine(product, zyteUsed, gptUsed, enriched) {
  if (zyteUsed && gptUsed && enriched) return 'Zyte + GPT-enriched';
  if (zyteUsed && !gptUsed) return 'Zyte-only';
  if (!zyteUsed && gptUsed) return 'GPT-only';
  if (zyteUsed && gptUsed && !enriched) return 'Zyte + GPT-fallback';
  return 'Adaptive-fallback';
}

// Enhanced scraping function with Zyte primary, GPT secondary
async function scrapeProductData(url) {
  console.log(`[Scraper] Starting enhanced scraping for: ${url.substring(0, 60)}...`);
  
  let zyteResult = null;
  let gptResult = null;
  let finalResult = null;
  let zyteUsed = false;
  let gptUsed = false;
  let enriched = false;
  
  const retailer = detectRetailer(url);
  
  // Step 1: Try Zyte API (Primary)
  if (zyteScraper.enabled) {
    try {
      console.log('[Scraper] 🕷️ Trying Zyte API as primary...');
      zyteResult = await zyteScraper.scrapeProduct(url);
      zyteUsed = true;
      
      if (zyteResult && zyteResult.name) {
        console.log(`[Scraper] ✅ Zyte extraction successful: ${zyteResult.name.substring(0, 50)}...`);
        console.log(`[Scraper] 📊 Zyte data quality: Price=${!!zyteResult.price}, Image=${!!zyteResult.image}, Dimensions=${!!zyteResult.dimensions}`);
        
        finalResult = zyteResult;
      }
    } catch (error) {
      console.log('[Scraper] ⚠️ Zyte API failed:', error.message);
      zyteResult = null;
    }
  }
  
  // Step 2: GPT Enrichment (if Zyte data incomplete) or GPT Fallback (if Zyte failed)
  if (gptParser && gptParser.parseProduct) {
    try {
      if (zyteResult && missingCritical(zyteResult)) {
        // GPT Enrichment mode
        console.log('[Scraper] 🤖 Running GPT enrichment for incomplete Zyte data...');
        gptResult = await gptParser.parseProduct(url);
        gptUsed = true;
        enriched = true;
        
        if (gptResult) {
          // Merge GPT data into Zyte result, prioritizing non-null values
          finalResult = {
            ...zyteResult,
            name: zyteResult.name || gptResult.name,
            price: zyteResult.price || gptResult.price,
            image: zyteResult.image || gptResult.image,
            dimensions: zyteResult.dimensions || gptResult.dimensions,
            weight: zyteResult.weight || gptResult.weight,
            variant: zyteResult.variant || gptResult.variant,
            selectedVariants: zyteResult.selectedVariants || gptResult.selectedVariants,
            assemblyFee: zyteResult.assemblyFee || gptResult.assemblyFee,
            isFlatPacked: zyteResult.isFlatPacked !== null ? zyteResult.isFlatPacked : gptResult.isFlatPacked,
            brand: zyteResult.brand || gptResult.brand,
            category: zyteResult.category || gptResult.category,
            confidence: Math.max(zyteResult.confidence || 0, gptResult.confidence || 0)
          };
          console.log('[Scraper] ✅ GPT enrichment completed');
        }
      } else if (!zyteResult) {
        // GPT Fallback mode
        console.log('[Scraper] 🤖 Running GPT as fallback (Zyte failed)...');
        gptResult = await gptParser.parseProduct(url);
        gptUsed = true;
        
        if (gptResult && gptResult.name && gptResult.price) {
          finalResult = gptResult;
          console.log('[Scraper] ✅ GPT fallback successful');
        }
      }
    } catch (error) {
      console.log('[Scraper] ⚠️ GPT processing failed:', error.message);
    }
  }
  
  // Step 3: Final validation and box estimation
  if (finalResult && finalResult.name && finalResult.price) {
    // Add box estimation if dimensions missing
    if (!finalResult.dimensions && !finalResult.estimatedBoxes) {
      const boxes = boxEstimator.estimateBoxDimensions(finalResult);
      finalResult.estimatedBoxes = boxes;
      finalResult.dimensions = boxes[0];
    }
    
    // Add metadata
    finalResult.url = url;
    finalResult.retailer = finalResult.retailer || retailer;
    finalResult.scrapedAt = new Date().toISOString();
    finalResult.engine = detectEngine(finalResult, zyteUsed, gptUsed, enriched);
    
    // Record success
    await adaptiveScraper.recordScrapingAttempt(url, retailer, true, finalResult);
    
    console.log(`[Scraper] ✅ Final result - Engine: ${finalResult.engine}`);
    return finalResult;
  }
  
  // Step 4: Adaptive fallback (last resort)
  console.log('[Scraper] 🔄 Using adaptive fallback...');
  const fallbackResult = {
    url: url,
    name: `Product from ${retailer}`,
    price: 100, // Default price for demo
    currency: 'USD',
    image: null,
    retailer: retailer,
    dimensions: { length: 24, width: 18, height: 12 },
    weight: null,
    variant: null,
    selectedVariants: {},
    assemblyFee: null,
    isFlatPacked: false,
    inStock: true,
    category: 'Unknown',
    brand: null,
    confidence: 0.1,
    engine: 'Adaptive-fallback',
    scrapedAt: new Date().toISOString(),
    _fallback: true
  };
  
  // Record failure
  await adaptiveScraper.recordScrapingAttempt(url, retailer, false, null, ['all_methods_failed']);
  
  console.log('[Scraper] ⚠️ Using adaptive fallback data');
  return fallbackResult;
}

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
    return 'Unknown';
  } catch (e) {
    return 'Unknown';
  }
}

// API Routes
app.post('/api/scrape', async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ 
        error: 'URLs array is required',
        received: typeof urls
      });
    }
    
    if (urls.length === 0) {
      return res.status(400).json({ error: 'At least one URL is required' });
    }
    
    if (urls.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 URLs allowed per request' });
    }
    
    console.log(`[API] Processing ${urls.length} URLs with Zyte primary, GPT secondary...`);
    
    const products = [];
    const errors = [];
    const engineStats = {};
    
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].trim();
      
      if (!url) {
        console.log(`[API] Skipping empty URL at index ${i}`);
        continue;
      }
      
      if (!url.startsWith('http')) {
        console.log(`[API] Invalid URL at index ${i}: ${url}`);
        errors.push(`Invalid URL: ${url}`);
        continue;
      }
      
      try {
        console.log(`[API] Processing URL ${i + 1}/${urls.length}: ${url.substring(0, 60)}...`);
        
        const productData = await scrapeProductData(url);
        
        if (productData) {
          products.push(productData);
          
          // Track engine usage
          const engine = productData.engine || 'Unknown';
          engineStats[engine] = (engineStats[engine] || 0) + 1;
          
          console.log(`[API] ✅ Successfully processed: ${productData.name?.substring(0, 50)}... (Engine: ${engine})`);
        } else {
          throw new Error('No product data returned');
        }
        
      } catch (error) {
        console.error(`[API] ❌ Failed to process ${url}:`, error.message);
        
        errors.push(`Failed to process ${url}: ${error.message}`);
        
        // Add error product to maintain array consistency
        products.push({
          url: url,
          error: error.message,
          name: 'Failed to load',
          price: 0,
          retailer: detectRetailer(url),
          engine: 'Error'
        });
      }
    }
    
    console.log(`[API] Completed processing: ${products.length} products, ${errors.length} errors`);
    console.log(`[API] Engine usage:`, engineStats);
    
    const response = {
      success: true,
      products: products,
      total: products.length,
      engineStats: engineStats,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString()
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('[API] Scraping error:', error);
    res.status(500).json({ 
      error: 'SCRAPE_FAILED',
      message: error.message,
      success: false,
      timestamp: new Date().toISOString()
    });
  }
});

// Legacy /products endpoint for compatibility
app.get('/products', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    console.log(`[API] Single product request: ${url.substring(0, 60)}...`);
    
    const productData = await scrapeProductData(url);
    
    const response = {
      products: [productData],
      engine: productData.engine,
      timestamp: new Date().toISOString()
    };
    
    console.log(`[API] ✅ Single product processed (Engine: ${productData.engine})`);
    res.json(response);
    
  } catch (error) {
    console.error('[API] Single product error:', error);
    res.status(500).json({ 
      error: 'SCRAPE_FAILED', 
      message: error.message 
    });
  }
});

// Get scraper statistics
app.get('/api/stats', async (req, res) => {
  try {
    const stats = adaptiveScraper.getRetailerStats();
    res.json({
      success: true,
      stats: stats,
      scrapers: {
        zyte: zyteScraper.enabled ? 'enabled' : 'disabled',
        gpt: gptParser ? 'enabled' : 'disabled'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve admin pages
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

app.get('/admin-calculator', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin-calculator.html'));
});

// Catch-all route for frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📍 Ping: http://localhost:${PORT}/ping`);
  console.log(`📍 Admin Panel: http://localhost:${PORT}/admin`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});