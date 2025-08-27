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

    console.log(`Processing ${urls.length} product URLs:`, urls);
    let products = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        console.log(`Processing product URL ${i + 1}: ${url}`);
        const productData = await scrapeProductURL(url, i + 1);
        products.push(productData);
      } catch (error) {
        console.error(`Error processing URL ${url}:`, error);
        const fallbackData = await createFallbackProduct(url, i + 1);
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
  try {
    const html = await fetchWithScrapingBee(url);
    console.log(`Received HTML for product ${productId}, length: ${html.length}`);
    
    if (html.length < 1000) {
      console.log('Minimal HTML received, using fallback');
      return await createFallbackProduct(url, productId);
    }

    return await parseProductHTML(html, url, productId);
  } catch (error) {
    console.error('Product scraping failed:', error);
    return await createFallbackProduct(url, productId);
  }
}

async function fetchWithScrapingBee(url) {
  const isAmazon = url.toLowerCase().includes('amazon.com');
  
  const scrapingBeeParams = new URLSearchParams({
    'api_key': SCRAPINGBEE_API_KEY,
    'url': url,
    'render_js': 'true',
    'premium_proxy': 'true',
    'country_code': 'us'
  });

  // Amazon needs special handling
  if (isAmazon) {
    scrapingBeeParams.set('wait', '5000');
    scrapingBeeParams.set('wait_for', '#productTitle');
    scrapingBeeParams.set('js_scenario', JSON.stringify({
      instructions: [
        { wait: 2000 },
        { wait_for: '#productTitle' },
        { wait: 1000 }
      ]
    }));
  } else {
    scrapingBeeParams.set('wait', '3000');
  }

  const scrapingBeeUrl = `${SCRAPINGBEE_URL}?${scrapingBeeParams}`;
  
  console.log(`Fetching ${isAmazon ? 'Amazon' : 'regular'} URL with ScrapingBee...`);
  const response = await fetch(scrapingBeeUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`ScrapingBee error: ${response.status}`);
  }

  return await response.text();
}

async function parseProductHTML(html, url, productId) {
  const retailer = getRetailerName(url);
  let productName = 'Product';
  let price = 0;
  let image = null;
  let variant = null;
  
  console.log(`Parsing HTML for ${retailer}...`);
  
  // First try: Check for structured data (works on most modern sites)
  const structuredData = extractStructuredData(html);
  if (structuredData) {
    productName = structuredData.name || productName;
    price = structuredData.price || price;
    image = structuredData.image || image;
    console.log('Found structured data:', { productName, price });
  }
  
  // Second try: Open Graph meta tags (widely used)
  if (!productName || !price) {
    const ogData = extractOpenGraphData(html);
    productName = productName === 'Product' ? (ogData.title || productName) : productName;
    price = price === 0 ? (ogData.price || price) : price;
    image = image || ogData.image;
    console.log('Found OG data:', { productName, price });
  }
  
  // Third try: Retailer-specific parsing
  if (retailer === 'Amazon') {
    const amazonData = parseAmazonHTML(html);
    productName = amazonData.name || productName;
    price = amazonData.price || price;
    image = amazonData.image || image;
    variant = amazonData.variant;
  } else if (retailer === 'Wayfair') {
    const wayfairData = parseWayfairHTML(html);
    productName = wayfairData.name || productName;
    price = wayfairData.price || price;
    image = wayfairData.image || image;
    variant = wayfairData.variant;
  } else if (retailer === 'Walmart') {
    const walmartData = parseWalmartHTML(html);
    productName = walmartData.name || productName;
    price = walmartData.price || price;
    image = walmartData.image || image;
  } else if (retailer === 'Target') {
    const targetData = parseTargetHTML(html);
    productName = targetData.name || productName;
    price = targetData.price || price;
    image = targetData.image || image;
  } else {
    // Generic fallback parsing
    const genericData = parseGenericHTML(html);
    productName = genericData.name || productName;
    price = genericData.price || price;
    image = genericData.image || image;
  }
  
  // Clean up product name
  productName = cleanProductName(productName);
  
  // Final validation
  if (price === 0) {
    console.log('No price found, using fallback');
    return await createFallbackProduct(url, productId);
  }
  
  return {
    id: productId,
    url: url,
    retailer: retailer,
    name: productName,
    price: price,
    image: image || `https://via.placeholder.com/150x150/7BC043/FFFFFF?text=${encodeURIComponent(retailer.charAt(0))}`,
    variant: variant,
    quantity: 1,
    category: determineCategory(productName),
    scraped_at: new Date().toISOString()
  };
}

// Extract JSON-LD structured data
function extractStructuredData(html) {
  try {
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      const data = JSON.parse(jsonLdMatch[1]);
      if (data['@type'] === 'Product' || data.type === 'Product') {
        return {
          name: data.name,
          price: data.offers?.price || data.price,
          image: data.image?.[0] || data.image
        };
      }
    }
  } catch (e) {
    console.log('No structured data found');
  }
  return null;
}

