const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
require('dotenv').config();
const OrderTracker = require('./orderTracking');
const ZyteScraper = require('./zyteScraper');
const { parseProduct: parseWithGPT } = require('./gptParser');

// Simple, working scraper approach
const MAX_CONCURRENT = 1; // Process one at a time to avoid issues

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPING_TIMEOUT = 30000;
const MAX_CONCURRENT_SCRAPES = 2;
const BERMUDA_DUTY_RATE = 0.265;
const SHIPPING_RATE_PER_CUBIC_FOOT = 8;

// Initialize scrapers
const zyteScraper = new ZyteScraper();
const USE_ZYTE = zyteScraper.enabled;
const USE_GPT_FALLBACK = !!process.env.OPENAI_API_KEY;

// Confidence threshold for triggering GPT fallback
const CONFIDENCE_THRESHOLD = 0.3; // If Zyte confidence < 30%, try GPT

// Initialize order tracker
let orderTracker = null;

OrderTracker.create().then(tracker => {
  orderTracker = tracker;
}).catch(error => {
  console.error('Failed to initialize order tracker:', error);
});

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Zyte API - ${USE_ZYTE ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log(`2. Fallback: GPT Parser - ${USE_GPT_FALLBACK ? '✅ ENABLED' : '❌ DISABLED (Missing OpenAI Key)'}`);
console.log('');

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Fix for Railway X-Forwarded-For warning
app.set('trust proxy', true);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// CRITICAL: Health check MUST be before rate limiter
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    scraping: {
      primary: USE_ZYTE ? 'Zyte API' : 'None',
      fallback: process.env.OPENAI_API_KEY ? 'GPT Parser' : 'None',
      dimensions: 'Estimation'
    },
    shopifyConfigured: !!SHOPIFY_ACCESS_TOKEN
  });
});

// Admin authentication middleware
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required');
  }
  
  const credentials = Buffer.from(auth.slice(6), 'base64').toString();
  const [username, password] = credentials.split(':');
  
  if (username === 'admin' && password === '1064') {
    next();
  } else {
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    res.status(401).send('Invalid credentials');
  }
}

// Admin routes
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

app.get('/admin-calculator', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin-calculator.html'));
});

// Root route - serve frontend HTML
app.get('/', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend', 'index.html');
  res.sendFile(frontendPath, (err) => {
    if (err) {
      console.error('Error serving frontend:', err);
      res.json({
        message: 'Frontend not found - API is running',
        endpoints: {
          health: '/health',
          scrape: 'POST /api/scrape',
          createOrder: 'POST /apps/instant-import/create-draft-order'
        }
      });
    }
  });
});

// Serve complete-order page
app.get('/complete-order.html', (req, res) => {
  const completePath = path.join(__dirname, '../frontend', 'complete-order.html');
  res.sendFile(completePath, (err) => {
    if (err) {
      console.error('Error serving complete-order page:', err);
      res.redirect('/');
    }
  });
});

// Rate limiter (after health check)
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
    if (domain.includes('lowes.com')) return 'Lowes';
    if (domain.includes('costco.com')) return 'Costco';
    if (domain.includes('macys.com')) return 'Macys';
    if (domain.includes('ikea.com')) return 'IKEA';
    if (domain.includes('overstock.com')) return 'Overstock';
    if (domain.includes('bedbathandbeyond.com')) return 'Bed Bath & Beyond';
    if (domain.includes('cb2.com')) return 'CB2';
    if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
    if (domain.includes('westelm.com')) return 'West Elm';
    if (domain.includes('potterybarn.com')) return 'Pottery Barn';
    if (domain.includes('lunafurn.com')) return 'Luna Furniture';
    return 'Unknown Retailer';
  } catch (e) {
    return 'Unknown Retailer';
  }
}

// SDL Domain blocking function
function isSDLDomain(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    const blockedPatterns = [
      'spencer-deals-ltd.myshopify.com',
      'sdl.bm',
      'spencer-deals',
      'spencerdeals',
      'sdl.com',
      '.sdl.'
    ];
    
    return blockedPatterns.some(pattern => domain.includes(pattern));
  } catch (e) {
    return false;
  }
}

function categorizeProduct(name, url) {
  const text = (name + ' ' + url).toLowerCase();
  
  // Handle category objects from Zyte (convert to string)
  if (typeof name === 'object' && name.name) {
    const categoryText = name.name.toLowerCase();
    if (categoryText.includes('mattress')) return 'furniture';
    if (categoryText.includes('bedroom')) return 'furniture';
    if (categoryText.includes('furniture')) return 'furniture';
  }
  
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
  
  // Check if dimensions are in the name
  const dimMatch = text.match(/(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)/);
  if (dimMatch) {
    const dims = {
      length: Math.max(1, parseFloat(dimMatch[1]) * 1.2),
      width: Math.max(1, parseFloat(dimMatch[2]) * 1.2), 
      height: Math.max(1, parseFloat(dimMatch[3]) * 1.2)
    };
    
    if (dims.length <= 120 && dims.width <= 120 && dims.height <= 120) {
      return dims;
    }
  }
  
  // Enhanced category estimates with more realistic sizes
  const baseEstimates = {
    'furniture': { 
      length: 48 + Math.random() * 30,
      width: 30 + Math.random() * 20,  
      height: 36 + Math.random() * 24
    },
    'electronics': { 
      length: 18 + Math.random() * 15,
      width: 12 + Math.random() * 8,
      height: 8 + Math.random() * 6
    },
    'appliances': { 
      length: 30 + Math.random() * 12,
      width: 30 + Math.random() * 12,
      height: 36 + Math.random() * 20
    },
    'clothing': { 
      length: 12 + Math.random() * 6,
      width: 10 + Math.random() * 6,
      height: 2 + Math.random() * 2
    },
    'books': { 
      length: 8 + Math.random() * 3,
      width: 5 + Math.random() * 3,
      height: 1 + Math.random() * 2
    },
    'toys': { 
      length: 12 + Math.random() * 8,
      width: 10 + Math.random() * 8,
      height: 8 + Math.random() * 8
    },
    'sports': { 
      length: 24 + Math.random() * 12,
      width: 18 + Math.random() * 10,
      height: 12 + Math.random() * 8
    },
    'home-decor': { 
      length: 12 + Math.random() * 12,
      width: 10 + Math.random() * 10,
      height: 12 + Math.random() * 12
    },
    'tools': { 
      length: 18 + Math.random() * 6,
      width: 12 + Math.random() * 6,
      height: 6 + Math.random() * 4
    },
    'garden': { 
      length: 24 + Math.random() * 12,
      width: 18 + Math.random() * 12,
      height: 12 + Math.random() * 12
    },
    'general': { 
      length: 14 + Math.random() * 8,
      width: 12 + Math.random() * 6,
      height: 10 + Math.random() * 6
    }
  };
  
  const estimate = baseEstimates[category] || baseEstimates['general'];
  
  return {
    length: Math.round(estimate.length * 10) / 10,
    width: Math.round(estimate.width * 10) / 10,
    height: Math.round(estimate.height * 10) / 10
  };
}

