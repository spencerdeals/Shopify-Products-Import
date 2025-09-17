const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const ApifyScraper = require('./apifyScraper');
const OrderTracker = require('./orderTracking');
const UPCItemDB = require('./upcitemdb');
const ProWebCrawler = require('./proWebCrawler');
const AmazonCrawler = require('./amazonCrawler');
require('dotenv').config();

// Import GPT parser if available, with fallback
let parseProduct;
try {
  const gptParser = require('./gptParser');
  parseProduct = gptParser.parseProduct;
  console.log('✅ GPT Parser loaded successfully');
} catch (error) {
  console.log('⚠️ GPT Parser not available:', error.message);
  parseProduct = null;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY || '';
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const BERMUDA_DUTY_RATE = 0.265;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sdl2024admin';

// Initialize services
const apifyScraper = new ApifyScraper(APIFY_API_KEY);
const upcItemDB = new UPCItemDB(UPCITEMDB_API_KEY);
const orderTracker = new OrderTracker();
const proWebCrawler = new ProWebCrawler();
const amazonCrawler = new AmazonCrawler();

const USE_APIFY = apifyScraper.isAvailable();
const USE_SCRAPINGBEE = !!SCRAPINGBEE_API_KEY;
const USE_UPCITEMDB = !!UPCITEMDB_API_KEY;
const USE_PRO_CRAWLER = proWebCrawler.isAvailable();
const USE_AMAZON_CRAWLER = amazonCrawler.isAvailable();

// FAST timeouts for speed
const SCRAPING_TIMEOUT = 15000;  // 15 seconds max for speed
const MAX_CONCURRENT_SCRAPES = 3;

console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log('');
console.log('🔍 SCRAPING CONFIGURATION:');
console.log(`1. Amazon Specialist: Amazon-Crawler - ${USE_AMAZON_CRAWLER ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`2. Primary: Apify - ${USE_APIFY ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`3. Secondary: ProWebCrawler - ${USE_PRO_CRAWLER ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`4. Tertiary: ScrapingBee - ${USE_SCRAPINGBEE ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`5. Fallback: GPT Parser - ${parseProduct ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`6. Enhancement: UPCitemdb - ${USE_UPCITEMDB ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log('=====================');

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', true);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Health check BEFORE rate limiter
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    scraping: {
      apify: USE_APIFY,
      proWebCrawler: USE_PRO_CRAWLER,
      scrapingbee: USE_SCRAPINGBEE,
      gpt: !!parseProduct,
      upcitemdb: USE_UPCITEMDB,
      amazonCrawler: USE_AMAZON_CRAWLER
    },
    shopifyConfigured: !!SHOPIFY_ACCESS_TOKEN
  });
});

// Admin authentication middleware
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="SDL Admin"');
    return res.status(401).send('Authentication required');
  }
  
  const credentials = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  const username = credentials[0];
  const password = credentials[1];
  
  if (username === 'admin' && password === ADMIN_PASSWORD) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="SDL Admin"');
    res.status(401).send('Invalid credentials');
  }
}

// Admin routes - BEFORE rate limiter
app.get('/admin', requireAuth, (req, res) => {
  const adminPath = path.join(__dirname, '../frontend', 'admin.html');
  res.sendFile(adminPath, (err) => {
    if (err) {
      console.error('Error serving admin page:', err);
      res.status(404).send('Admin page not found');
    }
  });
});

app.get('/admin.html', requireAuth, (req, res) => {
  const adminPath = path.join(__dirname, '../frontend', 'admin.html');
  res.sendFile(adminPath);
});

// Admin calculator route
app.get('/pages/imports/admin', requireAuth, (req, res) => {
  const adminCalculatorPath = path.join(__dirname, '../frontend', 'admin-calculator.html');
  res.sendFile(adminCalculatorPath, (err) => {
    if (err) {
      console.error('Error serving admin calculator page:', err);
      res.status(404).send('Admin calculator page not found');
    }
  });
});

