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
        
        if (productData.needsManualPrice) {
          console.log(`⚠ Manual price entry needed for: ${productData.name}`);
        }
        if (productData.dimensionsEstimated) {
          console.log(`📦 Using estimated dimensions (${productData.dimensionSource})`);
        }
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
    const html = await fetchWithScrapingBee(url);
    console.log(`  HTML received: ${html.length} bytes`);
    
    if (html.length < 5000) {
      console.log('  Warning: Short HTML response, might be blocked');
    }
    
    const product = await parseProductHTML(html, url, productId);
    
    // Enhanced dimension extraction
    if (!product.dimensions || !product.dimensions.length) {
      console.log('  📦 No exact dimensions found, searching for alternatives...');
      product.dimensions = await findBestDimensions(html, product.name, product.category);
      product.dimensionsEstimated = true;
      product.dimensionSource = product.dimensions.source || 'category estimate';
    } else {
      product.dimensionsEstimated = false;
      product.dimensionSource = 'exact product specs';
    }
    
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
  
  const params = new URLSearchParams({
    'api_key': SCRAPINGBEE_API_KEY,
    'url': url,
    'render_js': 'true',
    'premium_proxy': 'true',
    'country_code': 'us',
    'block_ads': 'true',
    'stealth_proxy': 'true'
  });
  
  const retailerSettings = {
    'Amazon': { wait: '7000', wait_for: 'span#productTitle' },
    'Wayfair': { wait: '5000', wait_for: 'h1' },
    'Walmart': { wait: '4000', wait_for: '[itemprop="name"]' },
    'Target': { wait: '4000', wait_for: '[data-test="product-title"]' },
    'Home Depot': { wait: '3000', wait_for: 'h1' },
    'Best Buy': { wait: '4000', wait_for: '.sku-title' },
    'IKEA': { wait: '4000', wait_for: '.pip-header-section' },
    'Costco': { wait: '4000', wait_for: 'h1' },
    'eBay': { wait: '3000', wait_for: 'h1' },
    'Crate & Barrel': { wait: '4000', wait_for: 'h1' },
    'Lowes': { wait: '3000', wait_for: 'h1' },
    'Overstock': { wait: '3000', wait_for: 'h1' },
    'Pottery Barn': { wait: '4000', wait_for: 'h1' },
    'Ashley Furniture': { wait: '4000', wait_for: 'h1' }
  };
  
  const settings = retailerSettings[retailer] || { wait: '3000' };
  Object.entries(settings).forEach(([key, value]) => {
    params.set(key, value);
  });
  
  if (retailer === 'Amazon') {
    params.set('js_scenario', JSON.stringify({
      instructions: [
        { wait: 2000 },
        { scroll: { x: 0, y: 500 } },
        { wait: 2000 },
        { wait_for: 'span#productTitle' },
        { wait: 3000 }
      ]
    }));
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
    quantity: 1,
    needsManualPrice: false,
    needsManualDimensions: false
  };
  
  console.log(`  Parsing ${retailer} content...`);
  
  // 1. Try JSON-LD structured data first
  const structuredData = extractJSONLD(html);
  if (structuredData) {
    console.log('  ✓ Found JSON-LD data');
    product.name = structuredData.name || product.name;
    product.price = structuredData.price || product.price;
    product.image = structuredData.image || product.image;
    product.dimensions = structuredData.dimensions || product.dimensions;
    product.weight = structuredData.weight || product.weight;
  }
  
  // 2. Try Open Graph meta tags
  const ogData = extractOpenGraph(html);
  if (ogData.title || ogData.price) {
    console.log('  ✓ Found Open Graph data');
    product.name = product.name || ogData.title;
    product.price = product.price || ogData.price;
    product.image = product.image || ogData.image;
  }
  
  // 3. Retailer-specific parsing
  const parserMap = {
    'Amazon': parseAmazonHTML,
    'Wayfair': parseWayfairHTML,
    'Walmart': parseWalmartHTML,
    'Target': parseTargetHTML,
    'Home Depot': parseHomeDepotHTML,
    'Best Buy': parseBestBuyHTML,
    'IKEA': parseIKEAHTML,
    'Costco': parseCostcoHTML,
    'eBay': parseEbayHTML,
    'Lowes': parseLowesHTML,
    'Overstock': parseOverstockHTML,
    'Crate & Barrel': parseCrateBarrelHTML,
    'Pottery Barn': parsePotteryBarnHTML,
    'Ashley Furniture': parseAshleyHTML
  };
  
  const parser = parserMap[retailer];
  if (parser) {
    const retailerData = parser(html);
    console.log(`  ${retailer} parsing result:`, { 
      foundName: !!retailerData.name, 
      foundPrice: !!retailerData.price,
      foundDimensions: !!retailerData.dimensions
    });
    product.name = product.name || retailerData.name;
    product.price = product.price || retailerData.price;
    product.image = product.image || retailerData.image;
    product.variant = retailerData.variant || product.variant;
    product.dimensions = retailerData.dimensions || product.dimensions;
    product.weight = retailerData.weight || product.weight;
  }
  
  // 4. Try to extract dimensions from common patterns
  if (!product.dimensions) {
    product.dimensions = extractDimensionsFromHTML(html);
  }
  
  // 5. Generic fallback parsing
  if (!product.name || !product.price) {
    const genericData = parseGenericHTML(html);
    product.name = product.name || genericData.name;
    product.price = product.price || genericData.price;
    product.image = product.image || genericData.image;
  }
  
  // Clean up
  product.name = cleanProductName(product.name) || 'Unknown Product';
  product.price = parseFloat(product.price) || 0;
  product.category = determineCategory(product.name);
  
  // If no price found, flag for manual entry
  if (product.price === 0) {
    console.log('  ⚠ No price found - will need manual entry');
    product.needsManualPrice = true;
  }
  
  // If no dimensions found, flag for manual entry or estimation
  if (!product.dimensions || !product.dimensions.length) {
    console.log('  ⚠ No dimensions found - will estimate or need manual entry');
    product.needsManualDimensions = true;
  }
  
  // Set placeholder image if needed
  if (!product.image) {
    product.image = `https://via.placeholder.com/150x150/7BC043/FFFFFF?text=${encodeURIComponent(retailer.charAt(0))}`;
  }
  
  return product;
}

