// backend/apifyScraper.js
let ApifyClient;

try {
  const apifyModule = require('apify-client');
  ApifyClient = apifyModule.ApifyClient;
  console.log('✅ Apify client module loaded successfully');
} catch (error) {
  console.log('⚠️ Apify client not installed - Amazon scraping will fallback to ScrapingBee');
  ApifyClient = null;
}

class ApifyScraper {
  constructor(apiKey) {
    this.enabled = false;
    this.client = null;

    if (!ApifyClient) {
      console.log('⚠️ Apify client library not available');
      return;
    }

    if (!apiKey) {
      console.log('⚠️ Apify API key not provided');
      return;
    }

    try {
      this.client = new ApifyClient({ token: apiKey });
      this.enabled = true;
      console.log('✅ Apify scraper initialized for Amazon products');
    } catch (error) {
      console.error('❌ Failed to initialize Apify client:', error.message);
    }
  }

  isAvailable() {
    return this.enabled && this.client !== null;
  }

  async scrapeAmazon(url) {
    if (!this.isAvailable()) {
      throw new Error('Apify not available or not configured');
    }

    try {
      console.log('🔄 Starting Apify Amazon scrape for:', url);
      
      // Using the junglee/Amazon-crawler actor
      const run = await this.client.actor('junglee/Amazon-crawler').call({
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
      await this.client.run(run.id).waitForFinish({ waitSecs: 60 });

      // Get the results
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (!items || items.length === 0) {
        console.log('❌ No results from Apify');
        throw new Error('No product data found');
      }

      const product = items[0];
      console.log('✅ Apify scrape successful');

      return this.parseAmazonData(product);

    } catch (error) {
      console.error('❌ Apify Amazon scrape failed:', error.message);
      throw error;
    }
  }

  parseAmazonData(data) {
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
      result.dimensions = this.extractDimensionsFromSpecs(data.specifications);
      result.weight = this.extractWeightFromSpecs(data.specifications);
    }

    // Fallback weight extraction
    if (!result.weight) {
      if (data.weight) result.weight = this.parseWeightString(data.weight);
      else if (data.itemWeight) result.weight = this.parseWeightString(data.itemWeight);
      else if (data.shippingWeight) result.weight = this.parseWeightString(data.shippingWeight);
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

  extractDimensionsFromSpecs(specs) {
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
        const parsed = this.parseDimensionString(specs[key]);
        if (parsed) return parsed;
      }
    }

    return null;
  }

  extractWeightFromSpecs(specs) {
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
        const weight = this.parseWeightString(specs[key]);
        if (weight) return weight;
      }
    }

    return null;
  }

  parseDimensionString(str) {
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

  parseWeightString(weightStr) {
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

  // New generic parser for other retailers
  parseGenericData(data) {
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

    // Price extraction
    if (data.price) {
      if (typeof data.price === 'number') {
        result.price = data.price;
      } else if (typeof data.price === 'string') {
        const priceMatch = data.price.match(/[\d,]+\.?\d*/);
        result.price = priceMatch ? parseFloat(priceMatch[0].replace(',', '')) : null;
      }
    }

    // Image
    result.image = data.image || null;

    // Try to extract dimensions from description or specifications
    if (data.description) {
      result.dimensions = this.extractDimensionsFromText(data.description);
    }

    console.log('📦 Parsed generic product:', {
      name: result.name?.substring(0, 50) + '...',
      price: result.price,
      hasImage: !!result.image,
      hasDimensions: !!result.dimensions
    });

    return result;
  }

  extractDimensionsFromText(text) {
    if (!text) return null;

    const patterns = [
      /(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*(?:inches|in|")?/i,
      /(\d+\.?\d*)"?\s*[WL]\s*[x×]\s*(\d+\.?\d*)"?\s*[DW]\s*[x×]\s*(\d+\.?\d*)"?\s*[HT]/i,
      /L:\s*(\d+\.?\d*).*W:\s*(\d+\.?\d*).*H:\s*(\d+\.?\d*)/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
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
}

module.exports = ApifyScraper;
