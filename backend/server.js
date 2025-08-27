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

const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;
const SCRAPINGBEE_URL = 'https://app.scrapingbee.com/api/v1/';

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
        deliveryFee: 0 // Customer will input this
      };
    }
    grouped[retailer].products.push(product);
  });
  
  return grouped;
}

// Robust scraper that handles any URL type
async function robustScrapeProduct(url, productId) {
  try {
    // First, analyze the URL to determine strategy
    const urlType = analyzeURL(url);
    console.log(`  URL type: ${urlType.type} (${urlType.retailer})`);
    
    const html = await fetchWithScrapingBee(url, urlType);
    console.log(`  HTML received: ${html.length} bytes`);
    
    let productUrl = url;
    let htmlToProcess = html;
    
    // If it's a category/search page, try to find first product
    if (urlType.type === 'category' || urlType.type === 'search') {
      const firstProductUrl = extractFirstProductURL(html, urlType.retailer);
      if (firstProductUrl) {
        console.log(`  Found first product: ${firstProductUrl.substring(0, 80)}...`);
        // For now, use the category page data but flag it
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

// Analyze URL to determine page type and strategy
function analyzeURL(url) {
  const retailer = getRetailerName(url);
  const lowerUrl = url.toLowerCase();
  
  // Detect page types
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
    'render_js': 'false', // Faster for category pages
    'premium_proxy': 'true',
    'country_code': 'us',
    'block_ads': 'true'
  });
  
  // Only use JS rendering for product pages
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

// Extract first product URL from category/search pages
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
  
  const retailerPatterns = patterns[retailer] || patterns['Amazon']; // Default fallback
  
  for (const pattern of retailerPatterns) {
    const match = html.match(pattern);
    if (match) {
      let productUrl = match[1];
      
      // Make URL absolute if relative
      if (productUrl.startsWith('/')) {
        const baseUrl = new URL(html.match(/https?:\/\/[^\/]+/)?.[0] || 'https://www.wayfair.com');
        productUrl = baseUrl.origin + productUrl;
      }
      
      return productUrl;
    }
  }
  
  return null;
}

// Universal product parser that works with any content
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
  
  // 1. Try structured data (most reliable)
  const structuredData = extractStructuredData(html);
  if (structuredData) {
    console.log('  ✓ Found structured data');
    product.name = structuredData.name || product.name;
    product.image = structuredData.image || product.image;
    product.price = structuredData.price || product.price;
  }
  
  // 2. Universal content extraction (works on any page type)
  const universalData = extractUniversalContent(html, retailer);
  console.log(`  Universal extraction: name=${!!universalData.name}, image=${!!universalData.image}, price=${!!universalData.price}, dimensions=${!!universalData.dimensions}`);
  
  product.name = product.name || universalData.name;
  product.image = product.image || universalData.image;
  product.dimensions = product.dimensions || universalData.dimensions;
  
  // 3. Confident price extraction only
  const priceResult = extractConfidentPrice(html, retailer, structuredData);
  if (priceResult.confident) {
    product.price = priceResult.price;
    product.needsManualPrice = false;
    product.priceStatus = 'found';
    console.log(`  ✓ Confident price: $${priceResult.price} (${priceResult.source})`);
  } else {
    product.price = null; // Don't show $0
    product.needsManualPrice = true;
    product.priceStatus = 'manual_required';
    product.priceMessage = priceResult.reason || 'Price could not be determined automatically';
    console.log(`  ⚠ Price uncertain - manual entry required (${priceResult.reason})`);
  }
  
  // Clean up and finalize
  product.name = cleanProductName(product.name) || `${retailer} Product`;
  product.category = determineCategory(product.name);
  
  // Add dimensions with buffer if not found
  if (!product.dimensions) {
    product.dimensions = getEstimatedDimensions(product.name, product.category);
    product.dimensions.estimated = true;
    product.dimensions.source = 'category estimate + 20% buffer';
  } else {
    // Add 20% buffer to scraped dimensions
    product.dimensions.length = Math.ceil(product.dimensions.length * 1.2);
    product.dimensions.width = Math.ceil(product.dimensions.width * 1.2);  
    product.dimensions.height = Math.ceil(product.dimensions.height * 1.2);
    product.dimensions.source += ' + 20% buffer';
  }
  
  // Estimate weight
  product.weight = product.weight || estimateWeight(product.name, product.category);
  
  // Set placeholder image if needed
  if (!product.image) {
    product.image = `https://placehold.co/200x200/667eea/FFFFFF/png?text=${encodeURIComponent(retailer)}`;
  }
  
  // Make image URL absolute
  if (product.image && product.image.startsWith('/')) {
    const baseUrl = new URL(url);
    product.image = baseUrl.origin + product.image;
  }
  
  // Calculate shipping cost
  product.shippingCost = calculateShippingCost(product.dimensions, product.weight);
  console.log(`  💰 Calculated shipping: $${product.shippingCost} (${product.dimensions.length}" x ${product.dimensions.width}" x ${product.dimensions.height}", ${product.weight}lbs)`);
  
  return product;
}

// Confident price extraction with reliability scoring
function extractConfidentPrice(html, retailer, structuredData) {
  const results = [];
  
  // 1. Structured data (highest confidence)
  if (structuredData && structuredData.price > 0) {
    results.push({
      price: structuredData.price,
      source: 'JSON-LD structured data',
      confidence: 95
    });
  }
  
  // 2. Retailer-specific selectors (high confidence)
  const retailerPrice = extractRetailerPrice(html, retailer);
  if (retailerPrice > 0) {
    results.push({
      price: retailerPrice,
      source: `${retailer} specific selector`,
      confidence: 85
    });
  }
  
  // 3. Generic price patterns (medium confidence)
  const genericPrices = extractGenericPrices(html);
  genericPrices.forEach(price => {
    results.push({
      price: price,
      source: 'generic price pattern',
      confidence: 60
    });
  });
  
  // Filter and validate results
  const validResults = results.filter(result => 
    result.price >= 5 && result.price <= 25000 // Reasonable range
  );
  
  if (validResults.length === 0) {
    return { confident: false, reason: 'No valid prices found' };
  }
  
  // Use highest confidence result
  const bestResult = validResults.sort((a, b) => b.confidence - a.confidence)[0];
  
  // Only confident if score is 80+ or multiple sources agree
  const agreeingPrices = validResults.filter(r => 
    Math.abs(r.price - bestResult.price) < (bestResult.price * 0.05) // Within 5%
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

// Retailer-specific price extraction
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

// Generic price extraction
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
  
  // Return most common prices (likely to be actual product prices)
  const priceCounts = {};
  prices.forEach(price => {
    priceCounts[price] = (priceCounts[price] || 0) + 1;
  });
  
  return Object.entries(priceCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3)
    .map(([price]) => parseFloat(price));
}

// Extract structured data (JSON-LD, meta tags)
function extractStructuredData(html) {
  const result = {};
  
  // JSON-LD
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
  
  // Open Graph
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i);
  const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i);
  const ogPrice = html.match(/<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([^"']+)/i);
  
  if (ogTitle) result.name = result.name || ogTitle[1];
  if (ogImage) result.image = result.image || ogImage[1];
  if (ogPrice) result.price = result.price || parseFloat(ogPrice[1]);
  
  return Object.keys(result).length > 0 ? result : null;
}

// Universal content extraction that works on any page
function extractUniversalContent(html, retailer) {
  const result = {};
  
  // Product name - multiple strategies
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
      // Clean up common noise
      name = name.replace(/\s*[-|]\s*(Wayfair|Amazon|Walmart|Target).*$/i, '');
      name = name.replace(/\s*\|\s*.*$/, '');
      if (name.length > 10) {
        result.name = name;
        break;
      }
    }
  }
  
  // Product image - look for main images
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
  
  // Dimensions - comprehensive search
  result.dimensions = extractDimensionsFromHTML(html);
  
  return result;
}

// Enhanced dimension extraction
function extractDimensionsFromHTML(html) {
  console.log('  Looking for dimensions...');
  
  const patterns = [
    // Product dimensions with labels
    /(?:overall|product|assembled|item|package|shipping|box)\s*dimensions?[^:]*:\s*(\d+(?:\.\d+)?)["\s]*(?:[LlWwHhxX×])\s*[×x]\s*(\d+(?:\.\d+)?)["\s]*(?:[LlWwHhxX])\s*[×x]\s*(\d+(?:\.\d+)?)["\s]*(?:[LlWwHh])/i,
    
    // Simple patterns
    /(\d+(?:\.\d+)?)["\s]*[×x]\s*(\d+(?:\.\d+)?)["\s]*[×x]\s*(\d+(?:\.\d+)?)\s*(?:inches|in|")/i,
    
    // With units
    /(\d+(?:\.\d+)?)["\s]*[LWHlwh]\s*[×x]\s*(\d+(?:\.\d+)?)["\s]*[LWHlwh]\s*[×x]\s*(\d+(?:\.\d+)?)["\s]*[LWHlwh]/i,
    
    // Flexible patterns
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
      
      // Validate dimensions
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
║  Mode: Robust Universal Scraper       ║
║  Price: Confident Auto + Manual       ║
╚════════════════════════════════════════╝
  `);
});
