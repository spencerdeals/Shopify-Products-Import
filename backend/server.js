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

    console.log(`\n============ Processing ${urls.length} URLs ============`);
    let products = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`\n[${i + 1}/${urls.length}] Processing: ${url}`);
      
      try {
        const productData = await scrapeProductURL(url, i + 1);
        products.push(productData);
        console.log(`✓ Success: ${productData.name.substring(0, 50)}... - $${productData.price}`);
      } catch (error) {
        console.error(`✗ Failed:`, error.message);
        const fallbackData = createFallbackProduct(url, i + 1);
        products.push(fallbackData);
      }
    }

    console.log(`\n✓ Completed: ${products.length} products processed`);
    
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
  try {
    // Fetch HTML with ScrapingBee
    const html = await fetchWithScrapingBee(url);
    console.log(`  HTML received: ${html.length} bytes`);
    
    // Save a sample for debugging
    if (html.length < 5000) {
      console.log('  Warning: Short HTML response, might be blocked');
    }
    
    // Parse the HTML
    const product = await parseProductHTML(html, url, productId);
    
    // Calculate shipping based on dimensions
    product.shipping = calculateShipping(product.dimensions, product.weight);
    
    return product;
  } catch (error) {
    console.error('  Scraping failed:', error.message);
    throw error;
  }
}

async function fetchWithScrapingBee(url) {
  const retailer = getRetailerName(url);
  console.log(`  Using ScrapingBee for ${retailer}...`);
  
  // Build ScrapingBee parameters based on retailer
  const params = new URLSearchParams({
    'api_key': SCRAPINGBEE_API_KEY,
    'url': url,
    'render_js': 'true',
    'premium_proxy': 'true',
    'country_code': 'us',
    'block_ads': 'true',
    'stealth_proxy': 'true'  // Better for avoiding detection
  });
  
  // Retailer-specific settings
  if (retailer === 'Amazon') {
    params.set('wait', '7000');  // Longer wait for Amazon
    params.set('wait_for', 'span#productTitle');
    params.set('js_scenario', JSON.stringify({
      instructions: [
        { wait: 2000 },
        { scroll: { x: 0, y: 500 } },
        { wait: 2000 },
        { scroll: { x: 0, y: 0 } },
        { wait_for: 'span#productTitle' },
        { wait: 3000 }
      ]
    }));
  } else if (retailer === 'Wayfair') {
    params.set('wait', '5000');
    params.set('js_scenario', JSON.stringify({
      instructions: [
        { wait: 2000 },
        { wait_for: 'h1' },
        { wait: 2000 }
      ]
    }));
  } else {
    params.set('wait', '4000');
  }
  
  const scrapingBeeUrl = `${SCRAPINGBEE_URL}?${params}`;
  
  const response = await fetch(scrapingBeeUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('  ScrapingBee error response:', error.substring(0, 200));
    throw new Error(`ScrapingBee error: ${response.status}`);
  }

  return await response.text();
}

