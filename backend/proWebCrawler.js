// backend/proWebCrawler.js
const { chromium } = require('playwright');

class ProWebCrawler {
  constructor() {
    this.enabled = true; // Always enabled since it doesn't need API keys
    console.log('🕸️ ProWebCrawler initialized');
  }

  isAvailable() {
    return this.enabled;
  }

  async scrapeProduct(url) {
    console.log('🕸️ ProWebCrawler starting...');
    
    let browser = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });

      const page = await browser.newPage();
      
      // Set user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Navigate to the page
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      
      // Wait for dynamic content
      await page.waitForTimeout(2000);

      // Extract product data
      const productData = await page.evaluate(() => {
        const data = {
          name: null,
          price: null,
          image: null,
          variant: null,
          dimensions: null,
          weight: null,
          brand: null,
          inStock: true
        };

        // Extract title - comprehensive selectors
        const titleSelectors = [
          'h1[data-testid="product-title"]',
          'h1.ProductTitle',
          'h1[data-automation-id="product-title"]',
          'h1.sr-only',
          'h1',
          '.product-title h1',
          '.product-name h1',
          '[data-testid="product-name"]'
        ];
        
        for (const selector of titleSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim()) {
            data.name = element.textContent.trim();
            break;
          }
        }

        // Extract price - comprehensive selectors
        const priceSelectors = [
          '.MoneyPrice',
          '.a-price-whole',
          '[data-test="product-price"]',
          '[data-automation-id="product-price"]',
          '.pricing-price__value',
          '.price',
          '[class*="price"]',
          '.current-price',
          '.sale-price'
        ];
        
        for (const selector of priceSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            const priceText = element.textContent.replace(/[^0-9.]/g, '');
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
          'img[class*="product"]',
          '.hero-image img'
        ];
        
        for (const selector of imageSelectors) {
          const element = document.querySelector(selector);
          if (element && element.src && element.src.startsWith('http')) {
            data.image = element.src;
            break;
          }
        }

        // Extract variant information
        const variantSelectors = [
          '.SelectedOption',
          '.selected-option',
          '[aria-selected="true"]',
          '.variant-selected',
          '.option-selected'
        ];
        
        for (const selector of variantSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim() && 
              !element.textContent.trim().match(/^(select|choose|option|default)$/i)) {
            data.variant = element.textContent.trim();
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

        // Check availability
        const unavailableKeywords = /out of stock|unavailable|sold out|not available/i;
        data.inStock = !unavailableKeywords.test(bodyText);

        return data;
      });

      console.log('✅ ProWebCrawler completed successfully');
      return this.cleanResult(productData);

    } catch (error) {
      console.error('❌ ProWebCrawler failed:', error.message);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
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
}

module.exports = ProWebCrawler;