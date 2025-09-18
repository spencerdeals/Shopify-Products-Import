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
      console.log('   🔍 Will verify these actors exist during first run...');
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
      if (domain.includes('lunafurn.com')) return 'generic';
      if (domain.includes('overstock.com')) return 'generic';
      if (domain.includes('target.com')) return 'generic';
      if (domain.includes('walmart.com')) return 'generic';
      if (domain.includes('bestbuy.com')) return 'generic';
      if (domain.includes('homedepot.com')) return 'generic';
      if (domain.includes('lowes.com')) return 'generic';
      if (domain.includes('costco.com')) return 'generic';
      if (domain.includes('macys.com')) return 'generic';
      if (domain.includes('ikea.com')) return 'generic';
      if (domain.includes('cb2.com')) return 'generic';
      if (domain.includes('crateandbarrel.com')) return 'generic';
      if (domain.includes('westelm.com')) return 'generic';
      if (domain.includes('potterybarn.com')) return 'generic';
      if (domain.includes('ashleyfurniture.com')) return 'generic';
      if (domain.includes('roomstogo.com')) return 'generic';
      if (domain.includes('livingspaces.com')) return 'generic';
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
    
    console.log(`🎭 Using ${actorConfig.actorId} for ${retailerType} product`);
    console.log(`   📋 Raw URL: ${url}`);
    console.log(`   🔍 URL length: ${url.length}`);
    console.log(`   ✅ URL validation: ${this.isValidUrl(url)}`);

    try {
      let input;
      
      if (retailerType === 'amazon') {
        console.log(`   🛒 Amazon input preparation...`);
        input = {
          categoryOrProductUrls: [{ url }],
          maxItems: 1,
          proxyConfiguration: { useApifyProxy: true }
        };
        console.log(`   📦 Amazon input:`, JSON.stringify(input, null, 2));
      } else if (retailerType === 'wayfair') {
        console.log(`   🏠 Wayfair input preparation...`);
        input = {
          productUrls: [url],
          maxResultsPerScrape: 1,
          usePagination: false
        };
        console.log(`   📦 Wayfair input:`, JSON.stringify(input, null, 2));
      } else {
        console.log(`   🌐 Generic/Wayfair input preparation...`);
        // Generic Python Crawlee actor - uses startUrls array
        input = {
          startUrls: [url],  // Python Crawlee expects simple array of URLs
          maxRequestsPerCrawl: 1
        };
        console.log(`   📦 Generic Python input:`, JSON.stringify(input, null, 2));
      }

      console.log(`   ⏱️ Running actor with ${actorConfig.timeout/1000}s timeout...`);
      console.log(`   🎯 Actor ID: ${actorConfig.actorId}`);
      console.log(`   💾 Memory: ${actorConfig.memory}MB`);
      
      console.log(`   🚀 Starting actor run...`);
      const runOptions = {
        timeout: actorConfig.timeout,
        memory: actorConfig.memory,
        waitSecs: Math.floor(actorConfig.timeout / 1000) - 10
      };
      console.log(`   ⚙️ Run options:`, runOptions);
      
      const run = await this.client.actor(actorConfig.actorId).call(input, runOptions);
      console.log(`   ✅ Actor run completed. Run ID: ${run.id}`);
      console.log(`   📊 Run status: ${run.status}`);
      
      // Log run details for debugging
      if (run.status !== 'SUCCEEDED') {
        console.log(`   ⚠️ Actor run status: ${run.status}`);
        if (run.statusMessage) {
          console.log(`   📋 Status message: ${run.statusMessage}`);
        }
      }

      console.log(`   📥 Fetching results from dataset: ${run.defaultDatasetId}`);
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      console.log(`   📋 Dataset items count: ${items ? items.length : 0}`);
      
      if (items && items.length > 0) {
        console.log(`   🔍 First item preview:`, JSON.stringify(items[0], null, 2).substring(0, 500) + '...');
      } else {
        console.log(`   ❌ No items in dataset - checking run logs...`);
        try {
          const logs = await this.client.log(run.id).get();
          if (logs) {
            console.log(`   📋 Actor logs (last 1000 chars):`, logs.substring(-1000));
          }
        } catch (logError) {
          console.log(`   ❌ Could not fetch logs: ${logError.message}`);
        }
      }
      
      if (items && items.length > 0) {
        console.log(`   ✅ Actor returned ${items.length} items`);
        return this.cleanResult(items[0], retailerType);
      }
      
      console.log(`   ❌ No items returned from actor`);
      throw new Error('No results from Apify actor');
      
    } catch (error) {
      console.error(`   ❌ Actor ${actorConfig.actorId} failed:`);
      console.error(`   📋 Error message: ${error.message}`);
      console.error(`   📋 Error type: ${error.constructor.name}`);
      
      // More detailed error logging
      if (error.response) {
        console.error(`   📋 HTTP status: ${error.response.status}`);
        console.error(`   📋 Response data:`, error.response.data);
      }
      if (error.details) {
        console.error(`   📋 Error details:`, error.details);
      }
      if (error.run) {
        console.error(`   📋 Run info:`, {
          id: error.run.id,
          status: error.run.status,
          statusMessage: error.run.statusMessage
        });
      }
      if (error.stack) {
        console.error(`   📋 Stack trace: ${error.stack.substring(0, 500)}...`);
      }
      throw error;
    }
  }
  
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch (e) {
      return false;
    }
  }

  parseZyteResponse(data, url, retailer) {
    console.log('🔍 Parsing Zyte response...');
    
    const productData = {
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

    // Priority 1: Extract from Zyte's automatic product extraction
    if (data.product) {
      const product = data.product;
      
      // Product name
      productData.name = product.name || product.title || null;
      if (productData.name) {
        productData.name = productData.name.trim().substring(0, 200);
        console.log('   📝 Product name:', productData.name.substring(0, 50) + '...');
      }

      // Price - handle multiple formats
      if (product.price) {
        let priceValue = product.price;
        if (typeof priceValue === 'object' && priceValue.value) {
          priceValue = priceValue.value;
        }
        productData.price = parseFloat(String(priceValue).replace(/[^0-9.]/g, ''));
        if (productData.price > 0 && productData.price < 100000) {
          console.log('   💰 Price: $' + productData.price);
        } else {
          productData.price = null;
        }
      } else if (product.regularPrice) {
        productData.price = parseFloat(String(product.regularPrice).replace(/[^0-9.]/g, ''));
        console.log('   💰 Regular Price: $' + productData.price);
      }

      // Images - handle multiple formats
      if (product.images && product.images.length > 0) {
        const firstImage = product.images[0];
        productData.image = typeof firstImage === 'object' ? firstImage.url : firstImage;
        console.log('   🖼️ Image: Found');
      } else if (product.mainImage) {
        productData.image = typeof product.mainImage === 'object' ? product.mainImage.url : product.mainImage;
        console.log('   🖼️ Image: Found (main)');
      }

      // Brand
      productData.brand = product.brand || null;

      // Category/Breadcrumbs
      if (product.breadcrumbs && product.breadcrumbs.length > 0) {
        productData.category = product.breadcrumbs[product.breadcrumbs.length - 1].name || 
                              product.breadcrumbs[product.breadcrumbs.length - 1];
      }

      // Availability
      if (product.availability) {
        const availability = String(product.availability).toLowerCase();
        productData.inStock = !availability.includes('out of stock') && 
                             !availability.includes('unavailable') &&
                             !availability.includes('sold out');
      }

      // Variants - Enhanced extraction
      if (product.variants && product.variants.length > 0) {
        const selectedVariant = product.variants.find(v => v.selected) || product.variants[0];
        if (selectedVariant) {
          const variantParts = [];
          if (selectedVariant.color) variantParts.push(`Color: ${selectedVariant.color}`);
          if (selectedVariant.size) variantParts.push(`Size: ${selectedVariant.size}`);
          if (selectedVariant.style) variantParts.push(`Style: ${selectedVariant.style}`);
          if (selectedVariant.material) variantParts.push(`Material: ${selectedVariant.material}`);
          
          if (variantParts.length > 0) {
            productData.variant = variantParts.join(', ');
            console.log('   🎨 Variant:', productData.variant);
          }
        }
      } else if (product.color || product.size || product.style) {
        // Direct variant properties
        const variantParts = [];
        if (product.color) variantParts.push(`Color: ${product.color}`);
        if (product.size) variantParts.push(`Size: ${product.size}`);
        if (product.style) variantParts.push(`Style: ${product.style}`);
        
        if (variantParts.length > 0) {
          productData.variant = variantParts.join(', ');
          console.log('   🎨 Direct Variant:', productData.variant);
        }
      }
    }

    // Priority 2: Parse from browser HTML if structured data is incomplete
    if (data.browserHtml && (!productData.name || !productData.price)) {
      console.log('   🔍 Falling back to HTML parsing...');
      const htmlData = this.parseHTML(data.browserHtml, url, retailer);
      
      // Merge data - prefer structured data but fill gaps with HTML parsing
      productData.name = productData.name || htmlData.name;
      productData.price = productData.price || htmlData.price;
      productData.image = productData.image || htmlData.image;
      productData.dimensions = productData.dimensions || htmlData.dimensions;
      productData.weight = productData.weight || htmlData.weight;
      productData.variant = productData.variant || htmlData.variant;
    }

    return productData;
  }

  cleanResult(item, retailerType) {
    console.log(`   🧹 Cleaning result from ${retailerType} actor...`);
    
    // Handle different actor response formats
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

    // Extract price - handle Amazon vs Wayfair vs Generic formats
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
      // Handle Wayfair weight format like "75.85 pound"
      const weightStr = String(item.weight).replace(/[^0-9.]/g, '');
      cleanedData.weight = parseFloat(weightStr) || null;
    } else if (item.attributes && item.attributes['overall product weight']) {
      const weightStr = String(item.attributes['overall product weight']).replace(/[^0-9.]/g, '');
      cleanedData.weight = parseFloat(weightStr) || null;
    }

    // Extract brand - handle different formats
    cleanedData.brand = item.brand || item.manufacturer || null;

    // Extract category - handle different formats
    if (item.breadCrumbs) {
      // Amazon uses breadCrumbs string like "Electronics › Computers & Accessories › Memory Cards"
      const breadcrumbArray = item.breadCrumbs.split(' › ');
      cleanedData.category = breadcrumbArray[breadcrumbArray.length - 1];
    } else if (item.breadcrumbs && Array.isArray(item.breadcrumbs)) {
      // Wayfair uses breadcrumbs array
      cleanedData.category = item.breadcrumbs[item.breadcrumbs.length - 2] || item.breadcrumbs[item.breadcrumbs.length - 1]; // Skip SKU
    } else if (item.category) {
      // Generic format
      cleanedData.category = Array.isArray(item.category) ? item.category[item.category.length - 1] : item.category;
    }

    // Extract variant - handle different formats
    if (retailerType === 'amazon') {
      // Amazon variants from variantAttributes
      if (item.variantAttributes && item.variantAttributes.length > 0) {
        const variants = item.variantAttributes.map(attr => `${attr.name}: ${attr.value}`);
        cleanedData.variant = variants.join(', ');
      } else if (item.selectedVariant) {
        cleanedData.variant = item.selectedVariant;
      }
    } else if (retailerType === 'wayfair') {
      // Wayfair variants from attributes or selected options
      if (item.attributes && item.attributes.color) {
        cleanedData.variant = `Color: ${item.attributes.color}`;
      } else if (item.selectedOptions) {
        cleanedData.variant = Object.entries(item.selectedOptions)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
      }
    } else {
      // Generic variant extraction
      cleanedData.variant = item.variant || item.selectedVariant || item.color || item.size || item.style || null;
    }
    
    // Clean up variant text
    if (cleanedData.variant && (cleanedData.variant.length < 2 || cleanedData.variant.length > 50)) {
      cleanedData.variant = null;
    }

    // Check availability - handle different formats
    if (item.inStock !== undefined) {
      // Amazon format
      cleanedData.inStock = !!item.inStock;
    } else if (item.in_stock !== undefined) {
      // Wayfair format
      cleanedData.inStock = !!item.in_stock;
    } else if (item.availability) {
      // Generic format
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

  // Batch scraping method
  async scrapeMultipleProducts(urls) {
    if (!this.enabled) {
      throw new Error('Apify not configured');
    }

    const results = [];
    const batchSize = 2; // Small batches to avoid rate limits
    
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      
      const batchPromises = batch.map(url => 
        this.scrapeProduct(url).catch(error => ({
          url,
          error: error.message,
          success: false
        }))
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches
      if (i + batchSize < urls.length) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    return results;
  }
}

module.exports = ApifyActorScraper;