// Convert product dimensions to shipping box dimensions
function estimateBoxDimensions(productDimensions, category) {
  if (!productDimensions) return null;
  
  // ENHANCED: Add realistic packaging padding based on category and fragility
  const paddingFactors = {
    'electronics': 1.35,  // More padding for fragile items + protective foam
    'appliances': 1.25,   // Moderate padding + corner protection
    'furniture': 1.15,    // Minimal padding for large/sturdy items
    'clothing': 1.45,     // Significant padding for soft goods compression
    'books': 1.2,
    'toys': 1.3,          // Extra padding for irregular shapes
    'sports': 1.25,       // Moderate padding for equipment
    'home-decor': 1.4,    // High padding for fragile decorative items
    'tools': 1.2,         // Moderate padding for metal items
    'garden': 1.25,       // Moderate padding for outdoor items
    'general': 1.3        // Conservative estimate for unknown items
  };
  
  const factor = paddingFactors[category] || 1.25;
  
  // ENHANCED: Add minimum padding requirements (at least 2 inches per side for fragile items)
  const minPadding = ['electronics', 'home-decor'].includes(category) ? 4 : 2; // 2 inches per side = 4 total
  
  return {
    length: Math.round(Math.max(productDimensions.length * factor, productDimensions.length + minPadding) * 10) / 10,
    width: Math.round(Math.max(productDimensions.width * factor, productDimensions.width + minPadding) * 10) / 10,
    height: Math.round(Math.max(productDimensions.height * factor, productDimensions.height + minPadding) * 10) / 10
  };
}

function calculateShippingCost(dimensions, weight, price) {
  if (!dimensions) {
    // No dimensions available, use a default based on price
    console.log(`   ⚠️ No dimensions - using price-based estimate`);
    return Math.max(30, price * 0.18); // Slightly higher default for safety
  }
  
  console.log(`   🧮 ENHANCED DETAILED Shipping calculation:`);
  console.log(`   📦 Input dimensions: ${dimensions.length}" × ${dimensions.width}" × ${dimensions.height}"`);
  
  // Calculate volume in cubic feet
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  console.log(`   📊 VOLUME CALCULATION:`);
  console.log(`   📊   ${dimensions.length} × ${dimensions.width} × ${dimensions.height} = ${cubicInches.toFixed(0)} cubic inches`);
  console.log(`   📊   ${cubicInches.toFixed(0)} ÷ 1728 = ${cubicFeet.toFixed(3)} cubic feet`);
  
  // ENHANCED: Progressive pricing based on size
  let ratePerCubicFoot = SHIPPING_RATE_PER_CUBIC_FOOT;
  
  // Larger items get slightly better rates (economies of scale)
  if (cubicFeet > 20) {
    ratePerCubicFoot = SHIPPING_RATE_PER_CUBIC_FOOT * 0.9; // 10% discount for large items
    console.log(`   💰 Large item discount applied: $${ratePerCubicFoot.toFixed(2)}/ft³`);
  } else if (cubicFeet < 1) {
    ratePerCubicFoot = SHIPPING_RATE_PER_CUBIC_FOOT * 1.2; // 20% premium for tiny items
    console.log(`   💰 Small item premium applied: $${ratePerCubicFoot.toFixed(2)}/ft³`);
  }
  
  // Base cost with enhanced minimum
  const baseCost = Math.max(20, cubicFeet * ratePerCubicFoot); // Increased minimum from $15 to $20
  console.log(`   💰 BASE COST CALCULATION:`);
  console.log(`   💰   ${cubicFeet.toFixed(3)} × $${ratePerCubicFoot.toFixed(2)} = $${(cubicFeet * ratePerCubicFoot).toFixed(2)}`);
  console.log(`   💰   Math.max(20, ${(cubicFeet * ratePerCubicFoot).toFixed(2)}) = $${baseCost.toFixed(2)}`);
  
  // ENHANCED: Oversize surcharges
  let oversizeFee = 0;
  const maxDimension = Math.max(dimensions.length, dimensions.width, dimensions.height);
  
  if (maxDimension > 96) {
    oversizeFee = 100; // Very large items
    console.log(`   📏 OVERSIZE FEE: Max dimension ${maxDimension}" > 96" = $${oversizeFee}`);
  } else if (maxDimension > 72) {
    oversizeFee = 50; // Large items
    console.log(`   📏 OVERSIZE FEE: Max dimension ${maxDimension}" > 72" = $${oversizeFee}`);
  } else if (maxDimension > 48) {
    oversizeFee = 25; // Medium-large items
    console.log(`   📏 OVERSIZE FEE: Max dimension ${maxDimension}" > 48" = $${oversizeFee}`);
  }
  
  // ENHANCED: High-value item insurance fee
  let valueFee = 0;
  if (price > 2000) {
    valueFee = price * 0.015; // 1.5% for very high value
    console.log(`   💎 HIGH VALUE FEE: $${price} > $2000 = $${valueFee.toFixed(2)} (1.5%)`);
  } else if (price > 1000) {
    valueFee = price * 0.01; // 1% for high value
    console.log(`   💎 HIGH VALUE FEE: $${price} > $1000 = $${valueFee.toFixed(2)} (1%)`);
  } else if (price > 500) {
    valueFee = price * 0.005; // 0.5% for medium value
    console.log(`   💎 VALUE FEE: $${price} > $500 = $${valueFee.toFixed(2)} (0.5%)`);
  }
  
  // Add handling fee
  const handlingFee = 18; // Increased from $15 to $18
  console.log(`   📋 HANDLING FEE: $${handlingFee}`);
  
  // Total shipping cost
  const totalShippingCost = baseCost + oversizeFee + valueFee + handlingFee;
  console.log(`   💰 ENHANCED TOTAL SHIPPING:`);
  console.log(`   💰   Base: $${baseCost.toFixed(2)}`);
  if (oversizeFee > 0) console.log(`   💰   Oversize: $${oversizeFee.toFixed(2)}`);
  if (valueFee > 0) console.log(`   💰   Value: $${valueFee.toFixed(2)}`);
  console.log(`   💰   Handling: $${handlingFee.toFixed(2)}`);
  console.log(`   💰   TOTAL: $${totalShippingCost.toFixed(2)}`);
  
  return Math.round(totalShippingCost * 100) / 100;
}