// Admin calculator route at the specific domain path
app.get('/pages/imports/admin', requireAuth, (req, res) => {
  const adminCalculatorPath = path.join(__dirname, '../frontend', 'admin-calculator.html');
  res.sendFile(adminCalculatorPath, (err) => {
    if (err) {
      console.error('Error serving admin calculator page:', err);
      res.status(404).send('Admin calculator page not found');
    }
  });
});

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
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
    if (domain.includes('williams-sonoma.com')) return 'Williams Sonoma';
    if (domain.includes('anthropologie.com')) return 'Anthropologie';
    if (domain.includes('urbanoutfitters.com')) return 'Urban Outfitters';
    if (domain.includes('nordstrom.com')) return 'Nordstrom';
    
    // Extended retailer detection - never return "Unknown"
    if (domain.includes('ashleyfurniture') || domain.includes('ashley.com')) return 'Ashley Furniture';
    if (domain.includes('roomstogo.com')) return 'Rooms To Go';
    if (domain.includes('livingspaces.com')) return 'Living Spaces';
    if (domain.includes('bobsfurniture.com') || domain.includes('bobdiscount.com')) return 'Bob\'s Furniture';
    if (domain.includes('valuecityfurniture.com')) return 'Value City Furniture';
    if (domain.includes('raymourflanigan.com')) return 'Raymour & Flanigan';
    if (domain.includes('havertys.com')) return 'Havertys';
    if (domain.includes('ethanallen.com')) return 'Ethan Allen';
    if (domain.includes('bassettfurniture.com')) return 'Bassett Furniture';
    if (domain.includes('lazyboy.com')) return 'La-Z-Boy';
    if (domain.includes('rh.com') || domain.includes('restorationhardware.com')) return 'Restoration Hardware';
    if (domain.includes('article.com')) return 'Article';
    if (domain.includes('allmodern.com')) return 'AllModern';
    if (domain.includes('jossandmain.com')) return 'Joss & Main';
    if (domain.includes('birchlane.com')) return 'Birch Lane';
    if (domain.includes('perigold.com')) return 'Perigold';
    if (domain.includes('build.com')) return 'Build.com';
    if (domain.includes('houzz.com')) return 'Houzz';
    if (domain.includes('1stdibs.com')) return '1stDibs';
    if (domain.includes('chairish.com')) return 'Chairish';
    if (domain.includes('apt2b.com')) return 'Apt2B';
    if (domain.includes('burrow.com')) return 'Burrow';
    if (domain.includes('floyd.com')) return 'Floyd';
    if (domain.includes('interior-define.com')) return 'Interior Define';
    if (domain.includes('lovesac.com')) return 'Lovesac';
    if (domain.includes('medleywest.com')) return 'Medley West';
    if (domain.includes('modsy.com')) return 'Modsy';
    if (domain.includes('sixpenny.com')) return 'Sixpenny';
    if (domain.includes('thuma.co')) return 'Thuma';
    if (domain.includes('tuftandneedle.com')) return 'Tuft & Needle';
    if (domain.includes('westwing.com')) return 'Westwing';
    if (domain.includes('world-market.com') || domain.includes('worldmarket.com')) return 'World Market';
    if (domain.includes('pier1.com')) return 'Pier 1';
    if (domain.includes('zgallerie.com')) return 'Z Gallerie';
    if (domain.includes('arhaus.com')) return 'Arhaus';
    if (domain.includes('ballarddesigns.com')) return 'Ballard Designs';
    if (domain.includes('serenaandlily.com')) return 'Serena & Lily';
    if (domain.includes('onekingslane.com')) return 'One Kings Lane';
    if (domain.includes('grandinroad.com')) return 'Grandin Road';
    if (domain.includes('frontgate.com')) return 'Frontgate';
    if (domain.includes('horchow.com')) return 'Horchow';
    if (domain.includes('neimanmarcus.com')) return 'Neiman Marcus';
    if (domain.includes('saksfifthavenue.com')) return 'Saks Fifth Avenue';
    if (domain.includes('bloomingdales.com')) return 'Bloomingdales';
    if (domain.includes('dillards.com')) return 'Dillards';
    if (domain.includes('jcpenney.com')) return 'JCPenney';
    if (domain.includes('kohls.com')) return 'Kohl\'s';
    if (domain.includes('tjmaxx.com')) return 'TJ Maxx';
    if (domain.includes('marshalls.com')) return 'Marshalls';
    if (domain.includes('homegoods.com')) return 'HomeGoods';
    if (domain.includes('tuesday-morning.com')) return 'Tuesday Morning';
    if (domain.includes('big-lots.com') || domain.includes('biglots.com')) return 'Big Lots';
    if (domain.includes('at-home.com') || domain.includes('athome.com')) return 'At Home';
    if (domain.includes('homedecorators.com')) return 'Home Decorators Collection';
    if (domain.includes('menards.com')) return 'Menards';
    if (domain.includes('acehardware.com')) return 'Ace Hardware';
    if (domain.includes('tractorsupply.com')) return 'Tractor Supply Co.';
    if (domain.includes('ruralking.com')) return 'Rural King';
    if (domain.includes('fleetfarm.com')) return 'Fleet Farm';
    if (domain.includes('orschelnfarmhome.com')) return 'Orscheln Farm & Home';
    if (domain.includes('sportsmans.com')) return 'Sportsman\'s Warehouse';
    if (domain.includes('cabelas.com')) return 'Cabela\'s';
    if (domain.includes('basspro.com')) return 'Bass Pro Shops';
    if (domain.includes('rei.com')) return 'REI';
    if (domain.includes('dicks.com')) return 'Dick\'s Sporting Goods';
    if (domain.includes('academy.com')) return 'Academy Sports + Outdoors';
    if (domain.includes('modells.com')) return 'Modell\'s';
    if (domain.includes('bigfive.com')) return 'Big 5 Sporting Goods';
    if (domain.includes('hibbett.com')) return 'Hibbett Sports';
    if (domain.includes('footlocker.com')) return 'Foot Locker';
    if (domain.includes('finishline.com')) return 'Finish Line';
    if (domain.includes('champssports.com')) return 'Champs Sports';
    if (domain.includes('eastbay.com')) return 'Eastbay';
    if (domain.includes('nike.com')) return 'Nike';
    if (domain.includes('adidas.com')) return 'Adidas';
    if (domain.includes('underarmour.com')) return 'Under Armour';
    if (domain.includes('puma.com')) return 'Puma';
    if (domain.includes('newbalance.com')) return 'New Balance';
    if (domain.includes('converse.com')) return 'Converse';
    if (domain.includes('vans.com')) return 'Vans';
    if (domain.includes('sketchers.com')) return 'Sketchers';
    if (domain.includes('crocs.com')) return 'Crocs';
    if (domain.includes('timberland.com')) return 'Timberland';
    if (domain.includes('ugg.com')) return 'UGG';
    if (domain.includes('clarks.com')) return 'Clarks';
    if (domain.includes('ecco.com')) return 'ECCO';
    if (domain.includes('birkenstock.com')) return 'Birkenstock';
    if (domain.includes('drmartens.com')) return 'Dr. Martens';
    if (domain.includes('redwing.com')) return 'Red Wing';
    if (domain.includes('wolverine.com')) return 'Wolverine';
    if (domain.includes('caterpillar.com')) return 'Caterpillar';
    if (domain.includes('carhartt.com')) return 'Carhartt';
    if (domain.includes('dickies.com')) return 'Dickies';
    if (domain.includes('wrangler.com')) return 'Wrangler';
    if (domain.includes('levis.com')) return 'Levi\'s';
    if (domain.includes('gap.com')) return 'Gap';
    if (domain.includes('oldnavy.com')) return 'Old Navy';
    if (domain.includes('bananarepublic.com')) return 'Banana Republic';
    if (domain.includes('jcrew.com')) return 'J.Crew';
    if (domain.includes('abercrombie.com')) return 'Abercrombie & Fitch';
    if (domain.includes('hollister.com')) return 'Hollister';
    if (domain.includes('americaneagle.com')) return 'American Eagle';
    if (domain.includes('aeropostale.com')) return 'Aeropostale';
    if (domain.includes('forever21.com')) return 'Forever 21';
    if (domain.includes('hm.com')) return 'H&M';
    if (domain.includes('zara.com')) return 'Zara';
    if (domain.includes('uniqlo.com')) return 'Uniqlo';
    if (domain.includes('express.com')) return 'Express';
    if (domain.includes('anntaylor.com')) return 'Ann Taylor';
    if (domain.includes('loft.com')) return 'LOFT';
    if (domain.includes('whitehouseblackmarket.com')) return 'White House Black Market';
    if (domain.includes('talbots.com')) return 'Talbots';
    if (domain.includes('chicos.com')) return 'Chico\'s';
    if (domain.includes('dressbarn.com')) return 'Dressbarn';
    if (domain.includes('lanebryant.com')) return 'Lane Bryant';
    if (domain.includes('torrid.com')) return 'Torrid';
    if (domain.includes('maurices.com')) return 'Maurices';
    if (domain.includes('catherines.com')) return 'Catherines';
    if (domain.includes('avenue.com')) return 'Avenue';
    if (domain.includes('ashro.com')) return 'Ashro';
    if (domain.includes('roamans.com')) return 'Roaman\'s';
    if (domain.includes('womanwithin.com')) return 'Woman Within';
    if (domain.includes('jessicalondon.com')) return 'Jessica London';
    if (domain.includes('fullbeauty.com')) return 'FullBeauty';
    if (domain.includes('kingsize.com')) return 'KingSize';
    if (domain.includes('destinationxl.com')) return 'Destination XL';
    if (domain.includes('casualmale.com')) return 'Casual Male XL';
    if (domain.includes('bigandtall.com')) return 'Big and Tall';
    
    // Fallback: Extract retailer name from domain
    const domainParts = domain.replace('www.', '').split('.');
    const mainDomain = domainParts[0];
    
    // Clean up and format the domain name
    const retailerName = mainDomain
      .replace(/[-_]/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    return retailerName;
  } catch (e) {
    // Even if URL parsing fails, try to extract from the string
    const urlLower = url.toLowerCase();
    if (urlLower.includes('amazon')) return 'Amazon';
    if (urlLower.includes('wayfair')) return 'Wayfair';
    if (urlLower.includes('target')) return 'Target';
    if (urlLower.includes('walmart')) return 'Walmart';
    
    // Last resort fallback
    return 'Online Retailer';
  }
}

