// ========== ADD THIS TO YOUR server.js ==========

// 1. ADD TO IMPORTS SECTION (at the top with other requires):
const { ApifyClient } = require('apify-client');

// 2. ADD TO CONFIGURATION SECTION (after SCRAPINGBEE_API_KEY):
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const USE_APIFY_FOR_AMAZON = !!APIFY_API_KEY;

// Initialize Apify client
const apifyClient = USE_APIFY_FOR_AMAZON ? new ApifyClient({ token: APIFY_API_KEY }) : null;

// 3. UPDATE YOUR CONSOLE.LOG SECTION:
console.log('=== SERVER STARTUP ===');
console.log(`Port: ${PORT}`);
console.log(`Shopify Domain: ${SHOPIFY_DOMAIN}`);
console.log(`ScrapingBee: ${USE_SCRAPINGBEE ? 'Enabled' : 'Disabled'}`);
console.log(`Apify (Amazon): ${USE_APIFY_FOR_AMAZON ? 'Enabled' : 'Disabled'}`);
console.log('=====================');

// 4. ADD THESE NEW FUNCTIONS (before the scrapeProduct function):

// Apify Amazon scraper function
async function scrapeAmazonWithApify(url) {
  if (!apifyClient) {
    throw new Error('Apify not configured');
  }

  try {
    console.log('🔄 Starting Apify Amazon scrape for:', url);
    
    // Using the junglee/Amazon-crawler actor
    const run = await apifyClient.actor('junglee/Amazon-crawler').call({
      categoryOrProductUrls: [
        { url: url, method: "GET" }
      ],
      maxItemsPerStartUrl: 1,
      scraperProductDetails: true,
      locationDelverableRoutes: [
        "PRODUCT",
        "SEARCH", 
        "OFFERS"
      ],
      maxOffersPerStartUrl: 0,
      useCaptchaSolver: false,
      proxyCountry: "AUTO_SELECT_PROXY_COUNTRY"
    });

    console.log('⏳ Apify run started, waiting for results...');

    // Wait for the run to finish (timeout after 60 seconds)
    await apifyClient.run(run.id).waitForFinish({ waitSecs: 60 });

    // Get the results
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    
    if (!items || items.length === 0) {
      console.log('❌ No results from Apify');
      throw new Error('No product data found');
    }

    const product = items[0];
    console.log('✅ Apify scrape successful');

    return parseApifyAmazonData(product);

  } catch (error) {
    console.error('❌ Apify Amazon scrape failed:', error.message);
    throw error;
  }
}

// Parse Apify Amazon data
function parseApifyAmazonData(data) {
  const result = {
    name: null,
    price: null,
    image: null,
    dimensions: null,
    weight: null,
    brand: null,
    category: null,
    inStock: true
  };

  // Product name
  result.name = data.title || data.name || 'Unknown Product';

  // Price extraction (handle various price fields)
  if (data.price) {
    if (typeof data.price === 'object') {
      result.price = data.price.value || data.price.amount || null;
    } else if (typeof data.price === 'string') {
      const priceMatch = data.price.match(/[\d,]+\.?\d*/);
      result.price = priceMatch ? parseFloat(priceMatch[0].replace(',', '')) : null;
    } else {
      result.price = parseFloat(data.price);
    }
  }

  // Fallback price from offer
  if (!result.price && data.offer?.price) {
    result.price = parseFloat(data.offer.price);
  }

  // Image
  result.image = data.mainImage || data.image || data.images?.[0] || null;

  // Brand
  result.brand = data.brand || data.manufacturer || null;

  // Category
  if (data.categories && Array.isArray(data.categories)) {
    result.category = data.categories[0];
  } else if (data.category) {
    result.category = data.category;
  }

  // Dimensions and Weight from specifications
  if (data.specifications) {
    result.dimensions = extractDimensionsFromApify(data.specifications);
    result.weight = extractWeightFromApify(data.specifications);
  }

  // Fallback weight extraction
  if (!result.weight) {
    if (data.weight) result.weight = parseWeightString(data.weight);
    else if (data.itemWeight) result.weight = parseWeightString(data.itemWeight);
    else if (data.shippingWeight) result.weight = parseWeightString(data.shippingWeight);
  }

  console.log('📦 Parsed Amazon product:', {
    name: result.name?.substring(0, 50) + '...',
    price: result.price,
    hasImage: !!result.image,
    hasDimensions: !!result.dimensions,
    weight: result.weight
  });

  return result;
}

// Extract dimensions from Apify specifications
function extractDimensionsFromApify(specs) {
  if (!specs) return null;

  const dimensionKeys = [
    'Product Dimensions',
    'Package Dimensions', 
    'Item Dimensions',
    'Dimensions',
    'Size'
  ];

  for (const key of dimensionKeys) {
    if (specs[key]) {
      const parsed = parseDimensionString(specs[key]);
      if (parsed) return parsed;
    }
  }

  return null;
}