// Enhanced GPT enhancement function
async function enhanceProductDataWithGPT(zyteData, url, retailer) {
  if (!process.env.OPENAI_API_KEY) {
    return zyteData;
  }
  
  try {
    console.log('   🧠 Enhancing product data with ADVANCED GPT intelligence...');
    
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const prompt = `ENHANCED PRODUCT INTELLIGENCE: Analyze this product and provide SHIPPING BOX dimensions (not product dimensions).

Product: "${zyteData.name}"
Category: "${zyteData.category}"
Current Variant: "${zyteData.variant || 'none'}"
Current Product Dimensions: ${JSON.stringify(zyteData.dimensions)}
Retailer: ${retailer}
Price: $${zyteData.price || 'unknown'}

CRITICAL RULES:
1. SHIPPING BOX dimensions (what UPS/FedEx would measure) - NOT product dimensions
2. Add 2-6 inches padding per side for packaging materials
3. For furniture: Consider disassembly/flat-pack vs assembled shipping
4. For electronics: Consider protective packaging requirements
5. Multi-box items: Estimate largest single box dimensions
6. Primary variant should be SIZE/DIMENSION over color (King vs Blue)

Return ONLY: {
  "primaryVariant": "...",
  "shippingBoxDimensions": {"length": X, "width": Y, "height": Z},
  "packagingType": "flat-pack|assembled|multi-box|standard",
  "confidence": "high|medium|low"
}

EXAMPLES:
- King Mattress → shippingBoxDimensions: {length: 84, width: 84, height: 16} (rolled/compressed)
- 63" Loveseat → shippingBoxDimensions: {length: 68, width: 40, height: 36} (assembled)
- IKEA Dresser → shippingBoxDimensions: {length: 48, width: 24, height: 8} (flat-pack)`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a shipping/logistics expert specializing in e-commerce packaging. Focus on REALISTIC shipping box dimensions.' },
        { role: 'user', content: prompt }
      ],
    });

    const enhancement = JSON.parse(response.choices[0].message.content || '{}');
    
    // SAFELY enhance the data with new shipping intelligence
    const enhanced = { ...zyteData };
    
    // Enhance variant if GPT found a better one
    if (enhancement.primaryVariant && enhancement.primaryVariant !== 'none') {
      enhanced.variant = enhancement.primaryVariant;
      console.log(`   🎨 Enhanced variant: "${zyteData.variant}" → "${enhancement.primaryVariant}"`);
    }
    
    // Enhance with SHIPPING BOX dimensions if GPT found better ones
    if (enhancement.shippingBoxDimensions && 
        enhancement.shippingBoxDimensions.length > 0 &&
        enhancement.shippingBoxDimensions.width > 0 &&
        enhancement.shippingBoxDimensions.height > 0) {
      
      // Only use GPT shipping dimensions if confidence is medium/high
      const confidence = enhancement.confidence || 'low';
      const gptVolume = enhancement.shippingBoxDimensions.length * enhancement.shippingBoxDimensions.width * enhancement.shippingBoxDimensions.height;
      const currentVolume = zyteData.dimensions ? (zyteData.dimensions.length * zyteData.dimensions.width * zyteData.dimensions.height) : 0;
      
      // Use GPT shipping dimensions if confidence is good OR they're more realistic
      if (confidence !== 'low' || gptVolume > currentVolume * 1.2) {
        enhanced.dimensions = enhancement.shippingBoxDimensions;
        enhanced.packagingType = enhancement.packagingType || 'standard';
        enhanced.dimensionSource = 'gpt-shipping-enhanced';
        console.log(`   📦 Enhanced SHIPPING dimensions (${confidence} confidence): ${Math.round(gptVolume/1728 * 100)/100} ft³ vs ${Math.round(currentVolume/1728 * 100)/100} ft³`);
        console.log(`   📦 Packaging type: ${enhanced.packagingType}`);
      }
    }
    
    return enhanced;
    
  } catch (error) {
    console.log('   ❌ GPT enhancement error:', error.message);
    return zyteData; // Return original data if enhancement fails
  }
}

// Check if IKEA product needs component collection
function checkIfIkeaNeedsComponents(productName, price) {
  const name = productName.toLowerCase();
  
  // Bed frames - typically 2-4 components
  if (/\b(bed|frame|headboard|footboard)\b/.test(name)) {
    if (price > 400) {
      return { count: 4, type: 'bed frame' }; // King/Queen beds
    } else if (price > 200) {
      return { count: 3, type: 'bed frame' }; // Full/Double beds
    } else {
      return { count: 2, type: 'bed frame' }; // Twin beds
    }
  }
  
  // Wardrobes/PAX - typically 3-6 components
  if (/\b(wardrobe|armoire|closet|pax)\b/.test(name)) {
    if (price > 500) {
      return { count: 6, type: 'wardrobe system' }; // Large PAX systems
    } else if (price > 300) {
      return { count: 4, type: 'wardrobe' }; // Medium wardrobes
    } else {
      return { count: 3, type: 'wardrobe' }; // Small wardrobes
    }
  }
  
  // Kitchen systems - typically 4-8 components
  if (/\b(kitchen|cabinet.*set|knoxhult|enhet)\b/.test(name)) {
    if (price > 1000) {
      return { count: 8, type: 'kitchen system' }; // Full kitchen
    } else if (price > 500) {
      return { count: 5, type: 'kitchen set' }; // Partial kitchen
    } else {
      return { count: 4, type: 'kitchen unit' }; // Small kitchen set
    }
  }
  
  // Sectional sofas - typically 2-4 components
  if (/\b(sectional|sofa.*section|corner.*sofa)\b/.test(name)) {
    if (price > 800) {
      return { count: 4, type: 'sectional sofa' }; // Large sectionals
    } else {
      return { count: 3, type: 'sectional sofa' }; // Small sectionals
    }
  }
  
  // Dining sets - typically 2-3 components (table + chairs)
  if (/\b(dining|table.*chair|chair.*table)\b/.test(name)) {
    return { count: 3, type: 'dining set' };
  }
  
  // Large storage/shelving - typically 2-3 components for tall units
  if (/\b(bookshelf|shelf.*unit|billy|hemnes.*bookcase|kallax)\b/.test(name) && price > 200) {
    return { count: 3, type: 'storage unit' };
  }
  
  // Large desks - typically 2 components
  if (/\b(desk|workstation|office.*table)\b/.test(name) && price > 300) {
    return { count: 2, type: 'desk system' };
  }
  
  return null; // Single component item
}

