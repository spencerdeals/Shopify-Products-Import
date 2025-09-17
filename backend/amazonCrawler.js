const axios = require('axios');
const cheerio = require('cheerio');

class AmazonCrawler {
  constructor() {
    this.available = true;
    console.log('🛒 AmazonCrawler initialized (standalone implementation)');
  }

  isAvailable() {
    return this.available;
  }

  // Extract ASIN from Amazon URL
  extractASIN(url) {
    try {
      const asinPatterns = [
        /\/dp\/([A-Z0-9]{10})/i,
        /\/gp\/product\/([A-Z0-9]{10})/i,
        /\/product\/([A-Z0-9]{10})/i,
        /asin=([A-Z0-9]{10})/i,
        /\/([A-Z0-9]{10})(?:\/|\?|$)/i
      ];

      for (const pattern of asinPatterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }
      return null;
    } catch (error) {
      console.log('   ❌ ASIN extraction failed:', error.message);
      return null;
    }
  }

  // Extract variant information from text
  extractVariant(text) {
    if (!text) return null;

    // Common variant patterns
    const variantPatterns = [
      // Color patterns
      /color[:\s]+([^,\n\r]+)/i,
      /colour[:\s]+([^,\n\r]+)/i,
      // Size patterns
      /size[:\s]+([^,\n\r]+)/i,
      // Style patterns
      /style[:\s]+([^,\n\r]+)/i,
      // Pattern/design
      /pattern[:\s]+([^,\n\r]+)/i,
      // Material
      /material[:\s]+([^,\n\r]+)/i,
      // Flavor (for consumables)
      /flavor[:\s]+([^,\n\r]+)/i,
      /flavour[:\s]+([^,\n\r]+)/i
    ];

    for (const pattern of variantPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const variant = match[1].trim().replace(/[^\w\s-]/g, '').substring(0, 50);
        if (variant.length > 2 && !variant.match(/^(select|choose|option|default|none|n\/a)$/i)) {
          return variant;
        }
      }
    }

    return null;
  }

  // Parse dimensions from text
  parseDimensions(text) {
    if (!text) return null;

    const dimPatterns = [
      // Standard format: 12 x 8 x 6 inches
      /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i,
      // With dimensions label
      /dimensions?[:\s]+(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
      // Product dimensions
      /product\s+dimensions?[:\s]+(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i
    ];

    for (const pattern of dimPatterns) {
      const match = text.match(pattern);
      if (match) {
        const length = parseFloat(match[1]);
        const width = parseFloat(match[2]);
        const height = parseFloat(match[3]);
        
        if (length > 0 && width > 0 && height > 0 && length < 1000 && width < 1000 && height < 1000) {
          return { length, width, height };
        }
      }
    }

    return null;
  }

  // Parse weight from text
  parseWeight(text) {
    if (!text) return null;

    const weightPatterns = [
      // Pounds
      /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?|lb\.?)/i,
      // Kilograms (convert to pounds)
      /(\d+(?:\.\d+)?)\s*(?:kilograms?|kgs?|kg\.?)/i,
      // Ounces (convert to pounds)
      /(\d+(?:\.\d+)?)\s*(?:ounces?|ozs?|oz\.?)/i
    ];

    for (let i = 0; i < weightPatterns.length; i++) {
      const match = text.match(weightPatterns[i]);
      if (match) {
        let weight = parseFloat(match[1]);
        
        if (i === 1) { // Kilograms to pounds
          weight = weight * 2.20462;
        } else if (i === 2) { // Ounces to pounds
          weight = weight / 16;
        }
        
        if (weight > 0 && weight < 10000) {
          return Math.round(weight * 10) / 10;
        }
      }
    }

    return null;
  }

  // Main scraping method
  async scrapeProduct(url) {
    try {
      console.log('🛒 Starting Amazon scraping...');
      const startTime = Date.now();

      // Make request with proper headers to avoid blocking
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      const productData = {
        name: null,
        price: null,
        image: null,
        variant: null,
        dimensions: null,
        weight: null,
        brand: null,
        inStock: true
      };

      // Extract product title
      const titleSelectors = [
        '#productTitle',
        '.product-title',
        'h1.a-size-large',
        'h1[data-automation-id="product-title"]',
        '.pdp-product-name'
      ];

      for (const selector of titleSelectors) {
        const title = $(selector).first().text().trim();
        if (title && title.length > 5) {
          productData.name = title.substring(0, 200);
          console.log('   📝 Found title');
          break;
        }
      }

      // Extract price
      const priceSelectors = [
        '.a-price-whole',
        '.a-price .a-offscreen',
        '.a-price-range .a-price .a-offscreen',
        '#price_inside_buybox',
        '.a-price.a-text-price.a-size-medium.apexPriceToPay',
        '.a-price-current'
      ];

      for (const selector of priceSelectors) {
        const priceText = $(selector).first().text().trim();
        if (priceText) {
          const priceMatch = priceText.match(/[\d,]+\.?\d*/);
          if (priceMatch) {
            const price = parseFloat(priceMatch[0].replace(/,/g, ''));
            if (price > 0 && price < 100000) {
              productData.price = price;
              console.log('   💰 Found price: $' + price);
              break;
            }
          }
        }
      }

      // Extract main product image
      const imageSelectors = [
        '#landingImage',
        '#imgBlkFront',
        '.a-dynamic-image',
        '.product-image img',
        '#main-image'
      ];

      for (const selector of imageSelectors) {
        const imgSrc = $(selector).first().attr('src') || $(selector).first().attr('data-src');
        if (imgSrc && imgSrc.startsWith('http')) {
          productData.image = imgSrc;
          console.log('   🖼️ Found image');
          break;
        }
      }

      // Extract variant information from various sources
      const fullText = $('body').text();
      productData.variant = this.extractVariant(fullText) || this.extractVariant(productData.name);

      if (productData.variant) {
        console.log('   🎨 Found variant:', productData.variant);
      }

      // Extract dimensions
      productData.dimensions = this.parseDimensions(fullText);
      if (productData.dimensions) {
        console.log('   📏 Found dimensions');
      }

      // Extract weight
      productData.weight = this.parseWeight(fullText);
      if (productData.weight) {
        console.log('   ⚖️ Found weight:', productData.weight, 'lbs');
      }

      // Check stock status
      const outOfStockIndicators = [
        'currently unavailable',
        'out of stock',
        'temporarily out of stock',
        'item is not available'
      ];

      const stockText = $('body').text().toLowerCase();
      productData.inStock = !outOfStockIndicators.some(indicator => 
        stockText.includes(indicator)
      );

      console.log(`   ✅ Amazon scraping completed in ${Date.now() - startTime}ms`);
      return productData;

    } catch (error) {
      console.log('   ❌ Amazon scraping failed:', error.message);
      throw error;
    }
  }
}

module.exports = AmazonCrawler;