function isAmazonUrl(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    return domain.includes('amazon.com') || domain.includes('amazon.');
  } catch (e) {
    return false;
  }
}

function isSDLDomain(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    const blockedPatterns = [
      'spencer-deals-ltd.myshopify.com',
      'sdl.bm',
      'spencer-deals',
      'spencerdeals'
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
  
  // Enhanced category estimates
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

function estimateBoxDimensions(productDimensions, category) {
  if (!productDimensions) return null;
  
  const paddingFactors = {
    'electronics': 1.3,
    'appliances': 1.2,
    'furniture': 1.1,
    'clothing': 1.4,
    'books': 1.2,
    'toys': 1.25,
    'sports': 1.2,
    'home-decor': 1.35,
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
    return Math.max(25, (price || 100) * 0.15);
  }
  
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  const baseCost = Math.max(15, cubicFeet * 8); // $8 per cubic foot
  const oversizeFee = Math.max(dimensions.length, dimensions.width, dimensions.height) > 48 ? 50 : 0;
  const valueFee = price > 500 ? price * 0.02 : 0;
  const handlingFee = 15;
  
  const totalCost = baseCost + oversizeFee + valueFee + handlingFee;
  return Math.round(totalCost);
}

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

function mergeProductData(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  
  return {
    name: primary.name || secondary.name,
    price: primary.price || secondary.price,
    image: primary.image || secondary.image,
    variant: primary.variant || secondary.variant,
    dimensions: primary.dimensions || secondary.dimensions,
    weight: primary.weight || secondary.weight,
    brand: primary.brand || secondary.brand,
    category: primary.category || secondary.category,
    inStock: primary.inStock !== undefined ? primary.inStock : secondary.inStock
  };
}

// Get optimal scraping order based on retailer
function getOptimalScrapingOrder(retailer) {
  // ScrapingBee works best for these retailers
  const scrapingBeeFirst = ['Target', 'Best Buy', 'Walmart', 'Home Depot', 'Lowes', 'Costco'];
  
  // ProWebCrawler works best for these retailers  
  const proWebFirst = ['IKEA', 'CB2', 'Crate & Barrel', 'West Elm', 'Pottery Barn', 'Anthropologie', 'Urban Outfitters'];
  
  // Apify works best for these retailers
  const apifyFirst = ['Macys', 'Nordstrom', 'Overstock', 'Bed Bath & Beyond'];
  
  if (scrapingBeeFirst.includes(retailer)) {
    return ['scrapingbee', 'apify', 'prowebcrawler'];
  } else if (proWebFirst.includes(retailer)) {
    return ['prowebcrawler', 'scrapingbee', 'apify'];
  } else if (apifyFirst.includes(retailer)) {
    return ['apify', 'prowebcrawler', 'scrapingbee'];
  } else {
    // Default order for unknown retailers
    return ['prowebcrawler', 'apify', 'scrapingbee'];
  }
}

// ScrapingBee scraper with better error handling
async function scrapeWithScrapingBee(url) {
  if (!USE_SCRAPINGBEE) {
    throw new Error('ScrapingBee not configured');
  }

  try {
    console.log('🐝 Starting ScrapingBee extraction...');
    const startTime = Date.now();
    
    const response = await Promise.race([
      axios({
        method: 'GET',
        url: 'https://app.scrapingbee.com/api/v1/',
        params: {
          api_key: SCRAPINGBEE_API_KEY,
          url: url,
          premium_proxy: 'false',
          country_code: 'us',
          render_js: 'false',
          block_resources: 'true',
          wait: '1000' // Reduce wait time for speed
        },
        timeout: 6000 // Faster timeout
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('ScrapingBee timeout')), 6000)
      )
    ]);

    console.log(`   ✅ ScrapingBee completed in ${Date.now() - startTime}ms`);
    
    const html = response.data;
    if (!html || typeof html !== 'string') {
      throw new Error('No HTML content received');
    }
    
    const productData = {
      name: null,
      price: null,
      image: null,
      variant: null,
      dimensions: null,
      weight: null,
      brand: null,
      inStock: true
    };

    // Extract title
    const titlePatterns = [
      /<h1[^>]*data-testid="[^"]*title[^"]*"[^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<title[^>]*>([^|<]+)/i
    ];
    
    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1].trim()) {
        productData.name = match[1].trim().replace(/&[^;]+;/g, '').substring(0, 200);
        console.log('   📝 Found title');
        break;
      }
    }

    // Extract variant information (color, size, style, etc.)
    const variantPatterns = [
      // Wayfair specific patterns
      // More comprehensive Wayfair variant patterns
      /class="[^"]*SelectedOption[^"]*"[^>]*>([^<]+)<\/[^>]*>/i,
      /class="[^"]*selected[^"]*option[^"]*"[^>]*>([^<]+)<\/[^>]*>/i,
      /data-testid="[^"]*selected[^"]*"[^>]*>([^<]+)<\/[^>]*>/i,
      /aria-selected="true"[^>]*>([^<]+)<\/[^>]*>/i,
      // JSON data patterns - more specific
      /"selectedOptionName":\s*"([^"]{2,50})"/i,
      /"optionName":\s*"([^"]{2,50})"/i,
      /"selectedOption":\s*"([^"]{2,50})"/i,
      /"currentOption":\s*"([^"]{2,50})"/i,
      // Look for color/size in URL parameters
      /piid=(\d+)/i,
      // Generic variant patterns
      /class="[^"]*color[^"]*selected[^"]*"[^>]*>([^<]+)<\/[^>]*>/i,
      /class="[^"]*size[^"]*selected[^"]*"[^>]*>([^<]+)<\/[^>]*>/i,
      // Structured data variants
      /"variant":\s*"([^"]{2,50})"/i,
      /"color":\s*"([^"]{2,50})"/i,
      /"size":\s*"([^"]{2,50})"/i,
      // Look for variant in meta tags
      /property="product:color"[^>]+content="([^"]+)"/i,
      /property="product:size"[^>]+content="([^"]+)"/i
    ];
    
    for (const pattern of variantPatterns) {
      const match = html.match(pattern);
      if (match && match[1] && match[1].trim().length > 1 && match[1].trim().length < 50) {
        productData.variant = match[1].trim().replace(/&[^;]+;/g, '');
        // Skip generic/unhelpful variants
        if (!productData.variant.match(/^(select|choose|option|default|none|n\/a)$/i)) {
          console.log('   🎨 Found variant:', productData.variant);
          break;
        }
      }
    }
    
    // If no variant found, try extracting from URL parameters (Wayfair specific)
    if (!productData.variant) {
      try {
        const urlObj = new URL(url);
        const piid = urlObj.searchParams.get('piid');
        if (piid) {
          // This is a Wayfair product variant ID - we could potentially map this
          console.log('   🎨 Found Wayfair variant ID:', piid);
          productData.variant = `Variant ${piid}`;
        }
      } catch (e) {
        // URL parsing failed, continue
      }
    }
    
    // Extract price
    const pricePatterns = [
      // More specific price patterns for better accuracy
      /class="[^"]*price[^"]*"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      /data-testid="[^"]*price[^"]*"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      /id="[^"]*price[^"]*"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      // Wayfair specific
      /MoneyPrice[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      /PriceBlock[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      // JSON-LD structured data
      /"price":\s*"?(\d+(?:\.\d{2})?)"?/i,
      /"amount":\s*"?(\d+(?:\.\d{2})?)"?/i,
      // Generic fallback - but more restrictive
      /\$(\d{2,4}(?:,\d{3})*(?:\.\d{2})?)/g
    ];
    
    // Try patterns in order of specificity
    for (let i = 0; i < pricePatterns.length; i++) {
      const pattern = pricePatterns[i];
      
      if (pattern.global) {
        // For global patterns, find all matches and pick the most reasonable one
        const matches = [...html.matchAll(pattern)];
        const prices = matches.map(match => parseFloat(match[1].replace(/,/g, '')))
          .filter(price => price >= 10 && price <= 50000) // Reasonable price range
          .sort((a, b) => b - a); // Sort descending
        
        if (prices.length > 0) {
          // For furniture, prefer higher prices as they're more likely to be correct
          productData.price = prices[0];
          console.log('   💰 Found price: $' + productData.price + ` (from ${prices.length} candidates)`);
          break;
        }
      } else {
        // For non-global patterns, take first match
        const match = html.match(pattern);
        if (match) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (price >= 10 && price <= 50000) {
            productData.price = price;
            console.log('   💰 Found price: $' + price);
            break;
          }
        }
      }
    }

    // Extract dimensions
    const dimPatterns = [
      /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i,
      /dimensions?[^>]*>[\s\S]*?(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i
    ];
    
    for (const pattern of dimPatterns) {
      const match = html.match(pattern);
      if (match) {
        productData.dimensions = {
          length: parseFloat(match[1]),
          width: parseFloat(match[2]),
          height: parseFloat(match[3])
        };
        console.log('   📏 Found dimensions');
        break;
      }
    }

    // Extract image URL
    const imagePatterns = [
      /src="([^"]+)"[^>]*(?:class="[^"]*product[^"]*image|data-testid="[^"]*image)/i,
      /property="og:image"[^>]+content="([^"]+)"/i
    ];
    
    for (const pattern of imagePatterns) {
      const match = html.match(pattern);
      if (match && match[1].startsWith('http')) {
        productData.image = match[1];
        break;
      }
    }

    return productData;

  } catch (error) {
    console.error('❌ ScrapingBee failed:', error.message);
    throw error;
  }
}