// Helper function to check if essential data is complete
function isDataComplete(productData) {
  return productData && 
         productData.name && 
         productData.name !== 'Unknown Product' &&
         productData.image && 
         productData.dimensions &&
         productData.dimensions.length > 0 &&
         productData.dimensions.width > 0 &&
         productData.dimensions.height > 0;
}

// Helper function to check if dimensions look suspicious/wrong
function dimensionsLookSuspicious(dimensions) {
  if (!dimensions) return true;
  
  const { length, width, height } = dimensions;
  
  // Check for missing or zero dimensions
  if (!length || !width || !height || length <= 0 || width <= 0 || height <= 0) {
    return true;
  }
  
  // Check for unreasonably small dimensions (likely extraction errors)
  if (length < 2 && width < 2 && height < 2) {
    return true;
  }
  
  // Check for unreasonably large dimensions (likely extraction errors)
  if (length > 200 || width > 200 || height > 200) {
    return true;
  }
  
  return false;
}

// IKEA Multi-Box Estimator - estimates total shipping volume for IKEA furniture
function estimateIkeaMultiBoxShipping(singleBoxDimensions, productName, price) {
  const name = productName.toLowerCase();
  const volume = singleBoxDimensions.length * singleBoxDimensions.width * singleBoxDimensions.height;
  
  console.log(`   🛏️ ENHANCED IKEA Multi-Box Analysis for: "${productName.substring(0, 50)}..."`);
  console.log(`   📦 Single box: ${singleBoxDimensions.length}" × ${singleBoxDimensions.width}" × ${singleBoxDimensions.height}" (${(volume/1728).toFixed(2)} ft³)`);
  
  let boxMultiplier = 1;
  let confidence = 'low';
  let packagingNotes = '';
  
  // ENHANCED: More specific IKEA product analysis
  if (/\b(bed|frame|headboard|footboard)\b/.test(name)) {
    if (price > 400) {
      boxMultiplier = 4; // King/Queen beds - frame, headboard, slats, hardware
      confidence = 'high';
      packagingNotes = 'King/Queen bed - frame, headboard, slats, hardware';
    } else if (price > 200) {
      boxMultiplier = 3; // Full/Double beds - frame, headboard, slats
      confidence = 'medium';
      packagingNotes = 'Full/Double bed - frame, headboard, slats';
    } else {
      boxMultiplier = 2; // Twin beds - frame, slats
      confidence = 'medium';
      packagingNotes = 'Twin bed - frame and slats';
    }
  }
  // PAX Wardrobes - IKEA's modular system
  else if (/\b(wardrobe|armoire|closet|pax)\b/.test(name)) {
    if (price > 500) {
      boxMultiplier = 6; // Large PAX systems - sides, shelves, doors, hardware
      confidence = 'high';
      packagingNotes = 'Large PAX system - sides, shelves, doors, hardware';
    } else if (price > 300) {
      boxMultiplier = 4; // Medium PAX - sides, shelves, doors
      confidence = 'medium';
      packagingNotes = 'Medium PAX wardrobe - sides, shelves, doors';
    } else {
      boxMultiplier = 3; // Small PAX - basic components
      confidence = 'medium';
      packagingNotes = 'Small PAX wardrobe - basic components';
    }
  }
  // Kitchen systems - IKEA's flat-pack kitchen units
  else if (/\b(kitchen|cabinet.*set|knoxhult|enhet|metod)\b/.test(name)) {
    if (price > 1000) {
      boxMultiplier = 8; // Full kitchen - cabinets, doors, drawers, hardware
      confidence = 'medium';
      packagingNotes = 'Full kitchen system - multiple cabinet boxes';
    } else if (price > 500) {
      boxMultiplier = 5; // Partial kitchen - few cabinets
      confidence = 'medium';
      packagingNotes = 'Kitchen set - cabinet boxes and hardware';
    } else {
      boxMultiplier = 3; // Small kitchen unit
      confidence = 'low';
      packagingNotes = 'Small kitchen unit - basic components';
    }
  }
  // Dining sets - table + chairs
  else if (/\b(dining|table.*chair|chair.*table)\b/.test(name)) {
    boxMultiplier = 3; // Table top, legs, chairs
    confidence = 'medium';
    packagingNotes = 'Dining set - table and chairs separately boxed';
  }
  // Sectional sofas - typically 2-4 boxes
  else if (/\b(sectional|sofa.*section|corner.*sofa)\b/.test(name)) {
    if (price > 800) {
      boxMultiplier = 4; // Large sectionals - multiple sections
      confidence = 'high';
      packagingNotes = 'Large sectional - multiple seat sections';
    } else {
      boxMultiplier = 3; // Small sectionals - corner + sections
      confidence = 'medium';
      packagingNotes = 'Sectional sofa - corner and seat sections';
    }
  }
  // Storage systems - BILLY, KALLAX, HEMNES
  else if (/\b(bookshelf|shelf.*unit|billy|hemnes.*bookcase|kallax|ivar)\b/.test(name)) {
    if (price > 200) {
      boxMultiplier = 3; // Tall units - shelves, sides, back panel
      confidence = 'medium';
      packagingNotes = 'Tall storage unit - shelves, sides, back panel';
    } else {
      boxMultiplier = 2; // Standard units - main components
      confidence = 'medium';
      packagingNotes = 'Standard storage unit - main components';
    }
  }
  // Desks - typically 2 boxes for larger desks
  else if (/\b(desk|workstation|office.*table|bekant|linnmon)\b/.test(name)) {
    if (price > 300) {
      boxMultiplier = 2; // Large desks - top and legs/frame
      confidence = 'medium';
      packagingNotes = 'Large desk - desktop and legs/frame';
    }
  }
  // Default for other furniture
  else if (price > 300) {
    boxMultiplier = 2; // Assume larger furniture needs multiple boxes
    confidence = 'low';
    packagingNotes = 'Large furniture item - estimated multi-box';
  }
  
  // ENHANCED: Calculate estimated total shipping dimensions
  // Strategy: Optimize stacking for freight efficiency
  let totalDimensions;
  
  if (boxMultiplier <= 2) {
    // Side by side for 2 boxes
    totalDimensions = {
      length: singleBoxDimensions.length * boxMultiplier,
      width: singleBoxDimensions.width,
      height: singleBoxDimensions.height
    };
  } else if (boxMultiplier <= 4) {
    // 2x2 arrangement for 3-4 boxes
    totalDimensions = {
      length: singleBoxDimensions.length * 2,
      width: singleBoxDimensions.width * 2,
      height: singleBoxDimensions.height
    };
  } else if (boxMultiplier <= 6) {
    // 2x3 arrangement for 5-6 boxes
    totalDimensions = {
      length: singleBoxDimensions.length * 2,
      width: singleBoxDimensions.width * 3,
      height: singleBoxDimensions.height
    };
  } else {
    // 2x4 arrangement for 7-8 boxes
    totalDimensions = {
      length: singleBoxDimensions.length * 2,
      width: singleBoxDimensions.width * 4,
      height: singleBoxDimensions.height
    };
  }
  
  const totalVolume = totalDimensions.length * totalDimensions.width * totalDimensions.height;
  
  console.log(`   📊 ENHANCED IKEA Multi-Box Estimate:`);
  console.log(`   📊   Product analysis: ${packagingNotes}`);
  console.log(`   📊   Estimated boxes: ${boxMultiplier} (confidence: ${confidence})`);
  console.log(`   📊   Total dimensions: ${totalDimensions.length}" × ${totalDimensions.width}" × ${totalDimensions.height}"`);
  console.log(`   📊   Total volume: ${(totalVolume/1728).toFixed(2)} ft³ (vs single box: ${(volume/1728).toFixed(2)} ft³)`);
  console.log(`   ⚠️   ENHANCED ESTIMATE - based on IKEA flat-pack patterns`);
  
  return {
    dimensions: totalDimensions,
    boxCount: boxMultiplier,
    confidence: confidence,
    packagingNotes: packagingNotes,
    singleBoxVolume: volume / 1728,
    totalVolume: totalVolume / 1728,
    estimationMethod: 'ikea-multibox-enhanced'
  };
}

