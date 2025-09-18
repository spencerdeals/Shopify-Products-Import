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
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      
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
          '.imgTagWrapper img',
          'img[data-a-dynamic-image]',
          '#imgBlkFront',
          '.a-spacing-small img'
        ];
        
        for (const selector of imageSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            let imgSrc = element.src || element.getAttribute('data-old-hires') || element.getAttribute('data-a-dynamic-image');
            if (imgSrc) {
              // Handle relative URLs
              if (imgSrc.startsWith('//')) {
                imgSrc = 'https:' + imgSrc;
              } else if (imgSrc.startsWith('/')) {
                imgSrc = 'https://images-na.ssl-images-amazon.com' + imgSrc;
              }
              
              if (imgSrc.startsWith('http')) {
                data.image = imgSrc;
                break;
              }
            }
          }
        }

        // If still no image, try multiple fallback methods
        if (!data.image) {
          // Method 1: Try data-src attribute
          for (const selector of imageSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              let imgSrc = element.getAttribute('data-src');
              if (imgSrc && imgSrc.startsWith('http')) {
                data.image = imgSrc;
                break;
              }
            }
          }
        }
        
        // Method 2: Try to get from JSON data in scripts
        if (!data.image) {
          const scriptTags = document.querySelectorAll('script');
          for (const script of scriptTags) {
            if (script.textContent.includes('ImageBlockATF') || script.textContent.includes('colorImages')) {
              try {
                // Try hiRes first
                let match = script.textContent.match(/"hiRes":"([^"]+)"/);
                if (!match) {
                  // Try large image
                  match = script.textContent.match(/"large":"([^"]+)"/);
                }
                if (!match) {
                  // Try main image
                  match = script.textContent.match(/"main":\{"([^"]+)"/);
                }
                if (match && match[1]) {
                  let imgUrl = match[1].replace(/\\u[\dA-F]{4}/gi, '').replace(/\\/g, '');
                  if (imgUrl.startsWith('http')) {
                    data.image = imgUrl;
                  }
                  break;
                }
              } catch (e) {
                // Continue searching
              }
            }
          }
        }
        
        // Method 3: Try og:image meta tag
        if (!data.image) {
          const ogImage = document.querySelector('meta[property="og:image"]');
          if (ogImage && ogImage.content && ogImage.content.startsWith('http')) {
            data.image = ogImage.content;
          }
        }
        
        // Method 4: Try any Amazon image with specific patterns
        if (!data.image) {
          const allImages = document.querySelectorAll('img');
          for (const img of allImages) {
            const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-old-hires');
            if (src && src.includes('images-na.ssl-images-amazon.com') && 
                (src.includes('_AC_') || src.includes('_SL') || src.includes('_UL'))) {
              data.image = src;
              break;
            }
          }
        }

        // Extract variant (color, size, style)
        const variantSelectors = [
          '.a-button-selected .a-button-text',
          '.a-dropdown-prompt',
          '#variation_color_name .selection',
          '#variation_size_name .selection',
          '#variation_style_name .selection',
          '.swatches .a-button-selected span',
          '.selection .a-color-base'
        ];
        
        for (const selector of variantSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim() && 
              !element.textContent.trim().match(/^(select|choose|option|default|click|tap)$/i)) {
            const variantText = element.textContent.trim();
            // Only use if it's not just numbers or codes
            if (!/^[\d\-_]+$/.test(variantText) && variantText.length >= 3 && variantText.length <= 50) {
              data.variant = variantText;
              break;
            }
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