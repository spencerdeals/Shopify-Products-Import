// backend/proWebCrawler.js
// Pro Web Content Crawler integration for better scraping

const { PlaywrightCrawler, Dataset } = require('crawlee');

class ProWebCrawler {
  constructor() {
    this.enabled = true;
    console.log('🕸️ ProWebCrawler initialized');
  }

  isAvailable() {
    return this.enabled;
  }

  async scrapeProduct(url) {
    console.log(`🕸️ ProWebCrawler scraping: ${url.substring(0, 60)}...`);
    
    try {
      const dataset = await Dataset.open();
      
      const crawler = new PlaywrightCrawler({
        requestHandler: async ({ page, request, enqueueLinks }) => {
          console.log(`🕸️ Processing ${request.url}`);
          
          // Wait for content to load
          await page.waitForTimeout(3000);
          
          // Extract product data
          const productData = await page.evaluate(() => {
            const data = {
              name: null,
              price: null,
              variant: null,
              image: null,
              dimensions: null,
              weight: null,
              brand: null,
              inStock: true
            };
            
            // Extract title - comprehensive selectors
            const titleSelectors = [
              'h1[data-testid*="title"]',
              'h1[data-testid*="product"]',
              'h1.ProductTitle',
              '#productTitle',
              'h1[data-automation-id*="title"]',
              'h1[class*="product"]',
              'h1[class*="title"]',
              '.product-title h1',
              '.pdp-product-name h1',
              'h1'
            ];
            
            for (const selector of titleSelectors) {
              const element = document.querySelector(selector);
              if (element && element.textContent.trim()) {
                data.name = element.textContent.trim();
                break;
              }
            }
            
            // Extract variant information - enhanced patterns
            const variantSelectors = [
              // Wayfair specific
              '[data-testid*="selected"] [data-testid*="option"]',
              '.SelectedOption',
              '.selected-option',
              '[class*="selected"][class*="option"]',
              
              // Generic variant selectors
              '.variant-selected',
              '.option-selected',
              '[data-selected="true"]',
              '.swatch.selected',
              '.color-option.selected',
              '.size-option.selected',
              
              // Amazon specific
              '#variation_color_name .selection',
              '#variation_size_name .selection',
              
              // Target specific
              '[data-test*="selected"]',
              
              // Walmart specific
              '[data-automation-id*="selected"]'
            ];
            
            for (const selector of variantSelectors) {
              const element = document.querySelector(selector);
              if (element && element.textContent.trim()) {
                const variantText = element.textContent.trim();
                if (variantText.length > 0 && variantText.length < 100) {
                  data.variant = variantText;
                  break;
                }
              }
            }
            
            // Extract price - very comprehensive
            const priceSelectors = [
              // Wayfair specific
              '.MoneyPrice',
              '[data-testid*="price"]',
              '.PriceBlock',
              '.price-block',
              
              // Amazon specific
              '.a-price-whole',
              '.a-price .a-offscreen',
              '#priceblock_dealprice',
              '#priceblock_ourprice',
              
              // Target specific
              '[data-test*="price"]',
              
              // Walmart specific
              '[data-automation-id*="price"]',
              
              // Generic
              '.price',
              '[class*="price"]',
              '[id*="price"]'
            ];
            
            let bestPrice = null;
            const foundPrices = [];
            
            for (const selector of priceSelectors) {
              const elements = document.querySelectorAll(selector);
              elements.forEach(element => {
                const text = element.textContent || element.getAttribute('content') || '';
                const priceMatch = text.match(/\$?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/);
                if (priceMatch) {
                  const price = parseFloat(priceMatch[1].replace(/,/g, ''));
                  if (price >= 10 && price <= 50000) {
                    foundPrices.push(price);
                  }
                }
              });
            }
            
            // For furniture and large items, prefer higher prices
            if (foundPrices.length > 0) {
              const productText = (data.name || '').toLowerCase();
              const isFurniture = /sofa|chair|table|bed|dresser|cabinet|furniture|seating|dining/i.test(productText);
              
              if (isFurniture) {
                // For furniture, take the highest reasonable price
                bestPrice = Math.max(...foundPrices);
              } else {
                // For other items, take median price
                foundPrices.sort((a, b) => a - b);
                const mid = Math.floor(foundPrices.length / 2);
                bestPrice = foundPrices.length % 2 === 0 
                  ? (foundPrices[mid - 1] + foundPrices[mid]) / 2 
                  : foundPrices[mid];
              }
            }
            
            data.price = bestPrice;
            
            // Extract main image
            const imageSelectors = [
              'img[data-testid*="image"]',
              'img[data-testid*="product"]',
              '#landingImage',
              '.ProductImages img',
              'img[data-automation-id*="image"]',
              '.product-image img',
              'img[class*="product"][class*="image"]',
              'img[src*="product"]'
            ];
            
            for (const selector of imageSelectors) {
              const img = document.querySelector(selector);
              if (img && img.src && img.src.startsWith('http') && !img.src.includes('placeholder')) {
                data.image = img.src;
                break;
              }
            }
            
            // Extract dimensions from page text
            const pageText = document.body.textContent;
            const dimMatch = pageText.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i);
            if (dimMatch) {
              data.dimensions = {
                length: parseFloat(dimMatch[1]),
                width: parseFloat(dimMatch[2]),
                height: parseFloat(dimMatch[3])
              };
            }
            
            // Extract weight
            const weightMatch = pageText.match(/(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?|kg)/i);
            if (weightMatch) {
              let weight = parseFloat(weightMatch[1]);
              if (weightMatch[0].toLowerCase().includes('kg')) {
                weight *= 2.205; // Convert to pounds
              }
              data.weight = weight;
            }
            
            // Check availability
            const outOfStockKeywords = /out of stock|unavailable|sold out|not available|temporarily unavailable/i;
            data.inStock = !outOfStockKeywords.test(pageText);
            
            return data;
          });
          
          // Save to dataset
          await dataset.pushData({
            url: request.url,
            ...productData,
            scrapedAt: new Date().toISOString()
          });
        },
        
        // Configuration
        maxRequestsPerCrawl: 1,
        requestHandlerTimeoutSecs: 60,
        navigationTimeoutSecs: 30,
        
        // Use stealth mode
        launchContext: {
          launchOptions: {
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu'
            ]
          }
        }
      });
      
