const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { URL } = require('url');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;
const SCRAPING_TIMEOUT = 30000;
const MAX_CONCURRENT_SCRAPES = 3;
const BERMUDA_DUTY_RATE = 0.265;
const USE_SCRAPINGBEE = !!SCRAPINGBEE_API_KEY;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// Utilities
function generateProductId() {
  return Date.now() + Math.random().toString(36).substr(2, 9);
}

function detectRetailer(url) {
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
  return 'Unknown Retailer';
}

function categorizeProduct(name, url) {
  const text = (name + ' ' + url).toLowerCase();
  if (/furniture|sofa|chair|table|desk|bed|mattress|dresser|cabinet/.test(text)) return 'furniture';
  if (/tv|laptop|phone|computer|electronics|camera|speaker|headphone/.test(text)) return 'electronics';
  if (/appliance|refrigerator|washing|dryer|dishwasher|microwave|oven/.test(text)) return 'appliances';
  if (/clothing|shirt|pants|dress|shoes|jacket|apparel/.test(text)) return 'clothing';
  if (/book|magazine|journal|novel/.test(text)) return 'books';
  if (/toy|game|puzzle|doll|action|play/.test(text)) return 'toys';
  if (/sport|fitness|exercise|gym|bike|golf/.test(text)) return 'sports';
  if (/decor|vase|picture|artwork|candle|pillow|curtain/.test(text)) return 'home-decor';
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
  const dimMatch = text.match(/(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)/);
  if (dimMatch) {
    return {
      length: Math.max(1, parseFloat(dimMatch[1]) * 1.2),
      width: Math.max(1, parseFloat(dimMatch[2]) * 1.2), 
      height: Math.max(1, parseFloat(dimMatch[3]) * 1.2)
    };
  }
  
  const baseEstimates = {
    'furniture': { length: 48, width: 24, height: 36 },
    'electronics': { length: 20, width: 12, height: 8 },
    'appliances': { length: 28, width: 28, height: 36 },
    'clothing': { length: 12, width: 10, height: 2 },
    'books': { length: 9, width: 6, height: 1 },
    'toys': { length: 12, width: 8, height: 6 },
    'sports': { length: 24, width: 12, height: 12 },
    'home-decor': { length: 12, width: 12, height: 12 },
    'general': { length: 18, width: 12, height: 8 }
  };
  
  const base = baseEstimates[category] || baseEstimates.general;
  
  return {
    length: base.length * 1.2,
    width: base.width * 1.2,
    height: base.height * 1.2
  };
}

function calculateShippingCost(dimensions, weight, orderTotal = 0) {
  const volume = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = volume / 1728;
  
  // Base freight: $7.50 per cubic foot
  const baseCost = cubicFeet * 7.5;
  
  // Competitive margin based on order size
  let marginMultiplier;
  if (orderTotal < 400) {
    marginMultiplier = 1.45; // 45% margin for orders under $400
  } else if (orderTotal < 1500) {
    marginMultiplier = 1.30; // 30% margin for orders $400-$1500  
  } else {
    marginMultiplier = 1.20; // 20% margin for orders over $1500
  }
  
  const finalCost = baseCost * marginMultiplier;
  
  return Math.max(35, Math.round(finalCost * 100) / 100);
}

// API endpoint to recalculate shipping with order total
app.post('/api/calculate-shipping', (req, res) => {
  try {
    const { products, orderTotal } = req.body;
    
    const updatedProducts = products.map(product => ({
      ...product,
      shippingCost: calculateShippingCost(product.dimensions, product.weight, orderTotal)
    }));
    
    const totalShippingCost = updatedProducts.reduce((total, product) => {
      return total + (product.shippingCost * product.quantity);
    }, 0);
    
    res.json({
      success: true,
      products: updatedProducts,
      totalShippingCost: Math.round(totalShippingCost * 100) / 100
    });
    
  } catch (error) {
    console.error('Shipping calculation error:', error);
    res.status(500).json({ success: false, error: 'Failed to calculate shipping' });
  }
});

