// backend/fastScraper.js - Enhanced Multi-Method Scraper with ChatGPT-5 Primary
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
console.log('1. Primary: ChatGPT-5 Parser -', gptParser ? '✅ ENABLED' : '❌ DISABLED');
console.log('2. Secondary: Zyte API -', zyteScraper.enabled ? '✅ ENABLED' : '❌ DISABLED');
console.log('3. Fallback: Adaptive Scraper - ✅ ENABLED');
console.log('');

// Middleware
app.use(cors());
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

// Enhanced scraping function with multiple methods
async function scrapeProductData(url) {
  console.log(`[FastScraper] Starting enhanced scraping for: ${url.substring(0, 60)}...`);
  
  let lastError = null;
  let result = null;
  
  // Method 1: Try ChatGPT-5 Parser (Primary)
  if (gptParser && gptParser.parseProduct) {
    try {
      console.log('[FastScraper] Trying ChatGPT-5 parser as primary...');
      result = await gptParser.parseProduct(url);
      
      if (result && result.name && result.price && result.price > 0) {
        console.log('[FastScraper] ✅ ChatGPT-5 parsing successful');
        
        // Enhance with box estimation if needed
        if (!result.dimensions && !result.estimatedBoxes) {
          const boxes = boxEstimator.estimateBoxDimensions(result);
          result.estimatedBoxes = boxes;
          result.dimensions = boxes[0];
        }
        
        // Record success
        await adaptiveScraper.recordScrapingAttempt(url, result.retailer || 'Unknown', true, result);
        
        return result;
      }
    } catch (error) {
      console.log('[FastScraper] ⚠️ ChatGPT-5 parsing failed:', error.message);
      lastError = error;
    }
  }
  
  // Method 2: Try Zyte API (Secondary)
  if (zyteScraper.enabled) {
    try {
      console.log('[FastScraper] Trying Zyte API as secondary...');
      result = await zyteScraper.scrapeProduct(url);
      
      if (result && result.name && result.price && result.price > 0) {
        console.log('[FastScraper] ✅ Zyte scraping successful');
        
        // Enhance with box estimation if needed
        if (!result.dimensions && !result.estimatedBoxes) {
          const boxes = boxEstimator.estimateBoxDimensions(result);
          result.estimatedBoxes = boxes;
          result.dimensions = boxes[0];
        }
        
        // Record success
        await adaptiveScraper.recordScrapingAttempt(url, result.retailer || 'Unknown', true, result);
        
        return result;
      }
    } catch (error) {
      console.log('[FastScraper] ⚠️ Zyte scraping failed:', error.message);
      lastError = error;
    }
  }
  
  // Method 3: Fallback to basic extraction (if all else fails)
  try {
    console.log('[FastScraper] Using fallback method...');
    
    const retailer = detectRetailer(url);
    result = {
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
      _fallback: true
    };
    
    console.log('[FastScraper] ⚠️ Using fallback data');
    
    // Record failure
    await adaptiveScraper.recordScrapingAttempt(url, retailer, false, null, ['all_methods_failed']);
    
    return result;
    
  } catch (error) {
    console.log('[FastScraper] ❌ Even fallback failed:', error.message);
    lastError = error;
  }
  
  // If everything fails, throw the last error
  throw lastError || new Error('All scraping methods failed');
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
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    scrapers: {
      gpt: gptParser ? 'enabled' : 'disabled',
      zyte: zyteScraper.enabled ? 'enabled' : 'disabled',
      adaptive: 'enabled'
    }
  });
});

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
    
    console.log(`[API] Processing ${urls.length} URLs...`);
    
    const products = [];
    const errors = [];
    
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
          console.log(`[API] ✅ Successfully processed: ${productData.name?.substring(0, 50)}...`);
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
          retailer: detectRetailer(url)
        });
      }
    }
    
    console.log(`[API] Completed processing: ${products.length} products, ${errors.length} errors`);
    
    const response = {
      success: true,
      products: products,
      total: products.length,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString()
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('[API] Scraping error:', error);
    res.status(500).json({ 
      error: error.message,
      success: false,
      timestamp: new Date().toISOString()
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
        gpt: gptParser ? 'enabled' : 'disabled',
        zyte: zyteScraper.enabled ? 'enabled' : 'disabled'
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