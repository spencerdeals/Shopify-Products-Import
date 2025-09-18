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
          categoryOrProductUrls: [url],
          maxItems: 1,
          proxyConfiguration: { useApifyProxy: true }
        };
        console.log(`   📦 Amazon input:`, JSON.stringify(input, null, 2));
      } else {
        console.log(`   🌐 Generic/Wayfair input preparation...`);
        // Generic actor
        input = {
          startUrls: [{ url }],
          maxRequestsPerCrawl: 1,
          proxyConfiguration: { useApifyProxy: true },
          pageFunction: `
            async function pageFunction(context) {
              const { page, request } = context;
              
              // Wait for content to load
              await page.waitForTimeout(3000);
              
              const result = await page.evaluate(() => {
                const data = {
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
                
                // Extract title
                const titleSelectors = [
                  'h1[data-testid="product-title"]',
                  '#productTitle',
                  'h1.ProductTitle',
                  'h1[data-automation-id="product-title"]',
                  'h1.sr-only',
                  'h1',
                  '.product-title h1',
                  '.product-name h1'
                ];
                
                for (const selector of titleSelectors) {
                  const titleEl = document.querySelector(selector);
                  if (titleEl && titleEl.textContent.trim()) {
                    data.name = titleEl.textContent.trim();
                    break;
                  }
                }
                
                // Extract price
                const priceSelectors = [
                  '.MoneyPrice',
                  '.a-price-whole',
                  '[data-test="product-price"]',
                  '[data-automation-id="product-price"]',
                  '.pricing-price__value',
                  '.price',
                  '[class*="price"]'
                ];
                
                for (const selector of priceSelectors) {
                  const priceEl = document.querySelector(selector);
                  if (priceEl) {
                    const priceText = priceEl.textContent.replace(/[^0-9.]/g, '');
                    const price = parseFloat(priceText);
                    if (price > 0 && price < 100000) {
                      data.price = price;
                      break;
                    }
                  }
                }
                
                // Extract main image
                const imageSelectors = [
                  'img[data-testid="product-image"]',
                  '#landingImage',
                  '.ProductImages img',
                  'img[data-automation-id="product-image"]',
                  '.product-image img',
                  'img[class*="product"]'
                ];
                
                for (const selector of imageSelectors) {
                  const imgEl = document.querySelector(selector);
                  if (imgEl && imgEl.src && imgEl.src.startsWith('http')) {
                    data.image = imgEl.src;
                    break;
                  }
                }
                
                // Extract dimensions from text
                const bodyText = document.body.textContent;
                const dimMatch = bodyText.match(/(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:inches?|in\\.?|")/i);
                if (dimMatch) {
                  data.dimensions = {
                    length: parseFloat(dimMatch[1]),
                    width: parseFloat(dimMatch[2]),
                    height: parseFloat(dimMatch[3])
                  };
                }
                
                // Extract weight
                const weightMatch = bodyText.match(/(\\d+(?:\\.\\d+)?)\\s*(?:pounds?|lbs?)/i);
                if (weightMatch) {
                  data.weight = parseFloat(weightMatch[1]);
                }
                
                // Extract variant (color, size, etc.)
                const variantSelectors = [
                  '.a-button-selected .a-button-text',
                  '.SelectedOption',
                  '.selected-variant',
                  '.swatch.selected',
                  '.selected'
                ];
                
                for (const selector of variantSelectors) {
                  const variantEl = document.querySelector(selector);
                  if (variantEl && variantEl.textContent.trim()) {
                    const variantText = variantEl.textContent.trim();
                    if (variantText.length > 2 && variantText.length < 50) {
                      data.variant = variantText;
                      break;
                    }
                  }
                }
                
                return data;
              });
              
              return {
                url: request.url,
                ...result,
                scrapedAt: new Date().toISOString()
              };
            }
          `
        };
        console.log(`   📦 Generic input prepared (pageFunction length: ${input.pageFunction.length})`);
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

      console.log(`   📥 Fetching results from dataset: ${run.defaultDatasetId}`);
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      console.log(`   📋 Dataset items count: ${items ? items.length : 0}`);
      
      if (items && items.length > 0) {
        console.log(`   🔍 First item preview:`, JSON.stringify(items[0], null, 2).substring(0, 500) + '...');
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
      if (error.response) {
        console.error(`   📋 HTTP status: ${error.response.status}`);
        console.error(`   📋 Response data:`, error.response.data);
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

    // Extract name
    cleanedData.name = item.name || item.title || item.productName || null;
    if (cleanedData.name) {
      cleanedData.name = cleanedData.name.trim().substring(0, 200);
    }

    // Extract price
    if (item.price) {
      if (typeof item.price === 'object') {
        cleanedData.price = parseFloat(item.price.value || item.price.amount || item.price.current || 0);
      } else {
        const priceStr = String(item.price).replace(/[^0-9.]/g, '');
        cleanedData.price = parseFloat(priceStr) || null;
      }
    }

    // Validate price
    if (cleanedData.price && (cleanedData.price <= 0 || cleanedData.price > 100000)) {
      cleanedData.price = null;
    }

    // Extract image
    if (item.image) {
      cleanedData.image = Array.isArray(item.image) ? item.image[0] : item.image;
    } else if (item.images && Array.isArray(item.images) && item.images.length > 0) {
      cleanedData.image = item.images[0];
    }

    // Ensure image is a valid URL
    if (cleanedData.image && !cleanedData.image.startsWith('http')) {
      cleanedData.image = null;
    }

    // Extract dimensions
    if (item.dimensions) {
      if (typeof item.dimensions === 'object' && item.dimensions.length && item.dimensions.width && item.dimensions.height) {
        cleanedData.dimensions = {
          length: parseFloat(item.dimensions.length),
          width: parseFloat(item.dimensions.width),
          height: parseFloat(item.dimensions.height)
        };
      }
    }

    // Extract weight
    if (item.weight) {
      cleanedData.weight = parseFloat(item.weight) || null;
    }

    // Extract brand
    cleanedData.brand = item.brand || item.manufacturer || null;

    // Extract category
    if (item.category) {
      cleanedData.category = Array.isArray(item.category) ? item.category[item.category.length - 1] : item.category;
    } else if (item.breadcrumbs && Array.isArray(item.breadcrumbs)) {
      cleanedData.category = item.breadcrumbs[item.breadcrumbs.length - 1];
    }

    // Extract variant
    cleanedData.variant = item.variant || item.selectedVariant || item.color || item.size || null;
    if (cleanedData.variant && (cleanedData.variant.length < 2 || cleanedData.variant.length > 50)) {
      cleanedData.variant = null;
    }

    // Check availability
    if (item.inStock !== undefined) {
      cleanedData.inStock = !!item.inStock;
    } else if (item.availability) {
      cleanedData.inStock = !item.availability.toLowerCase().includes('out of stock');
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