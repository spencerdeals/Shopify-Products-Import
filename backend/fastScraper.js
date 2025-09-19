// backend/fastScraper.js - Main Server with Manual Content Processing
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Import scrapers
const ZyteScraper = require('./zyteScraper');
const ApifyActorScraper = require('./apifyActorScraper');
const UPCItemDB = require('./upcitemdb');
const BOLHistoricalData = require('./bolHistoricalData');
const OrderTracker = require('./orderTracking');

const app = express();
const PORT = process.env.PORT || 8080;

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

// Initialize services
const zyteScraper = new ZyteScraper();
const apifyScraper = new ApifyActorScraper(process.env.APIFY_API_KEY);
const upcItemDB = new UPCItemDB(process.env.UPCITEMDB_API_KEY);
const bolHistoricalData = new BOLHistoricalData();
let orderTracker = null;

// Initialize order tracker
OrderTracker.create().then(tracker => {
  orderTracker = tracker;
}).catch(error => {
  console.error('Failed to initialize order tracker:', error);
});

// Configuration flags
const USE_ZYTE = zyteScraper.enabled;
const USE_APIFY = apifyScraper.isAvailable();
const USE_UPC = upcItemDB.enabled;
const CONFIDENCE_THRESHOLD = 0.3;

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Zyte API - ${USE_ZYTE ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`2. Fallback: Apify - ${USE_APIFY ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`3. BOL Historical Data - ✅ ENABLED (Volume Patterns)`);
console.log(`4. UPCitemdb - ${USE_UPC ? '✅ ENABLED (Premium API)' : '❌ DISABLED'}`);
console.log(`5. Confidence Threshold: ${CONFIDENCE_THRESHOLD} (${CONFIDENCE_THRESHOLD * 100}%)`);

// Main product scraping function
async function scrapeProduct(url) {
  console.log(`📦 Processing: ${url}`);
  
  const retailer = detectRetailer(url);
  console.log(`   Retailer: ${retailer}`);
  
  let productData = null;
  let scrapingMethod = 'none';
  
  // STEP 1: Try Zyte first
  if (USE_ZYTE) {
    try {
      console.log('   🕷️ Using Zyte API...');
      productData = await zyteScraper.scrapeProduct(url);
      scrapingMethod = 'zyte';
      
      // Check confidence
      const confidence = calculateConfidence(productData);
      console.log(`   📊 Zyte confidence: ${(confidence * 100).toFixed(1)}%`);
      
      if (confidence < CONFIDENCE_THRESHOLD) {
        console.log(`   ⚠️ Low confidence (${(confidence * 100).toFixed(1)}%), trying fallback...`);
        throw new Error('Low confidence result');
      }
      
      console.log('   ✅ Zyte scraping successful');
    } catch (error) {
      console.log(`   ❌ Zyte API failed: ${error.message}`);
      productData = null;
    }
  }
  
  // STEP 2: Try Apify if Zyte failed
  if (!productData && USE_APIFY) {
    try {
      console.log('   🎭 Using Apify fallback...');
      productData = await apifyScraper.scrapeProduct(url);
      scrapingMethod = 'apify';
      console.log('   ✅ Apify scraping successful');
    } catch (error) {
      console.log(`   ❌ Apify failed: ${error.message}`);
    }
  }
  
  // STEP 3: Manual entry required
  if (!productData) {
    console.log('   🚨 Both automated methods failed - requiring manual entry');
    console.log(`   ⚠️ ${retailer} requires manual entry - both automated methods failed`);
    
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
    scrapingMethod = 'manual';
  }
  
  // Fill in missing data with estimations
  const productName = productData.name || `Product from ${retailer}`;
  const category = productData.category || categorizeProduct(productName, url);
  
  console.log(`   🏷️ Product category: ${category}`);
  
  if (!productData.dimensions) {
    productData.dimensions = estimateDimensions(category, productName);
    console.log(`   📐 Used category-based estimation for: ${category}`);
  }
  
  if (!productData.weight) {
    productData.weight = estimateWeight(productData.dimensions, category);
    console.log(`   ⚖️ Estimated weight: ${productData.weight} lbs`);
  }
  
  // Calculate shipping cost
  const shippingCost = calculateShippingCost(
    productData.dimensions,
    productData.weight,
    productData.price || 100
  );
  
  // Prepare final product object
  const product = {
    name: productData.name,
    price: productData.price,
    image: productData.image,
    dimensions: productData.dimensions,
    weight: productData.weight,
    brand: productData.brand,
    category: category,
    inStock: productData.inStock,
    variant: productData.variant,
    shippingCost: shippingCost,
    retailer: retailer,
    url: url,
    scrapingMethod: scrapingMethod
  };

  return product;
}

// Process manual content with REAL dimension extraction
async function processManualContent(url, content) {
  console.log(`🤖 Processing manual content for: ${url}`);
  console.log(`📄 Content length: ${content.length} characters`);
  console.log(`📄 Content preview: ${content.substring(0, 50)}...`);
  
  const retailer = detectRetailer(url);
  const category = categorizeProduct(content, url);
  
  console.log(`🔍 STARTING DIMENSION EXTRACTION for ${category}`);
  console.log(`📄 Content sample: "${content.substring(0, 200)}..."`);
  
  // Extract REAL dimensions from content
  const productData = extractProductFromContent(content, url, retailer, category);
  
  console.log(`📊 Extraction results:`, {
    hasName: !!productData.name,
    hasPrice: !!productData.price,
    hasDimensions: !!productData.dimensions,
    hasWeight: !!productData.weight
  });
  
  // Fill in missing data
  const productName = productData.name || `Product from ${retailer}`;
  
  if (!productData.dimensions) {
    console.log(`⚠️ No dimensions found in content, using category estimate`);
    productData.dimensions = estimateDimensions(category, productName);
  }
  
  if (!productData.weight) {
    productData.weight = estimateWeight(productData.dimensions, category);
  }
  
  // Calculate shipping cost
  const shippingCost = calculateShippingCost(
    productData.dimensions,
    productData.weight,
    productData.price || 100
  );
  
  return {
    name: productData.name,
    price: productData.price,
    image: productData.image,
    dimensions: productData.dimensions,
    weight: productData.weight,
    category: category,
    shippingCost: shippingCost,
    retailer: retailer,
    url: url,
    scrapingMethod: 'manual'
  };
}

// Extract product information from manual content with REAL dimensions
function extractProductFromContent(content, url, retailer, category) {
  console.log('🔍 ENTERING extractProductFromContent function');
  console.log(`   📄 Content length: ${content.length}`);
  console.log(`   🏪 Retailer: ${retailer}`);
  console.log(`   🏷️ Category: ${category}`);
  
  const productData = {
    name: null,
    price: null,
    image: null,
    dimensions: null,
    weight: null
  };
  
  // Extract product name from content
  const namePatterns = [
    /product[^:]*:\s*([^\n\r]{10,100})/i,
    /title[^:]*:\s*([^\n\r]{10,100})/i,
    /<h1[^>]*>([^<]{10,100})<\/h1>/i,
    /name[^:]*:\s*([^\n\r]{10,100})/i
  ];
  
  for (const pattern of namePatterns) {
    const match = content.match(pattern);
    if (match && match[1].trim()) {
      productData.name = match[1].trim().substring(0, 200);
      console.log(`   📝 Extracted name: ${productData.name.substring(0, 50)}...`);
      break;
    }
  }
  
  // Extract price from content
  const pricePatterns = [
    /\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g,
    /price[^$]*\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/gi,
    /cost[^$]*\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/gi
  ];
  
  for (const pattern of pricePatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price > 10 && price < 50000) {
        productData.price = price;
        console.log(`   💰 Extracted price: $${productData.price}`);
        break;
      }
    }
    if (productData.price) break;
  }
  
  // CRITICAL: Extract REAL product dimensions from content
  console.log('🔍 Searching for product dimensions in content...');
  const dimPatterns = [
    // Standard dimension formats
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|"|'')/i,
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)/i,
    // Labeled dimensions
    /dimensions?[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
    /overall[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
    /size[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
    // L x W x H format
    /L:\s*(\d+(?:\.\d+)?)[^0-9]*W:\s*(\d+(?:\.\d+)?)[^0-9]*H:\s*(\d+(?:\.\d+)?)/i,
    /length[^:]*:\s*(\d+(?:\.\d+)?)[^0-9]*width[^:]*:\s*(\d+(?:\.\d+)?)[^0-9]*height[^:]*:\s*(\d+(?:\.\d+)?)/i,
    // Individual measurements
    /width[^:]*:\s*(\d+(?:\.\d+)?)[^0-9]*depth[^:]*:\s*(\d+(?:\.\d+)?)[^0-9]*height[^:]*:\s*(\d+(?:\.\d+)?)/i,
    // Product-specific formats
    /assembled[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
    /product[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i
  ];
  
  let patternIndex = 0;
  for (const pattern of dimPatterns) {
    patternIndex++;
    console.log(`   🔍 Testing pattern ${patternIndex}/${dimPatterns.length}: ${pattern.source.substring(0, 50)}...`);
    
    const match = content.match(pattern);
    if (match) {
      console.log(`   ✅ Pattern ${patternIndex} matched:`, match[0]);
      
      let length = parseFloat(match[1]);
      let width = parseFloat(match[2]);
      let height = parseFloat(match[3]);
      
      console.log(`   📐 Raw dimensions: ${length}" × ${width}" × ${height}"`);
      
      // Convert cm to inches if needed
      if (content.toLowerCase().includes('cm') || content.toLowerCase().includes('centimeter')) {
        length = length / 2.54;
        width = width / 2.54;
        height = height / 2.54;
        console.log('   📐 Converted from cm to inches');
      }
      
      // Validate dimensions are reasonable
      if (length > 0 && width > 0 && height > 0 && 
          length < 200 && width < 200 && height < 200) {
        
        console.log(`   ✅ Pattern ${patternIndex} dimensions valid: ${length}" × ${width}" × ${height}"`);
        
        // CRITICAL: Add packaging padding based on category
        const paddingFactors = {
          'electronics': 1.3,      // 30% padding for fragile items
          'appliances': 1.2,       // 20% padding
          'furniture': 1.15,       // 15% padding for sturdy items
          'high-end-furniture': 1.15, // 15% padding for quality items
          'outdoor': 1.15,         // 15% padding for outdoor furniture
          'clothing': 1.4,         // 40% padding for soft goods
          'books': 1.2,            // 20% padding
          'toys': 1.25,            // 25% padding
          'sports': 1.2,           // 20% padding
          'home-decor': 1.35,      // 35% padding for fragile decor
          'tools': 1.15,           // 15% padding
          'garden': 1.2,           // 20% padding
          'general': 1.25          // 25% padding default
        };
        
        const paddingFactor = paddingFactors[category] || 1.25;
        
        productData.dimensions = {
          length: Math.round(length * paddingFactor * 10) / 10,
          width: Math.round(width * paddingFactor * 10) / 10,
          height: Math.round(height * paddingFactor * 10) / 10
        };
        
        console.log(`   📐 Found product dimensions: ${length}" × ${width}" × ${height}"`);
        console.log(`   📦 Added ${((paddingFactor - 1) * 100).toFixed(0)}% packaging padding for ${category}`);
        console.log(`   📦 Final shipping dimensions: ${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
        break;
      } else {
        console.log(`   ❌ Pattern ${patternIndex} dimensions invalid: ${length}" × ${width}" × ${height}"`);
      }
    } else {
      console.log(`   ❌ Pattern ${patternIndex} no match`);
    }
  }
  
  // If no dimensions found, try to extract from URL or use category-based estimation
  if (!productData.dimensions) {
    console.log('   ⚠️ No dimensions found in content, trying URL extraction...');
    
    // Try to extract size from URL (like "85" from "mallorca-85-wood-outdoor-sofa")
    const urlSizeMatch = url.match(/[-_](\d{2,3})[-_]/);
    if (urlSizeMatch) {
      const extractedSize = parseInt(urlSizeMatch[1]);
      if (extractedSize >= 20 && extractedSize <= 120) {
        // Use extracted size as length, estimate width/height based on category
        const categoryRatios = {
          'furniture': { w: 0.4, h: 0.35 },
          'high-end-furniture': { w: 0.4, h: 0.35 },
          'outdoor': { w: 0.4, h: 0.35 },
          'electronics': { w: 0.6, h: 0.4 },
          'general': { w: 0.5, h: 0.4 }
        };
        
        const ratio = categoryRatios[category] || categoryRatios['general'];
        const paddingFactor = 1.15; // 15% padding
        
        productData.dimensions = {
          length: Math.round(extractedSize * paddingFactor * 10) / 10,
          width: Math.round(extractedSize * ratio.w * paddingFactor * 10) / 10,
          height: Math.round(extractedSize * ratio.h * paddingFactor * 10) / 10
        };
        
        console.log(`   📐 Extracted size ${extractedSize}" from URL`);
        console.log(`   📦 Estimated shipping dimensions: ${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
      }
    }
  }
  
  console.log('🔍 EXITING extractProductFromContent function');
  console.log(`   📦 Final productData:`, {
    hasName: !!productData.name,
    hasPrice: !!productData.price,
    hasImage: !!productData.image,
    hasDimensions: !!productData.dimensions,
    hasWeight: !!productData.weight
  });
  
  return productData;
}

function categorizeProduct(name, url) {
  const text = (name + ' ' + url).toLowerCase();
  
  // High-end furniture retailers get special treatment
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
  const name = productName.toLowerCase();
  
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

function calculateConfidence(productData) {
  let confidence = 0;
  
  if (productData.name) confidence += 0.3;
  if (productData.price) confidence += 0.3;
  if (productData.image) confidence += 0.2;
  if (productData.dimensions) confidence += 0.1;
  if (productData.variant) confidence += 0.1;
  
  return confidence;
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
    if (domain.includes('cb2.com')) return 'CB2';
    if (domain.includes('westelm.com')) return 'West Elm';
    if (domain.includes('potterybarn.com')) return 'Pottery Barn';
    if (domain.includes('ashleyfurniture.com')) return 'Ashley Furniture';
    if (domain.includes('roomstogo.com')) return 'Rooms To Go';
    if (domain.includes('livingspaces.com')) return 'Living Spaces';
    return 'Unknown';
  } catch (e) {
    return 'Unknown';
  }
}

// API Routes
app.post('/api/scrape', async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'Please provide an array of URLs' });
    }
    
    console.log(`🚀 Starting batch scrape for ${urls.length} products...`);
    
    const results = [];
    
    for (const url of urls) {
      try {
        const product = await scrapeProduct(url.trim());
        results.push(product);
      } catch (error) {
        console.error(`❌ Failed to scrape ${url}:`, error.message);
        results.push({
          url: url,
          error: error.message,
          retailer: detectRetailer(url),
          scrapingMethod: 'failed'
        });
      }
    }
    
    console.log(`✅ Completed scraping ${urls.length} products`);
    
    res.json({
      success: true,
      products: results,
      summary: {
        total: urls.length,
        successful: results.filter(r => !r.error).length,
        failed: results.filter(r => r.error).length
      }
    });
    
  } catch (error) {
    console.error('❌ Batch scraping error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/manual-process', async (req, res) => {
  try {
    const { url, content } = req.body;
    
    if (!url || !content) {
      return res.status(400).json({ error: 'URL and content are required' });
    }
    
    const product = await processManualContent(url, content);
    
    res.json({
      success: true,
      product: product
    });
    
  } catch (error) {
    console.error('❌ Manual processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      zyte: USE_ZYTE,
      apify: USE_APIFY,
      upc: USE_UPC
    }
  });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

app.get('/admin-calculator', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin-calculator.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📍 Admin Panel: http://localhost:${PORT}/admin (admin:1064)`);
  
  // Initialize BOL data
  bolHistoricalData.initialize().then(() => {
    bolHistoricalData.getInsights();
  });
});