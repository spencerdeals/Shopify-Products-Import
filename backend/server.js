import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import { URL } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;
const SCRAPING_TIMEOUT = 25000;
const MAX_CONCURRENT_SCRAPES = 2;
const BERMUDA_DUTY_RATE = 0.265;
const USE_SCRAPINGBEE = !!SCRAPINGBEE_API_KEY;

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50
});
app.use('/api/', limiter);

// Conditionally load Puppeteer only if needed
let puppeteer = null;
const USE_PUPPETEER = process.env.USE_PUPPETEER === 'true';

if (USE_PUPPETEER) {
  try {
    puppeteer = await import('puppeteer');
    console.log('Puppeteer loaded successfully');
  } catch (error) {
    console.warn('Puppeteer not available:', error.message);
  }
}

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
  
  const baseEstimates = {
    'furniture': { 
      length: 36 + Math.random() * 30,
      width: 20 + Math.random() * 20,  
      height: 30 + Math.random() * 24
    },
    'electronics': { 
      length: 12 + Math.random() * 15,
      width: 8 + Math.random() * 8,
      height: 4 + Math.random() * 6
    },
    'appliances': { 
      length: 24 + Math.random() * 12,
      width: 24 + Math.random() * 12,
      height: 30 + Math.random() * 20
    },
    'clothing': { 
      length: 12 + Math.random() * 6,
      width: 10 + Math.random() * 6,
      height: 2 + Math.random() * 2
    },
    'books': { 
      length: 8 + Math.random() * 3,
      width: 5 + Math.random() * 2,
      height: 1 + Math.random() * 1
    },
    'toys': { 
      length: 8 + Math.random() * 8,
      width: 6 + Math.random() * 6,
      height: 4 + Math.random() * 4
    },
    'sports': { 
      length: 18 + Math.random() * 20,
      width: 8 + Math.random() * 10,
      height: 6 + Math.random() * 8
    },
    'home-decor': { 
      length: 8 + Math.random() * 8,
      width: 8 + Math.random() * 8,
      height: 8 + Math.random() * 8
    },
    'general': { 
      length: 15 + Math.random() * 12,
      width: 10 + Math.random() * 8,
      height: 6 + Math.random() * 6
    }
  };
  
  const base = baseEstimates[category] || baseEstimates.general;
  
  return {
    length: Math.round(base.length * 1.3 * 100) / 100,
    width: Math.round(base.width * 1.3 * 100) / 100,
    height: Math.round(base.height * 1.3 * 100) / 100
  };
}

function validateDimensions(dimensions, category, name) {
  const { length, width, height } = dimensions;
  
  if (length <= 0 || width <= 0 || height <= 0) {
    console.warn(`Invalid dimensions for ${name}: ${length}x${width}x${height}`);
    return estimateDimensions(category, name);
  }
  
  if (length > 120 || width > 120 || height > 120) {
    console.warn(`Unrealistic dimensions for ${name}: ${length}x${width}x${height}, using estimates`);
    return estimateDimensions(category, name);
  }
  
  return dimensions;
}

function calculateShippingCost(dimensions, weight, orderTotal = 0) {
  let { length, width, height } = dimensions;
  
  const MAX_SINGLE_BOX = 96;
  
  length = Math.min(length, MAX_SINGLE_BOX);
  width = Math.min(width, MAX_SINGLE_BOX); 
  height = Math.min(height, MAX_SINGLE_BOX);
  
  let volume = length * width * height;
  let cubicFeet = volume / 1728;
  
  if (cubicFeet > 30) {
    cubicFeet = cubicFeet * 0.6;
    console.log(`Applied multi-box shipping correction: ${cubicFeet.toFixed(2)} cubic feet`);
  }
  
  const baseCost = cubicFeet * 7.5;
  
  let marginMultiplier;
  if (orderTotal < 400) {
    marginMultiplier = 1.45;
  } else if (orderTotal < 1500) {
    marginMultiplier = 1.30;
  } else {
    marginMultiplier = 1.20;
  }
  
  let finalCost = baseCost * marginMultiplier;
  
  if (orderTotal > 0) {
    const maxReasonableShipping = orderTotal * 0.5;
    if (finalCost > maxReasonableShipping) {
      console.log(`Shipping cost ${finalCost} exceeds 50% of order value, capping at ${maxReasonableShipping}`);
      finalCost = Math.min(finalCost, maxReasonableShipping);
    }
  }
  
  return Math.max(35, Math.round(finalCost * 100) / 100);
}

// ScrapingBee integration (Primary method)
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
      result.name = match[1].trim().replace(/'/g, "'").replace(/"/g, '"').replace(/<[^>]*>/g, '');
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

