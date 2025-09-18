// backend/oxylabsScraper.js - Oxylabs Proxy Endpoint Implementation
const axios = require('axios');
const cheerio = require('cheerio');

class OxylabsScraper {
  constructor() {
    this.username = process.env.OXYLABS_USERNAME;
    this.password = process.env.OXYLABS_PASSWORD;
    this.proxyEndpoint = 'https://realtime.oxylabs.io:60000';
    this.enabled = !!(this.username && this.password);
    
    console.log('🚀 OxylabsScraper Constructor:');
    console.log(`   Username: ${this.username ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   Password: ${this.password ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   Status: ${this.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    
    if (!this.enabled) {
      console.log('   ⚠️ Set OXYLABS_USERNAME and OXYLABS_PASSWORD environment variables');
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Oxylabs not configured - missing credentials');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🚀 Oxylabs scraping ${retailer}: ${url.substring(0, 60)}...`);

    try {
      // Use Oxylabs proxy endpoint with proper headers
      const response = await axios.get(url, {
        proxy: false, // Disable default proxy
        httpsAgent: new (require('https').Agent)({
          rejectUnauthorized: false // Equivalent to curl -k
        }),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          // Oxylabs specific headers
          'x-oxylabs-user-agent-type': 'desktop_chrome',
          'x-oxylabs-geo-location': 'United States',
          'x-oxylabs-render': 'html'
        },
        auth: {
          username: this.username,
          password: this.password
        },
        // Use Oxylabs proxy
        proxy: {
          protocol: 'https',
          host: 'realtime.oxylabs.io',
          port: 60000,
          auth: {
            username: this.username,
            password: this.password
          }
        },
        timeout: 30000,
        maxRedirects: 5
      });

      console.log('✅ Oxylabs request completed successfully');
      
      if (!response.data) {
        throw new Error('No HTML content received from Oxylabs');
      }

      // Parse the HTML response
      const productData = this.parseHTML(response.data, url, retailer);
      
      console.log('📦 Oxylabs extraction results:', {
        hasName: !!productData.name,
        hasPrice: !!productData.price,
        hasImage: !!productData.image,
        hasDimensions: !!productData.dimensions,
        hasWeight: !!productData.weight
      });

      return productData;

    } catch (error) {
      console.error('❌ Oxylabs scraping failed:', error.message);
      
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response headers:', error.response.headers);
        
        if (error.response.status === 401) {
          console.error('❌ Authentication failed - check Oxylabs credentials');
        } else if (error.response.status === 403) {
          console.error('❌ Access forbidden - check Oxylabs subscription');
        } else if (error.response.status >= 500) {
          console.error('❌ Oxylabs server error - try again later');
        }
      }
      