// ScrapingBee integration
async function scrapingBeeRequest(url) {
  if (!SCRAPINGBEE_API_KEY) {
    throw new Error('ScrapingBee API key not configured');
  }
  
  try {
    const scrapingBeeUrl = 'https://app.scrapingbee.com/api/v1/';
    const params = new URLSearchParams({
      api_key: SCRAPINGBEE_API_KEY,
      url: url,
      render_js: 'true',
      premium_proxy: 'true',
      country_code: 'us',
      wait: '2000',
      wait_for: '.product-title, h1, [data-test="product-title"], #productTitle',
      block_ads: 'true',
      block_resources: 'false'
    });

    const response = await axios.get(`${scrapingBeeUrl}?${params.toString()}`, {
      timeout: SCRAPING_TIMEOUT
    });

    return response.data;
  } catch (error) {
    console.error('ScrapingBee request failed:', error.message);
    throw error;
  }
}

async function parseScrapingBeeHTML(html, url) {
  const retailer = detectRetailer(url);
  const result = {};
  
  const namePatterns = [
    /<h1[^>]*id="productTitle"[^>]*>([^<]+)</i,
    /<h1[^>]*data-enzyme-id="ProductTitle"[^>]*>([^<]+)</i,
    /<h1[^>]*data-test="product-title"[^>]*>([^<]+)</i,
    /<h1[^>]*class="[^"]*sku-title[^"]*"[^>]*>([^<]+)</i,
    /<h1[^>]*>([^<]+)</i
  ];
  
  for (const pattern of namePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      result.name = match[1].trim().replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
      break;
    }
  }
  
  const pricePatterns = [
    /class="a-price-whole">([0-9,]+)/i,
    /class="a-price[^"]*"[^>]*>\s*<span[^>]*class="a-offscreen"[^>]*>\$([0-9,.]+)/i,
    /data-enzyme-id="PriceDisplay"[^>]*>[\s\S]*?\$([0-9,.]+)/i,
    /data-test="product-price"[^>]*>[\s\S]*?\$([0-9,.]+)/i,
    /class="pricing-price__range"[^>]*>[\s\S]*?\$([0-9,.]+)/i,
    /data-testid="price-current"[^>]*>[\s\S]*?\$([0-9,.]+)/i
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const priceStr = match[1].replace(/,/g, '');
      const price = parseFloat(priceStr);
      if (!isNaN(price) && price > 0) {
        result.price = price;
        break;
      }
    }
  }
  
  const imagePatterns = [
    /<img[^>]*id="landingImage"[^>]*src="([^"]+)"/i,
    /<img[^>]*data-enzyme-id="ProductImageCarousel"[^>]*src="([^"]+)"/i,
    /<img[^>]*data-test="hero-image-carousel"[^>]*src="([^"]+)"/i,
    /<img[^>]*class="[^"]*primary-image[^"]*"[^>]*src="([^"]+)"/i,
    /<img[^>]*data-testid="hero-image"[^>]*src="([^"]+)"/i
  ];
  
  for (const pattern of imagePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      result.image = match[1];
      break;
    }
  }
  
  if (retailer === 'Wayfair') {
    const dimPattern = /(\d+\.?\d*)["′]\s*W\s*x\s*(\d+\.?\d*)["′]\s*D\s*x\s*(\d+\.?\d*)["′]\s*H/i;
    const dimMatch = html.match(dimPattern);
    if (dimMatch) {
      result.dimensions = {
        length: parseFloat(dimMatch[2]) * 1.2,
        width: parseFloat(dimMatch[1]) * 1.2,
        height: parseFloat(dimMatch[3]) * 1.2
      };
    }
  }
  
  return result;
}

