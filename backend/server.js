// Enhanced backend with multiple scraping services
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

// Multiple scraping service API keys
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;
const BRIGHTDATA_API_KEY = process.env.BRIGHTDATA_API_KEY; // Optional: More powerful
const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY; // Optional: Good for Amazon
const SCRAPFLY_KEY = process.env.SCRAPFLY_KEY; // Optional: Great success rates

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

    console.log(`Processing ${urls.length} product URLs:`, urls);
    let products = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        console.log(`\n========== Processing URL ${i + 1} ==========`);
        console.log(`URL: ${url}`);
        
        const productData = await scrapeProductURL(url, i + 1);
        products.push(productData);
        
        console.log(`✓ Successfully scraped: ${productData.name} - $${productData.price}`);
      } catch (error) {
        console.error(`✗ Failed to scrape URL:`, error.message);
        const fallbackData = createFallbackProduct(url, i + 1);
        products.push(fallbackData);
      }
    }

    res.json({ 
      success: true, 
      products: products,
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

async function scrapeProductURL(url, productId) {
  let html = null;
  let method = null;
  
  // Try multiple scraping methods in order of preference
  const scrapingMethods = [
    { name: 'ScraperAPI', fn: fetchWithScraperAPI },
    { name: 'ScrapingBee', fn: fetchWithScrapingBee },
    { name: 'ScrapFly', fn: fetchWithScrapFly },
    { name: 'Direct', fn: fetchDirect }
  ];
  
  for (const scraper of scrapingMethods) {
    if (!shouldUseScraper(scraper.name)) continue;
    
    try {
      console.log(`Attempting ${scraper.name}...`);
      html = await scraper.fn(url);
      
      if (html && html.length > 1000) {
        method = scraper.name;
        console.log(`✓ ${scraper.name} succeeded (${html.length} bytes)`);
        break;
      }
    } catch (error) {
      console.log(`✗ ${scraper.name} failed: ${error.message}`);
    }
  }
  
  if (!html || html.length < 1000) {
    console.log('All scraping methods failed, using fallback');
    return createFallbackProduct(url, productId);
  }
  
  // Parse the HTML
  const product = await parseProductHTML(html, url, productId);
  
  // Enhance with dimensions if not found
  if (!product.dimensions || !product.dimensions.length) {
    product.dimensions = await estimateProductDimensions(product.name, product.category);
  }
  
  // Calculate shipping based on dimensions
  product.shipping = calculateShipping(product.dimensions, product.weight);
  
  console.log(`Scraped via ${method}:`, {
    name: product.name.substring(0, 50),
    price: product.price,
    dimensions: product.dimensions
  });
  
  return product;
}

// Check if we should use a scraper based on available API keys
function shouldUseScraper(name) {
  switch(name) {
    case 'ScraperAPI': return !!process.env.SCRAPERAPI_KEY;
    case 'ScrapingBee': return !!process.env.SCRAPINGBEE_API_KEY;
    case 'ScrapFly': return !!process.env.SCRAPFLY_KEY;
    case 'Direct': return true;
    default: return false;
  }
}

// ScraperAPI - Excellent for Amazon
async function fetchWithScraperAPI(url) {
  if (!process.env.SCRAPERAPI_KEY) throw new Error('ScraperAPI key not configured');
  
  const params = new URLSearchParams({
    'api_key': process.env.SCRAPERAPI_KEY,
    'url': url,
    'render': 'true',
    'country_code': 'us'
  });
  
  // Special params for Amazon
  if (url.includes('amazon.com')) {
    params.set('autoparse', 'true'); // ScraperAPI's Amazon parser
  }
  
  const response = await fetch(`http://api.scraperapi.com?${params}`);
  
  if (!response.ok) {
    throw new Error(`ScraperAPI error: ${response.status}`);
  }
  
  const text = await response.text();
  
  // If Amazon autoparse is enabled, we get JSON
  if (url.includes('amazon.com') && text.startsWith('{')) {
    const data = JSON.parse(text);
    // Convert ScraperAPI's Amazon format to HTML-like format for our parser
    return convertAmazonAPIToHTML(data);
  }
  
  return text;
}

// Convert ScraperAPI Amazon data to our format
function convertAmazonAPIToHTML(data) {
  // Create a pseudo-HTML that our parser can understand
  return `
    <html>
      <span id="productTitle">${data.name || data.title || ''}</span>
      <span class="a-price-whole">${data.price || ''}</span>
      <img id="landingImage" src="${data.image || ''}" />
      <span class="selection">${data.variant || ''}</span>
      <script type="application/ld+json">
        ${JSON.stringify({
          '@type': 'Product',
          name: data.name,
          offers: { price: data.price },
          image: data.image
        })}
      </script>
    </html>
  `;
}

// Enhanced ScrapingBee with better settings
async function fetchWithScrapingBee(url) {
  if (!process.env.SCRAPINGBEE_API_KEY) throw new Error('ScrapingBee key not configured');
  
  const isAmazon = url.toLowerCase().includes('amazon.com');
  const isWayfair = url.toLowerCase().includes('wayfair.com');
  
  const params = new URLSearchParams({
    'api_key': process.env.SCRAPINGBEE_API_KEY,
    'url': url,
    'render_js': 'true',
    'premium_proxy': 'true',
    'country_code': 'us',
    'block_ads': 'true',
    'block_resources': 'false'
  });
  
  if (isAmazon) {
    params.set('wait', '5000');
    params.set('wait_for', '#productTitle');
    params.set('stealth_proxy', 'true'); // Use stealth mode for Amazon
  } else if (isWayfair) {
    params.set('wait', '4000');
    params.set('wait_for', 'h1');
  } else {
    params.set('wait', '3000');
  }
  
  const response = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache'
    }
  });
  
  if (!response.ok) {
    throw new Error(`ScrapingBee error: ${response.status}`);
  }
  
  return await response.text();
}

