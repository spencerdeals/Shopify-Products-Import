const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const ApifyScraper = require('./apifyScraper');
require('dotenv').config();
const UPCItemDB = require('./upcitemdb');
// const learningSystem = require('./learningSystem');  // TODO: Re-enable with PostgreSQL later

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY || '';
const upcItemDB = new UPCItemDB(UPCITEMDB_API_KEY);
const USE_UPCITEMDB = !!UPCITEMDB_API_KEY;
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const SCRAPING_TIMEOUT = 60000;  // Increased to 60 seconds
const MAX_CONCURRENT_SCRAPES = 2;
const BERMUDA_DUTY_RATE = 0.265;
const USE_SCRAPINGBEE = !!SCRAPINGBEE_API_KEY;
const SHIPPING_RATE_PER_CUBIC_FOOT = 8; // $8 per cubic foot as discussed

// Initialize Apify scraper
const apifyScraper = new ApifyScraper(APIFY_API_KEY);
const USE_APIFY = apifyScraper.isAvailable();

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Apify - ${USE_APIFY ? '✅ ENABLED (All Retailers)' : '❌ DISABLED (Missing API Key)'}`);
console.log(`2. Fallback: ScrapingBee - ${USE_SCRAPINGBEE ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log(`3. Basic Scraper - ✅ ENABLED (Always Available)`);
console.log(`4. Dimension Data: UPCitemdb - ${USE_UPCITEMDB ? '✅ ENABLED' : '❌ DISABLED (Missing API Key)'}`);
console.log('');
console.log('📊 SCRAPING STRATEGY:');
if (USE_APIFY && USE_SCRAPINGBEE && USE_UPCITEMDB) {
  console.log('✅ OPTIMAL: Apify → ScrapingBee → Basic → UPCitemdb → AI Estimation');
} else if (USE_APIFY && USE_SCRAPINGBEE) {
  console.log('⚠️  GOOD: Apify → ScrapingBee → Basic → AI Estimation (No UPCitemdb)');
} else if (USE_APIFY && !USE_SCRAPINGBEE) {
  console.log('⚠️  LIMITED: Apify → Basic → AI Estimation (No ScrapingBee fallback)');
} else if (!USE_APIFY && USE_SCRAPINGBEE) {
  console.log('⚠️  LIMITED: ScrapingBee → Basic → AI Estimation (No Apify primary)');
} else {
  console.log('⚠️  BASIC: Basic Scraper → AI Estimation (No premium scrapers)');
}
console.log('=====================');

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Fix for Railway X-Forwarded-For warning
app.set('trust proxy', true);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, '../web')));

// CRITICAL: Health check MUST be before rate limiter
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    scraping: {
      primary: USE_APIFY ? 'Apify' : 'None',
      fallback: USE_SCRAPINGBEE ? 'ScrapingBee' : 'None',
      basic: 'Always Available',
      dimensions: USE_UPCITEMDB ? 'UPCitemdb' : 'None',
      strategy: USE_APIFY && USE_SCRAPINGBEE && USE_UPCITEMDB ? 'Optimal' : 
                USE_APIFY && USE_SCRAPINGBEE ? 'Good' :
                USE_APIFY || USE_SCRAPINGBEE ? 'Limited' : 'Basic'
    },
    shopifyConfigured: !!SHOPIFY_ACCESS_TOKEN
  });
});

