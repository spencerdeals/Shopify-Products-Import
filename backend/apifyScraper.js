// backend/apifyScraper.js
const { ApifyClient } = require('apify-client');

class ApifyScraper {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = apiKey ? new ApifyClient({ token: apiKey }) : null;
    this.enabled = !!apiKey;
    
    console.log(`🕷️ ApifyScraper ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  isAvailable() {
    return this.enabled;
  }

  detectRetailer(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain.includes('amazon.com')) return 'Amazon';
      if (domain.includes('wayfair.com')) return 'Wayfair';
      if (domain.includes('target.com')) return 'Target';
      if (domain.includes('walmart.com')) return 'Walmart';
      if (domain.includes('bestbuy.com')) return 'Best Buy';
      if (domain.includes('homedepot.com')) return 'Home Depot';
      if (domain.includes('lowes.com')) return 'Lowes';
      return 'Unknown';
    } catch (e) {
      return 'Unknown';
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Apify not configured - no API key provided');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🕷️ Apify scraping ${retailer}: ${url.substring(0, 60)}...`);

    try {
      // Use web scraper with custom page function
      const input = {
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
                inStock: true
              };
              
              // Extract title - multiple selectors for different sites
              const titleSelectors = [
                'h1[data-testid="product-title"]', // Wayfair
                '#productTitle', // Amazon
                'h1.ProductTitle', // Target
                'h1[data-automation-id="product-title"]', // Walmart
                'h1.sr-only', // Best Buy
                'h1', // Generic fallback
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
                '.MoneyPrice', // Wayfair
                '.a-price-whole', // Amazon
                '[data-test="product-price"]', // Target
                '[data-automation-id="product-price"]', // Walmart
                '.pricing-price__value', // Best Buy
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
              const dimMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i);
              if (dimMatch) {
                data.dimensions = {
                  length: parseFloat(dimMatch[1]),
                  width: parseFloat(dimMatch[2]),
                  height: parseFloat(dimMatch[3])
                };
              }
              
              // Extract weight
              const weightMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i);
              if (weightMatch) {
                data.weight = parseFloat(weightMatch[1]);
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

      const run = await this.client.actor('apify/web-scraper').call(input, {
        timeout: 60000, // 60 seconds
        memory: 1024,
        waitSecs: 45
      });

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        console.log(`✅ Apify scraping succeeded for ${retailer}`);
        return this.cleanResult(items[0]);
      }
      
      throw new Error('No results from Apify scraper');
      
    } catch (error) {
      console.error(`❌ Apify scraping failed: ${error.message}`);
      throw error;
    }
  }

  cleanResult(item) {
    return {
      name: item.name || null,
      price: item.price || null,
      image: item.image || null,
      variant: item.variant || null,
      dimensions: item.dimensions || null,
      weight: item.weight || null,
      brand: item.brand || null,
      category: item.category || null,
      inStock: item.inStock !== false
    };
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
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    return results;
  }
}

module.exports = ApifyScraper;