async function parseProductHTML(html, url, productId) {
  const retailer = getRetailerName(url);
  
  // Initialize product data
  let product = {
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
  
  console.log(`  Parsing ${retailer} content...`);
  
  // Try different parsing strategies in order
  
  // 1. Try JSON-LD structured data first (most reliable)
  const structuredData = extractJSONLD(html);
  if (structuredData) {
    console.log('  ✓ Found JSON-LD data');
    product.name = structuredData.name || product.name;
    product.price = structuredData.price || product.price;
    product.image = structuredData.image || product.image;
  }
  
  // 2. Try Open Graph meta tags
  const ogData = extractOpenGraph(html);
  if (ogData.title || ogData.price) {
    console.log('  ✓ Found Open Graph data');
    product.name = product.name || ogData.title;
    product.price = product.price || ogData.price;
    product.image = product.image || ogData.image;
  }
  
  // 3. Try retailer-specific parsing
  if (retailer === 'Amazon') {
    const amazonData = parseAmazonEnhanced(html);
    console.log('  Amazon parsing result:', { 
      foundName: !!amazonData.name, 
      foundPrice: !!amazonData.price 
    });
    product.name = product.name || amazonData.name;
    product.price = product.price || amazonData.price;
    product.image = product.image || amazonData.image;
    product.variant = amazonData.variant;
    product.dimensions = amazonData.dimensions;
    product.weight = amazonData.weight;
  } else if (retailer === 'Wayfair') {
    const wayfairData = parseWayfairEnhanced(html);
    console.log('  Wayfair parsing result:', { 
      foundName: !!wayfairData.name, 
      foundPrice: !!wayfairData.price 
    });
    product.name = product.name || wayfairData.name;
    product.price = product.price || wayfairData.price;
    product.image = product.image || wayfairData.image;
    product.dimensions = wayfairData.dimensions;
    product.weight = wayfairData.weight;
  } else {
    // Generic parsing for other sites
    const genericData = parseGenericEnhanced(html);
    product.name = product.name || genericData.name;
    product.price = product.price || genericData.price;
    product.image = product.image || genericData.image;
  }
  
  // Clean up and validate
  product.name = cleanProductName(product.name) || 'Product Details Unavailable';
  product.price = parseFloat(product.price) || 0;
  product.category = determineCategory(product.name);
  
  // If we still don't have critical data, try aggressive fallback
  if (!product.price || product.price === 0) {
    console.log('  ⚠ No price found, attempting aggressive search...');
    const allPrices = html.match(/\$[\d,]+\.?\d*/g) || [];
    const validPrices = allPrices
      .map(p => parseFloat(p.replace(/[$,]/g, '')))
      .filter(p => p > 10 && p < 10000)
      .sort((a, b) => b - a);
    
    if (validPrices.length > 0) {
      product.price = validPrices[0];
      console.log(`  Found fallback price: $${product.price}`);
    }
  }
  
  // Ensure dimensions and weight
  if (!product.dimensions) {
    product.dimensions = estimateProductDimensions(product.name, product.category);
  }
  if (!product.weight) {
    product.weight = estimateWeight(product.name, product.category);
  }
  
  // Set placeholder image if needed
  if (!product.image) {
    product.image = `https://via.placeholder.com/150x150/7BC043/FFFFFF?text=${encodeURIComponent(retailer.charAt(0))}`;
  }
  
  return product;
}

// Extract JSON-LD structured data
function extractJSONLD(html) {
  try {
    // Find all JSON-LD scripts
    const scripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    
    for (const script of scripts) {
      const match = script.match(/>([^<]+)</);
      if (!match) continue;
      
      try {
        const data = JSON.parse(match[1].trim());
        
        // Check if it's a Product type
        if (data['@type'] === 'Product' || data.type === 'Product') {
          return {
            name: data.name,
            price: data.offers?.price || data.offers?.[0]?.price,
            image: Array.isArray(data.image) ? data.image[0] : data.image
          };
        }
        
        // Check if it's an array with products
        if (Array.isArray(data)) {
          const product = data.find(item => item['@type'] === 'Product');
          if (product) {
            return {
              name: product.name,
              price: product.offers?.price,
              image: Array.isArray(product.image) ? product.image[0] : product.image
            };
          }
        }
      } catch (e) {
        // Invalid JSON, continue
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
  const priceMatch = html.match(/<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([^"']+)/i);
  const imageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i);
  
  if (titleMatch) og.title = titleMatch[1];
  if (priceMatch) og.price = parseFloat(priceMatch[1]);
  if (imageMatch) og.image = imageMatch[1];
  
  return og;
}

// Enhanced Amazon parser
function parseAmazonEnhanced(html) {
  const result = {};
  
  // Try multiple patterns for title
  const titlePatterns = [
    /<span[^>]*id=["']productTitle["'][^>]*>([^<]+)</i,
    /<h1[^>]*id=["']title["'][^>]*>([^<]+)</i,
    /<div[^>]*id=["']titleSection["'][^>]*>.*?<span[^>]*>([^<]+)</i,
    /<meta[^>]*name=["']title["'][^>]*content=["']([^"']+)/i
  ];
  
  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      result.name = match[1].trim();
      break;
    }
  }
  
  // Try multiple patterns for price
  const pricePatterns = [
    /<span[^>]*class=["'][^"']*a-price-whole["'][^>]*>[\s\$]*([0-9,]+)/i,
    /<span[^>]*class=["'][^"']*a-price["'][^>]*>.*?\$([0-9,]+\.?\d*)/is,
    /<span[^>]*class=["'][^"']*price["'][^>]*>.*?\$([0-9,]+\.?\d*)/is,
    /["']priceAmount["']:\s*["']([0-9.]+)/,
    /["']price["']:\s*["']\$?([0-9,]+\.?\d*)/,
    /<meta[^>]*itemprop=["']price["'][^>]*content=["']([0-9.]+)/i
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price > 0 && price < 100000) {
        result.price = price;
        break;
      }
    }
  }
  
  // Try to get image
  const imagePatterns = [
    /<img[^>]*id=["']landingImage["'][^>]*src=["']([^"']+)/i,
    /<img[^>]*data-old-hires=["']([^"']+)/i,
    /<div[^>]*class=["'][^"']*imgTagWrapper["'][^>]*>.*?<img[^>]*src=["']([^"']+)/i
  ];
  
  for (const pattern of imagePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      result.image = match[1];
      break;
    }
  }
  
  // Try to get dimensions
  const dimPattern = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*inches/i;
  const dimMatch = html.match(dimPattern);
  if (dimMatch) {
    result.dimensions = {
      length: parseFloat(dimMatch[1]),
      width: parseFloat(dimMatch[2]),
      height: parseFloat(dimMatch[3])
    };
  }
  
  // Try to get weight
  const weightPattern = /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i;
  const weightMatch = html.match(weightPattern);
  if (weightMatch) {
    result.weight = parseFloat(weightMatch[1]);
  }
  
  return result;
}

// Enhanced Wayfair parser
function parseWayfairEnhanced(html) {
  const result = {};
  
  // Title patterns
  const titlePatterns = [
    /<h1[^>]*>([^<]+)</i,
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i,
    /<title>([^<]+)</i
  ];
  
  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      let title = match[1].trim();
      // Clean Wayfair title
      title = title.replace(/\s*\|.*$/, '').replace(/\s*-\s*Wayfair.*$/, '');
      if (title && title.length > 5) {
        result.name = title;
        break;
      }
    }
  }
  
  // Price patterns - Wayfair specific
  const pricePatterns = [
    /\$([0-9,]+(?:\.\d{2})?)/,
    /<span[^>]*class=["'][^"']*Price["'][^>]*>\$?([0-9,]+(?:\.\d{2})?)/i,
    /["']price["']:\s*["']?([0-9,]+(?:\.\d{2})?)/,
    /<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([^"']+)/i
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price > 10 && price < 100000) {
        result.price = price;
        break;
      }
    }
  }
  
  // Dimensions - Wayfair often lists them
  const overallDim = html.match(/Overall[^:]*:\s*(\d+(?:\.\d+)?)["\s]*[HWL]\s*x\s*(\d+(?:\.\d+)?)["\s]*[HWL]\s*x\s*(\d+(?:\.\d+)?)["\s]*[HWL]/i);
  if (overallDim) {
    const nums = [parseFloat(overallDim[1]), parseFloat(overallDim[2]), parseFloat(overallDim[3])];
    nums.sort((a, b) => b - a);
    result.dimensions = {
      length: nums[0],
      width: nums[1],
      height: nums[2]
    };
  }
  
  // Weight
  const weightMatch = html.match(/Weight[^:]*:\s*(\d+(?:\.\d+)?)\s*(?:lb|pound)/i);
  if (weightMatch) {
    result.weight = parseFloat(weightMatch[1]);
  }
  
  return result;
}

// Generic enhanced parser
function parseGenericEnhanced(html) {
  const result = {};
  
  // Get title from multiple sources
  const titleMatch = html.match(/<h1[^>]*>([^<]{5,200})</i) ||
                    html.match(/<title>([^<]{5,100})</i) ||
                    html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i);
  
  if (titleMatch) {
    result.name = titleMatch[1].trim();
  }
  
  // Find prices
  const priceMatches = html.match(/\$[\d,]+\.?\d*/g) || [];
  const prices = priceMatches
    .map(p => parseFloat(p.replace(/[$,]/g, '')))
    .filter(p => p > 10 && p < 100000);
  
  if (prices.length > 0) {
    // Use the most common price or the first one
    result.price = prices[0];
  }
  
  return result;
}

// Calculate shipping based on container pricing
function calculateShipping(dimensions, weight) {
  // $6000 container, 75% usable = 1172 cubic feet
  const CONTAINER_COST = 6000;
  const USABLE_CUBIC_FEET = 1172;
  const COST_PER_CUBIC_FOOT = CONTAINER_COST / USABLE_CUBIC_FEET; // ~$5.12
  
  if (!dimensions) {
    // Estimate based on weight
    const estimatedCubicFeet = Math.max(1, weight / 30);
    return Math.round(estimatedCubicFeet * COST_PER_CUBIC_FOOT * 100) / 100;
  }
  
  // Calculate actual cubic feet
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Minimum 0.5 cubic feet
  const chargeableCubicFeet = Math.max(0.5, cubicFeet);
  
  // Base shipping cost
  let shipping = chargeableCubicFeet * COST_PER_CUBIC_FOOT;
  
  // Add handling fees for heavy items
  if (weight > 150) shipping += 50;
  else if (weight > 70) shipping += 25;
  
  return Math.round(shipping * 100) / 100;
}

// Detailed dimension estimates
function estimateProductDimensions(productName, category) {
  const name = productName.toLowerCase();
  
  // Check specific product types
  const dimensions = {
    // Living Room
    'sectional': { length: 120, width: 84, height: 36 },
    'sofa': { length: 84, width: 36, height: 36 },
    'loveseat': { length: 60, width: 36, height: 36 },
    'chair': { length: 32, width: 32, height: 40 },
    'recliner': { length: 36, width: 38, height: 42 },
    'ottoman': { length: 24, width: 18, height: 18 },
    'coffee table': { length: 48, width: 24, height: 18 },
    'end table': { length: 22, width: 22, height: 24 },
    'console table': { length: 48, width: 16, height: 30 },
    
    // Bedroom
    'king bed': { length: 80, width: 76, height: 36 },
    'queen bed': { length: 80, width: 60, height: 36 },
    'full bed': { length: 75, width: 54, height: 36 },
    'twin bed': { length: 75, width: 39, height: 36 },
    'dresser': { length: 60, width: 18, height: 36 },
    'nightstand': { length: 24, width: 18, height: 24 },
    'wardrobe': { length: 48, width: 24, height: 72 },
    
    // Dining
    'dining table': { length: 72, width: 36, height: 30 },
    'dining chair': { length: 20, width: 20, height: 38 },
    'bar stool': { length: 16, width: 16, height: 30 },
    'buffet': { length: 60, width: 18, height: 36 },
    
    // Office
    'desk': { length: 60, width: 30, height: 30 },
    'office chair': { length: 26, width: 26, height: 40 },
    'bookshelf': { length: 36, width: 12, height: 72 },
    'filing cabinet': { length: 18, width: 24, height: 52 },
    
    // Electronics
    'tv': { length: 50, width: 3, height: 28 },
    'television': { length: 50, width: 3, height: 28 },
    'laptop': { length: 14, width: 10, height: 1 },
    'monitor': { length: 24, width: 8, height: 18 },
    'printer': { length: 16, width: 14, height: 8 },
    
    // Appliances
    'refrigerator': { length: 36, width: 36, height: 70 },
    'washer': { length: 27, width: 30, height: 38 },
    'dryer': { length: 27, width: 30, height: 38 },
    'dishwasher': { length: 24, width: 24, height: 35 },
    'microwave': { length: 20, width: 16, height: 12 },
    'range': { length: 30, width: 26, height: 36 },
    
    // Outdoor
    'patio set': { length: 72, width: 72, height: 36 },
    'grill': { length: 48, width: 24, height: 48 },
    'fire pit': { length: 36, width: 36, height: 24 },
    'outdoor sofa': { length: 72, width: 32, height: 32 },
    'outdoor chair': { length: 28, width: 28, height: 36 }
  };
  
  // Check each dimension keyword
  for (const [key, dims] of Object.entries(dimensions)) {
    if (name.includes(key)) {
      return dims;
    }
  }
  
  // Category defaults
  const categoryDefaults = {
    'Furniture': { length: 48, width: 30, height: 30 },
    'Electronics': { length: 24, width: 18, height: 12 },
    'Appliances': { length: 30, width: 30, height: 36 },
    'Outdoor': { length: 48, width: 48, height: 36 },
    'General': { length: 18, width: 14, height: 10 }
  };
  
  return categoryDefaults[category] || categoryDefaults['General'];
}

// Weight estimates
function estimateWeight(productName, category) {
  const name = productName.toLowerCase();
  
  const weights = {
    'sectional': 250,
    'sofa': 150,
    'loveseat': 100,
    'chair': 50,
    'recliner': 85,
    'ottoman': 25,
    'coffee table': 60,
    'dining table': 120,
    'desk': 100,
    'dresser': 150,
    'bed': 100,
    'mattress': 80,
    'tv': 35,
    'refrigerator': 300,
    'washer': 200,
    'dryer': 125,
    'grill': 100
  };
  
  for (const [key, weight] of Object.entries(weights)) {
    if (name.includes(key)) {
      return weight;
    }
  }
  
  const categoryWeights = {
    'Furniture': 75,
    'Electronics': 20,
    'Appliances': 100,
    'Outdoor': 80,
    'General': 15
  };
  
  return categoryWeights[category] || 15;
}

function getRetailerName(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  
  if (hostname.includes('amazon')) return 'Amazon';
  if (hostname.includes('wayfair')) return 'Wayfair';
  if (hostname.includes('target')) return 'Target';
  if (hostname.includes('walmart')) return 'Walmart';
  if (hostname.includes('homedepot')) return 'Home Depot';
  if (hostname.includes('lowes')) return 'Lowes';
  if (hostname.includes('ikea')) return 'IKEA';
  if (hostname.includes('costco')) return 'Costco';
  if (hostname.includes('overstock')) return 'Overstock';
  if (hostname.includes('ashleyfurniture')) return 'Ashley Furniture';
  if (hostname.includes('crateandbarrel')) return 'Crate & Barrel';
  if (hostname.includes('potterybarn')) return 'Pottery Barn';
  if (hostname.includes('westelm')) return 'West Elm';
  if (hostname.includes('bestbuy')) return 'Best Buy';
  if (hostname.includes('ebay')) return 'eBay';
  
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
  const dimensions = { length: 24, width: 18, height: 12 };
  const weight = 20;
  
  return {
    id: productId,
    url: url,
    retailer: retailer,
    name: `Product from ${retailer}`,
    price: 99.99,
    image: `https://via.placeholder.com/150x150/7BC043/FFFFFF?text=${encodeURIComponent(retailer.charAt(0))}`,
    dimensions: dimensions,
    weight: weight,
    quantity: 1,
    category: 'General',
    shipping: calculateShipping(dimensions, weight),
    scraped_at: new Date().toISOString(),
    fallback: true
  };
}

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  Bermuda Import Calculator             ║
║  Running on port ${PORT}                  ║
║  ScrapingBee: ${SCRAPINGBEE_API_KEY ? '✓ Connected' : '✗ Missing'}         ║
╚════════════════════════════════════════╝
  `);
});