// ScrapFly - High success rate
async function fetchWithScrapFly(url) {
  if (!process.env.SCRAPFLY_KEY) throw new Error('ScrapFly key not configured');
  
  const params = new URLSearchParams({
    'key': process.env.SCRAPFLY_KEY,
    'url': url,
    'render_js': 'true',
    'asp': 'true', // Anti-bot bypass
    'country': 'us'
  });
  
  const response = await fetch(`https://api.scrapfly.io/scrape?${params}`);
  
  if (!response.ok) {
    throw new Error(`ScrapFly error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.result.content;
}

// Direct fetch as last resort
async function fetchDirect(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Direct fetch error: ${response.status}`);
  }
  
  return await response.text();
}

// Enhanced HTML parser with better patterns
async function parseProductHTML(html, url, productId) {
  const retailer = getRetailerName(url);
  let productData = {
    id: productId,
    url: url,
    retailer: retailer,
    name: null,
    price: null,
    image: null,
    variant: null,
    dimensions: null,
    weight: null,
    quantity: 1
  };
  
  console.log(`Parsing ${retailer} HTML (${html.length} bytes)...`);
  
  // Try multiple parsing strategies
  const parsers = [
    extractStructuredData,
    extractOpenGraphData,
    extractMicrodata,
    getRetailerSpecificParser(retailer),
    parseGenericHTML
  ];
  
  for (const parser of parsers) {
    if (!parser) continue;
    
    try {
      const data = parser(html);
      if (data) {
        // Merge found data
        productData.name = productData.name || data.name;
        productData.price = productData.price || data.price;
        productData.image = productData.image || data.image;
        productData.variant = productData.variant || data.variant;
        productData.dimensions = productData.dimensions || data.dimensions;
        productData.weight = productData.weight || data.weight;
        
        // If we have name and price, we're good
        if (productData.name && productData.price) {
          console.log(`✓ Parser succeeded: ${parser.name}`);
          break;
        }
      }
    } catch (error) {
      console.log(`Parser ${parser.name} error:`, error.message);
    }
  }
  
  // Clean and validate
  productData.name = cleanProductName(productData.name) || 'Unknown Product';
  productData.price = parseFloat(productData.price) || 0;
  productData.category = determineCategory(productData.name);
  
  // Ensure we have dimensions and weight
  if (!productData.dimensions) {
    productData.dimensions = await estimateProductDimensions(productData.name, productData.category);
  }
  if (!productData.weight) {
    productData.weight = estimateWeight(productData.name, productData.category);
  }
  
  // Add placeholder image if needed
  if (!productData.image) {
    productData.image = `https://via.placeholder.com/150x150/7BC043/FFFFFF?text=${encodeURIComponent(retailer.charAt(0))}`;
  }
  
  return productData;
}

// Get retailer-specific parser
function getRetailerSpecificParser(retailer) {
  const parsers = {
    'Amazon': parseAmazonHTML,
    'Wayfair': parseWayfairHTML,
    'Walmart': parseWalmartHTML,
    'Target': parseTargetHTML,
    'Home Depot': parseHomeDepotHTML,
    'IKEA': parseIKEAHTML,
    'Best Buy': parseBestBuyHTML
  };
  
  return parsers[retailer];
}

