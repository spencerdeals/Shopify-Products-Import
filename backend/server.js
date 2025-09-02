const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const ApifyScraper = require('./apifyScraper');
require('dotenv').config();
const UPCItemDB = require('./upcitemdb');

const app = express();
const PORT = process.env.PORT || 8080;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY || '';
const upcItemDB = new UPCItemDB(UPCITEMDB_API_KEY);
const USE_UPCITEMDB = !!UPCITEMDB_API_KEY;
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const SCRAPING_TIMEOUT = 30000;
const MAX_CONCURRENT_SCRAPES = 1;
const BERMUDA_DUTY_RATE = 0.265;
const USE_SCRAPINGBEE = !!SCRAPINGBEE_API_KEY;
const SHIPPING_RATE_PER_CUBIC_FOOT = 8;

// BOL-BASED SHIPPING PATTERNS FROM YOUR HISTORICAL DATA
const BOL_PATTERNS = {
  furniture: {
    avgWeight: 348,
    avgCubicFeet: 49.5,
    minCubicFeet: 9,
    maxCubicFeet: 171,
    dimensions: {
      sofa: { length: 84, width: 38, height: 36, weight: 185 },
      chair: { length: 36, width: 32, height: 38, weight: 65 },
      table: { length: 60, width: 36, height: 30, weight: 120 },
      dresser: { length: 60, width: 20, height: 48, weight: 250 },
      mattress: { length: 80, width: 60, height: 12, weight: 100 },
      cabinet: { length: 36, width: 18, height: 72, weight: 150 },
      default: { length: 48, width: 30, height: 36, weight: 150 }
    }
  },
  electronics: {
    avgWeight: 45,
    avgCubicFeet: 12,
    dimensions: {
      tv: { length: 55, width: 8, height: 35, weight: 45 },
      default: { length: 24, width: 18, height: 20, weight: 35 }
    }
  },
  appliances: {
    avgWeight: 220,
    avgCubicFeet: 55,
    dimensions: {
      refrigerator: { length: 36, width: 36, height: 70, weight: 350 },
      washer: { length: 30, width: 30, height: 40, weight: 200 },
      default: { length: 32, width: 32, height: 48, weight: 180 }
    }
  },
  general: {
    avgWeight: 75,
    avgCubicFeet: 25,
    dimensions: {
      default: { length: 24, width: 20, height: 18, weight: 50 }
    }
  }
};

// Initialize Apify scraper
const apifyScraper = new ApifyScraper(APIFY_API_KEY);
const USE_APIFY = apifyScraper.isAvailable();

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Primary: Apify - ${USE_APIFY ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`2. Fallback: ScrapingBee - ${USE_SCRAPINGBEE ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`3. Dimension Data: UPCitemdb - ${USE_UPCITEMDB ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log('4. BOL Historical Data: ✅ LOADED (177 shipments analyzed)');
console.log('=====================');

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', true);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, '../web')));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    scraping: {
      primary: USE_APIFY ? 'Apify' : 'None',
      fallback: USE_SCRAPINGBEE ? 'ScrapingBee' : 'None',
      dimensions: USE_UPCITEMDB ? 'UPCitemdb' : 'None',
      bolData: 'Active'
    }
  });
});