// Main product scraping function
async function scrapeProduct(url) {
  const productId = generateProductId();
  const retailer = detectRetailer(url);
  
  let productData = null;
  let scrapingMethod = 'none';
  
  console.log(`\n📦 Processing: ${url}`);
  console.log(`   Retailer: ${retailer}`);
  
  // STEP 1: For Amazon URLs, try Amazon-Crawler first
  if (retailer === 'Amazon' && amazonCrawler.isAvailable()) {
    try {
      console.log('   🛒 Attempting Amazon-Crawler (primary for Amazon)...');
      productData = await amazonCrawler.scrapeProduct(url);
      
      if (productData) {
        scrapingMethod = 'amazon-crawler';
        console.log('   ✅ Amazon-Crawler returned data');
        
        // Check if data is complete
        if (!isDataComplete(productData)) {
          console.log('   ⚠️ Amazon-Crawler data incomplete, will try fallbacks');
        }
      }
    } catch (error) {
      console.log('   ❌ Amazon-Crawler failed:', error.message);
      productData = null;
    }
  }
  
  // STEP 1: For Amazon URLs, ALWAYS use specialized Amazon crawler as PRIMARY
  if (USE_AMAZON_CRAWLER && isAmazonUrl(url)) {
    try {
      console.log('   🛒 Attempting Amazon specialist crawler...');
      
      const amazonPromise = amazonCrawler.scrapeProduct(url);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Amazon crawler timeout')), 15000) // 15s for Amazon
      );
      
      productData = await Promise.race([amazonPromise, timeoutPromise]);
      
      if (productData) {
        scrapingMethod = 'amazon-crawler';
        console.log('   ✅ Amazon crawler returned data');
        
        // For Amazon, if we get ANY data from amazon-crawler, use it as primary
        // Only supplement missing fields, don't replace existing data
        if (productData.name && productData.price) {
          console.log('   ✅ Amazon crawler has essential data - using as primary');
        } else {
          console.log('   ⚠️ Amazon crawler missing essential data, will supplement');
        }
      }
    } catch (error) {
      console.log('   ❌ Amazon crawler failed:', error.message);
      productData = null;
    }
  }
  
  // STEP 2: For Amazon with incomplete data, try other methods to supplement
  // For non-Amazon, use optimal scraping order
  if (!productData || (!isAmazonUrl(url) && !isDataComplete(productData)) || (isAmazonUrl(url) && (!productData.name || !productData.price))) {
    const scrapingOrder = getOptimalScrapingOrder(retailer);
    
    for (const method of scrapingOrder) {
      // For Amazon, only supplement if missing essential data
      if (isAmazonUrl(url) && productData && productData.name && productData.price) break;
      // For non-Amazon, stop when data is complete
      if (!isAmazonUrl(url) && productData && isDataComplete(productData)) break;
      
      try {
        let scraperData = null;
        let methodName = '';
        
        if (method === 'prowebcrawler' && USE_PRO_CRAWLER) {
          console.log('   🕸️ Attempting ProWebCrawler...');
          const proWebPromise = proWebCrawler.scrapeProduct(url);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('ProWebCrawler timeout')), 12000)
          );
          scraperData = await Promise.race([proWebPromise, timeoutPromise]);
          methodName = 'prowebcrawler';
        } else if (method === 'apify' && USE_APIFY) {
          console.log('   🔄 Attempting Apify scrape...');
          const apifyPromise = apifyScraper.scrapeProduct(url);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Apify timeout')), 8000)
          );
          scraperData = await Promise.race([apifyPromise, timeoutPromise]);
          methodName = 'apify';
        } else if (method === 'scrapingbee' && USE_SCRAPINGBEE) {
          console.log('   🐝 Attempting ScrapingBee...');
          const scrapingBeePromise = scrapeWithScrapingBee(url);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('ScrapingBee timeout')), 6000)
          );
          scraperData = await Promise.race([scrapingBeePromise, timeoutPromise]);
          methodName = 'scrapingbee';
        }
        
        if (scraperData) {
          if (!productData) {
            productData = scraperData;
            scrapingMethod = methodName;
            console.log(`   ✅ Using ${methodName} data`);
          } else {
            // For Amazon, prioritize amazon-crawler data over other scrapers
            const mergedData = isAmazonUrl(url) ? 
              mergeProductData(productData, scraperData) : // Amazon: keep amazon-crawler data as primary
              mergeProductData(productData, scraperData);   // Non-Amazon: normal merge
            productData = mergedData;
            scrapingMethod = scrapingMethod + '+' + methodName;
            
            if (isAmazonUrl(url)) {
              console.log(`   ✅ Supplemented Amazon data with ${methodName}`);
            }
          }
        }
      } catch (error) {
        console.log(`   ❌ ${method} failed:`, error.message);
      }
    }
  }
  
  // Skip the old individual scraper attempts since we handled them above
  /*
  if (USE_PRO_CRAWLER && !isAmazonUrl(url) && (!productData || !isDataComplete(productData))) {
    try {
      console.log('   🕸️ Attempting ProWebCrawler...');
      const proWebPromise = proWebCrawler.scrapeProduct(url);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('ProWebCrawler timeout')), 12000) // 12s for ProWeb
      );
      
      const proWebData = await Promise.race([proWebPromise, timeoutPromise]);
      
      if (proWebData) {
        if (!productData) {
          productData = proWebData;
          scrapingMethod = 'prowebcrawler';
          console.log('   ✅ Using ProWebCrawler data');
        } else {
          const mergedData = mergeProductData(productData, proWebData);
          productData = mergedData;
          scrapingMethod = scrapingMethod + '+prowebcrawler';
        }
      }
    } catch (error) {
      console.log('   ❌ ProWebCrawler failed:', error.message);
    }
  }
  
  // STEP 2: If Amazon-Crawler failed or not Amazon, try Apify
  if (USE_APIFY && (!productData || !isDataComplete(productData))) {
    try {
      const apifyLabel = retailer === 'Amazon' ? 'Apify (Amazon fallback)' : 'Apify (primary)';
      console.log(`   🔄 Attempting ${apifyLabel}...`);
      
      const apifyPromise = apifyScraper.scrapeProduct(url);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Apify timeout')), 8000) // 8s for Apify
      );
      
      const apifyData = await Promise.race([apifyPromise, timeoutPromise]);
      
      if (apifyData) {
        if (!productData) {
          productData = apifyData;
          scrapingMethod = 'apify';
          console.log('   ✅ Apify returned data');
        } else {
          const mergedData = mergeProductData(productData, apifyData);
          productData = mergedData;
          scrapingMethod = scrapingMethod + '+apify';
        }
      }
    } catch (error) {
      console.log('   ❌ Apify failed:', error.message);
    }
  }
  
  // STEP 4: Try ScrapingBee if still needed
  if (USE_SCRAPINGBEE && (!productData || !isDataComplete(productData))) {
    try {
      console.log('   🐝 Attempting ScrapingBee...');
      const scrapingBeePromise = scrapeWithScrapingBee(url);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('ScrapingBee timeout')), 6000) // 6s for ScrapingBee
      );
      
      const scrapingBeeData = await Promise.race([scrapingBeePromise, timeoutPromise]);
      
      if (scrapingBeeData) {
        if (!productData) {
          productData = scrapingBeeData;
          scrapingMethod = 'scrapingbee';
          console.log('   ✅ Using ScrapingBee data');
        } else {
          const mergedData = mergeProductData(productData, scrapingBeeData);
          productData = mergedData;
          scrapingMethod = scrapingMethod + '+scrapingbee';
        }
      }
    } catch (error) {
      console.log('   ❌ ScrapingBee failed:', error.message);
    }
  }
  */
  
  // STEP 3: Try GPT parser only as last resort for missing essential data
  if (parseProduct && (!productData || !productData.name || !productData.price)) {
    try {
      console.log(`   🧠 ${isAmazonUrl(url) ? 'Supplementing Amazon data with' : 'Falling back to'} GPT parser...`);
      const gptData = await parseProduct(url);
      
      if (gptData) {
        if (!productData) {
          productData = gptData;
          scrapingMethod = 'gpt';
        } else {
          // For Amazon, only use GPT for missing fields, keep amazon-crawler as primary
          productData = isAmazonUrl(url) ? 
            mergeProductData(productData, gptData) : // Keep Amazon data primary
            mergeProductData(productData, gptData);   // Normal merge for others
          scrapingMethod = scrapingMethod + '+gpt';
        }
        console.log(`   ✅ GPT parser ${isAmazonUrl(url) ? 'supplemented Amazon data' : 'succeeded'}`);
      }
    } catch (error) {
      console.log('   ❌ GPT parser failed:', error.message);
    }
  }
  
  // STEP 4: Try UPCitemdb for missing dimensions
  if (USE_UPCITEMDB && productData && productData.name && (!productData.dimensions || !productData.weight)) {
    try {
      console.log('   📦 Attempting UPCitemdb lookup...');
      const upcData = await upcItemDB.searchByName(productData.name);
      
      if (upcData) {
        if (!productData.dimensions && upcData.dimensions) {
          const category = productData.category || categorizeProduct(productData.name || '', url);
          productData.dimensions = estimateBoxDimensions(upcData.dimensions, category);
          console.log('   ✅ UPCitemdb provided dimensions');
        }
        if (!productData.weight && upcData.weight) {
          productData.weight = upcData.weight;
          console.log('   ✅ UPCitemdb provided weight');
        }
        scrapingMethod = scrapingMethod === 'estimation' ? 'upcitemdb' : scrapingMethod + '+upcitemdb';
      }
    } catch (error) {
      console.log('   ❌ UPCitemdb lookup failed:', error.message);
    }
  }
  
  // STEP 7: Use estimation for missing data
  if (!productData) {
    productData = {
      name: 'Product from ' + retailer,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      category: null
    };
    scrapingMethod = 'estimation';
    console.log('   ⚠️ All methods failed, using estimation');
  }
  
  // Fill in missing data
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
    variant: productData.variant || null,
    image: productData.image || 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=SDL',
    category: category,
    retailer: retailer,
    dimensions: productData.dimensions,
    weight: productData.weight,
    shippingCost: shippingCost,
    scrapingMethod: scrapingMethod,
    dataCompleteness: {
      hasName: !!productData.name,
      hasImage: !!productData.image,
      hasDimensions: !!productData.dimensions,
      hasWeight: !!productData.weight,
      hasPrice: !!productData.price
    }
  };
  
  console.log(`   💰 Shipping cost: $${shippingCost}`);
  console.log(`   📊 Data source: ${scrapingMethod}`);
  if (productData.variant) {
    console.log(`   🎨 Variant detected: ${productData.variant}`);
  }
  console.log(`   ✅ Product processed successfully\n`);
  
  return product;
}