// Test endpoint for UPCitemdb
app.get('/test-upc', async (req, res) => {
  if (!USE_UPCITEMDB) {
    return res.json({ 
      success: false, 
      message: 'UPCitemdb not configured' 
    });
  }
  
  try {
    const testProduct = await upcItemDB.searchByName('Apple iPhone 15 Pro');
    res.json({
      success: true,
      testProduct: testProduct,
      message: testProduct ? 'UPCitemdb is working!' : 'UPCitemdb connected but no results for test query'
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

// Root route - serve frontend HTML
app.get('/', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend', 'index.html');
  res.sendFile(frontendPath, (err) => {
    if (err) {
      console.error('Error serving frontend:', err);
      // Fallback to API info if frontend not found
      res.json({
        message: 'Frontend not found - API is running',
        endpoints: {
          health: '/health',
          scrape: 'POST /api/scrape',
          createOrder: 'POST /apps/instant-import/create-draft-order',
          testUpc: '/test-upc'
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
  
  // Calculate volume in cubic feet
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Base rate: $8 per cubic foot
  const baseCost = Math.max(15, cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT);
  
  // Add surcharges
  const oversizeFee = Math.max(dimensions.length, dimensions.width, dimensions.height) > 48 ? 50 : 0;
  const valueFee = price > 500 ? price * 0.02 : 0;
  const handlingFee = 15;
  
  const totalCost = baseCost + oversizeFee + valueFee + handlingFee;
  return Math.round(totalCost);
}

// Helper function to check if essential data is complete
function isDataComplete(productData) {
  return productData && 
         productData.name && 
         productData.name !== 'Unknown Product' &&
         !productData.name.includes('Product from') &&
         productData.price && 
         productData.price > 0 &&
         productData.image && 
         !productData.image.includes('placehold');
}

// Merge product data from multiple sources
function mergeProductData(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  
  return {
    name: (primary.name && !primary.name.includes('Product from')) ? primary.name : secondary.name,
    price: primary.price || secondary.price,
    image: (primary.image && !primary.image.includes('placehold')) ? primary.image : secondary.image,
    dimensions: primary.dimensions || secondary.dimensions,
    weight: primary.weight || secondary.weight,
    brand: primary.brand || secondary.brand,
    category: primary.category || secondary.category,
    inStock: primary.inStock !== undefined ? primary.inStock : secondary.inStock
  };
}

// Enhanced price extraction function
function extractPrice(text) {
  if (!text) return null;
  
  // Multiple price patterns to try
  const pricePatterns = [
    /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,  // $123.45 or $1,234.56
    /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*\$/g,  // 123.45$ or 1,234.56$
    /USD\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi, // USD 123.45
    /Price:\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi, // Price: $123.45
    /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)(?=\s*(?:USD|dollars?))/gi, // 123.45 USD
    /\$(\d+(?:\.\d{2})?)/g, // Simple $123 or $123.45
    /(\d+\.\d{2})/g // Just decimal numbers like 123.45
  ];
  
  for (const pattern of pricePatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const priceStr = match[1] || match[0];
      const price = parseFloat(priceStr.replace(/[,$]/g, ''));
      
      // Validate price range
      if (price >= 1 && price <= 50000) {
        return price;
      }
    }
  }
  
  return null;
}

// Basic web scraper as fallback
async function scrapeWithBasicScraper(url) {
  try {
    console.log('🌐 Starting basic web scraper for:', url);
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: SCRAPING_TIMEOUT,
      maxRedirects: 5
    });

    const html = response.data;
    
    // Extract title
    let title = null;
    const titlePatterns = [
      /<title[^>]*>([^<]+)<\/title>/i,
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i,
      /<meta[^>]*name="title"[^>]*content="([^"]+)"/i
    ];
    
    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        title = match[1].trim().replace(/&[^;]+;/g, '').substring(0, 200);
        if (title.length > 10) break;
      }
    }

    // Extract price using enhanced function
    const price = extractPrice(html);

    // Extract image
    let image = null;
    const imagePatterns = [
      /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i,
      /<img[^>]*src="([^"]+)"[^>]*(?:class="[^"]*(?:product|main|primary|hero)[^"]*"|id="[^"]*(?:product|main|primary|hero)[^"]*")/i,
      /<img[^>]*(?:class="[^"]*(?:product|main|primary|hero)[^"]*"|id="[^"]*(?:product|main|primary|hero)[^"]*")[^>]*src="([^"]+)"/i
    ];
    
    for (const pattern of imagePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const imgUrl = match[1];
        if (!imgUrl.includes('placeholder') && !imgUrl.includes('loading') && !imgUrl.includes('spinner')) {
          image = imgUrl.startsWith('http') ? imgUrl : new URL(imgUrl, url).href;
          break;
        }
      }
    }

    console.log('✅ Basic scraper results:', {
      hasTitle: !!title,
      hasPrice: !!price,
      hasImage: !!image,
      title: title?.substring(0, 50) + '...',
      price: price
    });

    return {
      name: title,
      price: price,
      image: image,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true
    };

  } catch (error) {
    console.error('❌ Basic scraper failed:', error.message);
    throw error;
  }
}

