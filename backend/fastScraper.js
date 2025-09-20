const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
require('dotenv').config();
// const OrderTracker = require('./orderTracking');
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

// Initialize order tracker - DISABLED
// let orderTracker = null;
// 
// OrderTracker.create().then(tracker => {
//   orderTracker = tracker;
// }).catch(error => {
//   console.error('Failed to initialize order tracker:', error);
// });

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
  
  // Add padding based on category
  const paddingFactors = {
    'electronics': 1.3,  // More padding for fragile items
    'appliances': 1.2,
    'furniture': 1.1,   // Less padding for large items
    'clothing': 1.4,     // More padding for soft goods
    'books': 1.2,
    'toys': 1.25,
    'sports': 1.2,
    'home-decor': 1.35,  // More padding for fragile decor
    'tools': 1.15,
    'garden': 1.2,
    'general': 1.25
  };
  
  const factor = paddingFactors[category] || 1.25;
  
  return {
    length: Math.round(productDimensions.length * factor * 10) / 10,
    width: Math.round(productDimensions.width * factor * 10) / 10,
    height: Math.round(productDimensions.height * factor * 10) / 10
  };
}

function calculateShippingCost(dimensions, weight, price) {
  if (!dimensions) {
    // No dimensions available, use a default based on price
    return Math.max(25, price * 0.15);
  }
  
  console.log(`   🧮 DETAILED Shipping calculation:`);
  console.log(`   📦 Input dimensions: ${dimensions.length}" × ${dimensions.width}" × ${dimensions.height}"`);
  
  // Calculate volume in cubic feet
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  console.log(`   📊 VOLUME CALCULATION:`);
  console.log(`   📊   ${dimensions.length} × ${dimensions.width} × ${dimensions.height} = ${cubicInches.toFixed(0)} cubic inches`);
  console.log(`   📊   ${cubicInches.toFixed(0)} ÷ 1728 = ${cubicFeet.toFixed(3)} cubic feet`);
  
  // Base rate: $8 per cubic foot, minimum $15
  const baseCost = Math.max(15, cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT);
  console.log(`   💰 BASE COST CALCULATION:`);
  console.log(`   💰   ${cubicFeet.toFixed(3)} × $${SHIPPING_RATE_PER_CUBIC_FOOT} = $${(cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT).toFixed(2)}`);
  console.log(`   💰   Math.max(15, ${(cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT).toFixed(2)}) = $${baseCost.toFixed(2)}`);
  
  // Add handling fee
  const handlingFee = 15;
  console.log(`   📋 HANDLING FEE: $${handlingFee}`);
  
  // Total shipping cost
  const totalShippingCost = baseCost + handlingFee;
  console.log(`   💰 TOTAL SHIPPING: $${baseCost.toFixed(2)} + $${handlingFee} = $${totalShippingCost.toFixed(2)}`);
  
  return Math.round(totalShippingCost * 100) / 100;
}