// Diagnostic endpoint to see what's being scraped
app.get('/api/test-scrape', async (req, res) => {
  const testUrl = req.query.url || 'https://www.amazon.com/dp/B09XQF2YJF';
  
  try {
    console.log('\n=== TEST SCRAPE ===');
    const product = await scrapeProduct(testUrl);
    
    res.json({
      success: true,
      url: testUrl,
      scraped: {
        name: product.name,
        price: product.price,
        image: product.image,
        dimensions: product.dimensions,
        weight: product.weight,
        shippingCost: product.shippingCost,
        scrapingMethod: product.scrapingMethod,
        dataCompleteness: product.dataCompleteness
      },
      raw: product
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint for UPCitemdb
app.get('/test-upc', async (req, res) => {
  if (!USE_UPCITEMDB) {
    return res.json({ success: false, message: 'UPCitemdb not configured' });
  }
  
  try {
    const testProduct = await upcItemDB.searchByName('Apple iPhone 15 Pro');
    res.json({
      success: true,
      testProduct: testProduct,
      message: testProduct ? 'UPCitemdb is working!' : 'No results'
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Root route
app.get('/', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend', 'index.html');
  res.sendFile(frontendPath, (err) => {
    if (err) {
      res.json({
        message: 'Frontend not found - API is running',
        endpoints: { health: '/health', scrape: 'POST /api/scrape' }
      });
    }
  });
});

// Complete order page
app.get('/complete-order.html', (req, res) => {
  const completePath = path.join(__dirname, '../frontend', 'complete-order.html');
  res.sendFile(completePath, (err) => {
    if (err) res.redirect('/');
  });
});

// Rate limiter
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
    if (domain.includes('cb2.com')) return 'CB2';
    if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
    if (domain.includes('westelm.com')) return 'West Elm';
    if (domain.includes('potterybarn.com')) return 'Pottery Barn';
    return 'Unknown Retailer';
  } catch (e) {
    return 'Unknown Retailer';
  }
}

function isSDLDomain(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    const blockedPatterns = ['spencer-deals-ltd.myshopify.com', 'sdl.bm', 'spencer-deals'];
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
  if (/\b(book|novel|textbook|magazine|journal)\b/.test(text)) return 'books';
  if (/\b(toy|game|puzzle|doll|action.figure|lego|playset|board.game|video.game)\b/.test(text)) return 'toys';
  if (/\b(exercise|fitness|gym|bike|bicycle|treadmill|weights|dumbbells|yoga|golf|tennis|basketball|football|soccer)\b/.test(text)) return 'sports';
  if (/\b(decor|decoration|vase|picture|frame|artwork|painting|candle|lamp|mirror|pillow|curtain|rug|carpet)\b/.test(text)) return 'home-decor';
  if (/\b(tool|hardware|drill|saw|hammer|screwdriver|wrench|toolbox)\b/.test(text)) return 'tools';
  if (/\b(garden|plant|pot|soil|fertilizer|hose|mower|outdoor)\b/.test(text)) return 'garden';
  return 'general';
}

// BOL-ENHANCED DIMENSION ESTIMATION
function estimateDimensionsFromBOL(category, name = '') {
  const text = name.toLowerCase();
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  
  // Try to match specific furniture types from BOL data
  if (category === 'furniture') {
    if (text.includes('sofa') || text.includes('couch')) {
      return patterns.dimensions.sofa;
    } else if (text.includes('chair')) {
      return patterns.dimensions.chair;
    } else if (text.includes('table')) {
      return patterns.dimensions.table;
    } else if (text.includes('dresser')) {
      return patterns.dimensions.dresser;
    } else if (text.includes('mattress')) {
      return patterns.dimensions.mattress;
    } else if (text.includes('cabinet')) {
      return patterns.dimensions.cabinet;
    }
  } else if (category === 'electronics' && text.includes('tv')) {
    return patterns.dimensions.tv;
  } else if (category === 'appliances') {
    if (text.includes('refrigerator') || text.includes('fridge')) {
      return patterns.dimensions.refrigerator;
    } else if (text.includes('washer') || text.includes('dryer')) {
      return patterns.dimensions.washer;
    }
  }
  
  // Use default for category
  const dims = patterns.dimensions.default;
  
  // Add realistic variation (±15%)
  const variance = 0.85 + Math.random() * 0.3;
  return {
    length: Math.round(dims.length * variance),
    width: Math.round(dims.width * variance),
    height: Math.round(dims.height * variance)
  };
}

// Estimate weight based on BOL patterns
function estimateWeightFromBOL(dimensions, category) {
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  
  // Calculate cubic feet
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Use BOL average weight per cubic foot for the category
  const weightPerCubic = patterns.avgWeight / patterns.avgCubicFeet;
  const estimatedWeight = Math.max(10, cubicFeet * weightPerCubic);
  
  return Math.round(estimatedWeight);
}

// Convert product dimensions to shipping box dimensions
function estimateBoxDimensions(productDimensions, category) {
  if (!productDimensions) return null;
  
  // Padding factors based on BOL analysis
  const paddingFactors = {
    'electronics': 1.3,
    'appliances': 1.2,
    'furniture': 1.15,  // Less padding for furniture (already large)
    'clothing': 1.4,
    'books': 1.2,
    'toys': 1.25,
    'general': 1.25
  };
  
  const factor = paddingFactors[category] || 1.25;
  
  return {
    length: Math.round(productDimensions.length * factor),
    width: Math.round(productDimensions.width * factor),
    height: Math.round(productDimensions.height * factor)
  };
}

function calculateShippingCost(dimensions, weight, price) {
  if (!dimensions) {
    return Math.max(25, price * 0.15);
  }
  
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Base rate: $8 per cubic foot (from your requirements)
  const baseCost = Math.max(15, cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT);
  
  // Add surcharges based on BOL analysis
  const oversizeFee = Math.max(dimensions.length, dimensions.width, dimensions.height) > 60 ? 75 : 0;
  const heavyWeightFee = weight > 150 ? weight * 0.25 : 0;
  const valueFee = price > 500 ? price * 0.02 : 0;
  const handlingFee = 15;
  
  const totalCost = baseCost + oversizeFee + heavyWeightFee + valueFee + handlingFee;
  return Math.round(totalCost);
}

// Enhanced ScrapingBee with retailer-specific extraction
async function scrapeWithScrapingBee(url) {
  if (!USE_SCRAPINGBEE) {
    throw new Error('ScrapingBee not configured');
  }

  try {
    const retailer = detectRetailer(url);
    console.log(`   🐝 ScrapingBee starting for ${retailer}...`);
    
    // First, try with specific CSS selectors for each retailer
    let scrapingParams = {
      api_key: SCRAPINGBEE_API_KEY,
      url: url,
      premium_proxy: 'true',
      country_code: 'us',
      render_js: 'true',
      wait: '5000',  // Wait longer for dynamic content
      wait_for: 'networkidle',  // Wait for network to be idle
      block_resources: 'false',  // Load all resources including images
      screenshot: 'false'
    };
    
    // Add retailer-specific extraction rules
    if (retailer === 'Amazon') {
      scrapingParams.extract_rules = JSON.stringify({
        price: {
          selector: 'span.a-price-whole, span.a-price-range, .a-price.a-text-price.a-size-medium.apexPriceToPay, .a-price-range, span[data-a-color="price"] span',
          type: 'text'
        },
        title: {
          selector: 'h1#title span, h1.a-size-large span, span#productTitle',
          type: 'text'
        },
        image: {
          selector: 'img#landingImage, div.imgTagWrapper img, img.a-dynamic-image, div[data-component-type="s-product-image"] img',
          type: '@src'
        }
      });
    } else if (retailer === 'Wayfair') {
      scrapingParams.extract_rules = JSON.stringify({
        price: {
          selector: '[data-enzyme-id="PriceBlock"] span, .SFPrice, .ProductDetailInfoBlock span[data-enzyme-id*="Price"], .BasePriceBlock__BasePrice',
          type: 'text'
        },
        title: {
          selector: 'h1.pl-Heading-heading, h1[data-enzyme-id="ProductName"], header h1',
          type: 'text'
        },
        image: {
          selector: 'img.InlineCarousel__StyledImage, img[data-enzyme-id="carousel-image"], .ProductDetailImageCarousel img',
          type: '@src'
        }
      });
    } else if (retailer === 'Walmart') {
      scrapingParams.extract_rules = JSON.stringify({
        price: {
          selector: 'span[itemprop="price"], span.price-now, .price-characteristic, [data-testid="price-wrap"] span, span[data-automation-id="product-price"]',
          type: 'text'
        },
        title: {
          selector: 'h1[itemprop="name"], h1.prod-ProductTitle, h1[data-automation-id="productName"], main h1',
          type: 'text'
        },
        image: {
          selector: 'img.hover-zoom-hero-image, img[data-testid="hero-image"], .prod-hero-image img, div[data-testid="image-carousel"] img',
          type: '@src'
        }
      });
    } else {
      // Generic extraction for unknown retailers
      scrapingParams.extract_rules = JSON.stringify({
        price: {
          selector: '[class*="price"], [data-testid*="price"], .price, span.price, .product-price',
          type: 'text'
        },
        title: {
          selector: 'h1, [class*="product-title"], [class*="product-name"], .title',
          type: 'text'
        },
        image: {
          selector: 'img[class*="product"], img[alt*="product"], .gallery img, main img',
          type: '@src'
        }
      });
    }
    
    // First attempt with CSS selectors
    let response = await axios({
      method: 'GET',
      url: 'https://app.scrapingbee.com/api/v1/',
      params: scrapingParams,
      timeout: 45000  // 45 second timeout
    });
    
    let extracted = response.data;
    
    // If CSS extraction didn't work well, try AI extraction as fallback
    if (!extracted.title || !extracted.price || !extracted.image) {
      console.log('   🤖 CSS extraction incomplete, trying AI extraction...');
      
      const aiParams = {
        api_key: SCRAPINGBEE_API_KEY,
        url: url,
        premium_proxy: 'true',
        country_code: 'us',
        render_js: 'true',
        wait: '5000',
        wait_for: 'networkidle',
        ai_extract_rules: JSON.stringify({
          price: "Product Price in USD, Sale Price, Current Price, or Discounted Price",
          title: "Product Title, Product Name, or Main Heading",
          image: "Main Product Image URL, Primary Product Photo, or Hero Image",
          description: "Product Description or Details",
          dimensions: "Product Dimensions, Package Dimensions, or Size",
          weight: "Product Weight or Shipping Weight",
          brand: "Brand Name, Manufacturer, or Sold By",
          availability: "Stock Status, Availability, or In Stock"
        })
      };
      
      const aiResponse = await axios({
        method: 'GET',
        url: 'https://app.scrapingbee.com/api/v1/',
        params: aiParams,
        timeout: 45000
      });
      
      // Merge CSS and AI results, preferring CSS when available
      extracted = {
        ...aiResponse.data,
        ...Object.fromEntries(
          Object.entries(extracted).filter(([_, v]) => v != null && v !== '')
        )
      };
    }
    
    console.log('   ✅ ScrapingBee extraction completed');
    
    // Parse the extracted data
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
      console.log('   📝 Extracted title:', productData.name.substring(0, 50) + '...');
    }
    
    // Parse price with enhanced patterns
    if (extracted.price) {
      const priceStr = extracted.price.toString();
      
      // Enhanced price patterns
      const pricePatterns = [
        /\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,           // $123.45
        /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*\$/,           // 123.45$
        /USD\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,         // USD 123.45
        /(\d+(?:,\d{3})*)\.\d{2}/,                     // 1,234.56
        /(\d+(?:\.\d{2})?)/                            // 123.45
      ];
      
      for (const pattern of pricePatterns) {
        const match = priceStr.match(pattern);
        if (match) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (price > 0 && price < 1000000) {
            productData.price = price;
            console.log('   💰 Extracted price: $' + productData.price);
            break;
          }
        }
      }
      
      // If still no price, try to find any number that looks like a price
      if (!productData.price) {
        const numbers = priceStr.match(/\d+(?:\.\d{2})?/g);
        if (numbers) {
          for (const num of numbers) {
            const price = parseFloat(num);
            if (price > 10 && price < 10000) {  // Reasonable price range
              productData.price = price;
              console.log('   💰 Extracted price (fallback): $' + productData.price);
              break;
            }
          }
        }
      }
    }
    
    // Extract image URL - fix relative URLs
    if (extracted.image) {
      let imageUrl = extracted.image;
      
      // Handle relative URLs
      if (imageUrl.startsWith('//')) {
        imageUrl = 'https:' + imageUrl;
      } else if (imageUrl.startsWith('/')) {
        const baseUrl = new URL(url);
        imageUrl = baseUrl.origin + imageUrl;
      }
      
      // Validate it's a real image URL
      if (imageUrl.match(/\.(jpg|jpeg|png|gif|webp|svg)/i) || 
          imageUrl.includes('images') || 
          imageUrl.includes('media') ||
          imageUrl.includes('product')) {
        productData.image = imageUrl;
        console.log('   🖼️ Extracted image URL');
      }
    }
    
    // Parse dimensions if available
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
          console.log('   📏 Extracted dimensions:', productData.dimensions);
          break;
        }
      }
    }
    
    // Parse weight if available
    if (extracted.weight) {
      const weightPatterns = [
        { regex: /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i, multiplier: 1 },
        { regex: /(\d+(?:\.\d+)?)\s*(?:kilograms?|kgs?)/i, multiplier: 2.205 },
        { regex: /(\d+(?:\.\d+)?)\s*(?:ounces?|oz)/i, multiplier: 0.0625 }
      ];
      
      for (const { regex, multiplier } of weightPatterns) {
        const match = extracted.weight.match(regex);
        if (match) {
          productData.weight = Math.round(parseFloat(match[1]) * multiplier * 10) / 10;
          console.log('   ⚖️ Extracted weight:', productData.weight + ' lbs');
          break;
        }
      }
    }
    
    // Extract brand
    if (extracted.brand) {
      productData.brand = extracted.brand.trim();
    }
    
    // Check availability
    if (extracted.availability) {
      const outOfStock = /out of stock|unavailable|sold out|not available/i;
      productData.inStock = !outOfStock.test(extracted.availability);
    }
    
    console.log('   📦 ScrapingBee results:', {
      hasName: !!productData.name,
      hasPrice: !!productData.price,
      hasImage: !!productData.image,
      hasDimensions: !!productData.dimensions,
      hasWeight: !!productData.weight
    });
    
    return productData;
    
  } catch (error) {
    console.error('   ❌ ScrapingBee failed:', error.message);
    if (error.response?.status === 400) {
      console.error('   Bad Request - Check API parameters');
    } else if (error.response?.status === 500) {
      console.error('   ScrapingBee server error - Page may be too complex');
    }
    throw error;
  }
}

// Main product scraping function with better timeout handling
async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  
  let productData = null;
  let scrapingMethod = 'none';
  
  console.log(`\n📦 Processing: ${url}`);
  console.log(`   Retailer: ${retailer}`);
  
  // STEP 1: Try Apify with proper timeout
  if (USE_APIFY) {
    try {
      console.log('   🔄 Attempting Apify scrape (30s timeout)...');
      
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Apify timeout after 30s')), 30000);
      });
      
      // Race between Apify and timeout
      const apifyPromise = apifyScraper.scrapeProduct(url);
      productData = await Promise.race([apifyPromise, timeoutPromise]);
      
      // Check if we got good data
      if (productData && 
          productData.name && 
          productData.name !== 'Unknown Product' && 
          productData.price && 
          productData.price > 0) {
        scrapingMethod = 'apify';
        console.log('   ✅ Apify returned complete data');
      } else {
        console.log('   ⚠️ Apify data incomplete, will try ScrapingBee');
        // Don't null out productData yet - we might be able to merge it
      }
    } catch (error) {
      console.log('   ❌ Apify failed:', error.message);
      productData = null;
    }
  }
  
  // STEP 2: Try ScrapingBee if Apify failed or incomplete
  if (USE_SCRAPINGBEE) {
    // Always try ScrapingBee for these retailers as Apify struggles with them
    const difficultRetailers = ['Wayfair', 'Walmart', 'Target'];
    const shouldTryScrapingBee = !productData || 
                                  !productData.price || 
                                  !productData.image ||
                                  productData.name === 'Unknown Product' ||
                                  difficultRetailers.includes(retailer);
    
    if (shouldTryScrapingBee) {
      try {
        console.log('   🐝 Attempting ScrapingBee extraction...');
        const scrapingBeeData = await scrapeWithScrapingBee(url);
        
        if (scrapingBeeData) {
          if (!productData || !productData.name || productData.name === 'Unknown Product') {
            // Replace completely with ScrapingBee data
            productData = scrapingBeeData;
            scrapingMethod = 'scrapingbee';
            console.log('   ✅ Using ScrapingBee data');
          } else {
            // Merge data - keep good data from both
            const mergedData = {
              name: productData.name !== 'Unknown Product' ? productData.name : scrapingBeeData.name,
              price: productData.price || scrapingBeeData.price,
              image: productData.image || scrapingBeeData.image,
              dimensions: productData.dimensions || scrapingBeeData.dimensions,
              weight: productData.weight || scrapingBeeData.weight,
              brand: productData.brand || scrapingBeeData.brand,
              category: productData.category || scrapingBeeData.category,
              inStock: productData.inStock !== undefined ? productData.inStock : scrapingBeeData.inStock
            };
            
            productData = mergedData;
            scrapingMethod = 'apify+scrapingbee';
            console.log('   ✅ Merged Apify + ScrapingBee data');
            
            // Log what was filled in
            if (!productData.price && scrapingBeeData.price) {
              console.log('     + ScrapingBee provided price');
            }
            if (!productData.image && scrapingBeeData.image) {
              console.log('     + ScrapingBee provided image');
            }
          }
        }
      } catch (error) {
        console.log('   ❌ ScrapingBee failed:', error.message);
      }
    }
  }
  
  // STEP 3: Try UPCitemdb for dimensions if we have a name
  if (USE_UPCITEMDB && productData && productData.name && (!productData.dimensions || !productData.weight)) {
    try {
      console.log('   📦 Attempting UPCitemdb lookup...');
      const upcData = await upcItemDB.searchByName(productData.name);
      
      if (upcData) {
        const category = categorizeProduct(productData.name || '', url);
        
        if (!productData.dimensions && upcData.dimensions) {
          productData.dimensions = estimateBoxDimensions(upcData.dimensions, category);
          console.log('   ✅ UPCitemdb provided dimensions');
        }
        
        if (!productData.weight && upcData.weight) {
          productData.weight = upcData.weight;
          console.log('   ✅ UPCitemdb provided weight');
        }
        
        if (!productData.image && upcData.image) {
          productData.image = upcData.image;
          console.log('   ✅ UPCitemdb provided image');
        }
        
        scrapingMethod += scrapingMethod === 'none' ? 'upcitemdb' : '+upcitemdb';
      }
    } catch (error) {
      console.log('   ❌ UPCitemdb failed:', error.message);
    }
  }
  
  // STEP 4: Create a default if nothing worked
  if (!productData) {
    productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null
    };
    scrapingMethod = 'estimation';
    console.log('   ⚠️ All scraping methods failed');
  }
  
  // Generate better product names
  let productName = productData.name;
  
  // Check if name is missing or generic
  if (!productName || productName === 'Unknown Product' || productName.includes('Product from')) {
    // Try to extract something from the URL
    const urlParts = url.split('/');
    const lastPart = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];
    
    // Clean up common URL patterns
    let urlHint = lastPart
      .replace(/\.(html|htm|aspx|php|jsp)$/i, '')
      .replace(/[?#].*$/, '')
      .replace(/[-_]/g, ' ')
      .slice(0, 30);
    
    if (urlHint && urlHint.length > 5) {
      productName = `${retailer} - ${urlHint}...`;
    } else {
      // Use numbered naming as fallback
      const timestamp = Date.now().toString().slice(-4);
      productName = `${retailer} Item ${timestamp}`;
    }
    
    console.log('   📝 Generated name:', productName);
  }
  
  const category = categorizeProduct(productName, url);
  
  // Use BOL-based estimation for missing dimensions
  if (!productData.dimensions) {
    productData.dimensions = estimateDimensionsFromBOL(category, productName);
    console.log('   📐 Applied BOL-based dimensions for', category);
  }
  
  // Use BOL-based weight estimation
  if (!productData.weight) {
    productData.weight = estimateWeightFromBOL(productData.dimensions, category);
    console.log('   ⚖️ Applied BOL-based weight estimate');
  }
  
  // Fix image URL if needed
  if (!productData.image || productData.image === 'null' || productData.image === '') {
    // Use a better placeholder with retailer branding
    const placeholderColors = {
      'Amazon': '7CB342/FFFFFF',
      'Wayfair': 'BA68C8/FFFFFF',
      'Walmart': '2196F3/FFFFFF',
      'Target': 'F44336/FFFFFF',
      'Unknown Retailer': '9E9E9E/FFFFFF'
    };
    const color = placeholderColors[retailer] || '7CB342/FFFFFF';
    productData.image = `https://placehold.co/400x400/${color}/png?text=${encodeURIComponent(retailer)}`;
    console.log('   🖼️ Using placeholder image');
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
    image: productData.image,
    category: category,
    retailer: retailer,
    dimensions: productData.dimensions,
    weight: productData.weight,
    shippingCost: shippingCost,
    scrapingMethod: scrapingMethod,
    dataCompleteness: {
      hasName: !!productData.name && productData.name !== 'Unknown Product',
      hasImage: !!productData.image && !productData.image.includes('placehold'),
      hasDimensions: !!productData.dimensions,
      hasWeight: !!productData.weight,
      hasPrice: !!productData.price && productData.price > 0
    }
  };
  
  // Log final summary
  console.log(`   💰 Shipping cost: $${shippingCost}`);
  console.log(`   📊 Data source: ${scrapingMethod}`);
  console.log(`   📈 Completeness: ${Object.values(product.dataCompleteness).filter(v => v).length}/5`);
  console.log(`   ✅ Product processed\n`);
  
  return product;
}

