// server/routes/instantImport.js
// Instant Import API endpoints for Bermuda Import Calculator
// Handles POST / and /instant-import with Zyte integration

const express = require('express');

// Optional normalizer - handle if missing
let normalizeZyteProduct = null;
try {
  ({ normalizeZyteProduct } = require('../../importer/normalize'));
} catch (e) {
  console.warn('Normalizer not available:', e.message);
}

// Optional Zyte scraper - handle if missing
let ZyteScraper = null;
try {
  ZyteScraper = require('../../backend/zyteScraper');
} catch (e) {
  console.warn('ZyteScraper not available:', e.message);
}

// Optional GPT parser - handle if missing
let parseProduct = null;
try {
  ({ parseProduct } = require('../../backend/gptParser'));
} catch (e) {
  console.warn('GPT parser not available:', e.message);
}

/**
 * Create instant import router
 */
function createInstantImportRouter() {
  const router = express.Router();

  // Health check endpoint
  router.get('/instant-import/health', (req, res) => {
    const zyteEnabled = !!(process.env.ZYTE_API_KEY && process.env.ZYTE_API_KEY.trim());
    const gptEnabled = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
    
    res.json({
      ok: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      scrapers: {
        zyte: zyteEnabled ? 'enabled' : 'disabled',
        gpt: gptEnabled ? 'enabled' : 'disabled',
        normalizer: normalizeZyteProduct ? 'enabled' : 'disabled'
      }
    });
  });

  // Main instant import endpoint - handles both POST / and POST /instant-import
  const handleInstantImport = async (req, res) => {
    try {
      const { url } = req.body;
      
      if (!url || typeof url !== 'string') {
        return res.status(400).json({
          error: 'MISSING_URL',
          message: 'URL is required in request body'
        });
      }

      console.log(`[Instant Import] Processing: ${url}`);

      let result = null;
      let engine = 'none';
      let confidence = 0;

      // Try Zyte first (primary scraper)
      if (ZyteScraper && normalizeZyteProduct) {
        try {
          const zyteScraper = new ZyteScraper();
          if (zyteScraper.enabled) {
            console.log('[Instant Import] Trying Zyte scraper...');
            const zyteData = await zyteScraper.scrapeProduct(url);
            
            if (zyteData) {
              // Normalize Zyte data to standard format
              result = normalizeZyteProduct(zyteData, url);
              engine = 'zyte';
              confidence = result.confidence || 0;
              
              console.log(`[Instant Import] Zyte success - confidence: ${(confidence * 100).toFixed(1)}%`);
            }
          }
        } catch (error) {
          console.warn('[Instant Import] Zyte failed:', error.message);
        }
      }

      // Try GPT fallback if Zyte failed or low confidence
      if (!result || confidence < 0.8) {
        if (parseProduct && process.env.OPENAI_API_KEY) {
          try {
            console.log('[Instant Import] Trying GPT parser...');
            const gptData = await parseProduct(url);
            
            if (gptData) {
              // GPT data is already normalized
              result = {
                ...gptData,
                retailer: detectRetailer(url),
                extractedAt: new Date().toISOString()
              };
              engine = result ? 'gpt-enhanced' : 'gpt-only';
              
              console.log('[Instant Import] GPT success');
            }
          } catch (error) {
            console.warn('[Instant Import] GPT failed:', error.message);
          }
        }
      }

      // Fallback: return basic mock data if all methods failed
      if (!result) {
        result = {
          url: url,
          name: 'Sample Product (Scrapers Not Configured)',
          price: 99.99,
          currency: 'USD',
          image: null,
          brand: null,
          category: null,
          inStock: true,
          dimensions: { length: 24, width: 18, height: 12 },
          weight: null,
          variant: null,
          allVariants: [],
          retailer: detectRetailer(url),
          extractedAt: new Date().toISOString(),
          confidence: 0
        };
        engine = 'mock';
        
        console.log('[Instant Import] Using mock data - scrapers not configured');
      }

      // Calculate shipping estimate if dimensions are available
      if (result.dimensions && result.price) {
        result.shippingEstimate = calculateShippingEstimate(result);
      }

      // Log meta summary
      console.log(`[META] ${engine} | ${result.retailer} | $${result.price} | ${result.name?.substring(0, 50)}...`);

      // Return successful result
      res.json({
        success: true,
        engine: engine,
        confidence: confidence,
        product: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('[Instant Import] Unexpected error:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while processing the request'
      });
    }
  };

  // Mount the handler on both routes
  router.post('/', handleInstantImport);
  router.post('/instant-import', handleInstantImport);

  // Legacy /products endpoint for backward compatibility
  router.get('/products', async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
      return res.status(400).json({
        error: 'MISSING_URL',
        message: 'URL query parameter is required'
      });
    }

    // Convert GET to POST format and reuse handler
    req.body = { url };
    await handleInstantImport(req, res);
  });

  return router;
}