function getIkeaProductType(name) {
  if (/\b(bed|frame|headboard)\b/.test(name)) return 'Bed Frame';
  if (/\b(wardrobe|armoire|pax)\b/.test(name)) return 'Wardrobe/Storage';
  if (/\b(dining|table.*chair)\b/.test(name)) return 'Dining Set';
  if (/\b(sectional|sofa.*section)\b/.test(name)) return 'Sectional Sofa';
  if (/\b(kitchen|cabinet.*set)\b/.test(name)) return 'Kitchen System';
  if (/\b(bookshelf|billy|kallax)\b/.test(name)) return 'Storage/Shelving';
  if (/\b(desk|workstation)\b/.test(name)) return 'Desk/Office';
  return 'Furniture';
}

// Merge product data from multiple sources
function mergeProductData(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  
  return {
    name: primary.name || secondary.name,
    price: primary.price || secondary.price,
    image: primary.image || secondary.image,
    dimensions: primary.dimensions || secondary.dimensions,
    weight: primary.weight || secondary.weight,
    brand: primary.brand || secondary.brand,
    category: primary.category || secondary.category,
    inStock: primary.inStock !== undefined ? primary.inStock : secondary.inStock,
    variant: primary.variant || secondary.variant
  };
}

// Enhanced product data enhancement with URL parameter analysis
async function enhanceProductDataWithAdvancedGPT(productData, url, retailer) {
  if (!process.env.OPENAI_API_KEY) {
    return productData;
  }
  
  try {
    console.log('   🧠 Enhancing product data with ADVANCED GPT intelligence...');
    
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // Extract URL parameters for variant detection
    const urlObj = new URL(url);
    const urlParams = Object.fromEntries(urlObj.searchParams.entries());
    
    console.log('   🔍 URL parameters detected:', urlParams);
    
    // Enhanced prompt with URL parameter analysis
    const enhancementPrompt = `
You are an expert e-commerce product analyzer. Analyze this product data and return enhanced information in JSON format.

Product URL: ${productData.url}
URL Parameters: ${urlParams}
Current Data: ${JSON.stringify(productData, null, 2)}

Enhance the product data with:
1. SELECTED variant detection (color, size, style from URL params and selected options)
2. Correct product image URL for the SELECTED variant (not default)
3. Intelligent shipping box estimation based on product type and dimensions
4. Realistic cubic feet calculation for shipping

Return a JSON object with these fields:
- selected_variant: string (e.g., "Dark Green Corduroy, Left Hand Facing")
- variant_image_url: string (image URL for selected variant)
- estimated_shipping_box: object with length, width, height, cubic_feet, confidence, reasoning
- enhanced_category: string (better category than current)

Focus on accuracy - this affects customer orders and shipping costs.
`;

        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a product analysis expert. Always return valid JSON format responses.'
            },
            {
              role: 'user', 
              content: enhancementPrompt
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 1000
        });

    const enhancement = JSON.parse(response.choices[0].message.content || '{}');
    
    // SAFELY enhance the data with new intelligence
    const enhanced = { ...productData };
    
    // Enhance variant if GPT found a better one
    if (enhancement.selected_variant && enhancement.selected_variant !== 'none') {
      enhanced.variant = enhancement.selected_variant;
      console.log(`   🎨 Enhanced variant: "${productData.variant}" → "${enhancement.selected_variant}"`);
    }
    
    // Enhance image if GPT found a variant-specific one
    if (enhancement.variant_image_url && enhancement.variant_image_url !== productData.image) {
      enhanced.image = enhancement.variant_image_url;
      console.log(`   🖼️ Enhanced image for selected variant`);
    }
    
    // Enhance with SHIPPING BOX dimensions if GPT found better ones
    if (enhancement.estimated_shipping_box && 
        enhancement.estimated_shipping_box.length > 0 &&
        enhancement.estimated_shipping_box.width > 0 &&
        enhancement.estimated_shipping_box.height > 0) {
      
      const confidence = enhancement.estimated_shipping_box.confidence || 'low';
      const gptVolume = enhancement.estimated_shipping_box.length * enhancement.estimated_shipping_box.width * enhancement.estimated_shipping_box.height;
      const currentVolume = productData.dimensions ? (productData.dimensions.length * productData.dimensions.width * productData.dimensions.height) : 0;
      
      // Use GPT shipping dimensions if confidence is good OR they're more realistic
      if (confidence !== 'low' || gptVolume > currentVolume * 1.2) {
        enhanced.dimensions = {
          length: enhancement.estimated_shipping_box.length,
          width: enhancement.estimated_shipping_box.width,
          height: enhancement.estimated_shipping_box.height
        };
        enhanced.dimensionSource = 'gpt-advanced-enhanced';
        enhanced.shippingReasoning = enhancement.estimated_shipping_box.reasoning;
        console.log(`   📦 Enhanced SHIPPING dimensions (${confidence} confidence): ${Math.round(gptVolume/1728 * 100)/100} ft³`);
        console.log(`   📦 Reasoning: ${enhancement.estimated_shipping_box.reasoning}`);
      }
    }
    
    // Enhance category if GPT found a better one
    if (enhancement.enhanced_category && enhancement.enhanced_category !== productData.category) {
      enhanced.category = enhancement.enhanced_category;
      console.log(`   📂 Enhanced category: "${productData.category}" → "${enhancement.enhanced_category}"`);
    }
    
    return enhanced;
    
  } catch (error) {
    console.log('   ❌ Advanced GPT enhancement error:', error.message);
    return productData; // Return original data if enhancement fails
  }
}