// Extract dimensions from HTML using multiple patterns
function extractDimensionsFromHTML(html) {
  console.log('  Looking for dimensions in HTML...');
  
  // Pattern 1: Product dimensions (L x W x H)
  const patterns = [
    // Standard format: 24" L x 18" W x 12" H
    /(\d+(?:\.\d+)?)["\s]*[LlWwHh]\s*x\s*(\d+(?:\.\d+)?)["\s]*[LlWwHh]\s*x\s*(\d+(?:\.\d+)?)["\s]*[LlWwHh]/i,
    // Format: 24 x 18 x 12 inches
    /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(?:inches|in|")/i,
    // Overall/Product Dimensions: 24" x 18" x 12"
    /(?:overall|product|assembled|package|box)\s*dimensions?[^:]*:\s*(\d+(?:\.\d+)?)["\s]*x\s*(\d+(?:\.\d+)?)["\s]*x\s*(\d+(?:\.\d+)?)/i,
    // Shipping dimensions
    /(?:shipping|package|box)\s*(?:dimensions?|size)[^:]*:\s*(\d+(?:\.\d+)?)["\s]*x\s*(\d+(?:\.\d+)?)["\s]*x\s*(\d+(?:\.\d+)?)/i,
    // Table format: Depth 24" Width 18" Height 12"
    /depth[^:]*:\s*(\d+(?:\.\d+)?)["\s]*.*?width[^:]*:\s*(\d+(?:\.\d+)?)["\s]*.*?height[^:]*:\s*(\d+(?:\.\d+)?)/is
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const dims = [
        parseFloat(match[1]),
        parseFloat(match[2]),
        parseFloat(match[3])
      ].sort((a, b) => b - a);
      
      console.log(`  ✓ Found dimensions: ${dims[0]}" x ${dims[1]}" x ${dims[2]}"`);
      
      return {
        length: dims[0],
        width: dims[1],
        height: dims[2],
        source: 'scraped from page'
      };
    }
  }
  
  // Pattern 2: Try to find individual measurements
  const lengthMatch = html.match(/(?:length|depth)[^:]*:\s*(\d+(?:\.\d+)?)\s*(?:inches|in|")/i);
  const widthMatch = html.match(/(?:width)[^:]*:\s*(\d+(?:\.\d+)?)\s*(?:inches|in|")/i);
  const heightMatch = html.match(/(?:height)[^:]*:\s*(\d+(?:\.\d+)?)\s*(?:inches|in|")/i);
  
  if (lengthMatch && widthMatch && heightMatch) {
    console.log(`  ✓ Found individual dimensions`);
    return {
      length: parseFloat(lengthMatch[1]),
      width: parseFloat(widthMatch[1]),
      height: parseFloat(heightMatch[1]),
      source: 'scraped individually'
    };
  }
  
  return null;
}

// Find best dimensions using multiple strategies
async function findBestDimensions(html, productName, category) {
  const name = productName.toLowerCase();
  
  // Strategy 1: Look for similar product dimensions in the same page
  console.log('  Strategy 1: Looking for related products...');
  const relatedMatch = html.match(/(?:similar|related|you may also like)[\s\S]{0,5000}(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/i);
  if (relatedMatch) {
    const dims = [
      parseFloat(relatedMatch[1]),
      parseFloat(relatedMatch[2]),
      parseFloat(relatedMatch[3])
    ].sort((a, b) => b - a);
    
    // Add 15% safety margin
    return {
      length: Math.ceil(dims[0] * 1.15),
      width: Math.ceil(dims[1] * 1.15),
      height: Math.ceil(dims[2] * 1.15),
      source: 'similar product + 15% margin',
      estimated: true
    };
  }
  
  // Strategy 2: Use detailed category database with product keywords
  console.log('  Strategy 2: Using category database...');
  const dimensions = getSmartDimensions(name, category);
  
  // Strategy 3: If furniture, check for seat/bed dimensions and extrapolate
  if (category === 'Furniture') {
    const seatDepth = html.match(/seat\s*depth[^:]*:\s*(\d+(?:\.\d+)?)/i);
    const seatWidth = html.match(/seat\s*width[^:]*:\s*(\d+(?:\.\d+)?)/i);
    
    if (seatDepth && seatWidth) {
      // Extrapolate full dimensions from seat dimensions
      return {
        length: Math.ceil(parseFloat(seatWidth[1]) * 1.2),
        width: Math.ceil(parseFloat(seatDepth[1]) * 1.3),
        height: 36, // Standard furniture height
        source: 'extrapolated from seat dimensions',
        estimated: true
      };
    }
  }
  
  return dimensions;
}

// Smart dimension database with product-specific estimates
function getSmartDimensions(productName, category) {
  const name = productName.toLowerCase();
  
  // Very specific product dimensions first
  const specificDimensions = {
    // Sofas by size
    'sectional': { length: 120, width: 84, height: 36 },
    '3-seat': { length: 84, width: 36, height: 36 },
    '2-seat': { length: 60, width: 36, height: 36 },
    'loveseat': { length: 60, width: 36, height: 36 },
    'sleeper sofa': { length: 84, width: 40, height: 36 },
    'futon': { length: 72, width: 36, height: 32 },
    
    // Chairs
    'recliner': { length: 36, width: 38, height: 42 },
    'accent chair': { length: 30, width: 30, height: 35 },
    'office chair': { length: 26, width: 26, height: 40 },
    'dining chair': { length: 20, width: 20, height: 38 },
    'bar stool': { length: 16, width: 16, height: 30 },
    
    // Tables
    'dining table': { length: 72, width: 36, height: 30 },
    'coffee table': { length: 48, width: 24, height: 18 },
    'end table': { length: 22, width: 22, height: 24 },
    'console table': { length: 48, width: 16, height: 30 },
    'desk': { length: 60, width: 30, height: 30 },
    
    // Bedroom
    'king bed': { length: 84, width: 80, height: 56 },
    'queen bed': { length: 84, width: 64, height: 56 },
    'full bed': { length: 79, width: 59, height: 56 },
    'twin bed': { length: 79, width: 42, height: 56 },
    'king mattress': { length: 80, width: 76, height: 12 },
    'queen mattress': { length: 80, width: 60, height: 12 },
    'dresser': { length: 60, width: 18, height: 36 },
    'nightstand': { length: 24, width: 18, height: 24 },
    
    // Electronics (including box)
    '65" tv': { length: 64, width: 6, height: 38 },
    '55" tv': { length: 54, width: 6, height: 33 },
    '50" tv': { length: 49, width: 6, height: 30 },
    '43" tv': { length: 42, width: 5, height: 26 },
    'laptop': { length: 16, width: 12, height: 3 },
    'desktop': { length: 20, width: 20, height: 24 },
    
    // Appliances (boxed)
    'refrigerator': { length: 38, width: 38, height: 72 },
    'dishwasher': { length: 26, width: 26, height: 37 },
    'microwave': { length: 24, width: 20, height: 16 },
    'washer': { length: 30, width: 32, height: 42 },
    'dryer': { length: 30, width: 32, height: 42 }
  };
  
  // Check for specific product types
  for (const [key, dims] of Object.entries(specificDimensions)) {
    if (name.includes(key)) {
      return {
        ...dims,
        source: `matched "${key}"`,
        estimated: true
      };
    }
  }
  
  // Check for size indicators and apply them
  let baseDims = getCategoryDefaults(category);
  
  if (name.includes('small') || name.includes('compact')) {
    baseDims = {
      length: Math.ceil(baseDims.length * 0.75),
      width: Math.ceil(baseDims.width * 0.75),
      height: Math.ceil(baseDims.height * 0.9)
    };
  } else if (name.includes('large') || name.includes('oversized')) {
    baseDims = {
      length: Math.ceil(baseDims.length * 1.25),
      width: Math.ceil(baseDims.width * 1.25),
      height: Math.ceil(baseDims.height * 1.1)
    };
  }
  
  return {
    ...baseDims,
    source: 'category estimate',
    estimated: true
  };
}

// Category defaults
function getCategoryDefaults(category) {
  const defaults = {
    'Furniture': { length: 48, width: 30, height: 30 },
    'Electronics': { length: 24, width: 18, height: 12 },
    'Appliances': { length: 30, width: 30, height: 36 },
    'Outdoor': { length: 48, width: 48, height: 36 },
    'Clothing': { length: 20, width: 16, height: 6 },
    'Toys': { length: 16, width: 12, height: 10 },
    'Sports': { length: 36, width: 12, height: 12 },
    'Books': { length: 12, width: 9, height: 3 },
    'General': { length: 18, width: 14, height: 10 }
  };
  
  return defaults[category] || defaults['General'];
}

// Estimate weight based on dimensions and category
function estimateWeight(productName, category) {
  const name = productName.toLowerCase();
  
  // Specific weights
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

// Calculate shipping based on actual dimensions
function calculateShipping(dimensions, weight) {
  const CONTAINER_COST = 6000;
  const USABLE_CUBIC_FEET = 1172; // 75% of 20ft container
  const COST_PER_CUBIC_FOOT = CONTAINER_COST / USABLE_CUBIC_FEET;
  
  if (!dimensions || !dimensions.length) {
    const estimatedCubicFeet = Math.max(1, weight / 30);
    return Math.round(estimatedCubicFeet * COST_PER_CUBIC_FOOT * 100) / 100;
  }
  
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Add margin if dimensions were estimated
  let chargeableCubicFeet = cubicFeet;
  if (dimensions.estimated) {
    chargeableCubicFeet = cubicFeet * 1.1; // 10% safety margin for estimated dimensions
  }
  
  // Minimum 0.5 cubic feet
  chargeableCubicFeet = Math.max(0.5, chargeableCubicFeet);
  
  let shipping = chargeableCubicFeet * COST_PER_CUBIC_FOOT;
  
  // Heavy item surcharge
  if (weight > 150) shipping += 50;
  else if (weight > 70) shipping += 25;
  
  return Math.round(shipping * 100) / 100;
}

// [Include all the retailer-specific parsers here - I'll continue with the enhanced Wayfair one as an example]

// Enhanced Wayfair parser with dimension extraction
function parseWayfairHTML(html) {
  const result = {};
  
  // Title
  const titleMatch = html.match(/<h1[^>]*>([^<]+)</i) ||
                    html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i);
  
  if (titleMatch) {
    let title = titleMatch[1].trim();
    title = title.replace(/\s*\|.*$/, '').replace(/\s*-\s*Wayfair.*$/, '');
    result.name = title;
  }
  
  // Price
  const priceMatches = html.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g) || [];
  for (const match of priceMatches) {
    const price = parseFloat(match.replace(/[$,]/g, ''));
    if (price > 100 && price < 2000) {
      result.price = price;
      break;
    }
  }
  
  // Dimensions - Wayfair usually has them in specifications
  const overallMatch = html.match(/Overall[^:]*:\s*(\d+(?:\.\d+)?)["\s]*[HWL]\s*x\s*(\d+(?:\.\d+)?)["\s]*[HWL]\s*x\s*(\d+(?:\.\d+)?)["\s]*[HWL]/i);
  if (overallMatch) {
    const nums = [
      parseFloat(overallMatch[1]),
      parseFloat(overallMatch[2]),
      parseFloat(overallMatch[3])
    ].sort((a, b) => b - a);
    
    result.dimensions = {
      length: nums[0],
      width: nums[1],
      height: nums[2],
      source: 'product specs'
    };
  }
  
  // Weight
  const weightMatch = html.match(/(?:Product\s+)?Weight[^:]*:\s*(\d+(?:\.\d+)?)\s*(?:lb|pound)/i);
  if (weightMatch) {
    result.weight = parseFloat(weightMatch[1]);
  }
  
  return result;
}

// [Include all other retailer parsers with similar dimension extraction...]

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
    'ebay': 'eBay',
    'overstock': 'Overstock',
    'crateandbarrel': 'Crate & Barrel',
    'potterybarn': 'Pottery Barn',
    'ashley': 'Ashley Furniture'
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
  const dimensions = { length: 24, width: 18, height: 12, estimated: true, source: 'fallback' };
  const weight = 20;
  
  return {
    id: productId,
    url: url,
    retailer: retailer,
    name: `Product from ${retailer}`,
    price: 0,
    image: `https://via.placeholder.com/150x150/7BC043/FFFFFF?text=${encodeURIComponent(retailer.charAt(0))}`,
    dimensions: dimensions,
    weight: weight,
    quantity: 1,
    category: 'General',
    shipping: calculateShipping(dimensions, weight),
    needsManualPrice: true,
    needsManualDimensions: true,
    scraped_at: new Date().toISOString()
  };
}

// [Include remaining parser functions...]

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  Bermuda Import Calculator             ║
║  Running on port ${PORT}                  ║
║  ScrapingBee: ${SCRAPINGBEE_API_KEY ? '✓ Connected' : '✗ Missing'}         ║
╚════════════════════════════════════════╝
  `);
});
