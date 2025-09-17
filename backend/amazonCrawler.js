// backend/amazonCrawler.js
const { chromium } = require('playwright');

class AmazonCrawler {
  constructor() {
    this.enabled = true; // Always enabled since it doesn't need API keys
    console.log('🛒 AmazonCrawler initialized');
  }

  isAvailable() {
    return this.enabled;
  }

  async scrapeProduct(url) {
    if (!this.isAmazonUrl(url)) {
      throw new Error('Not an Amazon URL');
    }

    console.log('🛒 Amazon crawler starting...');
    
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
      
      // Set user agent to avoid detection
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Navigate to the page
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      
      // Wait a bit for dynamic content
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

        // Extract title
        const titleSelectors = [
          '#productTitle',
          'h1.a-size-large',
          'h1[data-automation-id="product-title"]',
          'h1'
        ];
        
        for (const selector of titleSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim()) {
            data.name = element.textContent.trim();
            break;
          }
        }

        // Extract price
        const priceSelectors = [
          '.a-price-whole',
          '.a-price .a-offscreen',
          '[data-testid="price"]',
          '.a-price-range .a-price .a-offscreen'
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
          '#landingImage',
          '.a-dynamic-image',
          'img[data-old-hires]',
          '.imgTagWrapper img'
        ];
        
        for (const selector of imageSelectors) {
          const element = document.querySelector(selector);
          if (element && element.src && element.src.startsWith('http')) {
            data.image = element.src;
            break;
          }
        }

        // Extract variant (color, size, style)
        const variantSelectors = [
          '.a-dropdown-prompt',
          '.selection .a-color-base',
          '[data-csa-c-content-id] .a-color-base',
          '.a-button-selected .a-button-text'
        ];
        
        for (const selector of variantSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim() && 
              !element.textContent.trim().match(/^(select|choose|option|default)$/i)) {
            data.variant = element.textContent.trim();
            break;
          }
        }

        // Extract dimensions from product details
        const detailsText = document.body.textContent;
        const dimMatch = detailsText.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i);
        if (dimMatch) {
          data.dimensions = {
            length: parseFloat(dimMatch[1]),
            width: parseFloat(dimMatch[2]),
            height: parseFloat(dimMatch[3])
          };
        }

        // Extract weight
        const weightMatch = detailsText.match(/(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i);
        if (weightMatch) {
          data.weight = parseFloat(weightMatch[1]);
        }

        // Check availability
        const unavailableKeywords = /currently unavailable|out of stock|temporarily out of stock/i;
        data.inStock = !unavailableKeywords.test(detailsText);

        return data;
      });

      console.log('✅ Amazon crawler completed successfully');
      return this.cleanResult(productData);

    } catch (error) {
      console.error('❌ Amazon crawler failed:', error.message);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  isAmazonUrl(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      return domain.includes('amazon.com') || domain.includes('amazon.');
    } catch (e) {
      return false;
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

module.exports = AmazonCrawler;