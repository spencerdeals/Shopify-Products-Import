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

    console.log(`\n============ Scraping ${urls.length} URLs (Name + Image + Dimensions + Price Attempt) ============`);
    let products = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`\n[${i + 1}/${urls.length}] Processing: ${url}`);
      
      try {
        const productData = await scrapeProductInfo(url, i + 1);
        products.push(productData);
        
        const priceStatus = productData.needsManualPrice ? 'Manual entry needed' : `$${productData.price}`;
        console.log(`✓ Success: ${productData.name.substring(0, 50)}... [${productData.retailer}] - ${priceStatus}`);
        
        if (productData.dimensions) {
          console.log(`  📦 Dimensions: ${productData.dimensions.length}" x ${productData.dimensions.width}" x ${productData.dimensions.height}" (${productData.dimensions.source})`);
        } else {
          console.log(`  📦 Using category estimate for dimensions`);
        }
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

async function scrapeProductInfo(url, productId) {
  try {
    const html = await fetchWithScrapingBee(url);
    console.log(`  HTML received: ${html.length} bytes`);
    
    const product = await parseProductInfo(html, url, productId);
    return product;
  } catch (error) {
    console.error('  Scraping failed:', error.message);
    throw error;
  }
}

async function fetchWithScrapingBee(url) {
  const retailer = getRetailerName(url);
  console.log(`  Using ScrapingBee for ${retailer}...`);
  
  const params = new URLSearchParams({
    'api_key': SCRAPINGBEE_API_KEY,
    'url': url,
    'render_js': 'true',
    'premium_proxy': 'true',
    'country_code': 'us',
    'block_ads': 'true',
    'stealth_proxy': 'true'
  });
  
  // Retailer-specific settings for better dimension scraping
  const retailerSettings = {
    'Amazon': { wait: '5000', wait_for: 'span#productTitle' },
    'Wayfair': { wait: '4000', wait_for: 'h1' },
    'Walmart': { wait: '3000', wait_for: '[itemprop="name"]' },
    'Target': { wait: '3000', wait_for: '[data-test="product-title"]' },
    'Home Depot': { wait: '3000', wait_for: 'h1' },
    'Best Buy': { wait: '3000', wait_for: '.sku-title' },
    'IKEA': { wait: '4000', wait_for: '.pip-header-section' }
  };
  
  const settings = retailerSettings[retailer] || { wait: '2000' };
  Object.entries(settings).forEach(([key, value]) => {
    params.set(key, value);
  });
  
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

async function parseProductInfo(html, url, productId) {
  const retailer = getRetailerName(url);
  
  let product = {
    id: productId,
    url: url,
    retailer: retailer,
    name: null,
    image: null,
    dimensions: null,
    price: 0,
    quantity: 1,
    category: 'General',
    needsManualPrice: true,
    weight: null
  };
  
  console.log(`  Parsing ${retailer} for name + image + dimensions + price...`);
  
  // 1. Try JSON-LD structured data first
  const structuredData = extractJSONLD(html);
  if (structuredData) {
    console.log('  ✓ Found JSON-LD data');
    product.name = structuredData.name || product.name;
    product.image = structuredData.image || product.image;
    product.price = structuredData.price || product.price;
  }
  
  // 2. Try Open Graph meta tags
  const ogData = extractOpenGraph(html);
  if (ogData.title || ogData.image || ogData.price) {
    console.log('  ✓ Found Open Graph data');
    product.name = product.name || ogData.title;
    product.image = product.image || ogData.image;
    product.price = product.price || ogData.price;
  }
  
  // 3. Try non-blocking price extraction with timeout
  if (!product.price || product.price === 0) {
    try {
      const priceWithTimeout = await Promise.race([
        extractPriceFromHTML(html, retailer),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Price extraction timeout')), 3000))
      ]);
      
      if (priceWithTimeout && priceWithTimeout > 0) {
        product.price = priceWithTimeout;
        product.needsManualPrice = false;
        console.log(`  ✓ Price extracted: $${priceWithTimeout}`);
      } else {
        console.log('  ⚠ Price extraction returned invalid value');
      }
    } catch (error) {
      console.log(`  ⚠ Price extraction failed: ${error.message}`);
    }
  }
  
  // 4. Retailer-specific parsing (never blocks for price)
  const parserMap = {
    'Amazon': parseAmazon,
    'Wayfair': parseWayfair,
    'Walmart': parseWalmart,
    'Target': parseTarget,
    'Home Depot': parseHomeDepot,
    'Best Buy': parseBestBuy,
    'IKEA': parseIKEA
  };
  
  const parser = parserMap[retailer];
  if (parser) {
    const retailerData = parser(html);
    console.log(`  ${retailer} parsing:`, { 
      name: !!retailerData.name, 
      image: !!retailerData.image,
      dimensions: !!retailerData.dimensions,
      price: !!retailerData.price
    });
    
    product.name = product.name || retailerData.name;
    product.image = product.image || retailerData.image;
    product.dimensions = product.dimensions || retailerData.dimensions;
    
    // Use retailer price if we don't have one yet
    if ((!product.price || product.price === 0) && retailerData.price && retailerData.price > 0) {
      product.price = retailerData.price;
      product.needsManualPrice = false;
      console.log(`  ✓ Price from ${retailer} parser: $${retailerData.price}`);
    }
  }
  
  // 5. Try generic dimension extraction
  if (!product.dimensions) {
    product.dimensions = extractDimensionsFromHTML(html);
  }
  
  // 6. Generic fallback parsing
  if (!product.name) {
    const genericData = parseGenericHTML(html);
    product.name = product.name || genericData.name;
    product.image = product.image || genericData.image;
  }
  
  // Clean up and finalize
  product.name = cleanProductName(product.name) || `Product from ${retailer}`;
  product.category = determineCategory(product.name);
  
  // Final price validation
  if (product.price && product.price > 0) {
    product.price = parseFloat(product.price);
    product.needsManualPrice = false;
  } else {
    product.price = 0;
    product.needsManualPrice = true;
  }
  
  // Estimate dimensions if not found, with 20% buffer for Bermuda shipping
  if (!product.dimensions) {
    product.dimensions = getEstimatedDimensions(product.name, product.category);
    product.dimensions.estimated = true;
    product.dimensions.source = 'category estimate + 20% buffer';
  } else {
    // Add 20% buffer to scraped dimensions for Bermuda customs
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
  
  // Calculate shipping cost based on dimensions
  product.shippingCost = calculateShippingCost(product.dimensions, product.weight);
  console.log(`  💰 Calculated shipping: $${product.shippingCost} (${product.dimensions.length}" x ${product.dimensions.width}" x ${product.dimensions.height}", ${product.weight}lbs)`);
  
  return product;
}

// Non-blocking price extraction with timeout
async function extractPriceFromHTML(html, retailer) {
  console.log(`  Attempting price extraction for ${retailer}...`);
  
  // Generic price patterns
  const pricePatterns = [
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,
    /USD\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi,
    /price[^>]*>.*?\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/is
  ];
  
  for (const pattern of pricePatterns) {
    const matches = html.match(pattern);
    if (matches) {
      const prices = matches
        .map(match => {
          const numMatch = match.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
          return numMatch ? parseFloat(numMatch[1].replace(/,/g, '')) : null;
        })
        .filter(price => price && price >= 10 && price <= 50000) // Reasonable price range
        .sort((a, b) => a - b); // Sort ascending
      
      if (prices.length > 0) {
        // Use the first reasonable price found
        return prices[0];
      }
    }
  }
  
  return null;
}

// Extract dimensions with multiple patterns
function extractDimensionsFromHTML(html) {
  console.log('  Looking for dimensions in HTML...');
  
  const patterns = [
    // Overall/Product dimensions: 84"L x 36"W x 36"H
    /(?:overall|product|assembled|item)\s*dimensions?[^:]*:\s*(\d+(?:\.\d+)?)["\s]*[LlWwHh]\s*x\s*(\d+(?:\.\d+)?)["\s]*[LlWwHh]\s*x\s*(\d+(?:\.\d+)?)["\s]*[LlWwHh]/i,
    
    // Package dimensions: 86 x 38 x 38 inches
    /(?:package|shipping|box)\s*dimensions?[^:]*:\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(?:inches|in|")/i,
    
    // Simple pattern: 84 x 36 x 36 inches
    /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(?:inches|in|")/i,
    
    // Dimensions with units: 84"L x 36"W x 36"H
    /(\d+(?:\.\d+)?)["\s]*[LlWwHh]\s*x\s*(\d+(?:\.\d+)?)["\s]*[LlWwHh]\s*x\s*(\d+(?:\.\d+)?)["\s]*[LlWwHh]/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const dims = [
        parseFloat(match[1]),
        parseFloat(match[2]), 
        parseFloat(match[3])
      ].sort((a, b) => b - a); // Sort largest to smallest
      
      // Sanity check - dimensions should be reasonable
      if (dims[0] > 4 && dims[0] < 200 && dims[2] > 1) {
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

// Simplified JSON-LD extraction
function extractJSONLD(html) {
  try {
    const scripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    
    for (const script of scripts) {
      const match = script.match(/>([^<]+)</);
      if (!match) continue;
      
      try {
        const data = JSON.parse(match[1].trim());
        
        if (data['@type'] === 'Product' || data.type === 'Product') {
          return {
            name: data.name,
            image: Array.isArray(data.image) ? data.image[0] : data.image,
            price: data.offers?.price || data.offers?.[0]?.price
          };
        }
        
        if (Array.isArray(data)) {
          const product = data.find(item => item['@type'] === 'Product');
          if (product) {
            return {
              name: product.name,
              image: Array.isArray(product.image) ? product.image[0] : product.image,
              price: product.offers?.price || product.offers?.[0]?.price
            };
          }
        }
      } catch (e) {
        continue;
      }
    }
  } catch (e) {
    console.log('  JSON-LD extraction error:', e.message);
  }
  return null;
}

// Extract Open Graph data
function extractOpenGraph(html) {
  const og = {};
  
  const titleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i);
  const imageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i);
  const priceMatch = html.match(/<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([^"']+)/i);
  
  if (titleMatch) og.title = titleMatch[1];
  if (imageMatch) og.image = imageMatch[1];
  if (priceMatch) og.price = parseFloat(priceMatch[1]);
  
  return og;
}

// Generic HTML parsing
function parseGenericHTML(html) {
  const result = {};
  
  // Get title
  const titleMatch = html.match(/<h1[^>]*>([^<]{5,200})<\/h1>/i) ||
                    html.match(/<title>([^<]{5,100})<\/title>/i);
  
  if (titleMatch) {
    result.name = titleMatch[1].trim();
  }
  
  // Look for main product image
  const imageMatch = html.match(/<img[^>]*(?:id|class)=["'][^"']*(?:product|main|hero|primary)[^"']*["'][^>]*src=["']([^"']+)/i);
  
  if (imageMatch) {
    result.image = imageMatch[1];
  }
  
  return result;
}

// Retailer-specific parsers
function parseAmazon(html) {
  const result = {};
  
  // Name
  const titleMatch = html.match(/<span[^>]*id=["']productTitle["'][^>]*>([^<]+)</i);
  if (titleMatch) result.name = titleMatch[1].trim();
  
  // Image
  const imageMatch = html.match(/<img[^>]*id=["']landingImage["'][^>]*src=["']([^"']+)/i);
  if (imageMatch) result.image = imageMatch[1];
  
  // Price
  const pricePatterns = [
    /<span[^>]*class=["'][^"']*a-price-whole["'][^>]*>[\s\$]*([0-9,]+)/i,
    /<span[^>]*class=["'][^"']*a-price["'][^>]*>.*?\$([0-9,]+\.?\d*)/is
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price > 0) {
        result.price = price;
        break;
      }
    }
  }
  
  return result;
}

function parseWayfair(html) {
  const result = {};
  
  // Name  
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (titleMatch) {
    let title = titleMatch[1].trim();
    title = title.replace(/\s*\|.*$/, '').replace(/\s*-\s*Wayfair.*$/, '');
    result.name = title;
  }
  
  // Image
  const imageMatch = html.match(/<img[^>]*class=["'][^"']*ProductDetailImageCarousel[^"']*["'][^>]*src=["']([^"']+)/i);
  if (imageMatch) result.image = imageMatch[1];
  
  // Price - look for $339.99 pattern
  const priceMatches = html.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g) || [];
  for (const match of priceMatches) {
    const price = parseFloat(match.replace(/[$,]/g, ''));
    // For Wayfair furniture, prices are typically $100-$2000
    if (price > 50 && price < 5000) {
      result.price = price;
      break;
    }
  }
  
  // Dimensions (Wayfair usually has good dimension data)
  const overallMatch = html.match(/Overall[^:]*:\s*(\d+(?:\.\d+)?)["\s]*[HWL]\s*x\s*(\d+(?:\.\d+)?)["\s]*[HWL]\s*x\s*(\d+(?:\.\d+)?)["\s]*[HWL]/i);
  if (overallMatch) {
    const dims = [
      parseFloat(overallMatch[1]),
      parseFloat(overallMatch[2]),
      parseFloat(overallMatch[3])
    ].sort((a, b) => b - a);
    
    result.dimensions = {
      length: dims[0],
      width: dims[1],
      height: dims[2],
      source: 'Wayfair product specs'
    };
  }
  
  return result;
}

function parseWalmart(html) {
  const result = {};
  
  const nameMatch = html.match(/<h1[^>]*itemprop=["']name["'][^>]*>([^<]+)</i);
  if (nameMatch) result.name = nameMatch[1].trim();
  
  const imageMatch = html.match(/<img[^>]*class=["'][^"']*prod-ProductImage[^"']*["'][^>]*src=["']([^"']+)/i);
  if (imageMatch) result.image = imageMatch[1];
  
  const priceMatch = html.match(/\$([0-9,]+(?:\.[0-9]{2})?)/);
  if (priceMatch) result.price = parseFloat(priceMatch[1].replace(/,/g, ''));
  
  return result;
}

function parseTarget(html) {
  const result = {};
  
  const nameMatch = html.match(/<h1[^>]*data-test=["']product-title["'][^>]*>([^<]+)</i);
  if (nameMatch) result.name = nameMatch[1].trim();
  
  const imageMatch = html.match(/<img[^>]*data-test=["']product-image["'][^>]*src=["']([^"']+)/i);
  if (imageMatch) result.image = imageMatch[1];
  
  const priceMatch = html.match(/\$([0-9,]+(?:\.[0-9]{2})?)/);
  if (priceMatch) result.price = parseFloat(priceMatch[1].replace(/,/g, ''));
  
  return result;
}

function parseHomeDepot(html) {
  const result = {};
  
  const nameMatch = html.match(/<h1[^>]*class=["'][^"']*product-title["'][^>]*>([^<]+)</i);
  if (nameMatch) result.name = nameMatch[1].trim();
  
  const priceMatch = html.match(/<span[^>]*class=["'][^"']*price["'][^>]*>.*?\$([0-9,]+(?:\.[0-9]{2})?)/is);
  if (priceMatch) result.price = parseFloat(priceMatch[1].replace(/,/g, ''));
  
  return result;
}

function parseBestBuy(html) {
  const result = {};
  
  const nameMatch = html.match(/<h1[^>]*class=["'][^"']*sku-title["'][^>]*>([^<]+)</i);
  if (nameMatch) result.name = nameMatch[1].trim();
  
  const priceMatch = html.match(/<span[^>]*class=["'][^"']*pricing-price["'][^>]*>.*?\$([0-9,]+(?:\.[0-9]{2})?)/is);
  if (priceMatch) result.price = parseFloat(priceMatch[1].replace(/,/g, ''));
  
  return result;
}

function parseIKEA(html) {
  const result = {};
  
  const nameMatch = html.match(/<span[^>]*class=["'][^"']*pip-header__title["'][^>]*>([^<]+)</i);
  if (nameMatch) result.name = nameMatch[1].trim();
  
  const priceMatch = html.match(/<span[^>]*class=["'][^"']*pip-price__integer["'][^>]*>([0-9,]+)/i);
  if (priceMatch) result.price = parseFloat(priceMatch[1].replace(/,/g, ''));
  
  return result;
}

// Get estimated dimensions with 20% buffer
function getEstimatedDimensions(productName, category) {
  const name = productName.toLowerCase();
  
  // Product-specific dimensions (before buffer)
  const specificDimensions = {
    'sectional': { length: 100, width: 70, height: 30 },
    'loveseat': { length: 50, width: 30, height: 30 },
    'sofa': { length: 70, width: 30, height: 30 },
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
  
  // Check for specific product match
  for (const [key, dims] of Object.entries(specificDimensions)) {
    if (name.includes(key)) {
      return {
        length: Math.ceil(dims.length * 1.2), // 20% buffer
        width: Math.ceil(dims.width * 1.2),
        height: Math.ceil(dims.height * 1.2),
        estimated: true
      };
    }
  }
  
  // Category defaults with 20% buffer
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

// Estimate weight
function estimateWeight(productName, category) {
  const name = productName.toLowerCase();
  
  const weights = {
    'sectional': 200,
    'sofa': 120,
    'loveseat': 80,
    'chair': 40,
    'recliner': 70,
    'ottoman': 20,
    'coffee table': 50,
    'dining table': 100,
    'desk': 80,
    'dresser': 120,
    'bed': 80,
    'mattress': 60,
    'tv': 30,
    'refrigerator': 250,
    'washer': 160,
    'dryer': 100
  };
  
  for (const [key, weight] of Object.entries(weights)) {
    if (name.includes(key)) return weight;
  }
  
  const categoryWeights = {
    'Furniture': 60,
    'Electronics': 15,
    'Appliances': 80,
    'Outdoor': 65,
    'General': 12
  };
  
  return categoryWeights[category] || 12;
}

// Calculate shipping cost based on dimensions
function calculateShippingCost(dimensions, weight) {
  const CONTAINER_COST = 6000;
  const USABLE_CUBIC_FEET = 1172; 
  const COST_PER_CUBIC_FOOT = CONTAINER_COST / USABLE_CUBIC_FEET;
  
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  let chargeableCubicFeet = Math.max(0.5, cubicFeet);
  
  let shipping = chargeableCubicFeet * COST_PER_CUBIC_FOOT;
  
  // Weight surcharge
  if (weight > 150) shipping += 50;
  else if (weight > 70) shipping += 25;
  
  return Math.round(shipping * 100) / 100;
}

function getRetailerName(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  
  const retailers = {
    'amazon': 'Amazon',
    'wayfair': 'Wayfair', 
    'walmart': 'Walmart',
    'target': 'Target',
    'homedepot': 'Home Depot',
    'lowes': 'Lowes',
    'bestbuy': 'Best Buy',
    'ikea': 'IKEA',
    'costco': 'Costco',
    'ebay': 'eBay'
  };
  
  for (const [key, name] of Object.entries(retailers)) {
    if (hostname.includes(key)) return name;
  }
  
  return 'Online Store';
}

function determineCategory(productName) {
  const name = productName.toLowerCase();
  
  if (name.includes('sofa') || name.includes('chair') || name.includes('table') || 
      name.includes('desk') || name.includes('bed') || name.includes('dresser') || 
      name.includes('cabinet') || name.includes('shelf')) return 'Furniture';
      
  if (name.includes('tv') || name.includes('television') || name.includes('laptop') || 
      name.includes('computer') || name.includes('monitor') || name.includes('tablet')) return 'Electronics';
      
  if (name.includes('refrigerator') || name.includes('washer') || name.includes('dryer') || 
      name.includes('dishwasher') || name.includes('microwave')) return 'Appliances';
      
  if (name.includes('grill') || name.includes('patio') || name.includes('outdoor') || 
      name.includes('fire pit')) return 'Outdoor';
      
  return 'General';
}

function cleanProductName(name) {
  if (!name) return null;
  
  return name
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .substring(0, 200)
    .trim();
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
    price: 0,
    image: `https://placehold.co/200x200/667eea/FFFFFF/png?text=${encodeURIComponent(retailer)}`,
    dimensions: dimensions,
    weight: weight,
    quantity: 1,
    category: 'General',
    shippingCost: calculateShippingCost(dimensions, weight),
    needsManualPrice: true,
    isFallback: true
  };
}

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  Bermuda Import Calculator             ║
║  Running on port ${PORT}                  ║
║  ScrapingBee: ${SCRAPINGBEE_API_KEY ? '✓ Connected' : '✗ Missing'}         ║
║  Focus: Name + Image + Dimensions      ║
║  Price: Attempt + Manual Fallback     ║
╚════════════════════════════════════════╝
  `);
});