// Main product scraping function
async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  
  let productData = null;
  let scrapingMethod = 'none';
  let confidence = null;
  
  console.log(`\n📦 Processing: ${url}`);
  console.log(`   Retailer: ${retailer}`);
  
  // STEP 1: Try Zyte API first
  try {
    console.log('   🕷️ Using Zyte API...');
    productData = await zyteScraper.scrapeProduct(url);
    confidence = productData?.confidence || null;
    scrapingMethod = 'zyte';
    
    if (confidence !== null) {
      console.log(`   📊 Zyte confidence: ${(confidence * 100).toFixed(1)}%`);
    }
    
    // Check if we got essential data - name AND price are required
    const hasEssentialData = productData && productData.name && productData.price;
    
    // Only fail if we have NO data at all
    if (!hasEssentialData) {
      console.log(`   ⚠️ Missing essential data (name: ${!!productData?.name}, price: ${!!productData?.price}), trying GPT fallback...`);
      throw new Error(`Zyte failed: missing essential data`);
    }
    
    console.log('   ✅ Zyte API success!');
    if (confidence !== null) {
      console.log(`   🎯 Confidence: ${(confidence * 100).toFixed(1)}%`);
    }
    
    // STEP 1.5: Advanced GPT Enhancement (SAFE - only enhances, never replaces)
    if (productData && USE_GPT_FALLBACK) {
      try {
        console.log('   🧠 Enhancing with ADVANCED GPT intelligence...');
        productData = await enhanceProductDataWithAdvancedGPT(productData, url, retailer);
        console.log('   ✅ Advanced GPT enhancement successful');
      } catch (error) {
        console.log('   ❌ GPT enhancement failed:', error.message);
      }
        // Override price if GPT found a significantly different price
        if (gptResult.price && (gptResult.price > product.price * 2 || product.price < 200)) {
        // Continue with original Zyte data - no harm done!
      }
    }
    
  } catch (error) {
    console.log('   ❌ Zyte API failed:', error.message);
    
    // STEP 2: Try GPT parser as fallback
    if (USE_GPT_FALLBACK) {
      try {
        console.log('   🤖 Trying GPT parser fallback...');
        const gptData = await parseWithGPT(url);
        
        // Check if GPT got essential data
        const gptHasEssentialData = gptData && gptData.name && gptData.price;
        
        if (gptHasEssentialData) {
          // Convert GPT parser format to our expected format
          productData = {
            name: gptData.name,
            price: gptData.price,
            image: gptData.image,
            dimensions: gptData.dimensions || gptData.package_dimensions,
            weight: gptData.weight || gptData.package_weight_lbs,
            brand: gptData.brand,
            category: gptData.category,
            inStock: gptData.inStock,
            variant: gptData.variant
          };
          scrapingMethod = 'gpt-fallback';
          console.log('   ✅ GPT parser fallback success!');
        } else {
          console.log('   ❌ GPT parser also missing essential data');
          throw new Error(`GPT parser failed: missing essential data (name: ${!!gptData?.name}, price: ${!!gptData?.price})`);
        }
      } catch (gptError) {
        console.log('   ❌ GPT parser fallback failed:', gptError.message);
        
        // Both Zyte and GPT failed - require manual entry
        console.log('   🚨 Both automated methods failed - requiring manual entry');
        scrapingMethod = 'manual-required';
      }
    } else {
      console.log('   ⚠️ No GPT fallback available (missing OpenAI API key)');
      scrapingMethod = 'manual-required';
    }
  }
  
  // Check if manual entry is required
  if (scrapingMethod === 'manual-required') {
    console.log(`   ⚠️ ${retailer} requires manual entry - both automated methods failed`);
    return {
      id: productId,
      url: url,
      name: null,
      price: null,
      image: null,
      category: 'general',
      retailer: retailer,
      dimensions: null,
      weight: null,
      shippingCost: 0,
      scrapingMethod: 'manual-required',
      confidence: null,
      variant: null,
      manualEntryRequired: true,
      message: `${retailer} requires manual entry. Please copy and paste the webpage content.`,
      dataCompleteness: {
        hasName: false,
        hasImage: false,
        hasDimensions: false,
        hasWeight: false,
        hasPrice: false,
        hasVariant: false
      }
    };
  }
  
  // Check if IKEA component collection is needed
  if (retailer === 'IKEA' && productData && productData.name && productData.price) {
    const needsComponents = checkIfIkeaNeedsComponents(productData.name, productData.price);
    if (needsComponents) {
      console.log(`   🛏️ IKEA product likely has multiple components: ${productData.name}`);
    }
    // TEMPORARILY DISABLED FOR DEBUGGING - Let's see what Zyte actually returns
    // if (scrapingMethod === 'manual-required') { ... }
  }
  
  // Ensure we always have valid productData for successful scrapes
  if (!productData) {
    productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true,
      variant: null
    };
  }
  
  // Fill in missing data with estimations
  const productName = (productData && productData.name) ? productData.name : `Product from ${retailer}`;
  
  // Handle category - safely convert object to string if needed
  let category = null;
  if (productData && productData.category) {
    category = productData.category;
  }
  if (typeof category === 'object' && category && category.name) {
    category = category.name; // Extract string from Zyte category object
  }
  if (!category || typeof category !== 'string') {
    category = categorizeProduct(productName, url);
  }
  
  console.log(`   📂 Final category: "${category}"`);
  
  // STEP 3: IKEA Multi-Box Estimation
  if (retailer === 'IKEA' && productData && productData.dimensions && productData.name && productData.price) {
    const ikeaEstimate = estimateIkeaMultiBoxShipping(productData.dimensions, productData.name, productData.price);
    
    if (ikeaEstimate.boxCount > 1) {
      productData.dimensions = ikeaEstimate.dimensions;
      productData.ikeaMultiBox = {
        estimatedBoxes: ikeaEstimate.boxCount,
        confidence: ikeaEstimate.confidence,
        singleBoxVolume: ikeaEstimate.singleBoxVolume,
        totalVolume: ikeaEstimate.totalVolume
      };
      
      scrapingMethod = scrapingMethod + '+ikea-multibox';
      
      console.log(`   🎯 Applied IKEA multi-box estimation (${ikeaEstimate.confidence} confidence)`);
    }
  }
  
  // STEP 4: Ensure we have dimensions before proceeding
  if (!productData || !productData.dimensions) {
    const estimatedDimensions = estimateDimensions(category, productName);
    if (productData) {
      productData.dimensions = estimatedDimensions;
    } else {
      productData = { dimensions: estimatedDimensions };
    }
    console.log('   📐 Estimated dimensions based on category:', category);
    if (scrapingMethod === 'none') {
      scrapingMethod = 'estimation';
    }
  }
  
  if (!productData || !productData.weight) {
    const estimatedWeight = estimateWeight(productData.dimensions, category);
    if (productData) {
      productData.weight = estimatedWeight;
    } else {
      productData = { ...productData, weight: estimatedWeight };
    }
    console.log('   ⚖️ Estimated weight based on dimensions');
  }
  
  // Calculate shipping cost
  const shippingCost = calculateShippingCost(
    productData.dimensions,
    productData.weight,
    (productData && productData.price) ? productData.price : 100
  );
  
  // Prepare final product object
  const product = {
    id: productId,
    url: url,
    name: productName,
    price: (productData && productData.price) ? productData.price : null,
    image: (productData && productData.image) ? productData.image : 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=SDL',
    category: category,
    retailer: retailer,
    dimensions: productData.dimensions,
    weight: productData.weight,
    shippingCost: shippingCost,
    scrapingMethod: scrapingMethod,
    confidence: confidence,
    variant: (productData && productData.variant) ? productData.variant : null,
    dataCompleteness: {
      hasName: !!(productData && productData.name),
      hasImage: !!(productData && productData.image),
      hasDimensions: !!(productData && productData.dimensions),
      hasWeight: !!(productData && productData.weight),
      hasPrice: !!(productData && productData.price),
      hasVariant: !!(productData && productData.variant)
    }
  };
  
  console.log(`   💰 Shipping cost: $${shippingCost}`);
  console.log(`   📊 Data source: ${scrapingMethod}`);
  if (confidence !== null) {
    console.log(`   🎯 Confidence: ${(confidence * 100).toFixed(1)}%`);
  }
  console.log(`   ✅ Product processed\n`);

  return product;
}