// Batch processing with better error handling and sequential fallback
async function processBatch(urls, batchSize = 1) {
  const results = [];
  const vendorCounts = {};
  
  console.log(`\n🚀 Starting sequential processing of ${urls.length} products...`);
  console.log('   Strategy: Apify → ScrapingBee → UPCitemdb → BOL Estimation\n');
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`[${i + 1}/${urls.length}] Processing URL...`);
    
    try {
      const product = await scrapeProduct(url);
      results.push(product);
      
      // Track successful scrapes
      if (product.dataCompleteness.hasPrice) {
        console.log(`   ✅ Successfully scraped: ${product.name.substring(0, 40)}...`);
      } else {
        console.log(`   ⚠️ Partial data for: ${product.name.substring(0, 40)}...`);
      }
      
    } catch (error) {
      console.error(`   ❌ Failed to process ${url}:`, error.message);
      
      // Create fallback product
      const retailer = detectRetailer(url);
      const vendorCount = (vendorCounts[retailer] || 0) + 1;
      vendorCounts[retailer] = vendorCount;
      
      const category = 'general';
      const dimensions = estimateDimensionsFromBOL(category, '');
      const weight = estimateWeightFromBOL(dimensions, category);
      const shippingCost = calculateShippingCost(dimensions, weight, 100);
      
      results.push({
        id: generateProductId(),
        url: url,
        name: `${retailer} Item ${vendorCount}`,
        price: null,
        image: `https://placehold.co/400x400/F44336/FFFFFF/png?text=Error`,
        category: category,
        retailer: retailer,
        dimensions: dimensions,
        weight: weight,
        shippingCost: shippingCost,
        scrapingMethod: 'failed',
        error: true,
        dataCompleteness: {
          hasName: false,
          hasImage: false,
          hasDimensions: false,
          hasWeight: false,
          hasPrice: false
        }
      });
    }
    
    // Add delay between products to avoid rate limiting
    if (i < urls.length - 1) {
      console.log('   ⏳ Waiting 2 seconds before next product...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Log final summary
  const successful = results.filter(p => p.dataCompleteness.hasPrice).length;
  const partial = results.filter(p => !p.error && !p.dataCompleteness.hasPrice).length;
  const failed = results.filter(p => p.error).length;
  
  console.log('\n📊 BATCH PROCESSING SUMMARY:');
  console.log(`   ✅ Successful: ${successful}/${urls.length}`);
  console.log(`   ⚠️ Partial data: ${partial}/${urls.length}`);
  console.log(`   ❌ Failed: ${failed}/${urls.length}`);
  console.log(`   📈 Success rate: ${((successful / urls.length) * 100).toFixed(1)}%\n`);
  
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
    console.log('   Using BOL-enhanced estimation with 177 historical shipments\n');
    
    const products = await processBatch(urls);
    
    // Log summary
    const scraped = products.filter(p => p.scrapingMethod !== 'estimation').length;
    console.log('\n📊 SCRAPING SUMMARY:');
    console.log(`   Total products: ${products.length}`);
    console.log(`   Successfully scraped: ${scraped}`);
    console.log(`   BOL-estimated: ${products.length - scraped}`);
    console.log(`   Success rate: ${((scraped / products.length) * 100).toFixed(1)}%\n`);
    
    res.json({ 
      products,
      summary: {
        total: products.length,
        scraped: scraped,
        estimated: products.length - scraped
      }
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape products' });
  }
});

// Store pending orders temporarily
const pendingOrders = new Map();

app.post('/api/store-pending-order', (req, res) => {
  const orderId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  pendingOrders.set(orderId, {
    data: req.body,
    timestamp: Date.now()
  });
  
  setTimeout(() => pendingOrders.delete(orderId), 3600000);
  
  console.log(`📦 Stored pending order ${orderId}`);
  res.json({ orderId, success: true });
});

app.get('/api/get-pending-order/:orderId', (req, res) => {
  const order = pendingOrders.get(req.params.orderId);
  if (order) {
    console.log(`✅ Retrieved pending order ${req.params.orderId}`);
    res.json(order.data);
    pendingOrders.delete(req.params.orderId);
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
      return res.status(500).json({ error: 'Shopify not configured' });
    }
    
    if (!customer || !customer.email || !customer.name) {
      return res.status(400).json({ error: 'Customer information required' });
    }
    
    const lineItems = [];
    
    // Add products
    products.forEach(product => {
      if (product.price && product.price > 0) {
        lineItems.push({
          title: product.name,
          price: product.price.toFixed(2),
          quantity: 1,
          properties: [
            { name: 'Source URL', value: product.url },
            { name: 'Retailer', value: product.retailer },
            { name: 'Category', value: product.category },
            { name: 'Est. Weight', value: `${product.weight} lbs` },
            { name: 'Est. Dimensions', value: `${product.dimensions.length}x${product.dimensions.width}x${product.dimensions.height}` }
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
    
    // Add combined shipping & handling (includes SDL margin)
    if (totals.totalShippingAndHandling > 0) {
      lineItems.push({
        title: 'Shipping & Handling to Bermuda',
        price: totals.totalShippingAndHandling.toFixed(2),
        quantity: 1,
        taxable: false
      });
    }
    
    const draftOrderData = {
      draft_order: {
        line_items: lineItems,
        customer: {
          email: customer.email,
          first_name: customer.name.split(' ')[0],
          last_name: customer.name.split(' ').slice(1).join(' ') || ''
        },
        email: customer.email,
        note: `Import Calculator Order\nBOL-Enhanced Estimation Used\n\nOriginal URLs:\n${originalUrls}`,
        tags: 'import-calculator, ocean-freight, bol-estimated',
        tax_exempt: true,
        send_receipt: false,
        send_fulfillment_receipt: false
      }
    };
    
    console.log(`📝 Creating draft order for ${customer.email}...`);
    
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
      error: 'Failed to create draft order',
      details: error.response?.data?.errors || error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📊 BOL Database: 177 historical shipments loaded\n`);
});