// Extract Open Graph meta tags
function extractOpenGraphData(html) {
  const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
  const ogPrice = html.match(/<meta[^>]*property="product:price:amount"[^>]*content="([^"]+)"/i);
  const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
  
  return {
    title: ogTitle?.[1],
    price: ogPrice ? parseFloat(ogPrice[1]) : null,
    image: ogImage?.[1]
  };
}

// Parse Amazon specifically
function parseAmazonHTML(html) {
  const result = { name: null, price: null, image: null, variant: null };
  
  // Product title
  const titlePatterns = [
    /<span[^>]*id="productTitle"[^>]*>([^<]+)<\/span>/i,
    /<h1[^>]*class="[^"]*product-title[^"]*"[^>]*>([^<]+)<\/h1>/i,
    /<h1[^>]*data-automation-id="title"[^>]*>([^<]+)<\/h1>/i
  ];
  
  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match) {
      result.name = match[1].trim();
      break;
    }
  }
  
  // Price patterns
  const pricePatterns = [
    /<span[^>]*class="a-price-whole"[^>]*>([0-9,]+)/,
    /<span[^>]*class="a-price-range"[^>]*>.*?\$([0-9,]+(?:\.[0-9]{2})?)/s,
    /<span[^>]*class="a-size-medium a-color-price"[^>]*>\$([0-9,]+(?:\.[0-9]{2})?)/,
    /data-asin-price="([0-9.]+)"/
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
  
  // Image
  const imagePatterns = [
    /<img[^>]*id="landingImage"[^>]*src="([^"]+)"/i,
    /<img[^>]*class="[^"]*a-dynamic-image[^"]*"[^>]*src="([^"]+)"/i,
    /data-old-hires="([^"]+\.jpg[^"]*)"/i
  ];
  
  for (const pattern of imagePatterns) {
    const match = html.match(pattern);
    if (match) {
      result.image = match[1];
      break;
    }
  }
  
  // Variant/color selection
  const variantMatch = html.match(/<span[^>]*class="selection"[^>]*>([^<]+)<\/span>/i);
  if (variantMatch) {
    result.variant = variantMatch[1].trim();
  }
  
  return result;
}

// Parse Wayfair specifically  
function parseWayfairHTML(html) {
  const result = { name: null, price: null, image: null, variant: null };
  
  // Wayfair patterns
  const nameMatch = html.match(/<h1[^>]*class="[^"]*ProductDetailInfoBlock[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
                    html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  
  const priceMatch = html.match(/<span[^>]*class="[^"]*SFPrice[^"]*"[^>]*>\$([0-9,]+(?:\.[0-9]{2})?)/i) ||
                     html.match(/\$([0-9,]+(?:\.[0-9]{2})?)/);
  
  const imageMatch = html.match(/<img[^>]*class="[^"]*ProductImage[^"]*"[^>]*src="([^"]+)"/i);
  
  if (nameMatch) result.name = nameMatch[1].trim();
  if (priceMatch) result.price = parseFloat(priceMatch[1].replace(/,/g, ''));
  if (imageMatch) result.image = imageMatch[1];
  
  return result;
}

// Parse Walmart specifically
function parseWalmartHTML(html) {
  const result = { name: null, price: null, image: null };
  
  const nameMatch = html.match(/<h1[^>]*itemprop="name"[^>]*>([^<]+)<\/h1>/i) ||
                    html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  
  const priceMatch = html.match(/\$([0-9,]+(?:\.[0-9]{2})?)/);
  
  if (nameMatch) result.name = nameMatch[1].trim();
  if (priceMatch) result.price = parseFloat(priceMatch[1].replace(/,/g, ''));
  
  return result;
}

// Parse Target specifically
function parseTargetHTML(html) {
  const result = { name: null, price: null, image: null };
  
  const nameMatch = html.match(/<h1[^>]*data-test="product-title"[^>]*>([^<]+)<\/h1>/i) ||
                    html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  
  const priceMatch = html.match(/\$([0-9,]+(?:\.[0-9]{2})?)/);
  
  if (nameMatch) result.name = nameMatch[1].trim();
  if (priceMatch) result.price = parseFloat(priceMatch[1].replace(/,/g, ''));
  
  return result;
}