      // Add the URL to crawl
      await crawler.addRequests([url]);
      
      // Run the crawler
      await crawler.run();
      
      // Get results
      const results = await dataset.getData();
      
      if (results.items && results.items.length > 0) {
        const result = results.items[0];
        console.log(`✅ ProWebCrawler succeeded for ${this.detectRetailer(url)}`);
        console.log(`   📝 Name: ${result.name ? 'Found' : 'Missing'}`);
        console.log(`   💰 Price: ${result.price ? '$' + result.price : 'Missing'}`);
        console.log(`   🎨 Variant: ${result.variant || 'None'}`);
        console.log(`   🖼️ Image: ${result.image ? 'Found' : 'Missing'}`);
        
        return this.cleanResult(result);
      }
      
      throw new Error('No results from ProWebCrawler');
      
    } catch (error) {
      console.error(`❌ ProWebCrawler failed: ${error.message}`);
      throw error;
    }
  }
  
  detectRetailer(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain.includes('wayfair')) return 'Wayfair';
      if (domain.includes('amazon')) return 'Amazon';
      if (domain.includes('walmart')) return 'Walmart';
      if (domain.includes('target')) return 'Target';
      if (domain.includes('bestbuy')) return 'BestBuy';
      if (domain.includes('homedepot')) return 'HomeDepot';
      return 'Unknown';
    } catch {
      return 'Unknown';
    }
  }
  
  cleanResult(item) {
    return {
      name: item.name || null,
      price: item.price || null,
      variant: item.variant || null,
      image: item.image || null,
      dimensions: item.dimensions || null,
      weight: item.weight || null,
      brand: item.brand || null,
      category: item.category || null,
      inStock: item.inStock !== false
    };
  }
}

module.exports = ProWebCrawler;