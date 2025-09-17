// apifyScraper.js
const axios = require('axios');
const { ApifyClient } = require('apify-client');

// NEW: optional GPT fallback
const USE_GPT_FALLBACK = (process.env.USE_GPT_FALLBACK || 'false').toLowerCase() === 'true';
let gptParser = null;
if (USE_GPT_FALLBACK) {
  try {
    gptParser = require('./gptParser');
    console.log('🧠 GPT fallback enabled (gptParser.js loaded)');
  } catch (e) {
    console.warn('⚠️ GPT fallback requested but gptParser.js not found. Continuing without it.');
  }
}

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

    let result = null;

    try {
      if (retailer === 'Wayfair') {
        result = await this.scrapeWayfair(url);
      } else {
        result = await this.scrapeGeneric(url);
      }
    } catch (error) {
      console.error(`❌ Apify ${retailer} scraping failed:`, error.message);
      result = null;
    }

    // === GPT fallback ===
    if (!result && USE_GPT_FALLBACK && gptParser) {
      try {
        console.log('🧠 Falling back to GPT parser...');
        result = await gptParser.parseProduct(url, { currencyFallback: 'USD' });
        if (result) console.log('✅ GPT fallback succeeded:', (result.name || 'Unnamed').slice(0, 60));
      } catch (e) {
        console.warn('⚠️ GPT fallback failed:', e.message);
      }
    }

    return result;
  }

  async scrapeWayfair(url) {
    try {
      console.log('🏠 Scraping Wayfair with 123webdata/wayfair-scraper...');
      const input = { urls: [url] };

      // IMPORTANT: waitSecs so we actually wait for the run to finish
      const run = await this.client.actor('123webdata/wayfair-scraper').call(input, {
        timeout: 180000, // 3 min ceiling for tough pages
        memory: 2048,
        waitSecs: 90     // wait up to 90s for the actor to finish
      });

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      if (items && items.length > 0) {
        const item = items[0];
        console.log('✅ Wayfair scraper successful');
        console.log('   📝 Name:', (item.name || item.title || 'Not found').substring(0, 50) + '...');
        console.log('   💰 Price:', item.price || item.currentPrice || 'Not found');

        let dimensions = null;
        if (item.dimensions) {
          const dimMatch = item.dimensions.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
          if (dimMatch) {
            dimensions = {
              length: parseFloat(dimMatch[1]),
              width: parseFloat(dimMatch[2]),
              height: parseFloat(dimMatch[3])
            };
          }
        }
        
        return {
          name: item.name || item.title || null,
          price: item.price || item.currentPrice || null,
          image: item.image || item.imageUrl || null,
          dimensions,
          weight: item.weight || null,
          brand: item.brand || null,
          category: item.category || null,
          inStock: item.inStock !== false
        };
      }

      console.log('❌ Wayfair scraper returned no data');
      return null;
    } catch (error) {
      console.error('❌ Wayfair scraper failed:', error.message);
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
              const nameSelectors = ['h1', '.product-title', '.product-name', '[data-testid*="title"]'];
              const priceSelectors = ['.price', '[data-testid*="price"]', '[class*="price"]'];
              const imageSelectors = ['.product-image img', '.main-image img', 'img[data-testid*="image"]'];
              
              let name = null;
              for (const selector of nameSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim()) { name = el.textContent.trim(); break; }
              }
              
              let price = null;
              for (const selector of priceSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                  const match = el.textContent.match(/\\$([\\d,]+(?:\\.\\d{2})?)/);
                  if (match) { price = parseFloat(match[1].replace(/,/g, '')); break; }
                }
              }
              
              let image = null;
              for (const selector of imageSelectors) {
                const el = document.querySelector(selector);
                if (el && el.src) { image = el.src; break; }
              }
              
              return { name, price, image };
            });
          }
        `,
        maxRequestsPerCrawl: 1,
        proxyConfiguration: { useApifyProxy: true }
      };

      const run = await this.client.actor('apify/web-scraper').call(input, {
        timeout: 60000,
        memory: 512,
        waitSecs: 45
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