      throw error;
    }
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
      inStock: true,
      variant: null
    };

    // Extract product name - retailer-specific selectors
    const titleSelectors = this.getTitleSelectors(retailer);
    for (const selector of titleSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim()) {
        productData.name = element.text().trim().replace(/\s+/g, ' ').substring(0, 200);
        console.log('   📝 Extracted title:', productData.name.substring(0, 50) + '...');
        break;
      }
    }

    // Extract price - retailer-specific selectors
    const priceSelectors = this.getPriceSelectors(retailer);
    for (const selector of priceSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const priceText = element.text().replace(/[^0-9.]/g, '');
        const price = parseFloat(priceText);
        if (price > 0 && price < 100000) {
          productData.price = price;
          console.log('   💰 Extracted price: $' + productData.price);
          break;
        }
      }
    }

    // Extract main image - retailer-specific selectors
    const imageSelectors = this.getImageSelectors(retailer);
    for (const selector of imageSelectors) {
      const element = $(selector).first();
      if (element.length) {
        let imgSrc = element.attr('src') || element.attr('data-src') || element.attr('data-original');
        if (imgSrc) {
          // Handle relative URLs
          if (imgSrc.startsWith('//')) {
            imgSrc = 'https:' + imgSrc;
          } else if (imgSrc.startsWith('/')) {
            const urlObj = new URL(url);
            imgSrc = urlObj.protocol + '//' + urlObj.host + imgSrc;
          }
          
          if (imgSrc.startsWith('http')) {
            productData.image = imgSrc;
            console.log('   🖼️ Extracted image URL');
            break;
          }
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
      console.log('   📏 Extracted dimensions:', productData.dimensions);
    }

    // Extract weight
    const weightMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?|kg|kilograms?)/i);
    if (weightMatch) {
      let weight = parseFloat(weightMatch[1]);
      // Convert kg to lbs if needed
      if (/kg|kilogram/i.test(weightMatch[0])) {
        weight *= 2.205;
      }
      productData.weight = Math.round(weight * 10) / 10;
      console.log('   ⚖️ Extracted weight:', productData.weight + ' lbs');
    }

    // Extract variant/color/size
    const variantSelectors = this.getVariantSelectors(retailer);
    for (const selector of variantSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim()) {
        const variantText = element.text().trim();
        if (!/^(select|choose|option|default|click|tap)$/i.test(variantText) && 
            variantText.length >= 3 && variantText.length <= 50) {
          productData.variant = variantText;
          console.log('   🎨 Extracted variant:', productData.variant);
          break;
        }
      }
    }

    // Check availability
    const unavailableKeywords = /out of stock|unavailable|sold out|not available|currently unavailable/i;
    productData.inStock = !unavailableKeywords.test(bodyText);

    return productData;
  }

  getTitleSelectors(retailer) {
    const common = [
      'h1[data-testid*="title"]',
      'h1[data-testid*="name"]',
      'h1.product-title',
      'h1.ProductTitle',
      'h1',
      '.product-title h1',
      '.product-name h1'
    ];

    const specific = {
      'Amazon': [
        '#productTitle',
        'h1.a-size-large',
        'h1[data-automation-id="product-title"]'
      ],
      'Wayfair': [
        'h1[data-testid="product-title"]',
        'h1.ProductTitle'
      ],
      'Target': [
        'h1[data-test="product-title"]',
        'h1.ProductTitle'
      ],
      'Walmart': [
        'h1[data-automation-id="product-title"]',
        'h1.prod-ProductTitle'
      ],
      'Best Buy': [
        'h1.sr-only',
        'h1.heading-5'
      ]
    };

    return [...(specific[retailer] || []), ...common];
  }

  getPriceSelectors(retailer) {
    const common = [
      '.price',
      '[class*="price"]',
      '.current-price',
      '.sale-price',
      '[data-testid*="price"]'
    ];

    const specific = {
      'Amazon': [
        '.a-price-whole',
        '.a-price .a-offscreen',
        '.a-price-range .a-price .a-offscreen'
      ],
      'Wayfair': [
        '.MoneyPrice',
        '[data-testid="price"]'
      ],
      'Target': [
        '[data-test="product-price"]',
        '.h-text-red'
      ],
      'Walmart': [
        '[data-automation-id="product-price"]',
        '.price-current'
      ],
      'Best Buy': [
        '.pricing-price__value',
        '.sr-only:contains("current price")'
      ]
    };

    return [...(specific[retailer] || []), ...common];
  }

  getImageSelectors(retailer) {
    const common = [
      '.product-image img',
      'img[class*="product"]',
      '.hero-image img',
      'img[data-testid*="image"]'
    ];

    const specific = {
      'Amazon': [
        '#landingImage',
        '.a-dynamic-image',
        'img[data-old-hires]',
        '.imgTagWrapper img'
      ],
      'Wayfair': [
        'img[data-testid="product-image"]',
        '.ProductImages img'
      ],
      'Target': [
        '.ProductImages img',
        'img[data-test="product-image"]'
      ],
      'Walmart': [
        'img[data-automation-id="product-image"]',
        '.prod-hero-image img'
      ],
      'Best Buy': [
        '.product-image img',
        '.hero-image img'
      ]
    };

    return [...(specific[retailer] || []), ...common];
  }

  getVariantSelectors(retailer) {
    const common = [
      '.selected-option',
      '[aria-selected="true"]',
      '.variant-selected',
      '.option-selected'
    ];

    const specific = {
      'Amazon': [
        '.a-button-selected .a-button-text',
        '.a-dropdown-prompt',
        '#variation_color_name .selection'
      ],
      'Wayfair': [
        '.SelectedOption',
        '.option-selected'
      ],
      'Target': [
        '.selected-variant',
        '.h-text-bold'
      ],
      'Walmart': [
        '.selected-variant-value',
        '[data-selected="true"]'
      ]
    };

    return [...(specific[retailer] || []), ...common];
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
      if (domain.includes('costco.com')) return 'Costco';
      if (domain.includes('macys.com')) return 'Macys';
      if (domain.includes('ikea.com')) return 'IKEA';
      return 'Unknown';
    } catch (e) {
      return 'Unknown';
    }
  }
}

module.exports = OxylabsScraper;