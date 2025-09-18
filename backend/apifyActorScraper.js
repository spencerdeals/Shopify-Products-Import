// backend/apifyActorScraper.js - Apify Actor-based scraping system
const { ApifyClient } = require('apify-client');

class ApifyActorScraper {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = apiKey ? new ApifyClient({ token: apiKey }) : null;
    this.enabled = !!apiKey;
    
    // Actor configurations for different retailers
    this.actors = {
      amazon: {
        actorId: 'junglee/amazon-crawler',
        timeout: 120000, // 2 minutes
        memory: 2048
      },
      wayfair: {
        actorId: '123webdata/wayfair-scraper',
        timeout: 90000,
        memory: 1024
      },
      generic: {
        actorId: 'assertive_analogy/pro-web-content-crawler',
        timeout: 90000, // 1.5 minutes
        memory: 1024
      }
    };
    
    console.log(`🎭 ApifyActorScraper ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
    if (this.enabled) {
      console.log('   📋 Configured actors:');
      console.log(`   - Amazon: ${this.actors.amazon.actorId}`);
      console.log(`   - Wayfair: ${this.actors.wayfair.actorId}`);
      console.log(`   - Generic: ${this.actors.generic.actorId}`);
    }
  }

  isAvailable() {
    return this.enabled;
  }

  detectRetailer(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain.includes('amazon.com')) return 'amazon';
      if (domain.includes('wayfair.com')) return 'wayfair';
      // All other retailers use generic actor
      return 'generic';
    } catch (e) {
      return 'generic';
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Apify not configured - no API key provided');
    }

    const retailerType = this.detectRetailer(url);
    const actorConfig = this.actors[retailerType];
    
    console.log(`   🎭 Using ${actorConfig.actorId} for ${retailerType} product`);

    try {
      let input;
      
      if (retailerType === 'amazon') {
        input = {
          categoryOrProductUrls: [{ url }],
          maxItems: 1,
          proxyConfiguration: { useApifyProxy: true }
        };
      } else if (retailerType === 'wayfair') {
        input = {
          productUrls: [url],
          maxResultsPerScrape: 1,
          usePagination: false
        };
      } else {
        // Generic actor for all other websites
        input = {
          startUrls: [url],
          maxRequestsPerCrawl: 1
        };
      }

      console.log(`   ⏱️ Running actor with ${actorConfig.timeout/1000}s timeout...`);
      
      const run = await this.client.actor(actorConfig.actorId).call(input, {
        timeout: actorConfig.timeout,
        memory: actorConfig.memory,
        waitSecs: Math.floor(actorConfig.timeout / 1000) - 10
      });
      
      console.log(`   ✅ Actor run completed. Status: ${run.status}`);

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        console.log(`   ✅ Actor returned ${items.length} items`);
        return this.cleanResult(items[0], retailerType);
      }
      
      throw new Error('No results from Apify actor');
      
    } catch (error) {
      console.error(`   ❌ Actor ${actorConfig.actorId} failed: ${error.message}`);
      throw error;
    }
  }

  cleanResult(item, retailerType) {
    console.log(`   🧹 Cleaning result from ${retailerType} actor...`);
    
    let cleanedData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true,
      variant: null
    };

    // Extract name - handle different formats
    cleanedData.name = item.name || item.title || item.productName || null;
    if (cleanedData.name) {
      cleanedData.name = cleanedData.name.trim().substring(0, 200);
    }

    // Extract price - handle different actor formats
    if (item.price) {
      if (typeof item.price === 'object' && item.price.value) {
        // Amazon format: { value: 145.5, currency: "$" }
        cleanedData.price = parseFloat(item.price.value);
      } else {
        // Wayfair/Generic format: direct number or string
        const priceStr = String(item.price).replace(/[^0-9.]/g, '');
        cleanedData.price = parseFloat(priceStr) || null;
      }
    }

    // Validate price
    if (cleanedData.price && (cleanedData.price <= 0 || cleanedData.price > 100000)) {
      cleanedData.price = null;
    }

    // Extract image - handle different formats
    if (item.thumbnailImage) {
      // Amazon format
      cleanedData.image = item.thumbnailImage;
    } else if (item.main_image) {
      // Wayfair format
      cleanedData.image = item.main_image;
    } else if (item.image) {
      // Generic format
      cleanedData.image = Array.isArray(item.image) ? item.image[0] : item.image;
    } else if (item.images && Array.isArray(item.images) && item.images.length > 0) {
      cleanedData.image = item.images[0];
    }

    // Ensure image is a valid URL
    if (cleanedData.image && !cleanedData.image.startsWith('http')) {
      cleanedData.image = null;
    }

    // Extract dimensions - handle Wayfair vs Generic formats
    if (item.attributes && item.attributes.overall) {
      // Parse Wayfair dimensions like "31'' H X 51'' W X 16'' D"
      const dimMatch = item.attributes.overall.match(/(\d+(?:\.\d+)?)''\s*H\s*X\s*(\d+(?:\.\d+)?)''\s*W\s*X\s*(\d+(?:\.\d+)?)''\s*D/i);
      if (dimMatch) {
        cleanedData.dimensions = {
          length: parseFloat(dimMatch[2]), // Width becomes length
          width: parseFloat(dimMatch[3]),  // Depth becomes width
          height: parseFloat(dimMatch[1])  // Height stays height
        };
      }
    } else if (item.dimensions) {
      // Generic format
      if (typeof item.dimensions === 'object' && item.dimensions.length && item.dimensions.width && item.dimensions.height) {
        cleanedData.dimensions = {
          length: parseFloat(item.dimensions.length),
          width: parseFloat(item.dimensions.width),
          height: parseFloat(item.dimensions.height)
        };
      }
    }

    // Extract weight - handle different formats
    if (item.weight) {
      const weightStr = String(item.weight).replace(/[^0-9.]/g, '');
      cleanedData.weight = parseFloat(weightStr) || null;
    } else if (item.attributes && item.attributes['overall product weight']) {
      const weightStr = String(item.attributes['overall product weight']).replace(/[^0-9.]/g, '');
      cleanedData.weight = parseFloat(weightStr) || null;
    }

    // Extract brand
    cleanedData.brand = item.brand || item.manufacturer || null;

    // Extract category
    if (item.breadCrumbs) {
      // Amazon uses breadCrumbs string
      const breadcrumbArray = item.breadCrumbs.split(' › ');
      cleanedData.category = breadcrumbArray[breadcrumbArray.length - 1];
    } else if (item.breadcrumbs && Array.isArray(item.breadcrumbs)) {
      // Wayfair uses breadcrumbs array
      cleanedData.category = item.breadcrumbs[item.breadcrumbs.length - 2] || item.breadcrumbs[item.breadcrumbs.length - 1];
    } else if (item.category) {
      // Generic format
      cleanedData.category = Array.isArray(item.category) ? item.category[item.category.length - 1] : item.category;
    }

    // Extract variant
    if (retailerType === 'amazon') {
      // Amazon variants from variantAttributes
      if (item.variantAttributes && item.variantAttributes.length > 0) {
        const variants = item.variantAttributes.map(attr => `${attr.name}: ${attr.value}`);
        cleanedData.variant = variants.join(', ');
      }
    } else if (retailerType === 'wayfair') {
      // Wayfair variants from attributes
      if (item.attributes && item.attributes.color) {
        cleanedData.variant = `Color: ${item.attributes.color}`;
      }
    } else {
      // Generic variant extraction
      cleanedData.variant = item.variant || item.color || item.size || item.style || null;
    }
    
    // Clean up variant text
    if (cleanedData.variant && (cleanedData.variant.length < 2 || cleanedData.variant.length > 50)) {
      cleanedData.variant = null;
    }

    // Check availability
    if (item.inStock !== undefined) {
      cleanedData.inStock = !!item.inStock;
    } else if (item.in_stock !== undefined) {
      cleanedData.inStock = !!item.in_stock;
    } else if (item.availability) {
      cleanedData.inStock = !item.availability.toLowerCase().includes('out of stock');
    } else {
      cleanedData.inStock = true;
    }

    console.log(`   📊 Cleaned data:`, {
      hasName: !!cleanedData.name,
      hasPrice: !!cleanedData.price,
      hasImage: !!cleanedData.image,
      hasDimensions: !!cleanedData.dimensions,
      hasWeight: !!cleanedData.weight,
      hasVariant: !!cleanedData.variant
    });

    return cleanedData;
  }
}

module.exports = ApifyActorScraper;