// Generic HTML parsing as final fallback
function parseGenericHTML(html) {
  const result = { name: null, price: null, image: null };
  
  // Try multiple name patterns
  const namePatterns = [
    /<h1[^>]*>([^<]{10,200})<\/h1>/i,
    /<title>([^<]{10,100})<\/title>/i,
    /<meta[^>]*name="title"[^>]*content="([^"]+)"/i
  ];
  
  for (const pattern of namePatterns) {
    const match = html.match(pattern);
    if (match) {
      result.name = match[1].trim();
      break;
    }
  }
  
  // Find all prices and pick the most likely one
  const priceMatches = html.match(/\$([0-9,]+\.?[0-9]*)/g) || [];
  const prices = priceMatches
    .map(p => parseFloat(p.replace(/[$,]/g, '')))
    .filter(p => p > 10 && p < 50000)
    .sort((a, b) => b - a); // Sort high to low
  
  if (prices.length > 0) {
    result.price = prices[0];
  }
  
  // Try to find any product image
  const imageMatch = html.match(/<img[^>]*(?:class="[^"]*product[^"]*"|id="[^"]*product[^"]*")[^>]*src="([^"]+)"/i);
  if (imageMatch) {
    result.image = imageMatch[1];
  }
  
  return result;
}

// Clean product name
function cleanProductName(name) {
  if (!name) return 'Product';
  
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

async function createFallbackProduct(url, productId) {
  const retailer = getRetailerName(url);
  
  // Create realistic fallback data based on URL
  let fallbackName = 'Product Item';
  let fallbackPrice = 99.99;
  let fallbackCategory = 'General';
  
  if (url.includes('furniture') || url.includes('sofa') || url.includes('chair')) {
    fallbackName = 'Furniture Item';
    fallbackPrice = 299.99;
    fallbackCategory = 'Furniture';
  } else if (url.includes('electronic') || url.includes('laptop') || url.includes('phone')) {
    fallbackName = 'Electronics Item';
    fallbackPrice = 499.99;
    fallbackCategory = 'Electronics';
  }
  
  return {
    id: productId,
    url: url,
    retailer: retailer,
    name: fallbackName,
    price: fallbackPrice,
    image: `https://via.placeholder.com/150x150/7BC043/FFFFFF?text=${encodeURIComponent(retailer.charAt(0))}`,
    weight: estimateWeight(fallbackName),
    dimensions: estimateDimensions(fallbackName),
    quantity: 1,
    category: fallbackCategory,
    scraped_at: new Date().toISOString()
  };
}

function getRetailerName(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.includes('amazon')) return 'Amazon';
  if (hostname.includes('wayfair')) return 'Wayfair';
  if (hostname.includes('target')) return 'Target';
  if (hostname.includes('walmart')) return 'Walmart';
  if (hostname.includes('ebay')) return 'eBay';
  if (hostname.includes('bestbuy')) return 'Best Buy';
  if (hostname.includes('homedepot')) return 'Home Depot';
  if (hostname.includes('lowes')) return 'Lowes';
  if (hostname.includes('ikea')) return 'IKEA';
  if (hostname.includes('costco')) return 'Costco';
  return 'Online Store';
}

function determineCategory(productName) {
  const name = productName.toLowerCase();
  if (name.includes('sofa') || name.includes('chair') || name.includes('table') || name.includes('desk') || name.includes('bed')) return 'Furniture';
  if (name.includes('laptop') || name.includes('phone') || name.includes('tv') || name.includes('computer') || name.includes('tablet')) return 'Electronics';
  if (name.includes('shoe') || name.includes('shirt') || name.includes('pants') || name.includes('dress') || name.includes('jacket')) return 'Clothing';
  if (name.includes('book') || name.includes('novel') || name.includes('textbook')) return 'Books';
  if (name.includes('toy') || name.includes('game') || name.includes('puzzle')) return 'Toys';
  return 'General';
}

function estimateDimensions(productName) {
  const name = productName.toLowerCase();
  if (name.includes('sofa') || name.includes('sectional') || name.includes('couch')) {
    return { length: 84, width: 36, height: 36 };
  }
  if (name.includes('chair') || name.includes('recliner')) {
    return { length: 32, width: 32, height: 40 };
  }
  if (name.includes('table') && name.includes('dining')) {
    return { length: 60, width: 36, height: 30 };
  }
  if (name.includes('desk')) {
    return { length: 48, width: 24, height: 30 };
  }
  if (name.includes('tv') || name.includes('television')) {
    return { length: 48, width: 4, height: 28 };
  }
  return { length: 12, width: 12, height: 12 };
}

function estimateWeight(productName) {
  const name = productName.toLowerCase();
  if (name.includes('sofa') || name.includes('sectional') || name.includes('couch')) return 150;
  if (name.includes('chair') || name.includes('recliner')) return 50;
  if (name.includes('table')) return 75;
  if (name.includes('desk')) return 100;
  if (name.includes('tv') || name.includes('television')) return 35;
  if (name.includes('laptop')) return 5;
  if (name.includes('phone')) return 1;
  return 10;
}

app.listen(PORT, () => {
  console.log(`Bermuda Import Calculator running on port ${PORT}`);
});