// Extract weight from Apify specifications
function extractWeightFromApify(specs) {
  if (!specs) return null;

  const weightKeys = [
    'Item Weight',
    'Product Weight',
    'Package Weight',
    'Weight',
    'Shipping Weight'
  ];

  for (const key of weightKeys) {
    if (specs[key]) {
      const weight = parseWeightString(specs[key]);
      if (weight) return weight;
    }
  }

  return null;
}

// Parse dimension string helper
function parseDimensionString(str) {
  if (!str || typeof str !== 'string') return null;

  const patterns = [
    /(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*(?:inches|in|")?/i,
    /(\d+\.?\d*)"?\s*[WL]\s*[x×]\s*(\d+\.?\d*)"?\s*[DW]\s*[x×]\s*(\d+\.?\d*)"?\s*[HT]/i,
    /L:\s*(\d+\.?\d*).*W:\s*(\d+\.?\d*).*H:\s*(\d+\.?\d*)/i
  ];

  for (const pattern of patterns) {
    const match = str.match(pattern);
    if (match) {
      const length = parseFloat(match[1]);
      const width = parseFloat(match[2]);
      const height = parseFloat(match[3]);
      
      if (length > 0 && width > 0 && height > 0 && 
          length < 200 && width < 200 && height < 200) {
        return { length, width, height };
      }
    }
  }

  return null;
}

// Parse weight string helper
function parseWeightString(weightStr) {
  if (typeof weightStr === 'number') return weightStr;
  if (typeof weightStr !== 'string') return null;

  const patterns = [
    { regex: /(\d+\.?\d*)\s*(?:pounds?|lbs?)/i, multiplier: 1 },
    { regex: /(\d+\.?\d*)\s*(?:kilograms?|kgs?)/i, multiplier: 2.205 },
    { regex: /(\d+\.?\d*)\s*(?:grams?|g)/i, multiplier: 0.00220462 },
    { regex: /(\d+\.?\d*)\s*(?:ounces?|oz)/i, multiplier: 0.0625 }
  ];

  for (const { regex, multiplier } of patterns) {
    const match = weightStr.match(regex);
    if (match) {
      const weight = parseFloat(match[1]) * multiplier;
      if (weight > 0 && weight < 1000) {
        return Math.round(weight * 10) / 10;
      }
    }
  }

  return null;
}

// 5. MODIFY YOUR EXISTING scrapeProduct FUNCTION:
// Add this NEW CODE at the beginning of the scrapeProduct function, right after:
// const retailer = detectRetailer(url);

  // SPECIAL HANDLING FOR AMAZON - Try Apify first
  if (retailer === 'Amazon' && USE_APIFY_FOR_AMAZON) {
    try {
      console.log(`🎯 Using Apify for Amazon product: ${url}`);
      const apifyData = await scrapeAmazonWithApify(url);
      
      if (apifyData && (apifyData.name || apifyData.price)) {
        const category = categorizeProduct(apifyData.name || '', url);
        
        // Use scraped dimensions if available, otherwise estimate
        let dimensions = apifyData.dimensions;
        let dimensionSource = 'apify-scraped';
        let confidence = 'high';
        
        if (!dimensions) {
          console.log(`No dimensions from Apify, using intelligent estimation...`);
          const intelligentDims = await getIntelligentDimensions(
            '', 
            url,
            apifyData.price
          );
          dimensions = intelligentDims;
          dimensionSource = intelligentDims.source || 'intelligent-estimate';
          confidence = intelligentDims.confidence || 'medium';
        }
        
        const validatedDimensions = validateDimensions(dimensions, category, apifyData.name);
        const weight = apifyData.weight || estimateWeight(validatedDimensions, category);
        const shippingCost = calculateShippingCost(validatedDimensions, weight, apifyData.price || 0);
        
        return {
          id: generateProductId(),
          name: apifyData.name || 'Amazon Product',
          price: apifyData.price,
          image: apifyData.image || 'https://placehold.co/120x120/FF9800/FFFFFF/png?text=Amazon',
          retailer: retailer,
          category: apifyData.category || category,
          dimensions: validatedDimensions,
          dimensionSource: dimensionSource,
          confidence: confidence,
          weight: weight,
          shippingCost: shippingCost,
          url: url,
          needsManualPrice: !apifyData.price,
          priceMessage: !apifyData.price ? 'Please enter product price manually' : null,
          quantity: 1,
          scraped: true,
          method: 'Apify',
          brand: apifyData.brand,
          inStock: apifyData.inStock,
          estimateWarning: confidence !== 'high' ? 
            `Dimensions ${dimensionSource === 'apify-scraped' ? 'scraped' : 'estimated'} - Confidence: ${confidence}` : null
        };
      }
    } catch (error) {
      console.log(`⚠️ Apify failed for Amazon, falling back to ScrapingBee:`, error.message);
      // Fall through to ScrapingBee logic below
    }
  }

  // Then your existing ScrapingBee code continues as normal...
