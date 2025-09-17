const axios = require('axios');
const { ApifyClient } = require('apify-client');

class ApifyScraper {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = apiKey ? new ApifyClient({ token: apiKey }) : null;
    this.enabled = !!apiKey;
    
    if (this.enabled) {
      console.log('✅ ApifyScraper initialized successfully');
    } else {
      console.log('❌ ApifyScraper disabled - no API key provided');
    }
  }

  isAvailable() {
    return this.enabled;
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Apify not configured');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🔄 Apify scraping ${retailer} product...`);

    try {
      // For Wayfair, use the Web Scraper with custom selectors
      if (retailer === 'Wayfair') {
        return await this.scrapeWayfair(url);
      }
      
      // For other retailers, use generic web scraper
      return await this.scrapeGeneric(url);
      
    } catch (error) {
      console.error(`❌ Apify ${retailer} scraping failed:`, error.message);
      return null;
    }
  }

  async scrapeWayfair(url) {
    try {
      console.log('🏠 Scraping Wayfair with Web Scraper...');
      
      const input = {
        startUrls: [{ url }],
        pageFunction: `
          async function pageFunction(context) {
            const { page, request } = context;
            
            // Wait for page to load
            await page.waitForTimeout(3000);
            
            // Extract product data
            const result = await page.evaluate(() => {
              // Product name
              const nameSelectors = [
                'h1[data-enzyme-id="ProductTitle"]',
                'h1.ProductDetailInfoBlock-productTitle',
                'h1[data-testid="product-title"]',
                '.ProductDetailInfoBlock h1',
                'h1'
              ];
              
              let name = null;
              for (const selector of nameSelectors) {
                const element = document.querySelector(selector);
                if (element && element.textContent.trim()) {
                  name = element.textContent.trim();
                  break;
                }
              }
              
              // Price
              const priceSelectors = [
                '[data-enzyme-id="PriceBlock"] .BaseFontStyles',
                '.ProductDetailInfoBlock-price',
                '[data-testid="price"]',
                '.price',
                '[class*="price"]'
              ];
              
              let price = null;
              for (const selector of priceSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                  const priceText = element.textContent;
                  const match = priceText.match(/\\$([\\d,]+(?:\\.\\d{2})?)/);
                  if (match) {
                    price = parseFloat(match[1].replace(/,/g, ''));
                    break;
                  }
                }
              }
              
              // Image
              const imageSelectors = [
                '[data-enzyme-id="ProductImageCarousel"] img',
                '.ProductImageCarousel img',
                '.product-image img',
                'img[data-testid="product-image"]'
              ];
              
              let image = null;
              for (const selector of imageSelectors) {
                const element = document.querySelector(selector);
                if (element && element.src) {
                  image = element.src;
                  break;
                }
              }
              
              // Dimensions from specifications
              let dimensions = null;
              const specElements = document.querySelectorAll('[data-testid="specifications"] tr, .specifications tr, .product-specs tr');
              for (const row of specElements) {
                const text = row.textContent.toLowerCase();
                if (text.includes('dimension') || text.includes('size')) {
                  const match = text.match(/(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)/);
                  if (match) {
                    dimensions = {
                      length: parseFloat(match[1]),
                      width: parseFloat(match[2]),
                      height: parseFloat(match[3])
                    };
                    break;
                  }
                }
              }
              
              return {
                name,
                price,
                image,
                dimensions,
                url: window.location.href
              };
            });
            
            return result;
          }
        `,
        maxRequestsPerCrawl: 1,
        proxyConfiguration: { useApifyProxy: true }
      };

      const run = await this.client.actor('apify/web-scraper').call(input, {
        timeout: 60000,
        memory: 1024
      });

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('✅ Wayfair Web Scraper successful');
        console.log('   📝 Name:', item.name?.substring(0, 50) + '...');
        console.log('   💰 Price:', item.price ? `$${item.price}` : 'Not found');
        
        return {
          name: item.name || null,
          price: item.price || null,
          image: item.image || null,
          dimensions: item.dimensions || null,
          weight: null,
          brand: null,
          category: null,
          inStock: true
        };
      }
      
      console.log('❌ Wayfair Web Scraper returned no data');
      return null;
      
    } catch (error) {
      console.error('❌ Wayfair Web Scraper failed:', error.message);
      return null;
    }
  }

  async scrapeGeneric(url) {
    try {
      console.log('🔄 Using generic web scraper...');
      
      const input = {
        startUrls: [{ url }],
        pageFunction: `
          async function pageFunction(context) {
            const { page } = context;
            await page.waitForTimeout(2000);
            
            return await page.evaluate(() => {
              // Generic selectors for common e-commerce sites
              const nameSelectors = ['h1', '.product-title', '.product-name', '[data-testid*="title"]'];
              const priceSelectors = ['.price', '[data-testid*="price"]', '[class*="price"]'];
              const imageSelectors = ['.product-image img', '.main-image img', 'img[data-testid*="image"]'];
              
              let name = null;
              for (const selector of nameSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim()) {
                  name = el.textContent.trim();
                  break;
                }
              }
              
              let price = null;
              for (const selector of priceSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                  const match = el.textContent.match(/\\$([\\d,]+(?:\\.\\d{2})?)/);
                  if (match) {
                    price = parseFloat(match[1].replace(/,/g, ''));
                    break;
                  }
                }
              }
              
              let image = null;
              for (const selector of imageSelectors) {
                const el = document.querySelector(selector);
                if (el && el.src) {
                  image = el.src;
                  break;
                }
              }
              
              return { name, price, image };
            });
          }
        `,
        maxRequestsPerCrawl: 1,
        proxyConfiguration: { useApifyProxy: true }
      };

      const run = await this.client.actor('apify/web-scraper').call(input, {
        timeout: 45000,
        memory: 512
      });

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('✅ Generic scraper successful');
        
        return {
          name: item.name || null,
          price: item.price || null,
          image: item.image || null,
          dimensions: null,
          weight: null,
          brand: null,
          category: null,
          inStock: true
        };
      }
      
      return null;
      
    } catch (error) {
      console.error('❌ Generic scraper failed:', error.message);
      return null;
    }
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
}

module.exports = ApifyScraper;