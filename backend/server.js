import express from 'express';
import { join } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// ScrapingBee Config
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;
const SCRAPINGBEE_URL = 'https://app.scrapingbee.com/api/v1/';

// Shopify Config
const SHOPIFY_STORE_DOMAIN = 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = '2024-10';

app.use(express.json());
app.use(express.static(join(__dirname, '../frontend')));

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'bermuda-import-calculator' 
  });
});

app.get('/', (req, res) => {
  try {
    const htmlPath = join(__dirname, '../frontend/index.html');
    const html = readFileSync(htmlPath, 'utf8');
    res.send(html);
  } catch (error) {
    console.error('Error serving main page:', error);
    res.status(500).send('Server error');
  }
});

// Shopify Customer Authentication
app.post('/api/auth/customer', async (req, res) => {
  try {
    const { email, firstName, lastName, phone } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    console.log(`Creating/finding customer: ${email}`);
    
    // Try to find existing customer first
    let customer = await findCustomerByEmail(email);
    
    if (!customer) {
      // Create new customer
      customer = await createShopifyCustomer({
        email,
        first_name: firstName || '',
        last_name: lastName || '',
        phone: phone || '',
        verified_email: true,
        tags: 'bermuda-import-calculator'
      });
      console.log(`Created new customer: ${customer.id}`);
    } else {
      console.log(`Found existing customer: ${customer.id}`);
    }
    
    res.json({ 
      success: true, 
      customer: {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name
      }
    });

  } catch (error) {
    console.error('Customer auth error:', error);
    res.status(500).json({ 
      error: 'Failed to authenticate customer',
      message: error.message 
    });
  }
});

// Create Draft Order
app.post('/api/create-draft-order', async (req, res) => {
  try {
    const { customerId, products, deliveryFees, totals, originalUrls } = req.body;
    
    if (!customerId) {
      return res.status(400).json({ error: 'Customer ID is required' });
    }

    console.log(`Creating draft order for customer: ${customerId}`);
    
    // Build line items from products
    const lineItems = products.map(product => ({
      title: product.name,
      price: product.finalPrice.toString(),
      quantity: product.quantity,
      sku: `IMPORT-${product.id}`,
      properties: [
        {
          name: 'Original URL',
          value: product.url
        },
        {
          name: 'Retailer', 
          value: product.retailer
        },
        {
          name: 'Category',
          value: product.category
        }
      ]
    }));

    // Add delivery fees as line items
    Object.entries(deliveryFees || {}).forEach(([retailer, fee]) => {
      if (fee > 0) {
        lineItems.push({
          title: `${retailer} - USA Delivery Fee`,
          price: fee.toString(),
          quantity: 1,
          sku: 'DELIVERY-FEE'
        });
      }
    });

    // Add duty as line item
    lineItems.push({
      title: 'Bermuda Import Duty (26.5%)',
      price: totals.dutyAmount.toString(),
      quantity: 1,
      sku: 'BERMUDA-DUTY'
    });

    // Create note with all URLs and details
    const noteContent = [
      'BERMUDA IMPORT CALCULATOR QUOTE',
      '=====================================',
      '',
      'ORIGINAL PRODUCT URLS:',
      ...originalUrls.map((url, index) => `${index + 1}. ${url}`),
      '',
      'QUOTE BREAKDOWN:',
      `Product Total: $${totals.totalItemCost.toFixed(2)}`,
      `Delivery Fees: $${totals.totalDeliveryFees.toFixed(2)}`,
      `Import Duty: $${totals.dutyAmount.toFixed(2)}`,
      `Ocean Freight: $${totals.totalShippingCost.toFixed(2)}`,
      `TOTAL: $${totals.grandTotal.toFixed(2)}`,
      '',
      `Generated: ${new Date().toISOString()}`,
      'Via: Bermuda Import Calculator'
    ].join('\n');

    const draftOrder = {
      draft_order: {
        customer: {
          id: customerId
        },
        line_items: lineItems,
        shipping_line: {
          title: 'Ocean Freight & Handling',
          price: totals.totalShippingCost.toString()
        },
        note: noteContent,
        tags: 'bermuda-import,quote',
        currency: 'USD'
      }
    };

    const shopifyOrder = await createShopifyDraftOrder(draftOrder);
    
    console.log(`Draft order created: ${shopifyOrder.id}`);
    
    res.json({ 
      success: true, 
      draftOrderId: shopifyOrder.id,
      draftOrderNumber: shopifyOrder.name,
      orderUrl: `https://admin.shopify.com/store/spencer-deals-ltd/draft_orders/${shopifyOrder.id}`
    });

  } catch (error) {
    console.error('Draft order creation error:', error);
    res.status(500).json({ 
      error: 'Failed to create draft order',
      message: error.message 
    });
  }
});