// ScrapingBee scraping function - ENHANCED WITH AI EXTRACTION
async function scrapeWithScrapingBee(url) {
  if (!USE_SCRAPINGBEE) {
    throw new Error('ScrapingBee not configured');
  }

  try {
    console.log('🐝 Starting ScrapingBee AI extraction for:', url);
    
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Use AI extraction for universal compatibility
    const response = await axios({
      method: 'GET',
      url: 'https://app.scrapingbee.com/api/v1/',
      params: {
        api_key: SCRAPINGBEE_API_KEY,
        url: url,
        premium_proxy: 'true',
        country_code: 'us',
        render_js: 'true',
        wait: '5000',  // Wait longer for page to load
        ai_extract_rules: JSON.stringify({
          price: "Extract the current selling price of the product in USD. Look for sale price, current price, or regular price. Return only the number.",
          title: "Extract the full product name or title. This should be the main product heading.",
          description: "Extract a brief product description or key features",
          dimensions: "Extract product dimensions, package dimensions, or size information including length, width, height",
          weight: "Extract product weight or shipping weight",
          brand: "Extract the brand name or manufacturer",
          availability: "Extract stock status - whether the product is in stock or available",
          image: "Extract the main product image URL - the primary photo of the product"
        })
      },
      timeout: SCRAPING_TIMEOUT
    });

    console.log('✅ ScrapingBee AI extraction completed');
    
    // Parse the AI-extracted data
    const extracted = response.data;
    
    const productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true
    };

    // Extract product name
    if (extracted.title) {
      productData.name = extracted.title.trim();
      console.log('   📝 AI extracted title:', productData.name.substring(0, 50) + '...');
    }

    // Parse the price from AI extraction - robust parsing
    if (extracted.price) {
      const price = extractPrice(extracted.price);
      if (price) {
        productData.price = price;
        console.log('   💰 AI extracted price: $' + productData.price);
      }
    }

    // Parse dimensions if AI found them
    if (extracted.dimensions) {
      const dimPatterns = [
        /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
        /L:\s*(\d+(?:\.\d+)?).*W:\s*(\d+(?:\.\d+)?).*H:\s*(\d+(?:\.\d+)?)/i,
        /(\d+(?:\.\d+)?)"?\s*[WL]\s*[x×]\s*(\d+(?:\.\d+)?)"?\s*[DW]\s*[x×]\s*(\d+(?:\.\d+)?)"?\s*[HT]/i
      ];
      
      for (const pattern of dimPatterns) {
        const match = extracted.dimensions.match(pattern);
        if (match) {
          productData.dimensions = {
            length: parseFloat(match[1]),
            width: parseFloat(match[2]),
            height: parseFloat(match[3])
          };
          console.log('   📏 AI extracted dimensions:', productData.dimensions);
          break;
        }
      }
    }

    // Parse weight if AI found it
    if (extracted.weight) {
      const weightPatterns = [
        /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
        /(\d+(?:\.\d+)?)\s*(?:kilograms?|kgs?)/i,
        /(\d+(?:\.\d+)?)\s*(?:ounces?|oz)/i
      ];
      
      for (const pattern of weightPatterns) {
        const match = extracted.weight.match(pattern);
        if (match) {
          let weight = parseFloat(match[1]);
          // Convert to pounds if needed
          if (/kg/i.test(extracted.weight)) weight *= 2.205;
          if (/oz/i.test(extracted.weight)) weight *= 0.0625;
          
          productData.weight = Math.round(weight * 10) / 10;
          console.log('   ⚖️ AI extracted weight:', productData.weight + ' lbs');
          break;
        }
      }
    }

    // Extract brand
    if (extracted.brand) {
      productData.brand = extracted.brand.trim();
    }

    // Extract image URL
    if (extracted.image) {
      productData.image = extracted.image;
    }

    // Check availability
    if (extracted.availability) {
      const outOfStockKeywords = /out of stock|unavailable|sold out|not available/i;
      productData.inStock = !outOfStockKeywords.test(extracted.availability);
    }

    console.log('📦 ScrapingBee AI results:', {
      hasName: !!productData.name,
      hasPrice: !!productData.price,
      hasImage: !!productData.image,
      hasDimensions: !!productData.dimensions,
      hasWeight: !!productData.weight
    });

    return productData;

  } catch (error) {
    console.error('❌ ScrapingBee AI extraction failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      if (error.response.status === 429) {
        console.error('Rate limited - will retry with delay');
        throw new Error('Rate limited');
      }
      if (error.response.status === 400) {
        console.error('Bad Request - Check API key and parameters');
      }
    }
    throw error;
  }
}