// Batch processing with concurrency control
async function processBatch(urls, batchSize = MAX_CONCURRENT) {
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
    
    const products = await processBatch(urls);
    console.log(`\n✅ Completed scraping ${products.length} products\n`);
    
    res.json({ 
      products
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape products' });
  }
});

// API endpoint for manual webpage processing
app.post('/api/process-manual-content', async (req, res) => {
  try {
    const { url, htmlContent } = req.body;
    
    if (!url || !htmlContent) {
      return res.status(400).json({ error: 'URL and HTML content required' });
    }
    
    console.log(`\n🤖 Processing manual content for: ${url}`);
    console.log(`📄 Content length: ${htmlContent.length} characters`);
    console.log(`📄 Content preview: ${htmlContent.substring(0, 200)}...`);
    
    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
      console.log('❌ OpenAI API key not found');
      return res.status(500).json({ 
        error: 'GPT processing not available - missing OpenAI API key' 
      });
    }
    
    console.log('✅ OpenAI API key found, proceeding with GPT parsing...');
    
    // Use OpenAI directly to parse the content
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    try {
      console.log('🤖 Calling GPT parser...');
      
      const retailer = detectRetailer(url);
      
      // Trim content to avoid token limits
      const trimmedContent = htmlContent.substring(0, 15000);
      
      const prompt = `Extract product information from this ${retailer} webpage content and return ONLY valid JSON with these fields:
- name (string)
- price (number, no currency symbols)
- dimensions (object with length, width, height in inches if found)
- sku (string if found)
- variant (string like color/size if found)

For Crate & Barrel: Extract dimensions from format like "23.8"H height 85.4"W width 37"D depth" as length=85.4, width=37, height=23.8.

Content: ${trimmedContent}`;

      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a product data extractor. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
      });

      const gptData = JSON.parse(response.choices[0].message.content || '{}');
      console.log('📊 GPT parser result:', {
        hasName: !!gptData?.name,
        hasPrice: !!gptData?.price,
        name: gptData?.name?.substring(0, 50),
        price: gptData?.price
      });
      
      if (gptData && gptData.name && gptData.price) {
        const retailer = detectRetailer(url);
        const category = gptData.category || categorizeProduct(gptData.name, url);
        
        // Convert to our expected format
        const productData = {
          name: gptData.name,
          price: gptData.price,
          image: gptData.image,
          dimensions: gptData.dimensions || gptData.package_dimensions,
          weight: gptData.weight || gptData.package_weight_lbs,
          brand: gptData.brand,
          category: category,
          inStock: gptData.inStock,
          variant: gptData.variant
        };
        
        // Fill in missing data with estimations
        if (!productData.dimensions) {
          productData.dimensions = estimateDimensions(category, productData.name);
        }
        
        if (!productData.weight) {
          productData.weight = estimateWeight(productData.dimensions, category);
        }
        
        const shippingCost = calculateShippingCost(
          productData.dimensions,
          productData.weight,
          productData.price
        );
        
        const product = {
          id: generateProductId(),
          url: url,
          name: productData.name,
          price: productData.price,
          image: productData.image || 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=SDL',
          category: category,
          retailer: retailer,
          dimensions: productData.dimensions,
          weight: productData.weight,
          shippingCost: shippingCost,
          scrapingMethod: 'manual-gpt',
          confidence: null,
          variant: productData.variant,
          dataCompleteness: {
            hasName: !!productData.name,
            hasImage: !!productData.image,
            hasDimensions: !!productData.dimensions,
            hasWeight: !!productData.weight,
            hasPrice: !!productData.price,
            hasVariant: !!productData.variant
          } else if (gptData.variant_image_available === false) {
            productData.variant_image_note = `Selected variant (${gptData.enhanced_variant || productData.variant}) not pictured - showing similar style`;
            console.log('   📷 Variant image not available - will show note to customer');
          }
        };
        
        if (gptData.variant_image_available === false) {
          product.variant_image_note = `Selected variant (${gptData.enhanced_variant || productData.variant}) not pictured - showing similar style`;
          console.log('   📷 Variant image not available - will show note to customer');
        }
        
          product.variant_image_note = `Selected variant (${gptData.enhanced_variant || productData.variant}) not pictured - showing similar style`;
          console.log('   📷 Variant image not available - will show note to customer');
        }
        
        console.log('   ✅ Manual content processed successfully');
        res.json({ success: true, product });
        
      } else {
        console.log('❌ GPT extraction failed - missing required data:', {
          hasName: !!gptData?.name,
          hasPrice: !!gptData?.price,
          gptData: gptData
        });
        throw new Error('GPT could not extract required data from manual content');
      }
      
    } catch (error) {
      console.log('❌ GPT parsing error details:', error.message);
      console.log('📄 Content sample for debugging:', htmlContent.substring(0, 500));
      console.log('   ❌ Manual content processing failed:', error.message);
      res.status(400).json({ 
        error: `GPT parsing failed: ${error.message}. Please try copying the webpage content again, including product name and price.` 
      });
    }
    
  } catch (error) {
    console.error('Manual content processing error:', error);
    res.status(500).json({ error: 'Failed to process manual content' });
  }
});