// Shopify API Functions
async function findCustomerByEmail(email) {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/customers/search.json?query=email:${encodeURIComponent(email)}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Shopify customer search failed: ${response.status} ${error}`);
  }

  const data = await response.json();
  return data.customers.length > 0 ? data.customers[0] : null;
}

async function createShopifyCustomer(customerData) {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/customers.json`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ customer: customerData })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Shopify customer creation failed: ${response.status} ${error}`);
  }

  const data = await response.json();
  return data.customer;
}

async function createShopifyDraftOrder(draftOrderData) {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/draft_orders.json`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(draftOrderData)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Shopify draft order creation failed: ${response.status} ${error}`);
  }

  const data = await response.json();
  return data.draft_order;
}

// Original scraping functionality
app.post('/api/scrape', async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'URLs array is required' });
    }

    console.log(`\n============ Robust Scraping ${urls.length} URLs ============`);
    let products = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`\n[${i + 1}/${urls.length}] Processing: ${url}`);
      
      try {
        const productData = await robustScrapeProduct(url, i + 1);
        products.push(productData);
        
        const priceStatus = productData.needsManualPrice ? 'Manual entry needed' : `$${productData.price}`;
        console.log(`✓ Success: ${productData.name.substring(0, 50)}... [${productData.retailer}] - ${priceStatus}`);
      } catch (error) {
        console.error(`✗ Failed:`, error.message);
        const fallbackData = createFallbackProduct(url, i + 1);
        products.push(fallbackData);
      }
    }

    // Group products by retailer
    const groupedProducts = groupProductsByRetailer(products);
    const successfulPrices = products.filter(p => !p.needsManualPrice).length;
    
    console.log(`\n✓ Completed: ${products.length} products from ${Object.keys(groupedProducts).length} retailers`);
    console.log(`  Prices found: ${successfulPrices}/${products.length}, Manual entry needed: ${products.length - successfulPrices}`);
    
    res.json({ 
      success: true, 
      products: products,
      groupedProducts: groupedProducts,
      retailers: Object.keys(groupedProducts),
      scraped: products.filter(p => !p.isFallback).length,
      pricesFound: successfulPrices,
      count: products.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ 
      error: 'Failed to process products',
      message: error.message 
    });
  }
});

function groupProductsByRetailer(products) {
  const grouped = {};
  
  products.forEach(product => {
    const retailer = product.retailer;
    if (!grouped[retailer]) {
      grouped[retailer] = {
        retailer: retailer,
        products: [],
        deliveryFee: 0
      };
    }
    grouped[retailer].products.push(product);
  });
  
  return grouped;
}

async function robustScrapeProduct(url, productId) {
  try {
    const urlType = analyzeURL(url);
    console.log(`  URL type: ${urlType.type} (${urlType.retailer})`);
    
    const html = await fetchWithScrapingBee(url, urlType);
    console.log(`  HTML received: ${html.length} bytes`);
    
    let productUrl = url;
    let htmlToProcess = html;
    
    if (urlType.type === 'category' || urlType.type === 'search') {
      const firstProductUrl = extractFirstProductURL(html, urlType.retailer);
      if (firstProductUrl) {
        console.log(`  Found first product: ${firstProductUrl.substring(0, 80)}...`);
        productUrl = firstProductUrl;
      } else {
        console.log(`  No individual products found, using category page data`);
      }
    }
    
    const product = await parseUniversalProduct(htmlToProcess, productUrl, productId, urlType);
    return product;
    
  } catch (error) {
    console.error('  Robust scraping failed:', error.message);
    throw error;
  }
}

function analyzeURL(url) {
  const retailer = getRetailerName(url);
  const lowerUrl = url.toLowerCase();
  
  if (lowerUrl.includes('/pdp/') || lowerUrl.includes('/dp/') || lowerUrl.includes('/product/') || lowerUrl.includes('/p/')) {
    return { type: 'product', retailer, confidence: 'high' };
  }
  
  if (lowerUrl.includes('/search') || lowerUrl.includes('/s/') || lowerUrl.includes('q=')) {
    return { type: 'search', retailer, confidence: 'medium' };
  }
  
  if (lowerUrl.includes('/category/') || lowerUrl.includes('/c/') || lowerUrl.includes('/browse/') || lowerUrl.includes('/sb')) {
    return { type: 'category', retailer, confidence: 'medium' };
  }
  
  return { type: 'unknown', retailer, confidence: 'low' };
}

async function fetchWithScrapingBee(url, urlType) {
  const retailer = urlType.retailer;
  console.log(`  Using ScrapingBee for ${retailer} ${urlType.type} page...`);
  
  const params = new URLSearchParams({
    'api_key': SCRAPINGBEE_API_KEY,
    'url': url,
    'render_js': 'false',
    'premium_proxy': 'true',
    'country_code': 'us',
    'block_ads': 'true'
  });
  
  if (urlType.type === 'product') {
    params.set('render_js', 'true');
    params.set('wait', '3000');
  }
  
  const scrapingBeeUrl = `${SCRAPINGBEE_URL}?${params}`;
  
  const response = await fetch(scrapingBeeUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('  ScrapingBee error:', error.substring(0, 200));
    throw new Error(`ScrapingBee error: ${response.status}`);
  }

  return await response.text();
}

function extractFirstProductURL(html, retailer) {
  const patterns = {
    'Wayfair': [
      /href=["']([^"']*\/pdp\/[^"']+)/i,
      /href=["']([^"']*product[^"']+)/i
    ],
    'Amazon': [
      /href=["']([^"']*\/dp\/[^"']+)/i,
      /href=["']([^"']*\/gp\/product\/[^"']+)/i
    ],
    'Walmart': [
      /href=["']([^"']*\/ip\/[^"']+)/i
    ],
    'Target': [
      /href=["']([^"']*\/p\/[^"']+)/i
    ]
  };
  
  const retailerPatterns = patterns[retailer] || patterns['Amazon'];
  
  for (const pattern of retailerPatterns) {
    const match = html.match(pattern);
    if (match) {
      let productUrl = match[1];
      
      if (productUrl.startsWith('/')) {
        const baseUrl = new URL(html.match(/https?:\/\/[^\/]+/)?.[0] || 'https://www.wayfair.com');
        productUrl = baseUrl.origin + productUrl;
      }
      
      return productUrl;
    }
  }
  
  return null;
}

async function parseUniversalProduct(html, url, productId, urlType) {
  const retailer = urlType.retailer;
  
  let product = {
    id: productId,
    url: url,
    retailer: retailer,
    name: null,
    image: null,
    dimensions: null,
    price: null,
    quantity: 1,
    category: 'General',
    needsManualPrice: true,
    weight: null,
    pageType: urlType.type
  };
  
  console.log(`  Parsing ${retailer} ${urlType.type} page...`);
  
  const structuredData = extractStructuredData(html);
  if (structuredData) {
    console.log('  ✓ Found structured data');
    product.name = structuredData.name || product.name;
    product.image = structuredData.image || product.image;
    product.price = structuredData.price || product.price;
  }
  
  const universalData = extractUniversalContent(html, retailer);
  console.log(`  Universal extraction: name=${!!universalData.name}, image=${!!universalData.image}, price=${!!universalData.price}, dimensions=${!!universalData.dimensions}`);
  
  product.name = product.name || universalData.name;
  product.image = product.image || universalData.image;
  product.dimensions = product.dimensions || universalData.dimensions;
  
  const priceResult = extractConfidentPrice(html, retailer, structuredData);
  if (priceResult.confident) {
    product.price = priceResult.price;
    product.needsManualPrice = false;
    product.priceStatus = 'found';
    console.log(`  ✓ Confident price: $${priceResult.price} (${priceResult.source})`);
  } else {
    product.price = null;
    product.needsManualPrice = true;
    product.priceStatus = 'manual_required';
    product.priceMessage = priceResult.reason || 'Price could not be determined automatically';
    console.log(`  ⚠ Price uncertain - manual entry required (${priceResult.reason})`);
  }
  
  product.name = cleanProductName(product.name) || `${retailer} Product`;
  product.category = determineCategory(product.name);
  
  if (!product.dimensions) {
    product.dimensions = getEstimatedDimensions(product.name, product.category);
    product.dimensions.estimated = true;
    product.dimensions.source = 'category estimate + 20% buffer';
  } else {
    product.dimensions.length = Math.ceil(product.dimensions.length * 1.2);
    product.dimensions.width = Math.ceil(product.dimensions.width * 1.2);  
    product.dimensions.height = Math.ceil(product.dimensions.height * 1.2);
    product.dimensions.source += ' + 20% buffer';
  }
  
  product.weight = product.weight || estimateWeight(product.name, product.category);
  
  if (!product.image) {
    product.image = `https://placehold.co/200x200/667eea/FFFFFF/png?text=${encodeURIComponent(retailer)}`;
  }
  
  if (product.image && product.image.startsWith('/')) {
    const baseUrl = new URL(url);
    product.image = baseUrl.origin + product.image;
  }
  
  product.shippingCost = calculateShippingCost(product.dimensions, product.weight);
  console.log(`  💰 Calculated shipping: $${product.shippingCost} (${product.dimensions.length}" x ${product.dimensions.width}" x ${product.dimensions.height}", ${product.weight}lbs)`);
  
  return product;
}