// Scrapers
const scrapers = {
  async scrapeAmazon(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2' });
    return await page.evaluate(() => {
      const result = {};
      result.name = document.querySelector('#productTitle')?.textContent?.trim() || 'Amazon Product';
      const priceSelectors = ['.a-price .a-offscreen', '.a-price-whole', '#priceblock_dealprice', '#priceblock_ourprice'];
      for (const selector of priceSelectors) {
        const priceEl = document.querySelector(selector);
        if (priceEl) {
          const price = priceEl.textContent.replace(/[^0-9.]/g, '');
          if (price && !isNaN(parseFloat(price))) {
            result.price = parseFloat(price);
            break;
          }
        }
      }
      result.image = document.querySelector('#landingImage')?.src || document.querySelector('.a-dynamic-image')?.src;
      const details = Array.from(document.querySelectorAll('#feature-bullets ul li span, .a-unordered-list li span')).map(el => el.textContent).join(' ');
      const dimMatch = details.match(/(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*inches/i);
      if (dimMatch) {
        result.dimensions = {
          length: parseFloat(dimMatch[1]) * 1.2,
          width: parseFloat(dimMatch[2]) * 1.2,
          height: parseFloat(dimMatch[3]) * 1.2
        };
      }
      return result;
    });
  },

  async scrapeWayfair(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2' });
    return await page.evaluate(() => {
      const result = {};
      result.name = document.querySelector('[data-enzyme-id="ProductTitle"]')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || 'Wayfair Product';
      const priceEl = document.querySelector('[data-enzyme-id="PriceDisplay"] .sr-only, [data-enzyme-id="PriceDisplay"]') || document.querySelector('.BasePriceBlock-price');
      if (priceEl) {
        const price = priceEl.textContent.replace(/[^0-9.]/g, '');
        if (price && !isNaN(parseFloat(price))) {
          result.price = parseFloat(price);
        }
      }
      result.image = document.querySelector('[data-enzyme-id="ProductImageCarousel"] img')?.src || document.querySelector('.ProductImageCarousel img')?.src;
      const specs = Array.from(document.querySelectorAll('[data-enzyme-id="ProductSpecifications"] dd, .Specifications dd')).map(el => el.textContent);
      const dimText = specs.find(spec => spec.match(/\d+\.?\d*["′]\s*W\s*x\s*\d+\.?\d*["′]\s*D\s*x\s*\d+\.?\d*["′]\s*H/i));
      if (dimText) {
        const dimMatch = dimText.match(/(\d+\.?\d*)["′]\s*W\s*x\s*(\d+\.?\d*)["′]\s*D\s*x\s*(\d+\.?\d*)["′]\s*H/i);
        if (dimMatch) {
          result.dimensions = {
            length: parseFloat(dimMatch[2]) * 1.2,
            width: parseFloat(dimMatch[1]) * 1.2,
            height: parseFloat(dimMatch[3]) * 1.2
          };
        }
      }
      return result;
    });
  },

  async scrapeTarget(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2' });
    return await page.evaluate(() => {
      const result = {};
      result.name = document.querySelector('[data-test="product-title"]')?.textContent?.trim() || 'Target Product';
      const priceEl = document.querySelector('[data-test="product-price"]') || document.querySelector('.Price-characteristic');
      if (priceEl) {
        const price = priceEl.textContent.replace(/[^0-9.]/g, '');
        if (price && !isNaN(parseFloat(price))) {
          result.price = parseFloat(price);
        }
      }
      result.image = document.querySelector('[data-test="hero-image-carousel"] img')?.src;
      return result;
    });
  },

  async scrapeBestBuy(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2' });
    return await page.evaluate(() => {
      const result = {};
      result.name = document.querySelector('.sku-title h1')?.textContent?.trim() || 'Best Buy Product';
      const priceEl = document.querySelector('.pricing-price__range .sr-only') || document.querySelector('.pricing-price__range');
      if (priceEl) {
        const price = priceEl.textContent.replace(/[^0-9.]/g, '');
        if (price && !isNaN(parseFloat(price))) {
          result.price = parseFloat(price);
        }
      }
      result.image = document.querySelector('.primary-image')?.src;
      return result;
    });
  },

  async scrapeWalmart(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2' });
    return await page.evaluate(() => {
      const result = {};
      result.name = document.querySelector('[data-testid="product-title"]')?.textContent?.trim() || 'Walmart Product';
      const priceEl = document.querySelector('[data-testid="price-current"]') || document.querySelector('.price-current');
      if (priceEl) {
        const price = priceEl.textContent.replace(/[^0-9.]/g, '');
        if (price && !isNaN(parseFloat(price))) {
          result.price = parseFloat(price);
        }
      }
      result.image = document.querySelector('[data-testid="hero-image"]')?.src;
      return result;
    });
  },

  async scrapeGeneric(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2' });
    return await page.evaluate(() => {
      const result = {};
      const nameSelectors = ['h1', '.product-title', '.product-name', '[class*="title"]'];
      for (const selector of nameSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          result.name = el.textContent.trim();
          break;
        }
      }
      result.name = result.name || 'Product';
      const priceSelectors = ['[class*="price"]:not([class*="old"])', '[class*="cost"]', '[data-price]', '.money'];
      for (const selector of priceSelectors) {
        const els = document.querySelectorAll(selector);
        for (const el of els) {
          const text = el.textContent || el.getAttribute('data-price') || '';
          const price = text.replace(/[^0-9.]/g, '');
          if (price && !isNaN(parseFloat(price)) && parseFloat(price) > 0) {
            result.price = parseFloat(price);
            break;
          }
        }
        if (result.price) break;
      }
      const imgSelectors = ['.product-image img', '.main-image img', '[class*="hero"] img'];
      for (const selector of imgSelectors) {
        const img = document.querySelector(selector);
        if (img && img.src) {
          result.image = img.src;
          break;
        }
      }
      return result;
    });
  }
};

async function scrapeProduct(url, browser) {
  const retailer = detectRetailer(url);
  
  if (USE_SCRAPINGBEE) {
    try {
      console.log(`Trying ScrapingBee for ${retailer}: ${url}`);
      const html = await scrapingBeeRequest(url);
      const productData = await parseScrapingBeeHTML(html, url);
      
      if (productData.name) {
        const category = categorizeProduct(productData.name || '', url);
        const dimensions = productData.dimensions || estimateDimensions(category, productData.name);
        const weight = estimateWeight(dimensions, category);
        const shippingCost = calculateShippingCost(dimensions, weight, 0);

        return {
          id: generateProductId(),
          name: productData.name || 'Unknown Product',
          price: productData.price || null,
          image: productData.image || 'https://placehold.co/120x120/4CAF50/FFFFFF/png?text=No+Image',
          retailer: retailer,
          category: category,
          dimensions: dimensions,
          weight: weight,
          shippingCost: shippingCost,
          url: url,
          needsManualPrice: !productData.price,
          priceMessage: !productData.price ? 'Price could not be detected automatically' : null,
          quantity: 1,
          scraped: true,
          method: 'ScrapingBee'
        };
      }
    } catch (error) {
      console.log(`ScrapingBee failed for ${url}, falling back to Puppeteer:`, error.message);
    }
  }

  const page = await browser.newPage();
  try {
    console.log(`Using Puppeteer for ${retailer}: ${url}`);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.resourceType() === 'stylesheet' || req.resourceType() === 'font' || req.resourceType() === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });

    let productData;
    switch (retailer) {
      case 'Amazon': productData = await scrapers.scrapeAmazon(page, url); break;
      case 'Wayfair': productData = await scrapers.scrapeWayfair(page, url); break;
      case 'Target': productData = await scrapers.scrapeTarget(page, url); break;
      case 'Best Buy': productData = await scrapers.scrapeBestBuy(page, url); break;
      case 'Walmart': productData = await scrapers.scrapeWalmart(page, url); break;
      default: productData = await scrapers.scrapeGeneric(page, url); break;
    }

    const category = categorizeProduct(productData.name || '', url);
    const dimensions = productData.dimensions || estimateDimensions(category, productData.name);
    const weight = estimateWeight(dimensions, category);
    const shippingCost = calculateShippingCost(dimensions, weight, 0);

    return {
      id: generateProductId(),
      name: productData.name || 'Unknown Product',
      price: productData.price || null,
      image: productData.image || 'https://placehold.co/120x120/4CAF50/FFFFFF/png?text=No+Image',
      retailer: retailer,
      category: category,
      dimensions: dimensions,
      weight: weight,
      shippingCost: shippingCost,
      url: url,
      needsManualPrice: !productData.price,
      priceMessage: !productData.price ? 'Price could not be detected automatically' : null,
      quantity: 1,
      scraped: true,
      method: 'Puppeteer'
    };
  } catch (error) {
    console.error(`Both ScrapingBee and Puppeteer failed for ${url}:`, error.message);
    const retailer = detectRetailer(url);
    return {
      id: generateProductId(),
      name: `${retailer} Product`,
      price: null,
      image: 'https://placehold.co/120x120/DC3545/FFFFFF/png?text=Failed',
      retailer: retailer,
      category: 'general',
      dimensions: estimateDimensions('general'),
      weight: 5,
      shippingCost: 35,
      url: url,
      needsManualPrice: true,
      priceMessage: 'Scraping failed - please enter price manually',
      quantity: 1,
      scraped: false,
      error: error.message,
      method: 'Failed'
    };
  } finally {
    await page.close();
  }
}

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/api/scrape', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ success: false, error: 'URLs array is required' });
    }
    if (urls.length > 20) {
      return res.status(400).json({ success: false, error: 'Maximum 20 URLs allowed per request' });
    }

    const validUrls = urls.filter(url => {
      try { new URL(url); return true; } catch { return false; }
    });

    if (validUrls.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid URLs provided' });
    }

    console.log(`Starting to scrape ${validUrls.length} products...`);
    console.log(`Using ${USE_SCRAPINGBEE ? 'ScrapingBee + Puppeteer fallback' : 'Puppeteer only'}`);
    
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    try {
      const products = [];
      for (let i = 0; i < validUrls.length; i += MAX_CONCURRENT_SCRAPES) {
        const batch = validUrls.slice(i, i + MAX_CONCURRENT_SCRAPES);
        const batchPromises = batch.map(url => 
          Promise.race([
            scrapeProduct(url, browser),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), SCRAPING_TIMEOUT))
          ])
        );
        const batchResults = await Promise.allSettled(batchPromises);
        batchResults.forEach(result => {
          if (result.status === 'fulfilled') {
            products.push(result.value);
          }
        });
      }

      const groupedProducts = {};
      products.forEach(product => {
        if (!groupedProducts[product.retailer]) {
          groupedProducts[product.retailer] = { retailer: product.retailer, products: [] };
        }
        groupedProducts[product.retailer].products.push(product);
      });

      const stats = {
        count: products.length,
        scraped: products.filter(p => p.scraped).length,
        pricesFound: products.filter(p => p.price).length,
        retailers: Object.keys(groupedProducts)
      };

      console.log(`Scraping completed:`, stats);
      res.json({
        success: true,
        products: products,
        groupedProducts: groupedProducts,
        ...stats
      });
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ success: false, error: error.message || 'Scraping failed' });
  }
});