// Batch processing with concurrency control
async function processBatch(urls, batchSize = MAX_CONCURRENT_SCRAPES) {
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

// Store pending orders temporarily
const pendingOrders = new Map();

// Root route
app.get('/', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend', 'index.html');
  res.sendFile(frontendPath, (err) => {
    if (err) {
      console.error('Error serving frontend:', err);
      res.json({
        message: 'Frontend not found - API is running',
        endpoints: {
          health: '/health',
          scrape: 'POST /api/scrape'
        }
      });
    }
  });
});

// MISSING ENDPOINT: API endpoint for scraping
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
    
    // Log summary
    const amazonCount = products.filter(p => p.scrapingMethod?.includes('amazon-crawler')).length;
    const apifyCount = products.filter(p => p.scrapingMethod?.includes('apify')).length;
    const proWebCount = products.filter(p => p.scrapingMethod?.includes('prowebcrawler')).length;
    const scrapingBeeCount = products.filter(p => p.scrapingMethod?.includes('scrapingbee')).length;
    const gptCount = products.filter(p => p.scrapingMethod?.includes('gpt')).length;
    const upcitemdbCount = products.filter(p => p.scrapingMethod?.includes('upcitemdb')).length;
    const estimatedCount = products.filter(p => p.scrapingMethod === 'estimation').length;
    
    console.log('\n📊 SCRAPING SUMMARY:');
    console.log(`   Total products: ${products.length}`);
    console.log(`   Amazon-Crawler used: ${amazonCount}`);
    console.log(`   Apify used: ${apifyCount}`);
    console.log(`   ProWebCrawler used: ${proWebCount}`);
    console.log(`   ScrapingBee used: ${scrapingBeeCount}`);
    console.log(`   GPT used: ${gptCount}`);
    console.log(`   UPCitemdb used: ${upcitemdbCount}`);
    console.log(`   Fully estimated: ${estimatedCount}`);
    console.log(`   Success rate: ${((products.length - estimatedCount) / products.length * 100).toFixed(1)}%\n`);
    
    res.json({ 
      products,
      summary: {
        total: products.length,
        scraped: products.length - estimatedCount,
        estimated: estimatedCount,
        scrapingMethods: {
          amazonCrawler: amazonCount,
          apify: apifyCount,
          proWebCrawler: proWebCount,
          scrapingBee: scrapingBeeCount,
          gpt: gptCount,
          upcitemdb: upcitemdbCount,
          estimation: estimatedCount
        }
      }
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape products' });
  }
});