// Main product scraping function with enhanced multi-layer approach
async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  
  let productData = null;
  let scrapingMethod = 'none';
  let attempts = [];
  
  console.log(`\n📦 Processing: ${url}`);
  console.log(`   Retailer: ${retailer}`);
  
  // STEP 1: Always try Apify first for all retailers
  if (USE_APIFY) {
    try {
      console.log('   🔄 Attempting Apify scrape...');
      
      productData = await apifyScraper.scrapeProduct(url);
      
      if (productData) {
        scrapingMethod = 'apify';
        attempts.push('apify-success');
        console.log('   ✅ Apify returned data');
        
        // Check if data is complete
        if (!isDataComplete(productData)) {
          console.log('   ⚠️ Apify data incomplete, will try additional scrapers');
        }
      }
    } catch (error) {
      console.log('   ❌ Apify failed:', error.message);
      attempts.push('apify-failed');
      productData = null;
    }
  }
  
  // STEP 2: If Apify failed or returned incomplete data, try ScrapingBee with AI
  if (USE_SCRAPINGBEE && (!productData || !isDataComplete(productData))) {
    try {
      console.log('   🐝 Attempting ScrapingBee AI extraction...');
      const scrapingBeeData = await scrapeWithScrapingBee(url);
      
      if (scrapingBeeData) {
        attempts.push('scrapingbee-success');
        if (!productData) {
          // Apify failed completely, use ScrapingBee data
          productData = scrapingBeeData;
          scrapingMethod = 'scrapingbee';
          console.log('   ✅ Using ScrapingBee AI data (Apify failed)');
        } else {
          // Merge data - keep Apify data but fill in missing fields from ScrapingBee
          const mergedData = mergeProductData(productData, scrapingBeeData);
          
          // Log what was supplemented
          if (!productData.name && scrapingBeeData.name) {
            console.log('   ✅ ScrapingBee AI provided missing name');
          }
          if (!productData.price && scrapingBeeData.price) {
            console.log('   ✅ ScrapingBee AI provided missing price');
          }
          if (!productData.image && scrapingBeeData.image) {
            console.log('   ✅ ScrapingBee AI provided missing image');
          }
          
          productData = mergedData;
          scrapingMethod = 'apify+scrapingbee';
        }
      }
    } catch (error) {
      console.log('   ❌ ScrapingBee AI extraction failed:', error.message);
      attempts.push('scrapingbee-failed');
    }
  }
  
  // STEP 3: If still missing data, try basic web scraper
  if (!productData || !isDataComplete(productData)) {
    try {
      console.log('   🌐 Attempting basic web scraper...');
      const basicData = await scrapeWithBasicScraper(url);
      
      if (basicData) {
        attempts.push('basic-success');
        if (!productData) {
          productData = basicData;
          scrapingMethod = 'basic';
          console.log('   ✅ Using basic scraper data');
        } else {
          const mergedData = mergeProductData(productData, basicData);
          
          if (!productData.name && basicData.name) {
            console.log('   ✅ Basic scraper provided missing name');
          }
          if (!productData.price && basicData.price) {
            console.log('   ✅ Basic scraper provided missing price');
          }
          if (!productData.image && basicData.image) {
            console.log('   ✅ Basic scraper provided missing image');
          }
          
          productData = mergedData;
          scrapingMethod = scrapingMethod + '+basic';
        }
      }
    } catch (error) {
      console.log('   ❌ Basic scraper failed:', error.message);
      attempts.push('basic-failed');
    }
  }
  
  // STEP 4: Try UPCitemdb if we have a product name but missing dimensions
  if (USE_UPCITEMDB && productData && productData.name && (!productData.dimensions || !productData.weight)) {
    try {
      console.log('   📦 Attempting UPCitemdb lookup...');
      const upcData = await upcItemDB.searchByName(productData.name);
      
      if (upcData) {
        attempts.push('upcitemdb-success');
        // UPCitemdb returns PRODUCT dimensions, convert to BOX dimensions
        if (!productData.dimensions && upcData.dimensions) {
          const category = productData.category || categorizeProduct(productData.name || '', url);
          productData.dimensions = estimateBoxDimensions(upcData.dimensions, category);
          console.log('   ✅ UPCitemdb provided product dimensions, converted to box dimensions');
        }
        if (!productData.weight && upcData.weight) {
          productData.weight = upcData.weight;
          console.log('   ✅ UPCitemdb provided weight');
        }
        if (!productData.image && upcData.image) {
          productData.image = upcData.image;
          console.log('   ✅ UPCitemdb provided image');
        }
        scrapingMethod = scrapingMethod === 'estimation' ? 'upcitemdb' : scrapingMethod + '+upcitemdb';
      }
    } catch (error) {
      console.log('   ❌ UPCitemdb lookup failed:', error.message);
      attempts.push('upcitemdb-failed');
    }
  }
  
  // STEP 5: Use intelligent estimation for any missing data
  if (!productData) {
    // All methods failed completely
    productData = {
      name: 'Product from ' + retailer,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      category: null
    };
    scrapingMethod = 'estimation';
    attempts.push('estimation-used');
    console.log('   ⚠️ All methods failed, using estimation');
  }
  
  // Fill in missing data with estimations
  const productName = productData.name || `Product from ${retailer}`;
  const category = productData.category || categorizeProduct(productName, url);
  
  if (!productData.dimensions) {
    productData.dimensions = estimateDimensions(category, productName);
    console.log('   📐 Estimated dimensions based on category:', category);
  }
  
  if (!productData.weight) {
    productData.weight = estimateWeight(productData.dimensions, category);
    console.log('   ⚖️ Estimated weight based on dimensions');
  }
  
  // Calculate shipping cost
  const shippingCost = calculateShippingCost(
    productData.dimensions,
    productData.weight,
    productData.price || 100
  );
  
  // Prepare final product object
  const product = {
    id: productId,
    url: url,
    name: productName,
    price: productData.price,
    image: productData.image || 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=SDL',
    category: category,
    retailer: retailer,
    dimensions: productData.dimensions,
    weight: productData.weight,
    shippingCost: shippingCost,
    scrapingMethod: scrapingMethod,
    attempts: attempts,
    dataCompleteness: {
      hasName: !!productData.name && !productData.name.includes('Product from'),
      hasImage: !!productData.image && !productData.image.includes('placehold'),
      hasDimensions: !!productData.dimensions,
      hasWeight: !!productData.weight,
      hasPrice: !!productData.price
    }
  };
  
  console.log(`   💰 Shipping cost: $${shippingCost}`);
  console.log(`   📊 Data source: ${scrapingMethod}`);
  console.log(`   🎯 Attempts: ${attempts.join(' → ')}`);
  console.log(`   ✅ Product processed successfully\n`);
  
  return product;
}