function extractStructuredData(html) {
  const result = {};
  
  try {
    const scripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    
    for (const script of scripts) {
      const match = script.match(/>([^<]+)</);
      if (!match) continue;
      
      try {
        const data = JSON.parse(match[1].trim());
        
        if (data['@type'] === 'Product' || (Array.isArray(data) && data.find(item => item['@type'] === 'Product'))) {
          const product = Array.isArray(data) ? data.find(item => item['@type'] === 'Product') : data;
          result.name = product.name;
          result.image = Array.isArray(product.image) ? product.image[0] : product.image;
          result.price = product.offers?.price || product.offers?.[0]?.price;
          break;
        }
      } catch (e) {
        continue;
      }
    }
  } catch (e) {
    // Continue
  }
  
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i);
  const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i);
  const ogPrice = html.match(/<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([^"']+)/i);
  
  if (ogTitle) result.name = result.name || ogTitle[1];
  if (ogImage) result.image = result.image || ogImage[1];
  if (ogPrice) result.price = result.price || parseFloat(ogPrice[1]);
  
  return Object.keys(result).length > 0 ? result : null;
}

function extractUniversalContent(html, retailer) {
  const result = {};
  
  const namePatterns = [
    /<h1[^>]*>([^<]{10,200})<\/h1>/i,
    /<title>([^<]{10,100})<\/title>/i,
    /<span[^>]*class=["'][^"']*title[^"']*["'][^>]*>([^<]{10,150})<\/span>/i,
    /<div[^>]*class=["'][^"']*name[^"']*["'][^>]*>([^<]{10,150})<\/div>/i
  ];
  
  for (const pattern of namePatterns) {
    const match = html.match(pattern);
    if (match) {
      let name = match[1].trim();
      name = name.replace(/\s*[-|]\s*(Wayfair|Amazon|Walmart|Target).*$/i, '');
      name = name.replace(/\s*\|\s*.*$/, '');
      if (name.length > 10) {
        result.name = name;
        break;
      }
    }
  }
  
  const imagePatterns = [
    /<img[^>]*(?:class|id)=["'][^"']*(?:product|main|primary|hero)[^"']*["'][^>]*src=["']([^"']+)/i,
    /<img[^>]*src=["']([^"']*(?:product|main|item)[^"']*\.(?:jpg|jpeg|png|webp))/i,
    /<img[^>]*data-[^>]*=["']([^"']+\.(?:jpg|jpeg|png|webp))/i
  ];
  
  for (const pattern of imagePatterns) {
    const match = html.match(pattern);
    if (match && !match[1].includes('placeholder') && !match[1].includes('icon')) {
      result.image = match[1];
      break;
    }
  }
  
  result.dimensions = extractDimensionsFromHTML(html);
  
  return result;
}

function extractConfidentPrice(html, retailer, structuredData) {
  const results = [];
  
  if (structuredData && structuredData.price > 0) {
    results.push({
      price: structuredData.price,
      source: 'JSON-LD structured data',
      confidence: 95
    });
  }
  
  const retailerPrice = extractRetailerPrice(html, retailer);
  if (retailerPrice > 0) {
    results.push({
      price: retailerPrice,
      source: `${retailer} specific selector`,
      confidence: 85
    });
  }
  
  const genericPrices = extractGenericPrices(html);
  genericPrices.forEach(price => {
    results.push({
      price: price,
      source: 'generic price pattern',
      confidence: 60
    });
  });
  
  const validResults = results.filter(result => 
    result.price >= 5 && result.price <= 25000
  );
  
  if (validResults.length === 0) {
    return { confident: false, reason: 'No valid prices found' };
  }
  
  const bestResult = validResults.sort((a, b) => b.confidence - a.confidence)[0];
  
  const agreeingPrices = validResults.filter(r => 
    Math.abs(r.price - bestResult.price) < (bestResult.price * 0.05)
  );
  
  const confident = bestResult.confidence >= 80 || agreeingPrices.length >= 2;
  
  if (confident) {
    return {
      confident: true,
      price: bestResult.price,
      source: bestResult.source,
      confidence: bestResult.confidence
    };
  } else {
    return {
      confident: false,
      reason: `Low confidence (${bestResult.confidence}%), needs verification`,
      foundPrice: bestResult.price
    };
  }
}

function extractRetailerPrice(html, retailer) {
  const patterns = {
    'Wayfair': [
      /data-cy="price-current"[^>]*>.*?\$([0-9,]+(?:\.\d{2})?)/is,
      /class="[^"]*price-current[^"]*"[^>]*>.*?\$([0-9,]+(?:\.\d{2})?)/is
    ],
    'Amazon': [
      /class="[^"]*a-price-whole[^"]*"[^>]*>([0-9,]+)/i,
      /id="priceblock_dealprice"[^>]*>.*?\$([0-9,]+(?:\.\d{2})?)/is
    ],
    'Target': [
      /data-test="product-price"[^>]*>.*?\$([0-9,]+(?:\.\d{2})?)/is
    ],
    'Walmart': [
      /itemprop="price"[^>]*>.*?\$([0-9,]+(?:\.\d{2})?)/is
    ]
  };
  
  const retailerPatterns = patterns[retailer] || [];
  
  for (const pattern of retailerPatterns) {
    const match = html.match(pattern);
    if (match) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price > 0) return price;
    }
  }
  
  return 0;
}

function extractGenericPrices(html) {
  const patterns = [
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g
  ];
  
  const prices = [];
  
  for (const pattern of patterns) {
    const matches = Array.from(html.matchAll(pattern));
    matches.forEach(match => {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price >= 10 && price <= 10000) {
        prices.push(price);
      }
    });
  }
  
  const priceCounts = {};
  prices.forEach(price => {
    priceCounts[price] = (priceCounts[price] || 0) + 1;
  });
  
  return Object.entries(priceCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3)
    .map(([price]) => parseFloat(price));
}