// Enhanced Amazon parser
function parseAmazonHTML(html) {
  const result = { name: null, price: null, image: null, variant: null, dimensions: null, weight: null };
  
  // Multiple strategies for Amazon
  const strategies = [
    // Strategy 1: Standard selectors
    () => {
      const title = html.match(/<span[^>]*id="productTitle"[^>]*>([^<]+)/i);
      const price = html.match(/class="a-price-whole">([0-9,]+)/);
      const image = html.match(/id="landingImage"[^>]*src="([^"]+)"/);
      
      return {
        name: title?.[1]?.trim(),
        price: price ? parseFloat(price[1].replace(/,/g, '')) : null,
        image: image?.[1]
      };
    },
    
    // Strategy 2: Alternative price locations
    () => {
      const priceSpan = html.match(/<span[^>]*class="a-price[^"]*"[^>]*>.*?\$([0-9,]+\.?\d*)/s);
      const buyBox = html.match(/id="priceblock_dealprice">.*?\$([0-9,]+\.?\d*)/s);
      
      return {
        price: priceSpan ? parseFloat(priceSpan[1].replace(/,/g, '')) : 
               buyBox ? parseFloat(buyBox[1].replace(/,/g, '')) : null
      };
    },
    
    // Strategy 3: Dimensions from details
    () => {
      const dimensions = html.match(/Product Dimensions[^<]*<[^>]*>([^<]+)/i);
      const weight = html.match(/Item Weight[^<]*<[^>]*>([0-9.]+)\s*(pound|lb|ounce|oz)/i);
      
      let dims = null;
      if (dimensions) {
        const matches = dimensions[1].match(/([0-9.]+)\s*x\s*([0-9.]+)\s*x\s*([0-9.]+)/);
        if (matches) {
          dims = {
            length: parseFloat(matches[1]),
            width: parseFloat(matches[2]),
            height: parseFloat(matches[3])
          };
        }
      }
      
      let wt = null;
      if (weight) {
        wt = parseFloat(weight[1]);
        if (weight[2].toLowerCase().includes('oz')) {
          wt = wt / 16; // Convert ounces to pounds
        }
      }
      
      return { dimensions: dims, weight: wt };
    }
  ];
  
  // Try all strategies and merge results
  for (const strategy of strategies) {
    try {
      const data = strategy();
      Object.assign(result, data);
    } catch (e) {
      // Continue to next strategy
    }
  }
  
  return result;
}

// Enhanced Wayfair parser
function parseWayfairHTML(html) {
  const result = { name: null, price: null, image: null, dimensions: null, weight: null };
  
  // Wayfair uses React, so we need multiple strategies
  const strategies = [
    // JSON-LD data
    () => {
      const jsonLd = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([^<]+)/);
      if (jsonLd) {
        const data = JSON.parse(jsonLd[1]);
        return {
          name: data.name,
          price: data.offers?.price,
          image: data.image
        };
      }
    },
    
    // Standard HTML
    () => {
      const title = html.match(/<h1[^>]*>([^<]+)/);
      const price = html.match(/\$([0-9,]+\.?\d*)/);
      const image = html.match(/class="[^"]*ProductImage[^"]*"[^>]*src="([^"]+)"/);
      
      return {
        name: title?.[1]?.trim(),
        price: price ? parseFloat(price[1].replace(/,/g, '')) : null,
        image: image?.[1]
      };
    },
    
    // Dimensions from specifications
    () => {
      const overall = html.match(/Overall[^:]*:\s*([0-9.]+)"?\s*[HLW]\s*x\s*([0-9.]+)"?\s*[HLW]\s*x\s*([0-9.]+)"?\s*[HLW]/i);
      const weight = html.match(/Weight[^:]*:\s*([0-9.]+)\s*(lb|pound)/i);
      
      let dims = null;
      if (overall) {
        dims = {
          length: Math.max(parseFloat(overall[1]), parseFloat(overall[2]), parseFloat(overall[3])),
          width: parseFloat(overall[2]),
          height: Math.min(parseFloat(overall[1]), parseFloat(overall[2]), parseFloat(overall[3]))
        };
      }
      
      return {
        dimensions: dims,
        weight: weight ? parseFloat(weight[1]) : null
      };
    }
  ];
  
  for (const strategy of strategies) {
    try {
      const data = strategy();
      if (data) Object.assign(result, data);
    } catch (e) {
      // Continue
    }
  }
  
  return result;
}

