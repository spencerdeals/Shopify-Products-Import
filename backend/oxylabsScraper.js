// backend/oxylabsScraper.js
const axios = require('axios');
const cheerio = require('cheerio');

class OxylabsScraper {
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.enabled = !!(username && password);
    this.baseURL = 'https://realtime.oxylabs.io/v1/queries';
    
    console.log('🌐 OxylabsScraper initialized');
    console.log(`   Status: ${this.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    if (this.enabled) {
      console.log(`   Using credentials: ${username}`);
    }
  }

  isAvailable() {
    return this.enabled;
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Oxylabs not configured');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🌐 Oxylabs scraping ${retailer}: ${url.substring(0, 60)}...`);

    try {
      // Use realtime API with proper source detection
      const source = this.getSourceForRetailer(retailer);
      
      const payload = {
        source: source,
        url: url,
        user_agent_type: 'desktop',
        render: 'html',
        parse: false,
        callback_url: null
      };

      console.log(`   📤 Oxylabs payload: ${source} source`);

      const response = await axios.post(this.baseURL, payload, {
        auth: {
          username: this.username,
          password: this.password
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 60000
      });

      if (response.data && response.data.results && response.data.results.length > 0) {
        const result = response.data.results[0];
        console.log(`   📥 Oxylabs response: ${result.status_code} (${response.data.results.length} results)`);
        
        if (result.status_code === 200 && result.content) {
          // Handle different content formats
          let html = '';
          if (typeof result.content === 'string') {
            html = result.content;
          } else if (Array.isArray(result.content)) {
            html = result.content.join('');
          } else if (typeof result.content === 'object') {
            // Handle character array format
            const keys = Object.keys(result.content).sort((a, b) => parseInt(a) - parseInt(b));
            html = keys.map(key => result.content[key]).join('');
          }

          console.log(`✅ Oxylabs: Got ${html.length} chars of HTML`);
          
          // Parse the HTML for product data
          const productData = this.parseHTML(html, url, retailer);
          console.log('📦 Oxylabs parsing results:', {
            hasName: !!productData.name,
            hasPrice: !!productData.price,
            hasImage: !!productData.image,
            hasDimensions: !!productData.dimensions,
            hasWeight: !!productData.weight
          });
          
          return productData;
        } else {
          console.log(`   ❌ Oxylabs bad status: ${result.status_code}`);
          return null;
        }
      } else {
        console.log('   ❌ Oxylabs no results');
        return null;
      }
    } catch (error) {
      console.error(`❌ Oxylabs error: ${error.message}`);
      throw error;
    }
  }

