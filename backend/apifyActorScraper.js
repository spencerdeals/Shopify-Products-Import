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
        timeout: 60000, // 1 minute - much faster
        memory: 1024,
        maxRetries: 1,
        getInput: (url, userAgent) => ({
          startUrls: [{ url }],
          maxItems: 1,
          proxyConfiguration: { useApifyProxy: true },
          customHttpRequestHeaders: userAgent ? {
            'User-Agent': userAgent
          } : undefined
        })
      },
      wayfair: {
        actorId: 'dtrungtin/wayfair-scraper',
        timeout: 45000, // 45 seconds
        memory: 1024,
        maxRetries: 1,
        getInput: (url, userAgent) => ({
          startUrls: [{ url }],
          maxItems: 1,
          proxyConfiguration: { useApifyProxy: true },
          customHttpRequestHeaders: userAgent ? {
            'User-Agent': userAgent
          } : undefined
        })
      },
      generic: {
        actorId: 'apify/web-scraper',
        timeout: 30000, // 30 seconds
        memory: 1024,
        maxRetries: 1,
        getInput: (url, userAgent) => ({
          startUrls: [{ url }],
          maxRequestsPerCrawl: 1,
          proxyConfiguration: { useApifyProxy: true },
          customHttpRequestHeaders: userAgent ? {
            'User-Agent': userAgent
          } : undefined,
          pageFunction: `async function pageFunction(context) {
            const { page } = context;
            await page.waitForTimeout(2000);
            
            // Enhanced extraction with multiple selectors
            const result = await page.evaluate(() => {
              // Title extraction with multiple selectors
              const titleSelectors = [
                'h1[data-testid*="title"]', 'h1[data-testid*="name"]',
                '#productTitle', 'h1.product-title', 'h1.ProductTitle',
                'h1', '.product-title h1', '.product-name h1'
              ];
              
              let title = null;
              for (const selector of titleSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim()) {
                  title = el.textContent.trim();
                  break;
                }
              }
              
              // Price extraction with multiple selectors and patterns
              const priceSelectors = [
                '.MoneyPrice', '[data-testid="price"]', '.a-price .a-offscreen',
                '.price', '[class*="price"]', '.current-price', '.sale-price'
              ];
              
              let price = null;
              for (const selector of priceSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                  const match = el.textContent.match(/[\d,]+\.?\d*/);
                  if (match) {
                    price = parseFloat(match[0].replace(/,/g, ''));
                    if (price > 0) break;
                  }
                }
              }
              
              // Image extraction
              const imageSelectors = [
                'img[data-testid*="image"]', '#landingImage', '.product-image img',
                'img[class*="product"]', '.hero-image img'
              ];
              
              let image = null;
              for (const selector of imageSelectors) {
                const el = document.querySelector(selector);
                if (el && el.src && el.src.startsWith('http')) {
                  image = el.src;
                  break;
                }
              }
              
              return { title, price, image };
            });
            
            return result;
          }`
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
    
    // Simple, working actor configurations
    let actorId, input;
    
    if (retailerType === 'amazon') {
      actorId = 'junglee/amazon-crawler';
      input = { startUrls: [{ url }], maxItems: 1 };
    } else if (retailerType === 'wayfair') {
      actorId = '123webdata/wayfair-scraper';
      input = { startUrls: [{ url }], maxItems: 1 };
    } else {
      actorId = 'apify/web-scraper';
      input = {
        startUrls: [{ url }],
        maxRequestsPerCrawl: 1,
        pageFunction: `async function pageFunction(context) {
          const { page } = context;
          await page.waitForTimeout(2000);
          
          const result = await page.evaluate(() => {
            let title = null;
            let price = null;
            let image = null;
            
            // Simple title extraction
            const titleEl = document.querySelector('h1') || document.querySelector('.product-title') || document.querySelector('[class*="title"]');
            if (titleEl) title = titleEl.textContent.trim();
            
            // Simple price extraction
            const priceEl = document.querySelector('.price') || document.querySelector('[class*="price"]');
            if (priceEl) {
              const match = priceEl.textContent.match(/[\d,]+\.?\d*/);
              if (match) price = parseFloat(match[0].replace(/,/g, ''));
            }
            
            // Simple image extraction
            const imgEl = document.querySelector('.product-image img') || document.querySelector('img[class*="product"]');
            if (imgEl && imgEl.src) image = imgEl.src;
            
            return { title, price, image };
          });
          
          return result;
        }`
      };
    }
    
    try {
      const run = await this.client.actor(actorId).call(input, {
        timeout: 60000, // 1 minute
        memory: 1024
      });
      
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        return this.cleanResult(items[0]);
      }
      
      return null;
      
    } catch (error) {
      throw error;
    }
  }

  cleanResult(item) {
    return {
      name: item.name || item.title || null,
      price: item.price || null,
      image: item.image || null,
      dimensions: null,
      weight: null,
      brand: item.brand || null,
      category: item.category || null,
      inStock: true,
      variant: item.variant || null
    };
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
      if (item[field] !== undefined && item[field] !== null) {
        let price = item[field];
        
        if (typeof price === 'string') {
          // Extract numeric value from string
          const match = price.match(/[\d,]+\.?\d*/);
          if (match) {
            price = parseFloat(match[0].replace(/,/g, ''));
          }
        }
        
        if (typeof price === 'number' && price > 0) {
          console.log(`   💰 Extracted price from ${field}: $${price}`);
          return price;
        }
      }
    }
    
    return null;
  }

  extractVariant(item, retailerType) {
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