// Calculate shipping based on dimensions
function calculateShipping(dimensions, weight) {
  // Container: $6000, 75% full typically
  // Standard 20ft container: 1,172 cubic feet usable (75% of 1,563)
  const CONTAINER_COST = 6000;
  const USABLE_CUBIC_FEET = 1172;
  const COST_PER_CUBIC_FOOT = CONTAINER_COST / USABLE_CUBIC_FEET; // ~$5.12 per cubic foot
  
  if (!dimensions || !dimensions.length) {
    // Estimate based on weight if no dimensions
    const estimatedCubicFeet = weight ? weight / 30 : 1; // Rough density estimate
    return estimatedCubicFeet * COST_PER_CUBIC_FOOT;
  }
  
  // Calculate cubic feet
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728; // 1728 cubic inches in a cubic foot
  
  // Minimum charge for small items
  const minimumCubicFeet = 0.5;
  const chargeableCubicFeet = Math.max(cubicFeet, minimumCubicFeet);
  
  // Calculate shipping cost
  let shippingCost = chargeableCubicFeet * COST_PER_CUBIC_FOOT;
  
  // Add handling fee based on weight
  if (weight > 150) {
    shippingCost += 50; // Heavy item handling
  } else if (weight > 70) {
    shippingCost += 25; // Medium weight handling
  }
  
  return Math.round(shippingCost * 100) / 100; // Round to 2 decimals
}

// Enhanced dimension estimation
async function estimateProductDimensions(productName, category) {
  const name = productName.toLowerCase();
  
  // Detailed dimension database
  const dimensionDatabase = {
    // Furniture
    'sofa': { length: 84, width: 36, height: 36 },
    'sectional': { length: 120, width: 84, height: 36 },
    'loveseat': { length: 60, width: 36, height: 36 },
    'chair': { length: 32, width: 32, height: 40 },
    'recliner': { length: 36, width: 38, height: 42 },
    'ottoman': { length: 24, width: 18, height: 18 },
    'coffee table': { length: 48, width: 24, height: 18 },
    'dining table': { length: 72, width: 36, height: 30 },
    'desk': { length: 60, width: 30, height: 30 },
    'bookshelf': { length: 36, width: 12, height: 72 },
    'dresser': { length: 60, width: 18, height: 36 },
    'nightstand': { length: 24, width: 18, height: 24 },
    'bed frame king': { length: 80, width: 76, height: 14 },
    'bed frame queen': { length: 80, width: 60, height: 14 },
    'mattress king': { length: 80, width: 76, height: 12 },
    'mattress queen': { length: 80, width: 60, height: 12 },
    
    // Electronics
    'tv 65': { length: 57, width: 3, height: 33 },
    'tv 55': { length: 49, width: 3, height: 28 },
    'tv 50': { length: 44, width: 3, height: 25 },
    'tv 43': { length: 38, width: 3, height: 22 },
    'laptop': { length: 14, width: 10, height: 1 },
    'monitor': { length: 24, width: 8, height: 18 },
    'desktop': { length: 18, width: 8, height: 16 },
    'printer': { length: 16, width: 14, height: 8 },
    
    // Appliances
    'refrigerator': { length: 36, width: 36, height: 70 },
    'dishwasher': { length: 24, width: 24, height: 35 },
    'microwave': { length: 20, width: 16, height: 12 },
    'washer': { length: 27, width: 30, height: 38 },
    'dryer': { length: 27, width: 30, height: 38 },
    'oven range': { length: 30, width: 26, height: 36 },
    
    // Outdoor
    'grill': { length: 48, width: 24, height: 48 },
    'patio set': { length: 72, width: 72, height: 36 },
    'fire pit': { length: 36, width: 36, height: 24 },
    'umbrella': { length: 96, width: 10, height: 10 } // Packed dimensions
  };
  
  // Check for exact matches
  for (const [key, dimensions] of Object.entries(dimensionDatabase)) {
    if (name.includes(key)) {
      return dimensions;
    }
  }
  
  // Category defaults
  const categoryDefaults = {
    'Furniture': { length: 48, width: 30, height: 30 },
    'Electronics': { length: 24, width: 18, height: 12 },
    'Appliances': { length: 30, width: 30, height: 36 },
    'Clothing': { length: 16, width: 12, height: 4 },
    'Books': { length: 10, width: 8, height: 2 },
    'Toys': { length: 12, width: 12, height: 12 },
    'Sports': { length: 36, width: 12, height: 12 },
    'General': { length: 18, width: 14, height: 10 }
  };
  
  return categoryDefaults[category] || categoryDefaults['General'];
}