function extractDimensionsFromHTML(html) {
  console.log('  Looking for dimensions...');
  
  const patterns = [
    /(?:overall|product|assembled|item|package|shipping|box)\s*dimensions?[^:]*:\s*(\d+(?:\.\d+)?)["\s]*(?:[LlWwHhxX×])\s*[×x]\s*(\d+(?:\.\d+)?)["\s]*(?:[LlWwHhxX])\s*[×x]\s*(\d+(?:\.\d+)?)["\s]*(?:[LlWwHh])/i,
    /(\d+(?:\.\d+)?)["\s]*[×x]\s*(\d+(?:\.\d+)?)["\s]*[×x]\s*(\d+(?:\.\d+)?)\s*(?:inches|in|")/i,
    /(\d+(?:\.\d+)?)["\s]*[LWHlwh]\s*[×x]\s*(\d+(?:\.\d+)?)["\s]*[LWHlwh]\s*[×x]\s*(\d+(?:\.\d+)?)["\s]*[LWHlwh]/i,
    /(?:size|measure)[^:]*:\s*(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const dims = [
        parseFloat(match[1]),
        parseFloat(match[2]), 
        parseFloat(match[3])
      ].sort((a, b) => b - a);
      
      if (dims[0] >= 1 && dims[0] <= 300 && dims[2] >= 1) {
        console.log(`  ✓ Found dimensions: ${dims[0]}" x ${dims[1]}" x ${dims[2]}"`);
        return {
          length: dims[0],
          width: dims[1], 
          height: dims[2],
          source: 'scraped from page'
        };
      }
    }
  }
  
  return null;
}

function getEstimatedDimensions(productName, category) {
  const name = productName.toLowerCase();
  
  const specificDimensions = {
    'sectional': { length: 100, width: 70, height: 30 },
    'sofa': { length: 70, width: 30, height: 30 },
    'loveseat': { length: 50, width: 30, height: 30 },
    'chair': { length: 27, width: 27, height: 33 },
    'recliner': { length: 30, width: 32, height: 35 },
    'ottoman': { length: 20, width: 15, height: 15 },
    'coffee table': { length: 40, width: 20, height: 15 },
    'dining table': { length: 60, width: 30, height: 25 },
    'desk': { length: 50, width: 25, height: 25 },
    'dresser': { length: 50, width: 15, height: 30 },
    'nightstand': { length: 20, width: 15, height: 20 },
    'tv': { length: 42, width: 3, height: 23 },
    'refrigerator': { length: 30, width: 30, height: 58 },
    'washer': { length: 23, width: 25, height: 32 },
    'dryer': { length: 23, width: 25, height: 32 }
  };
  
  for (const [key, dims] of Object.entries(specificDimensions)) {
    if (name.includes(key)) {
      return {
        length: Math.ceil(dims.length * 1.2),
        width: Math.ceil(dims.width * 1.2),
        height: Math.ceil(dims.height * 1.2),
        estimated: true
      };
    }
  }
  
  const categoryDefaults = {
    'Furniture': { length: 48, width: 25, height: 25 },
    'Electronics': { length: 20, width: 15, height: 10 },
    'Appliances': { length: 25, width: 25, height: 30 },
    'Outdoor': { length: 40, width: 40, height: 30 },
    'General': { length: 15, width: 12, height: 8 }
  };
  
  const baseDims = categoryDefaults[category] || categoryDefaults['General'];
  
  return {
    length: Math.ceil(baseDims.length * 1.2),
    width: Math.ceil(baseDims.width * 1.2), 
    height: Math.ceil(baseDims.height * 1.2),
    estimated: true
  };
}

function estimateWeight(productName, category) {
  const name = productName.toLowerCase();
  
  const weights = {
    'sectional': 200, 'sofa': 120, 'loveseat': 80, 'chair': 40,
    'recliner': 70, 'ottoman': 20, 'coffee table': 50, 'dining table': 100,
    'desk': 80, 'dresser': 120, 'bed': 80, 'mattress': 60,
    'tv': 30, 'refrigerator': 250, 'washer': 160, 'dryer': 100
  };
  
  for (const [key, weight] of Object.entries(weights)) {
    if (name.includes(key)) return weight;
  }
  
  const categoryWeights = {
    'Furniture': 60, 'Electronics': 15, 'Appliances': 80,
    'Outdoor': 65, 'General': 12
  };
  
  return categoryWeights[category] || 12;
}

function calculateShippingCost(dimensions, weight) {
  const CONTAINER_COST = 6000;
  const USABLE_CUBIC_FEET = 1172; 
  const COST_PER_CUBIC_FOOT = CONTAINER_COST / USABLE_CUBIC_FEET;
  
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  let chargeableCubicFeet = Math.max(0.5, cubicFeet);
  let shipping = chargeableCubicFeet * COST_PER_CUBIC_FOOT;
  
  if (weight > 150) shipping += 50;
  else if (weight > 70) shipping += 25;
  
  return Math.round(shipping * 100) / 100;
}

function getRetailerName(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  
  const retailers = {
    'amazon': 'Amazon', 'wayfair': 'Wayfair', 'walmart': 'Walmart',
    'target': 'Target', 'homedepot': 'Home Depot', 'lowes': 'Lowes',
    'bestbuy': 'Best Buy', 'ikea': 'IKEA', 'costco': 'Costco',
    'ebay': 'eBay', 'overstock': 'Overstock'
  };
  
  for (const [key, name] of Object.entries(retailers)) {
    if (hostname.includes(key)) return name;
  }
  
  return 'Online Store';
}

function determineCategory(productName) {
  const name = productName.toLowerCase();
  
  if (/sofa|chair|table|desk|bed|dresser|cabinet|shelf/i.test(name)) return 'Furniture';
  if (/tv|television|laptop|computer|monitor|tablet/i.test(name)) return 'Electronics';
  if (/refrigerator|washer|dryer|dishwasher|microwave/i.test(name)) return 'Appliances';
  if (/grill|patio|outdoor|fire pit/i.test(name)) return 'Outdoor';
  
  return 'General';
}

function cleanProductName(name) {
  if (!name) return null;
  
  return name
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').substring(0, 200).trim();
}

function createFallbackProduct(url, productId) {
  const retailer = getRetailerName(url);
  const dimensions = getEstimatedDimensions('general item', 'General');
  const weight = 15;
  
  return {
    id: productId,
    url: url,
    retailer: retailer,
    name: `Product from ${retailer}`,
    price: null,
    image: `https://placehold.co/200x200/667eea/FFFFFF/png?text=${encodeURIComponent(retailer)}`,
    dimensions: dimensions,
    weight: weight,
    quantity: 1,
    category: 'General',
    shippingCost: calculateShippingCost(dimensions, weight),
    needsManualPrice: true,
    priceStatus: 'manual_required',
    priceMessage: 'Unable to scrape product information',
    isFallback: true,
    pageType: 'unknown'
  };
}

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  Bermuda Ocean Freight Calculator     ║
║  Running on port ${PORT}                  ║
║  ScrapingBee: ${SCRAPINGBEE_API_KEY ? '✓ Connected' : '✗ Missing'}         ║
║  Shopify: ${SHOPIFY_ACCESS_TOKEN ? '✓ Connected' : '✗ Missing'}            ║
║  Store: spencer-deals-ltd              ║
╚════════════════════════════════════════╝
  `);
});