// MISSING ENDPOINT: Prepare Shopify checkout - CRITICAL FOR FRONTEND
app.post('/api/prepare-shopify-checkout', async (req, res) => {
  try {
    const orderData = req.body;
    
    // Generate a unique checkout ID
    const checkoutId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    
    // Store the order data temporarily
    pendingOrders.set(checkoutId, {
      data: orderData,
      timestamp: Date.now()
    });
    
    // Clean up old orders after 1 hour
    setTimeout(() => pendingOrders.delete(checkoutId), 3600000);
    
    // Create the redirect URL - this should redirect to a page that will complete the order
    const redirectUrl = `/complete-order.html?checkoutId=${checkoutId}`;
    
    console.log(`🛒 Prepared checkout ${checkoutId} for ${orderData.products?.length || 0} products`);
    
    res.json({
      success: true,
      checkoutId: checkoutId,
      redirectUrl: redirectUrl
    });
    
  } catch (error) {
    console.error('❌ Failed to prepare checkout:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to prepare checkout',
      message: error.message
    });
  }
});

// MISSING ENDPOINT: Get checkout data
app.get('/api/get-checkout/:checkoutId', (req, res) => {
  const { checkoutId } = req.params;
  const orderData = pendingOrders.get(checkoutId);
  
  if (orderData) {
    console.log(`✅ Retrieved checkout data for ${checkoutId}`);
    res.json({
      success: true,
      data: orderData.data
    });
  } else {
    console.log(`❌ Checkout ${checkoutId} not found or expired`);
    res.status(404).json({
      success: false,
      error: 'Checkout not found or expired'
    });
  }
});