app.post('/apps/instant-import/create-draft-order', async (req, res) => {
  try {
    const { customer, products, deliveryFees, totals, originalUrls, quote } = req.body;
    if (!customer || !products || !Array.isArray(products)) {
      return res.status(400).json({ success: false, message: 'Customer and products are required' });
    }

    const lineItems = products.map(product => {
      const title = `${product.name} (${product.retailer})`;
      const properties = [
        { name: 'Product URL', value: product.url },
        { name: 'Retailer', value: product.retailer },
        { name: 'Category', value: product.category },
        { name: 'Dimensions', value: `${product.dimensions.length}" x ${product.dimensions.width}" x ${product.dimensions.height}"` },
        { name: 'Weight', value: `${product.weight} lbs` },
        { name: 'Ocean Freight Cost', value: `$${product.shippingCost}` }
      ];
      return {
        title: title,
        price: product.price || 0,
        quantity: product.quantity || 1,
        properties: properties,
        custom: true,
        taxable: false
      };
    });

    if (deliveryFees && Object.keys(deliveryFees).length > 0) {
      Object.entries(deliveryFees).forEach(([retailer, fee]) => {
        if (fee > 0) {
          lineItems.push({
            title: `USA Delivery Fee - ${retailer}`,
            price: fee,
            quantity: 1,
            custom: true,
            taxable: false
          });
        }
      });
    }

    if (totals && totals.dutyAmount > 0) {
      lineItems.push({
        title: 'Duty',
        price: totals.dutyAmount,
        quantity: 1,
        custom: true,
        taxable: false
      });
    }

    const customerNote = `
BERMUDA IMPORT QUOTE - ${new Date().toLocaleDateString()}

CUSTOMER: ${customer.name} (${customer.email})

COST BREAKDOWN:
• Product Cost: $${(totals.totalItemCost || 0).toFixed(2)}
• USA Delivery Fees: $${(totals.totalDeliveryFees || 0).toFixed(2)}
• Bermuda Duty (26.5%): $${(totals.dutyAmount || 0).toFixed(2)}
• Ocean Freight: $${(totals.totalShippingCost || 0).toFixed(2)}
• TOTAL: $${(totals.grandTotal || 0).toFixed(2)}

FREIGHT FORWARDER: Sealine Freight - Elizabeth, NJ 07201-614

ORIGINAL URLS:
${originalUrls ? originalUrls.map((url, i) => `${i+1}. ${url}`).join('\n') : 'No URLs provided'}

This quote was generated using the SDL Instant Import Calculator.
Contact customer to finalize import arrangements.
    `.trim();

    const shopifyData = {
      draft_order: {
        line_items: lineItems,
        customer: {
          email: customer.email,
          first_name: customer.name.split(' ')[0] || customer.name,
          last_name: customer.name.split(' ').slice(1).join(' ') || ''
        },
        note: customerNote,
        email: customer.email,
        invoice_sent_at: null,
        invoice_url: null,
        name: `#IMP${Date.now().toString().slice(-6)}`,
        status: 'open',
        tags: 'instant-import,bermuda-freight,quote'
      }
    };

    console.log('Creating Shopify draft order...');
    const response = await axios.post(
      `https://${SHOPIFY_DOMAIN}/admin/api/2023-10/draft_orders.json`,
      shopifyData,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    const draftOrder = response.data.draft_order;
    console.log(`Draft order created: ${draftOrder.name}`);

    res.json({
      success: true,
      draftOrderId: draftOrder.id,
      draftOrderNumber: draftOrder.name,
      orderUrl: `https://${SHOPIFY_DOMAIN}/admin/draft_orders/${draftOrder.id}`,
      invoiceUrl: draftOrder.invoice_url,
      totalPrice: draftOrder.total_price,
      message: 'Draft order created successfully'
    });
  } catch (error) {
    console.error('Draft order creation error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.errors || error.message || 'Failed to create draft order'
    });
  }
});

app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Bermuda Import Calculator Backend running on port ${PORT}`);
  console.log(`Shopify domain: ${SHOPIFY_DOMAIN}`);
  console.log(`ScrapingBee: ${USE_SCRAPINGBEE ? 'Enabled' : 'Disabled'}`);
  console.log('Ready to process import quotes with dynamic margin system!');
});

module.exports = app;