  detectRetailer(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain.includes('amazon.com')) return 'Amazon';
      if (domain.includes('wayfair.com')) return 'Wayfair';
      if (domain.includes('walmart.com')) return 'Walmart';
      if (domain.includes('target.com')) return 'Target';
      if (domain.includes('bestbuy.com')) return 'BestBuy';
      if (domain.includes('homedepot.com')) return 'HomeDepot';
      return 'Universal';
    } catch (e) {
      return 'Universal';
    }
  }

  getSourceForRetailer(retailer) {
    const sourceMap = {
      'Amazon': 'amazon',
      'Wayfair': 'universal',
      'Walmart': 'universal', 
      'Target': 'universal',
      'BestBuy': 'universal',
      'HomeDepot': 'universal'
    };
    return sourceMap[retailer] || 'universal';
  }

  parseHTML(html, url, retailer) {
    const $ = cheerio.load(html);
    
    const productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      variant: null,
      inStock: true
    };

    // Extract product name with retailer-specific selectors
    const titleSelectors = this.getTitleSelectors(retailer);
    for (const selector of titleSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim()) {
        let title = element.text().trim();
        // Skip generic titles
        if (!this.isGenericTitle(title)) {
          productData.name = title.substring(0, 200);
          console.log(`   📝 Extracted title: ${productData.name.substring(0, 50)}...`);
          break;
        }
      }
    }

    // Extract price with retailer-specific selectors
    const priceSelectors = this.getPriceSelectors(retailer);
    for (const selector of priceSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const priceText = element.text().replace(/[^0-9.]/g, '');
        const price = parseFloat(priceText);
        if (price > 0 && price < 100000) {
          productData.price = price;
          console.log(`   💰 Extracted price: $${productData.price}`);
          break;
        }
      }
    }

    // Extract main image with retailer-specific selectors
    const imageSelectors = this.getImageSelectors(retailer);
    for (const selector of imageSelectors) {
      const element = $(selector).first();
      if (element.length) {
        let imgSrc = element.attr('src') || element.attr('data-src') || element.attr('data-old-hires');
        if (imgSrc) {
          if (imgSrc.startsWith('//')) {
            imgSrc = 'https:' + imgSrc;
          } else if (imgSrc.startsWith('/')) {
            imgSrc = new URL(url).origin + imgSrc;
          }
          
          if (imgSrc.startsWith('http')) {
            productData.image = imgSrc;
            console.log(`   🖼️ Extracted image URL`);
            break;
          }
        }
      }
    }

    // Extract variant information
    const variantSelectors = this.getVariantSelectors(retailer);
    for (const selector of variantSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim()) {
        const variantText = element.text().trim();
        if (this.isValidVariant(variantText)) {
          productData.variant = variantText;
          console.log(`   🎨 Extracted variant: ${productData.variant}`);
          break;
        }
      }
    }

    // Extract dimensions from text
    const bodyText = $.text();
    const dimMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i);
    if (dimMatch) {
      productData.dimensions = {
        length: parseFloat(dimMatch[1]),
        width: parseFloat(dimMatch[2]),
        height: parseFloat(dimMatch[3])
      };
      console.log(`   📏 Extracted dimensions:`, productData.dimensions);
    }

    // Extract weight
    const weightMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i);
    if (weightMatch) {
      productData.weight = parseFloat(weightMatch[1]);
      console.log(`   ⚖️ Extracted weight: ${productData.weight} lbs`);
    }

    // Check availability
    const unavailableKeywords = /out of stock|unavailable|sold out|not available/i;
    productData.inStock = !unavailableKeywords.test(bodyText);

    return productData;
  }

  getTitleSelectors(retailer) {
    const selectors = {
      'Amazon': ['#productTitle', 'h1.a-size-large', 'h1[data-automation-id="product-title"]'],
      'Wayfair': ['[data-testid="ProductTitle"]', 'h1[data-testid="product-title"]', '.ProductTitle'],
      'Walmart': ['[data-automation-id="product-title"]', 'h1[data-testid="product-title"]'],
      'Target': ['[data-test="product-title"]', 'h1.ProductTitle'],
      'BestBuy': ['h1.sr-only', '.product-title h1'],
      'HomeDepot': ['.product-title h1', 'h1[data-testid="product-title"]']
    };
    return selectors[retailer] || ['h1', '.product-title', '.product-name', '[data-testid*="title"]'];
  }

  getPriceSelectors(retailer) {
    const selectors = {
      'Amazon': ['.a-price-whole', '.a-price .a-offscreen', '[data-testid="price"]'],
      'Wayfair': ['.MoneyPrice', '[data-testid="price"]', '.price-current'],
      'Walmart': ['[data-automation-id="product-price"]', '[data-testid="price"]'],
      'Target': ['[data-test="product-price"]', '.price-current'],
      'BestBuy': ['.pricing-price__value', '.sr-only'],
      'HomeDepot': ['.price', '.price-current']
    };
    return selectors[retailer] || ['.price', '[class*="price"]', '[data-testid*="price"]'];
  }

  getImageSelectors(retailer) {
    const selectors = {
      'Amazon': ['#landingImage', '.a-dynamic-image', 'img[data-old-hires]'],
      'Wayfair': ['[data-testid="ProductImage"]', '.ProductImages img', 'img[data-testid*="image"]'],
      'Walmart': ['img[data-automation-id="product-image"]', '.product-image img'],
      'Target': ['.ProductImages img', 'img[data-test*="image"]'],
      'BestBuy': ['.product-image img', 'img[class*="product"]'],
      'HomeDepot': ['.product-image img', 'img[data-testid*="image"]']
    };
    return selectors[retailer] || ['img[class*="product"]', '.product-image img', 'img[data-testid*="image"]'];
  }

  getVariantSelectors(retailer) {
    const selectors = {
      'Amazon': ['.a-button-selected .a-button-text', '#variation_color_name .selection'],
      'Wayfair': ['.SelectedOption', '.selected-option'],
      'Walmart': ['[aria-selected="true"]', '.variant-selected'],
      'Target': ['.selected-option', '[aria-selected="true"]'],
      'BestBuy': ['.option-selected', '.selected'],
      'HomeDepot': ['.selected-option', '.option-selected']
    };
    return selectors[retailer] || ['.selected', '[aria-selected="true"]', '.option-selected'];
  }

  isGenericTitle(title) {
    const genericPatterns = [
      /^about this item/i,
      /^product details/i,
      /^description/i,
      /^overview/i,
      /^features/i,
      /^specifications/i,
      /^reviews/i,
      /^questions/i,
      /^similar/i,
      /^related/i,
      /^you may also like/i,
      /^customers who/i,
      /^frequently bought/i
    ];
    
    return genericPatterns.some(pattern => pattern.test(title)) || title.length < 10;
  }

  isValidVariant(variant) {
    if (!variant || variant.length < 2 || variant.length > 50) return false;
    if (/^[\d\-_]+$/.test(variant)) return false;
    if (/^(select|choose|option|default|click|tap)$/i.test(variant)) return false;
    return true;
  }
}

module.exports = OxylabsScraper;