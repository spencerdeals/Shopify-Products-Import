// backend/apifyActorScraper.js - Optimized Apify Actor Integration with Deep Research
const { ApifyClient } = require('apify-client');

class ApifyActorScraper {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = apiKey ? new ApifyClient({ token: apiKey }) : null;
    this.enabled = !!apiKey;
    
    // Optimized actor configurations based on deep research
    this.actors = {
      amazon: {
        actorId: 'junglee/amazon-crawler',
        timeout: 180000, // 3 minutes - Amazon can be slow
        memory: 2048,
        maxRetries: 2,
        // Optimized input parameters based on actor documentation
        getInput: (url) => ({
          categoryOrProductUrls: [{ url }],
          maxItems: 1,
          maxItemsPerStartUrl: 1,
          proxyConfiguration: { useApifyProxy: true },
          extendOutputFunction: `($) => {
            const result = {};
            
            // Enhanced price extraction for Amazon
            const priceSelectors = [
              '.a-price-current .a-offscreen',
              '.a-price .a-offscreen', 
              '.a-price-whole',
              '.apexPriceToPay .a-offscreen',
              '.a-price.a-text-price .a-offscreen'
            ];
            
            for (const selector of priceSelectors) {
              const priceEl = $(selector).first();
              if (priceEl.length) {
                const priceText = priceEl.text().replace(/[^0-9.]/g, '');
                const price = parseFloat(priceText);
                if (price > 0) {
                  result.enhancedPrice = price;
                  break;
                }
              }
            }
            
            // Enhanced variant extraction
            const selectedVariants = [];
            $('.a-button-selected .a-button-text').each((i, el) => {
              const text = $(el).text().trim();
              if (text && text.length > 1 && text.length < 50) {
                selectedVariants.push(text);
              }
            });
            
            if (selectedVariants.length > 0) {
              result.enhancedVariant = selectedVariants.join(', ');
            }
            
            return result;
          }`,
          includeReviews: false,
          maxReviews: 0,
          scrapeProductDetails: true,
          scrapePriceHistory: false
        })
      },
      wayfair: {
        actorId: '123webdata/wayfair-scraper',
        timeout: 120000, // 2 minutes
        memory: 1024,
        maxRetries: 2,
        getInput: (url) => ({
          productUrls: [url],
          maxResultsPerScrape: 1,
          usePagination: false,
          proxyConfiguration: { useApifyProxy: true },
          // Wayfair-specific optimizations
          includeProductDetails: true,
          includeImages: true,
          includeReviews: false,
          maxReviews: 0
        })
      },
      generic: {
        actorId: 'assertive_analogy/pro-web-content-crawler',
        timeout: 90000, // 1.5 minutes
        memory: 1024,
        maxRetries: 2,
        getInput: (url) => ({
          startUrls: [{ url }],
          maxRequestsPerCrawl: 1,
          proxyConfiguration: { useApifyProxy: true },
          // Enhanced extraction for generic sites
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
                  variant: null,
                  availability: 'InStock'
                };
                
                // Enhanced title extraction
                const titleSelectors = [
                  'h1[data-testid*="title"]',
                  'h1[data-testid*="name"]', 
                  'h1.product-title',
                  'h1.ProductTitle',
                  'h1',
                  '.product-title',
                  '.product-name'
                ];
                
                for (const selector of titleSelectors) {
                  const titleEl = document.querySelector(selector);
                  if (titleEl && titleEl.textContent.trim()) {
                    data.name = titleEl.textContent.trim();
                    break;
                  }
                }
                
                // Enhanced price extraction with multiple methods
                const priceSelectors = [
                  '.price',
                  '[class*="price"]',
                  '.current-price',
                  '.sale-price',
                  '[data-testid*="price"]',
                  '.MoneyPrice',
                  '[data-test="product-price"]'
                ];
                
                // Method 1: CSS Selectors
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
                
                // Method 2: JSON-LD structured data
                if (!data.price) {
                  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
                  for (const script of jsonLdScripts) {
                    try {
                      const jsonData = JSON.parse(script.textContent);
                      const offers = jsonData.offers || jsonData['@graph']?.find(item => item.offers)?.offers;
                      if (offers) {
                        const offer = Array.isArray(offers) ? offers[0] : offers;
                        if (offer.price || offer.priceSpecification?.price) {
                          const price = parseFloat(offer.price || offer.priceSpecification.price);
                          if (price > 0) {
                            data.price = price;
                            break;
                          }
                        }
                      }
                    } catch (e) {}
                  }
                }
                
                // Enhanced image extraction
                const imageSelectors = [
                  '.product-image img',
                  'img[class*="product"]',
                  '.hero-image img',
                  'img[data-testid*="image"]',
                  '.main-image img',
                  '.featured-image img'
                ];
                
                for (const selector of imageSelectors) {
                  const imgEl = document.querySelector(selector);
                  if (imgEl && imgEl.src && imgEl.src.startsWith('http')) {
                    data.image = imgEl.src;
                    break;
                  }
                }
                
                // Enhanced variant extraction
                const variantSelectors = [
                  '.selected',
                  '.selected-option',
                  '[aria-selected="true"]',
                  '.variant-selected',
                  '.option-selected'
                ];
                
                const variants = [];
                for (const selector of variantSelectors) {
                  const elements = document.querySelectorAll(selector);
                  elements.forEach(el => {
                    const text = el.textContent.trim();
                    if (text && text.length > 1 && text.length < 50 && 
                        !text.toLowerCase().includes('select') &&
                        !variants.includes(text)) {
                      variants.push(text);
                    }
                  });
                }
                
                if (variants.length > 0) {
                  data.variant = variants.join(', ');
                }
                
                // Check availability
                const outOfStockKeywords = /out of stock|unavailable|sold out|not available/i;
                if (outOfStockKeywords.test(document.body.textContent)) {
                  data.availability = 'OutOfStock';
                }
                
                return data;
              });
              
              return {
                url: request.url,
                ...result,
                scrapedAt: new Date().toISOString()
              };
            }
          `,
          maxConcurrency: 1,
          requestTimeoutSecs: 60
        })
      }
    };
    
    console.log(`🎭 ApifyActorScraper ${this.enabled ? 'ENABLED (Optimized v2.0)' : 'DISABLED'}`);
    if (this.enabled) {
      console.log('   📋 Optimized actor configurations:');
      console.log(`   - Amazon: ${this.actors.amazon.actorId} (${this.actors.amazon.timeout/1000}s, ${this.actors.amazon.memory}MB)`);
      console.log(`   - Wayfair: ${this.actors.wayfair.actorId} (${this.actors.wayfair.timeout/1000}s, ${this.actors.wayfair.memory}MB)`);
      console.log(`   - Generic: ${this.actors.generic.actorId} (${this.actors.generic.timeout/1000}s, ${this.actors.generic.memory}MB)`);
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
    
    console.log(`   🎭 Using optimized ${actorConfig.actorId} for ${retailerType} product`);

    let attempt = 0;
    let lastError = null;

    while (attempt <= actorConfig.maxRetries) {
      try {
        const input = actorConfig.getInput(url);
        
        console.log(`   ⏱️ Running actor (attempt ${attempt + 1}/${actorConfig.maxRetries + 1}) with ${actorConfig.timeout/1000}s timeout...`);
        
        const run = await this.client.actor(actorConfig.actorId).call(input, {
          timeout: actorConfig.timeout,
          memory: actorConfig.memory,
          waitSecs: Math.floor(actorConfig.timeout / 1000) - 10
        });
        
        console.log(`   ✅ Actor run completed. Status: ${run.status}`);

        const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
        
        if (items && items.length > 0) {
          console.log(`   ✅ Actor returned ${items.length} items`);
          const cleanedResult = this.cleanResult(items[0], retailerType);
          
          // Validate result quality
          if (this.isValidResult(cleanedResult)) {
            return cleanedResult;
          } else {
            console.log(`   ⚠️ Result quality check failed, retrying...`);
            throw new Error('Result quality check failed');
          }
        }
        
        throw new Error('No results from Apify actor');
        
      } catch (error) {
        lastError = error;
        attempt++;
        
        console.error(`   ❌ Actor attempt ${attempt} failed: ${error.message}`);
        
        if (attempt <= actorConfig.maxRetries) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff
          console.log(`   ⏳ Retrying in ${backoffDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }
    