// Store pending orders temporarily (in memory for now, could use Redis later)
const pendingOrders = new Map();

// Endpoint to store pending order
app.post('/api/store-pending-order', (req, res) => {
  const orderId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  pendingOrders.set(orderId, {
    data: req.body,
    timestamp: Date.now()
  });
  
  // Clean up old orders after 1 hour
  setTimeout(() => pendingOrders.delete(orderId), 3600000);
  
  console.log(`📦 Stored pending order ${orderId}`);
  res.json({ orderId, success: true });
});

// Endpoint to retrieve pending order
app.get('/api/get-pending-order/:orderId', (req, res) => {
  const order = pendingOrders.get(req.params.orderId);
  if (order) {
    console.log(`✅ Retrieved pending order ${req.params.orderId}`);
    res.json(order.data);
    pendingOrders.delete(req.params.orderId); // Delete after retrieval
  } else {
    console.log(`❌ Order ${req.params.orderId} not found`);
    res.status(404).json({ error: 'Order not found or expired' });
  }
});

// Order tracking endpoints
app.post('/api/orders/:orderId/start-tracking', async (req, res) => {
  if (!orderTracker) {
    return res.status(500).json({ error: 'Order tracking not available' });
  }
  
  const { orderId } = req.params;
  const { retailerOrders } = req.body;
  
  const result = await orderTracker.startTracking(orderId, retailerOrders);
  res.json(result);
});

app.get('/api/orders/:orderId/tracking-status', async (req, res) => {
  if (!orderTracker) {
    return res.status(500).json({ error: 'Order tracking not available' });
  }
  
  const { orderId } = req.params;
  const status = await orderTracker.getTrackingStatus(orderId);
  res.json(status);
});

app.post('/api/orders/:orderId/stop-tracking', async (req, res) => {
  if (!orderTracker) {
    return res.status(500).json({ error: 'Order tracking not available' });
  }
  
  const { orderId } = req.params;
  const result = await orderTracker.stopTracking(orderId);
  res.json(result);
});

// Shopify Draft Order Creation
app.post('/apps/instant-import/create-draft-order', async (req, res) => {
  try {
    const { products, deliveryFees, totals, customer, originalUrls } = req.body;
    
    if (!SHOPIFY_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Shopify not configured. Please check API credentials.' });
    }
    
    if (!customer || !customer.email || !customer.name) {
      return res.status(400).json({ error: 'Customer information required' });
    }
    
    // Create line items for the draft order
    const lineItems = [];
    
    // Add each product as a line item
    products.forEach(product => {
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
    
    // Add duty as a line item
    if (totals.dutyAmount > 0) {
      lineItems.push({
        title: 'Bermuda Duty + Wharfage (26.5%)',
        price: totals.dutyAmount.toFixed(2),
        quantity: 1,
        taxable: false
      });
    }
    
    // Add delivery fees as line items
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
    
    // Add shipping cost as a line item
    if (totals.totalShippingCost > 0) {
      lineItems.push({
        title: 'Shipping & Handling to Bermuda',
        price: (totals.shippingCost || totals.totalShippingCost || 0).toFixed(2),
        quantity: 1,
        taxable: false
      });
    }
    
    // Create the draft order
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
    
    console.log(`📝 Creating draft order for ${customer.email}...`);
    
    // Make request to Shopify
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
    
    // Don't send invoice automatically - let customer complete checkout
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
      error: 'Failed to create draft order. Please try again or contact support.',
      details: error.response?.data?.errors || error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📍 Admin Panel: http://localhost:${PORT}/admin (admin:1064)`);
// Updated: Force Railway deployment trigger
});