async function scrapeProduct(url) {
  const retailer = detectRetailer(url);
  
  // Try ScrapingBee first
  if (USE_SCRAPINGBEE) {
    try {
      console.log(`Using ScrapingBee for ${retailer}: ${url}`);
      const html = await scrapingBeeRequest(url);
      const productData = await parseScrapingBeeHTML(html, url);
      
      if (productData.name) {
        const category = categorizeProduct(productData.name || '', url);
        const rawDimensions = productData.dimensions || estimateDimensions(category, productData.name);
        const dimensions = validateDimensions(rawDimensions, category, productData.name);
        const weight = estimateWeight(dimensions, category);
        const shippingCost = calculateShippingCost(dimensions, weight, 0);

        return {
          id: generateProductId(),
          name: productData.name || 'Unknown Product',
          price: productData.price || null,
          image: productData.image && productData.image.includes('http') ? productData.image : 'https://placehold.co/120x120/7CB342/FFFFFF/png?text=SDL',
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
          method: 'ScrapingBee',
          estimateWarning: !productData.dimensions ? 'ESTIMATED DIMENSIONS - Manual verification recommended' : null
        };
      }
    } catch (error) {
      console.log(`ScrapingBee failed for ${url}:`, error.message);
    }
  }

  // If ScrapingBee fails, return fallback data
  console.log(`Creating fallback data for ${retailer}: ${url}`);
  const category = categorizeProduct('', url);
  const dimensions = estimateDimensions(category);
  const weight = estimateWeight(dimensions, category);
  const shippingCost = calculateShippingCost(dimensions, weight, 0);

  return {
    id: generateProductId(),
    name: `${retailer} Product`,
    price: null,
    image: 'https://placehold.co/120x120/7CB342/FFFFFF/png?text=SDL',
    retailer: retailer,
    category: category,
    dimensions: dimensions,
    weight: weight,
    shippingCost: shippingCost,
    url: url,
    needsManualPrice: true,
    priceMessage: 'Price could not be detected automatically - please enter manually',
    quantity: 1,
    scraped: false,
    method: 'Fallback',
    estimateWarning: 'ESTIMATED DIMENSIONS - Manual verification recommended'
  };
}

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    scrapingBee: USE_SCRAPINGBEE,
    puppeteer: USE_PUPPETEER && !!puppeteer
  });
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
    console.log(`Using ${USE_SCRAPINGBEE ? 'ScrapingBee' : 'Fallback mode only'}`);
    
    const products = [];
    for (let i = 0; i < validUrls.length; i += MAX_CONCURRENT_SCRAPES) {
      const batch = validUrls.slice(i, i + MAX_CONCURRENT_SCRAPES);
      const batchPromises = batch.map(url => 
        Promise.race([
          scrapeProduct(url),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), SCRAPING_TIMEOUT))
        ]).catch(error => {
          console.error(`Failed to scrape ${url}:`, error.message);
          return null;
        })
      );
      const batchResults = await Promise.allSettled(batchPromises);
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
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
BERMUDA IMPORT QUOTE ESTIMATE - ${new Date().toLocaleDateString()}

CUSTOMER: ${customer.name} (${customer.email})

⚠️  IMPORTANT: This is an ESTIMATE based on scraped data. Manual verification required before final pricing.

COST BREAKDOWN:
• Product Cost: $${(totals.totalItemCost || 0).toFixed(2)}
• USA Delivery Fees: $${(totals.totalDeliveryFees || 0).toFixed(2)}
• Bermuda Duty (26.5%): $${(totals.dutyAmount || 0).toFixed(2)}
• Ocean Freight (ESTIMATED): $${(totals.totalShippingCost || 0).toFixed(2)}
• TOTAL ESTIMATE: $${(totals.grandTotal || 0).toFixed(2)}

MANUAL VERIFICATION NEEDED FOR:
${products.filter(p => p.estimateWarning).length > 0 ? 
  `• Products with estimated dimensions:\n${products.filter(p => p.estimateWarning).map(p => `  - ${p.name}`).join('\n')}\n` : ''}
${products.filter(p => p.needsManualPrice).length > 0 ? 
  `• Products requiring price verification:\n${products.filter(p => p.needsManualPrice).map(p => `  - ${p.name}`).join('\n')}\n` : ''}

FREIGHT FORWARDER: Sealine Freight - Elizabeth, NJ 07201-614

ORIGINAL URLS:
${originalUrls ? originalUrls.map((url, i) => `${i+1}. ${url}`).join('\n') : 'No URLs provided'}

This quote was generated using the SDL Instant Import Calculator.
Final pricing subject to manual verification and adjustment.
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
  console.log(`Puppeteer: ${USE_PUPPETEER && !!puppeteer ? 'Enabled' : 'Disabled'}`);
  console.log('Ready to process import quotes!');
});

export default app;