// Batch processing with concurrency control and delays
async function processBatch(urls, batchSize = MAX_CONCURRENT_SCRAPES) {
  const results = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    
    // Add delay between batches to avoid rate limiting
    if (i > 0) {
      console.log(`⏳ Waiting 3 seconds before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    const batchResults = await Promise.all(
      batch.map(async (url, index) => {
        try {
          // Add small delay between concurrent requests
          if (index > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          return await scrapeProduct(url);
        } catch (error) {
          console.error(`Failed to process ${url}:`, error.message);
          console.error('Stack trace:', error.stack);
          return {
            id: generateProductId(),
            url: url,
            name: 'Failed to load product',
            category: 'general',
            retailer: detectRetailer(url),
            shippingCost: 50,
            error: true,
            errorMessage: error.message
          };
        }
      })
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
    console.log('   Strategy: Apify → ScrapingBee AI → Basic Scraper → UPCitemdb → Estimation\n');
    
    const startTime = Date.now();
    const products = await processBatch(urls);
    const endTime = Date.now();
    
    // Calculate success metrics
    const apifyCount = products.filter(p => p.scrapingMethod?.includes('apify')).length;
    const scrapingBeeCount = products.filter(p => p.scrapingMethod?.includes('scrapingbee')).length;
    const basicCount = products.filter(p => p.scrapingMethod?.includes('basic')).length;
    const upcitemdbCount = products.filter(p => p.scrapingMethod?.includes('upcitemdb')).length;
    const estimatedCount = products.filter(p => p.scrapingMethod === 'estimation').length;
    const errorCount = products.filter(p => p.error).length;
    
    const successfulScrapes = products.filter(p => 
      !p.error && 
      p.dataCompleteness.hasName && 
      (p.dataCompleteness.hasPrice || p.dataCompleteness.hasImage)
    ).length;
    
    console.log('\n📊 SCRAPING SUMMARY:');
    console.log(`   Total products: ${products.length}`);
    console.log(`   Processing time: ${((endTime - startTime) / 1000).toFixed(1)}s`);
    console.log(`   Successful scrapes: ${successfulScrapes}/${products.length} (${(successfulScrapes/products.length*100).toFixed(1)}%)`);
    console.log(`   Apify used: ${apifyCount}`);
    console.log(`   ScrapingBee AI used: ${scrapingBeeCount}`);
    console.log(`   Basic scraper used: ${basicCount}`);
    console.log(`   UPCitemdb used: ${upcitemdbCount}`);
    console.log(`   Fully estimated: ${estimatedCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log('');
    
    // Data completeness analysis
    const withNames = products.filter(p => p.dataCompleteness.hasName).length;
    const withPrices = products.filter(p => p.dataCompleteness.hasPrice).length;
    const withImages = products.filter(p => p.dataCompleteness.hasImage).length;
    
    console.log('📈 DATA COMPLETENESS:');
    console.log(`   Names: ${withNames}/${products.length} (${(withNames/products.length*100).toFixed(1)}%)`);
    console.log(`   Prices: ${withPrices}/${products.length} (${(withPrices/products.length*100).toFixed(1)}%)`);
    console.log(`   Images: ${withImages}/${products.length} (${(withImages/products.length*100).toFixed(1)}%)`);
    console.log('');
    
    res.json({ 
      products,
      summary: {
        total: products.length,
        successful: successfulScrapes,
        errors: errorCount,
        processingTimeSeconds: (endTime - startTime) / 1000,
        scrapingMethods: {
          apify: apifyCount,
          scrapingBee: scrapingBeeCount,
          basic: basicCount,
          upcitemdb: upcitemdbCount,
          estimation: estimatedCount
        },
        dataCompleteness: {
          names: withNames,
          prices: withPrices,
          images: withImages,
          successRate: (successfulScrapes / products.length * 100).toFixed(1) + '%'
        }
      }
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Failed to scrape products',
      details: error.message 
    });
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
        title: 'Bermuda Import Duty (26.5%)',
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
        title: 'Ocean Freight & Handling to Bermuda',
        price: totals.totalShippingCost.toFixed(2),
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
  console.log(`📍 API Health: http://localhost:${PORT}/health\n`);
});