/**
 * Calculate shipping estimate based on product data
 */
function calculateShippingEstimate(product) {
  if (!product.dimensions || !product.price) {
    return null;
  }

  const { length, width, height } = product.dimensions;
  const price = product.price;

  // Calculate cubic feet
  const cubicInches = length * width * height;
  const cubicFeet = cubicInches / 1728;

  // Base shipping cost ($8 per cubic foot, minimum $15)
  const baseShippingCost = Math.max(15, cubicFeet * 8);

  // Oversize fee for items over 48 inches in any dimension
  const oversizeFee = Math.max(length, width, height) > 48 ? 50 : 0;

  // High-value fee (2% for items over $500)
  const highValueFee = price > 500 ? price * 0.02 : 0;

  // Handling fee
  const handlingFee = 15;

  // Total shipping
  const totalShipping = baseShippingCost + oversizeFee + highValueFee + handlingFee;

  // Duty calculation (26.5% of product price)
  const dutyAmount = price * 0.265;

  // Delivery fee
  const deliveryFee = 25;

  // Total import cost
  const totalImportCost = price + dutyAmount + totalShipping + deliveryFee;

  return {
    cubicFeet: Math.round(cubicFeet * 1000) / 1000,
    baseShipping: Math.round(baseShippingCost * 100) / 100,
    oversizeFee: oversizeFee,
    highValueFee: Math.round(highValueFee * 100) / 100,
    handlingFee: handlingFee,
    totalShipping: Math.round(totalShipping * 100) / 100,
    dutyAmount: Math.round(dutyAmount * 100) / 100,
    deliveryFee: deliveryFee,
    totalImportCost: Math.round(totalImportCost * 100) / 100,
    currency: product.currency || 'USD'
  };
}

/**
 * Detect retailer from URL
 */
function detectRetailer(url) {
  if (!url) return 'Unknown';
  
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    
    if (hostname.includes('amazon')) return 'Amazon';
    if (hostname.includes('wayfair')) return 'Wayfair';
    if (hostname.includes('target')) return 'Target';
    if (hostname.includes('walmart')) return 'Walmart';
    if (hostname.includes('bestbuy')) return 'Best Buy';
    if (hostname.includes('homedepot')) return 'Home Depot';
    if (hostname.includes('lowes')) return 'Lowes';
    if (hostname.includes('costco')) return 'Costco';
    if (hostname.includes('macys')) return 'Macys';
    if (hostname.includes('ikea')) return 'IKEA';
    if (hostname.includes('crateandbarrel')) return 'Crate & Barrel';
    if (hostname.includes('cb2')) return 'CB2';
    if (hostname.includes('westelm')) return 'West Elm';
    if (hostname.includes('potterybarn') return 'Pottery Barn';
    )
    
    return 'Unknown';
  } catch (e) {
    return 'Unknown';
  }
}

module.exports = createInstantImportRouter;