// Enhanced GPT enhancement function
async function enhanceProductDataWithGPT(zyteData, url, retailer) {
  if (!process.env.OPENAI_API_KEY) {
    return zyteData;
  }
  
  try {
    console.log('   🧠 Enhancing product data with GPT intelligence...');
    
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const prompt = `Enhance this product data intelligently. Extract ALL meaningful variants (color, size, style, orientation) and realistic shipping box dimensions. Return valid JSON format.

Product: "${zyteData.name}"
Category: "${zyteData.category}"
Current Variant: "${zyteData.variant || 'none'}"
Current Price: $${zyteData.price || 'unknown'}
Current Dimensions: ${JSON.stringify(zyteData.dimensions)}
Retailer: ${retailer}
URL: ${url}

Rules:
1. VERIFY PRICE: If you see sale/current price info, return the SALE price, not regular price
1. Extract ALL meaningful variants: color, size, style, orientation, material
2. For furniture: Extract size (King, Queen, 63"), color (Navy, Gray), style (Left-facing, Right-facing)
3. Extract realistic shipping box dimensions based on product type
4. Get the main product image URL if available
5. Return valid JSON format with these fields:
   - "salePrice": actual sale price if different from current price
   - "allVariants": ["Color: Navy", "Size: King", "Orientation: Left-facing"]
   - "primaryVariant": "Navy King Left-facing Sectional"
   - "enhancedDimensions": {"length": X, "width": Y, "height": Z}
   - "mainImage": "https://..."

Examples:
- Sectional Sofa → allVariants: ["Color: Navy", "Size: 89.5W", "Orientation: Left-facing"], primaryVariant: "Navy 89.5W Left-facing"
- Standing Desk → allVariants: ["Color: Rustic Brown", "Size: 47.25W"], primaryVariant: "Rustic Brown 47.25W"
- Office Chair → allVariants: ["Color: Black", "Style: Ergonomic"], primaryVariant: "Black Ergonomic"`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a furniture expert. Enhance product data intelligently and return valid JSON format. PRIORITIZE SALE PRICES over regular prices.' },
        { role: 'user', content: prompt }
      ],
    });

    const enhancement = JSON.parse(response.choices[0].message.content || '{}');
    
    // SAFELY enhance the data (never replace, only improve)
    const enhanced = { ...zyteData };
    
    // Check if GPT found a better (sale) price
    if (enhancement.salePrice && typeof enhancement.salePrice === 'number' && enhancement.salePrice > 0 && enhancement.salePrice < zyteData.price) {
      enhanced.price = enhancement.salePrice;
      console.log(`   💰 Enhanced price: $${zyteData.price} → $${enhancement.salePrice} (sale price)`);
    } else if (enhancement.salePrice && typeof enhancement.salePrice === 'number' && enhancement.salePrice > 0) {
      // Even if it's not lower, use it if it's a valid sale price and significantly different
      const priceDifference = Math.abs(enhancement.salePrice - zyteData.price);
      if (priceDifference > zyteData.price * 0.1) { // More than 10% difference
        enhanced.price = enhancement.salePrice;
        console.log(`   💰 Enhanced price: $${zyteData.price} → $${enhancement.salePrice} (corrected price)`);
      }
    }
    
    // Enhance variants if GPT found better ones
    if (enhancement.allVariants && Array.isArray(enhancement.allVariants) && enhancement.allVariants.length > 0) {
      enhanced.allVariants = enhancement.allVariants;
      console.log(`   🎨 Enhanced variants: ${enhancement.allVariants.join(', ')}`);
    }
    
    if (enhancement.primaryVariant && enhancement.primaryVariant !== 'none' && enhancement.primaryVariant.length > 3) {
      enhanced.variant = enhancement.primaryVariant;
      console.log(`   🎨 Enhanced variant: "${zyteData.variant}" → "${enhancement.primaryVariant}"`);
    }
    
    // Enhance main image if GPT found a better one
    if (enhancement.mainImage && enhancement.mainImage.startsWith('http')) {
      enhanced.image = enhancement.mainImage;
      console.log(`   🖼️ Enhanced image URL`);
    }
    
    // Enhance dimensions if GPT found better ones
    if (enhancement.enhancedDimensions && 
        enhancement.enhancedDimensions.length > 0 &&
        enhancement.enhancedDimensions.width > 0 &&
        enhancement.enhancedDimensions.height > 0) {
      
      // Only use GPT dimensions if they seem more realistic
      const gptVolume = enhancement.enhancedDimensions.length * enhancement.enhancedDimensions.width * enhancement.enhancedDimensions.height;
      const currentVolume = zyteData.dimensions ? (zyteData.dimensions.length * zyteData.dimensions.width * zyteData.dimensions.height) : 0;
      
      // Use GPT dimensions if they're significantly larger (more realistic for furniture)
      if (gptVolume > currentVolume * 1.5) {
        enhanced.dimensions = enhancement.enhancedDimensions;
        console.log(`   📦 Enhanced dimensions: ${Math.round(gptVolume/1728 * 100)/100} ft³ vs ${Math.round(currentVolume/1728 * 100)/100} ft³`);
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
  
  console.log(`   🛏️ IKEA Multi-Box Analysis for: "${productName.substring(0, 50)}..."`);
  console.log(`   📦 Single box: ${singleBoxDimensions.length}" × ${singleBoxDimensions.width}" × ${singleBoxDimensions.height}" (${(volume/1728).toFixed(2)} ft³)`);
  
  let boxMultiplier = 1;
  let confidence = 'low';
  
  // Bed frames - typically 2-4 boxes depending on size
  if (/\b(bed|frame|headboard|footboard)\b/.test(name)) {
    if (price > 400) {
      boxMultiplier = 4; // King/Queen beds
      confidence = 'high';
    } else if (price > 200) {
      boxMultiplier = 3; // Full/Double beds
      confidence = 'medium';
    } else {
      boxMultiplier = 2; // Twin beds
      confidence = 'medium';
    }
  }
  // Wardrobes/Armoires - typically 3-6 boxes
  else if (/\b(wardrobe|armoire|closet|pax)\b/.test(name)) {
    if (price > 500) {
      boxMultiplier = 6; // Large PAX systems
      confidence = 'high';
    } else if (price > 300) {
      boxMultiplier = 4; // Medium wardrobes
      confidence = 'medium';
    } else {
      boxMultiplier = 3; // Small wardrobes
      confidence = 'medium';
    }
  }
  // Dining sets - typically 2-3 boxes (table + chairs)
  else if (/\b(dining|table.*chair|chair.*table)\b/.test(name)) {
    boxMultiplier = 3;
    confidence = 'medium';
  }
  // Sectional sofas - typically 2-4 boxes
  else if (/\b(sectional|sofa.*section|corner.*sofa)\b/.test(name)) {
    if (price > 800) {
      boxMultiplier = 4; // Large sectionals
      confidence = 'high';
    } else {
      boxMultiplier = 3; // Small sectionals
      confidence = 'medium';
    }
  }
  // Kitchen systems - typically 3-8 boxes
  else if (/\b(kitchen|cabinet.*set|knoxhult|enhet)\b/.test(name)) {
    if (price > 1000) {
      boxMultiplier = 8; // Full kitchen
      confidence = 'medium';
    } else if (price > 500) {
      boxMultiplier = 5; // Partial kitchen
      confidence = 'medium';
    } else {
      boxMultiplier = 3; // Small kitchen set
      confidence = 'low';
    }
  }
  // Bookshelves/Storage - typically 2-3 boxes for tall units
  else if (/\b(bookshelf|shelf.*unit|billy|hemnes.*bookcase|kallax)\b/.test(name)) {
    if (price > 200) {
      boxMultiplier = 3; // Tall/wide units
      confidence = 'medium';
    } else {
      boxMultiplier = 2; // Standard units
      confidence = 'medium';
    }
  }
  // Desks - typically 2 boxes for larger desks
  else if (/\b(desk|workstation|office.*table)\b/.test(name)) {
    if (price > 300) {
      boxMultiplier = 2; // Large desks
      confidence = 'medium';
    }
  }
  // Default for other furniture
  else if (price > 300) {
    boxMultiplier = 2; // Assume larger furniture ships in 2 boxes
    confidence = 'low';
  }
  
  // Calculate estimated total shipping dimensions
  // Strategy: Stack boxes efficiently (2x2 for 4 boxes, 2x3 for 6 boxes, etc.)
  let totalDimensions;
  
  if (boxMultiplier <= 2) {
    // Side by side
    totalDimensions = {
      length: singleBoxDimensions.length * boxMultiplier,
      width: singleBoxDimensions.width,
      height: singleBoxDimensions.height
    };
  } else if (boxMultiplier <= 4) {
    // 2x2 arrangement
    totalDimensions = {
      length: singleBoxDimensions.length * 2,
      width: singleBoxDimensions.width * 2,
      height: singleBoxDimensions.height
    };
  } else if (boxMultiplier <= 6) {
    // 2x3 arrangement
    totalDimensions = {
      length: singleBoxDimensions.length * 2,
      width: singleBoxDimensions.width * 3,
      height: singleBoxDimensions.height
    };
  } else {
    // 2x4 arrangement for 8 boxes
    totalDimensions = {
      length: singleBoxDimensions.length * 2,
      width: singleBoxDimensions.width * 4,
      height: singleBoxDimensions.height
    };
  }
  
  const totalVolume = totalDimensions.length * totalDimensions.width * totalDimensions.height;
  
  console.log(`   📊 IKEA Multi-Box Estimate:`);
  console.log(`   📊   Product type: ${getIkeaProductType(name)}`);
  console.log(`   📊   Estimated boxes: ${boxMultiplier} (confidence: ${confidence})`);
  console.log(`   📊   Total dimensions: ${totalDimensions.length}" × ${totalDimensions.width}" × ${totalDimensions.height}"`);
  console.log(`   📊   Total volume: ${(totalVolume/1728).toFixed(2)} ft³ (vs single box: ${(volume/1728).toFixed(2)} ft³)`);
  console.log(`   ⚠️   This is an ESTIMATE - actual IKEA shipping may vary`);
  
  return {
    dimensions: totalDimensions,
    boxCount: boxMultiplier,
    confidence: confidence,
    singleBoxVolume: volume / 1728,
    totalVolume: totalVolume / 1728,
    estimationMethod: 'ikea-multibox'
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

// Main product scraping function
async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  
  let productData = null;
  let scrapingMethod = 'none';
  let confidence = null;
  
  console.log(`\n🔍 Scraping: ${url}`);
  console.log(`   🏪 Retailer: ${retailer}`);
  
  // STEP 1: Try Zyte API first
  if (USE_ZYTE) {
    try {
      console.log('   🕷️ Trying Zyte API...');
      const zyteResult = await zyteScraper.scrapeProduct(url);
      
      if (zyteResult && zyteResult.name && zyteResult.price) {
        productData = zyteResult;
        scrapingMethod = 'zyte';
        confidence = zyteResult.confidence || null;
        console.log(`   ✅ Zyte success! Product: "${zyteResult.name.substring(0, 50)}..." Price: $${zyteResult.price}`);
        
        // Skip GPT enhancement if we already have good Zyte data
        if (productData.confidence && productData.confidence > 0.95 && productData.allVariants && productData.allVariants.length > 2) {
          console.log('   ✅ Skipping GPT enhancement - Zyte data is excellent');
        } else {
          const gptResult = await parseWithGPT({ 
            url: productData.url, 
            html: `Product: ${productData.name}\nPrice: $${productData.price}\nVariants: ${productData.allVariants?.join(', ') || productData.variant || 'None'}\nImage: ${productData.image || 'None'}`, 
            currencyFallback: 'USD' 
          });
          
          // Only use GPT enhancements if they're significantly different or better
          if (gptResult.allVariants && gptResult.allVariants.length > (productData.allVariants?.length || 0)) {
            productData.allVariants = gptResult.allVariants;
            productData.variant = gptResult.variant;
            console.log('   🎨 Enhanced variants:', gptResult.allVariants);
          }
          
          if (gptResult.variant && gptResult.variant.length > (productData.variant?.length || 0)) {
            const cleanVariant = gptResult.variant.replace(/[|•]/g, ' ').replace(/\s+/g, ' ').trim();
            productData.variant = cleanVariant;
            console.log(`   🎨 Enhanced variant: "${productData.variant}" → "${cleanVariant}"`);
          }
          
          if (gptResult.image && gptResult.image !== productData.image && gptResult.image.startsWith('http')) {
            productData.image = gptResult.image;
            console.log('   🖼️ Enhanced image URL');
          }
          
          // Only use GPT price if it's significantly different (>10% difference)
          if (gptResult.price && Math.abs(gptResult.price - productData.price) > (productData.price * 0.1)) {
            console.log(`   💰 GPT found different price: $${gptResult.price} vs $${productData.price}`);
            productData.price = gptResult.price;
          }
          
          if (gptResult.dimensions && !productData.dimensions) {
            productData.dimensions = gptResult.dimensions;
            console.log('   📦 Enhanced dimensions:', (gptResult.dimensions.length * gptResult.dimensions.width * gptResult.dimensions.height / 1728).toFixed(1), 'ft³ vs', (productData.dimensions?.length * productData.dimensions?.width * productData.dimensions?.height / 1728 || 0).toFixed(1), 'ft³');
          }
        }
        
        try {
          productData = await enhanceProductDataWithGPT(productData, url, retailer);
          console.log('   ✅ GPT enhancement successful');
        } catch (gptError) {
          console.log('   ⚠️ GPT enhancement failed, using original Zyte data:', gptError.message);
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
        totalVolume: ikeaEstimate.totalVolume,
        estimationMethod: ikeaEstimate.estimationMethod
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
          variant: gptData.variant,
          allVariants: gptData.allVariants || []
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
          }
        };
        
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
  // Order tracking disabled - missing orderTracking.js file
  return res.status(500).json({ error: 'Order tracking not available' });
});

app.get('/api/orders/:orderId/tracking-status', async (req, res) => {
  // Order tracking disabled - missing orderTracking.js file
  return res.status(500).json({ error: 'Order tracking not available' });
});

app.post('/api/orders/:orderId/stop-tracking', async (req, res) => {
  // Order tracking disabled - missing orderTracking.js file
  return res.status(500).json({ error: 'Order tracking not available' });
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
});