// Enhanced weight estimation
function estimateWeight(productName, category) {
  const name = productName.toLowerCase();
  
  // Weight database
  const weightDatabase = {
    // Furniture
    'sofa': 150,
    'sectional': 250,
    'loveseat': 100,
    'chair': 50,
    'recliner': 85,
    'ottoman': 25,
    'coffee table': 60,
    'dining table': 120,
    'desk': 100,
    'bookshelf': 80,
    'dresser': 150,
    'nightstand': 30,
    'bed frame': 75,
    'mattress king': 140,
    'mattress queen': 120,
    
    // Electronics  
    'tv 65': 55,
    'tv 55': 40,
    'tv 50': 35,
    'tv 43': 25,
    'laptop': 5,
    'monitor': 15,
    'desktop': 25,
    
    // Appliances
    'refrigerator': 300,
    'dishwasher': 125,
    'microwave': 35,
    'washer': 200,
    'dryer': 125,
    
    // Outdoor
    'grill': 100,
    'patio': 200,
    'fire pit': 60
  };
  
  for (const [key, weight] of Object.entries(weightDatabase)) {
    if (name.includes(key)) {
      return weight;
    }
  }
  
  // Category defaults
  const categoryWeights = {
    'Furniture': 75,
    'Electronics': 20,
    'Appliances': 100,
    'Clothing': 2,
    'Books': 2,
    'Toys': 5,
    'General': 10
  };
  
  return categoryWeights[category] || 10;
}

// ... (Include all the other parsing functions from before)

function getRetailerName(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  const retailers = {
    'amazon': 'Amazon',
    'wayfair': 'Wayfair',
    'target': 'Target',
    'walmart': 'Walmart',
    'ebay': 'eBay',
    'bestbuy': 'Best Buy',
    'homedepot': 'Home Depot',
    'lowes': 'Lowes',
    'ikea': 'IKEA',
    'costco': 'Costco',
    'overstock': 'Overstock',
    'ashleyfurniture': 'Ashley Furniture',
    'crateandbarrel': 'Crate & Barrel',
    'potterybarn': 'Pottery Barn',
    'westelm': 'West Elm',
    'article': 'Article',
    'allmodern': 'AllModern'
  };
  
  for (const [key, name] of Object.entries(retailers)) {
    if (hostname.includes(key)) return name;
  }
  
  return 'Online Store';
}

function determineCategory(productName) {
  const name = productName.toLowerCase();
  
  const categories = {
    'Furniture': ['sofa', 'chair', 'table', 'desk', 'bed', 'dresser', 'cabinet', 'shelf', 'ottoman', 'bench'],
    'Electronics': ['tv', 'television', 'laptop', 'computer', 'tablet', 'phone', 'monitor', 'speaker', 'headphone'],
    'Appliances': ['refrigerator', 'fridge', 'washer', 'dryer', 'dishwasher', 'microwave', 'oven', 'range', 'freezer'],
    'Outdoor': ['patio', 'grill', 'umbrella', 'hammock', 'fire pit', 'outdoor'],
    'Clothing': ['shirt', 'pants', 'dress', 'jacket', 'shoe', 'coat', 'jeans'],
    'Sports': ['bike', 'bicycle', 'treadmill', 'weights', 'fitness', 'exercise'],
    'Books': ['book', 'novel', 'textbook', 'magazine'],
    'Toys': ['toy', 'game', 'puzzle', 'lego', 'doll']
  };
  
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => name.includes(keyword))) {
      return category;
    }
  }
  
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
  const category = 'General';
  const dimensions = { length: 18, width: 14, height: 10 };
  const weight = 10;
  
  return {
    id: productId,
    url: url,
    retailer: retailer,
    name: 'Product (Details Unavailable)',
    price: 99.99,
    image: `https://via.placeholder.com/150x150/7BC043/FFFFFF?text=${encodeURIComponent(retailer.charAt(0))}`,
    dimensions: dimensions,
    weight: weight,
    quantity: 1,
    category: category,
    shipping: calculateShipping(dimensions, weight),
    scraped_at: new Date().toISOString(),
    fallback: true
  };
}

// ... (Include remaining parsing functions)

app.listen(PORT, () => {
  console.log(`Bermuda Import Calculator running on port ${PORT}`);
  console.log('Configured scrapers:');
  if (process.env.SCRAPINGBEE_API_KEY) console.log('  ✓ ScrapingBee');
  if (process.env.SCRAPERAPI_KEY) console.log('  ✓ ScraperAPI');
  if (process.env.SCRAPFLY_KEY) console.log('  ✓ ScrapFly');
});