// Order tracking endpoints
app.post('/api/orders/:orderId/start-tracking', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { retailerOrders } = req.body;
    
    const result = await orderTracker.startTracking(orderId, retailerOrders);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/orders/:orderId/stop-tracking', async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await orderTracker.stopTracking(orderId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/orders/:orderId/tracking-status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await orderTracker.getTrackingStatus(orderId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

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

// FIXED: Shopify Draft Order Creation with better error handling
app.post('/apps/instant-import/create-draft-order', async (req, res) => {
  try {
    let orderData = req.body;
    
    // If this comes from the checkout flow, get the stored data
    if (req.body.checkoutId) {
      const storedData = pendingOrders.get(req.body.checkoutId);
      if (storedData) {
        orderData = { ...storedData.data, ...req.body };
        pendingOrders.delete(req.body.checkoutId);
      }
    }
    
    const { products, deliveryFees, totals, customer, originalUrls } = orderData;
    
    if (!SHOPIFY_ACCESS_TOKEN) {
      return res.status(500).json({ 
        error: 'Shopify not configured. Please check API credentials.' 
      });
    }
    
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Products array is required' });
    }
    
    // Get customer info - for now require in request
    let customerInfo = customer;
    if (!customerInfo?.email || !customerInfo?.name) {
      return res.status(400).json({ error: 'Customer information (email and name) required' });
    }
    
    console.log(`📝 Creating draft order for ${customerInfo.email} with ${products.length} products`);
    
    const lineItems = [];
    
      const apifyData = await apifyScraper.scrapeProduct(url);
    products.forEach(product => {
      if (apifyData) {
        if (!productData) {
          // No previous data, use Apify
          productData = apifyData;
          scrapingMethod = 'apify';
          console.log('   ✅ Apify returned data');
        } else {
          // Merge with existing data
          const mergedData = mergeProductData(productData, apifyData);
          productData = mergedData;
          scrapingMethod = scrapingMethod + '+apify';
          console.log('   ✅ Apify supplemented existing data');
        }
        
        lineItems.push({
          title: `${product.name}${product.variant ? ` - ${product.variant}` : ''}`,
          price: unitPrice.toFixed(2),
          quantity: quantity,
          requires_shipping: true,
          taxable: false,
          properties: [
            { name: 'Source URL', value: product.url },
            { name: 'Retailer', value: product.retailer },
            { name: 'Category', value: product.category }
          ]
        });
      }
    });
    
    // Add duty
    if (totals && totals.dutyAmount > 0) {
      lineItems.push({
        title: 'Bermuda Import Duty (26.5%)',
        price: totals.dutyAmount.toFixed(2),
        quantity: 1,
        requires_shipping: false,
        taxable: false
      });
    }
    
    // Add delivery fees
    if (deliveryFees && Object.keys(deliveryFees).length > 0) {
      Object.entries(deliveryFees).forEach(([vendor, fee]) => {
        if (fee > 0) {
          lineItems.push({
            title: `${vendor} US Delivery Fee`,
            price: fee.toFixed(2),
            quantity: 1,
            requires_shipping: false,
            taxable: false
          });
        }
      });
    }
    
    // Add shipping & handling
    if (totals && totals.totalShippingAndHandling > 0) {
      lineItems.push({
        title: 'Ocean Freight & Handling to Bermuda',
        price: totals.totalShippingAndHandling.toFixed(2),
        quantity: 1,
        requires_shipping: false,
        taxable: false
      });
    }
    
    const draftOrderData = {
      draft_order: {
        line_items: lineItems,
        customer: {
          email: customerInfo.email,
          first_name: customerInfo.firstName || customerInfo.name?.split(' ')[0] || '',
          last_name: customerInfo.lastName || customerInfo.name?.split(' ').slice(1).join(' ') || ''
        },
        email: customerInfo.email,
        note: `Import Calculator Order\n\nOriginal URLs:\n${originalUrls || 'N/A'}`,
        tags: 'instant-import, ocean-freight',
        tax_exempt: true,
        send_receipt: false,
        send_fulfillment_receipt: false
      }
    };
    
    const shopifyResponse = await axios.post(
      `https://${SHOPIFY_DOMAIN}/admin/api/2023-10/draft_orders.json`,
      draftOrderData,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          console.log('   ⚠️ Data still incomplete, will try more fallbacks');
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
      totalAmount: totals?.grandTotal || 0
    });
    
  } catch (error) {
    console.error('Draft order creation error:', error.response?.data || error);
    res.status(500).json({ 
      error: 'Failed to create draft order. Please try again or contact support.',
      details: error.response?.data?.errors || error.message
    });
  }
});