    throw lastError || new Error('All actor attempts failed');
  }

  isValidResult(result) {
    // Basic validation - at least name or price should be present
    return result && (result.name || result.price);
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

    // Extract name with retailer-specific logic
    cleanedData.name = this.extractName(item, retailerType);
    
    // Extract price with enhanced logic
    cleanedData.price = this.extractPrice(item, retailerType);
    
    // Extract image
    cleanedData.image = this.extractImage(item, retailerType);
    
    // Extract dimensions
    cleanedData.dimensions = this.extractDimensions(item, retailerType);
    
    // Extract weight
    cleanedData.weight = this.extractWeight(item, retailerType);
    
    // Extract brand
    cleanedData.brand = this.extractBrand(item, retailerType);
    
    // Extract category
    cleanedData.category = this.extractCategory(item, retailerType);
    
    // Extract variant
    cleanedData.variant = this.extractVariant(item, retailerType);
    
    // Extract availability
    cleanedData.inStock = this.extractAvailability(item, retailerType);

    console.log(`   📊 Cleaned data quality:`, {
      hasName: !!cleanedData.name,
      hasPrice: !!cleanedData.price,
      hasImage: !!cleanedData.image,
      hasDimensions: !!cleanedData.dimensions,
      hasWeight: !!cleanedData.weight,
      hasVariant: !!cleanedData.variant
    });

    return cleanedData;
  }

  extractName(item, retailerType) {
    const nameFields = ['name', 'title', 'productName', 'itemName'];
    
    for (const field of nameFields) {
      if (item[field] && typeof item[field] === 'string') {
        let name = item[field].trim();
        
        // Retailer-specific cleaning
        if (retailerType === 'amazon') {
          // Remove Amazon-specific noise
          name = name.replace(/\s*\(.*?\)\s*$/, '');
          name = name.replace(/\s*-\s*Amazon\.com\s*$/, '');
        }
        
        if (name.length > 5) { // Minimum reasonable length
          return name.substring(0, 200);
        }
      }
    }
    
    return null;
  }

  extractPrice(item, retailerType) {
    // Try enhanced price first (from custom extraction)
    if (item.enhancedPrice && item.enhancedPrice > 0) {
      console.log(`   💰 Using enhanced price: $${item.enhancedPrice}`);
      return item.enhancedPrice;
    }
    
    const priceFields = ['price', 'currentPrice', 'salePrice', 'regularPrice', 'listPrice'];
    
    for (const field of priceFields) {
      if (item[field]) {
        let priceValue = item[field];
        
        // Handle different price formats
        if (typeof priceValue === 'object') {
          priceValue = priceValue.value || priceValue.amount || priceValue.price;
        }
        
        if (typeof priceValue === 'string') {
          priceValue = priceValue.replace(/[^0-9.]/g, '');
        }
        
        const price = parseFloat(priceValue);
        
        if (price > 0 && price < 100000) {
          console.log(`   💰 Price from ${field}: $${price}`);
          return price;
        }
      }
    }
    
    return null;
  }

  extractImage(item, retailerType) {
    const imageFields = ['image', 'thumbnailImage', 'main_image', 'primaryImage', 'images'];
    
    for (const field of imageFields) {
      if (item[field]) {
        let imageUrl = item[field];
        
        // Handle array of images
        if (Array.isArray(imageUrl)) {
          imageUrl = imageUrl[0];
        }
        
        // Handle object format
        if (typeof imageUrl === 'object' && imageUrl.url) {
          imageUrl = imageUrl.url;
        }
        
        if (typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
          return imageUrl;
        }
      }
    }
    
    return null;
  }

  extractDimensions(item, retailerType) {
    if (retailerType === 'wayfair' && item.attributes && item.attributes.overall) {
      // Parse Wayfair dimensions like "31'' H X 51'' W X 16'' D"
      const dimMatch = item.attributes.overall.match(/(\d+(?:\.\d+)?)''\s*H\s*X\s*(\d+(?:\.\d+)?)''\s*W\s*X\s*(\d+(?:\.\d+)?)''\s*D/i);
      if (dimMatch) {
        return {
          length: parseFloat(dimMatch[2]), // Width becomes length
          width: parseFloat(dimMatch[3]),  // Depth becomes width
          height: parseFloat(dimMatch[1])  // Height stays height
        };
      }
    }
    
    // Generic dimension extraction
    if (item.dimensions && typeof item.dimensions === 'object') {
      const { length, width, height } = item.dimensions;
      if (length && width && height) {
        return {
          length: parseFloat(length),
          width: parseFloat(width),
          height: parseFloat(height)
        };
      }
    }
    
    return null;
  }

  extractWeight(item, retailerType) {
    const weightFields = ['weight', 'shippingWeight', 'itemWeight'];
    
    for (const field of weightFields) {
      if (item[field]) {
        let weightStr = String(item[field]);
        
        // Handle Wayfair specific weight format
        if (retailerType === 'wayfair' && item.attributes && item.attributes['overall product weight']) {
          weightStr = String(item.attributes['overall product weight']);
        }
        
        const weightMatch = weightStr.match(/(\d+(?:\.\d+)?)\s*(lb|pound|kg|g|oz)?/i);
        if (weightMatch) {
          let weight = parseFloat(weightMatch[1]);
          const unit = (weightMatch[2] || 'lb').toLowerCase();
          
          // Convert to pounds
          switch(unit) {
            case 'kg': weight *= 2.205; break;
            case 'g': weight *= 0.00220462; break;
            case 'oz': weight *= 0.0625; break;
          }
          
          return Math.round(weight * 10) / 10;
        }
      }
    }
    
    return null;
  }

  extractBrand(item, retailerType) {
    const brandFields = ['brand', 'manufacturer', 'brandName'];
    
    for (const field of brandFields) {
      if (item[field] && typeof item[field] === 'string' && item[field].trim()) {
        return item[field].trim();
      }
    }
    
    return null;
  }

  extractCategory(item, retailerType) {
    if (retailerType === 'amazon' && item.breadCrumbs) {
      // Amazon uses breadCrumbs string
      const breadcrumbArray = item.breadCrumbs.split(' › ');
      return breadcrumbArray[breadcrumbArray.length - 1];
    }
    
    if (retailerType === 'wayfair' && item.breadcrumbs && Array.isArray(item.breadcrumbs)) {
      // Wayfair uses breadcrumbs array
      return item.breadcrumbs[item.breadcrumbs.length - 2] || item.breadcrumbs[item.breadcrumbs.length - 1];
    }
    
    // Generic category extraction
    if (item.category) {
      return Array.isArray(item.category) ? item.category[item.category.length - 1] : item.category;
    }
    
    return null;
  }

  extractVariant(item, retailerType) {
    // Try enhanced variant first (from custom extraction)
    if (item.enhancedVariant) {
      console.log(`   🎨 Using enhanced variant: ${item.enhancedVariant}`);
      return item.enhancedVariant;
    }
    
    if (retailerType === 'amazon' && item.variantAttributes && Array.isArray(item.variantAttributes)) {
      const variants = item.variantAttributes.map(attr => `${attr.name}: ${attr.value}`);
      return variants.join(', ');
    }
    
    if (retailerType === 'wayfair' && item.attributes && item.attributes.color) {
      return `Color: ${item.attributes.color}`;
    }
    
    // Generic variant extraction
    const variantFields = ['variant', 'color', 'size', 'style'];
    for (const field of variantFields) {
      if (item[field] && typeof item[field] === 'string' && item[field].trim()) {
        const variant = item[field].trim();
        if (variant.length >= 2 && variant.length <= 50) {
          return variant;
        }
      }
    }
    
    return null;
  }

  extractAvailability(item, retailerType) {
    const availabilityFields = ['inStock', 'in_stock', 'availability'];
    
    for (const field of availabilityFields) {
      if (item[field] !== undefined) {
        if (typeof item[field] === 'boolean') {
          return item[field];
        }
        
        if (typeof item[field] === 'string') {
          const availability = item[field].toLowerCase();
          return !availability.includes('out of stock') && 
                 !availability.includes('unavailable') &&
                 !availability.includes('sold out');
        }
      }
    }
    
    return true; // Default to in stock
  }
}

module.exports = ApifyActorScraper;