// Test endpoints
app.get('/test-upc', async (req, res) => {
  if (!USE_UPCITEMDB) {
    return res.json({ 
      success: false, 
    });
  }
  
  // STEP 3: Try ProWebCrawler if still incomplete
  if (proWebCrawler.isAvailable() && (!productData || !isDataComplete(productData))) {
    try {
      console.log('   🕸️ Attempting ProWebCrawler...');
      const proData = await proWebCrawler.scrapeProduct(url);
      
          // All previous methods failed, use ScrapingBee data
        if (!productData) {
          scrapingMethod = 'scrapingbee-gpt';
          console.log('   ✅ Using ScrapingBee GPT data');
          console.log('   ✅ ProWebCrawler returned data');
          // Merge data - keep existing data but fill in missing fields
          const mergedData = mergeProductData(productData, proData);
          productData = mergedData;
          scrapingMethod = scrapingMethod + '+proweb';
          console.log('   ✅ ProWebCrawler supplemented data');
            console.log('   ✅ ScrapingBee GPT provided missing name');
      }
    } catch (error) {
            console.log('   ✅ ScrapingBee GPT provided missing price');
    }
  }
            console.log('   ✅ ScrapingBee GPT provided missing image');
  // STEP 4: If still incomplete, try ScrapingBee with AI
    const testProduct = await upcItemDB.searchByName('Apple iPhone 15 Pro');
            console.log('   ✅ ScrapingBee GPT provided missing dimensions');
      console.log('   🐝 Attempting ScrapingBee GPT extraction...');
      testProduct: testProduct,
      message: testProduct ? 'UPCitemdb is working!' : 'UPCitemdb connected but no results'
          scrapingMethod = scrapingMethod + '+scrapingbee-gpt';
  } catch (error) {
    res.json({
      success: false,
      console.log('   ❌ ScrapingBee GPT extraction failed:', error.message);
    });
  }
});

// Complete order page
app.get('/complete-order.html', (req, res) => {
  const completePath = path.join(__dirname, '../frontend', 'complete-order.html');
  res.sendFile(completePath, (err) => {
    if (err) {
      console.error('Error serving complete-order page:', err);
      res.redirect('/');
    }
  });
});

// Catch-all route for frontend
app.get('*', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend', 'index.html');
  res.sendFile(frontendPath, (err) => {
    if (err) {
      res.status(404).send('Page not found');
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📍 Admin Panel: http://localhost:${PORT}/admin (admin:${ADMIN_PASSWORD})\n`);
  
  // STEP 5: Try UPCitemdb if we have a product name but missing dimensions
  process.on('SIGTERM', () => {
    console.log('🛑 Server shutting down...');
    process.exit(0);
  });
});