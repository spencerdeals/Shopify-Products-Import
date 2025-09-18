// backend/zyteScraper.js - Optimized Zyte API Integration with Deep Research
const axios = require('axios');
const cheerio = require('cheerio');

class ZyteScraper {
  constructor() {
    this.apiKey = process.env.ZYTE_API_KEY;
    this.enabled = !!this.apiKey;
    this.baseURL = 'https://api.zyte.com/v1/extract';
    
    // Zyte API rate limits and optimization settings
    this.requestQueue = [];
    this.processing = false;
    this.maxConcurrent = 3; // Zyte allows up to 10 concurrent requests
    this.requestDelay = 100; // 100ms between requests to avoid rate limits
    
    console.log('🕷️ ZyteScraper Constructor (Optimized):');
    console.log(`   API Key: ${this.apiKey ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   Status: ${this.enabled ? '✅ ENABLED (v3.0 Optimized)' : '❌ DISABLED'}`);
    console.log(`   Max Concurrent: ${this.maxConcurrent}`);
    console.log(`   Request Delay: ${this.requestDelay}ms`);
    
    if (!this.enabled) {
      console.log('   ⚠️ Set ZYTE_API_KEY environment variable to enable Zyte scraping');
    } else {
      console.log('   🎯 Ready to use optimized Zyte API for web scraping');
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Zyte not configured - missing API key');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🕷️ Zyte scraping ${retailer}: ${url.substring(0, 60)}...`);

    try {
      console.log('   📤 Sending optimized request to Zyte API...');
      
      // Optimized request configuration based on Zyte documentation
      const requestConfig = this.getOptimizedConfig(url, retailer);
      
      const response = await axios.post(this.baseURL, requestConfig.body, {
        auth: {
          username: this.apiKey,
          password: ''
        },
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SDL-Import-Calculator/1.0'
        },
        timeout: requestConfig.timeout,
        validateStatus: (status) => status < 500 // Retry on 5xx errors
      });

      console.log('✅ Zyte request completed successfully');
      console.log('📊 Response status:', response.status);
      
      if (!response.data) {
        throw new Error('No data received from Zyte API');
      }
      
      // Parse the Zyte response with retailer-specific optimizations
      const productData = this.parseZyteResponse(response.data, url, retailer);
      
      console.log('📦 Zyte extraction results:', {
        hasName: !!productData.name,
        hasPrice: !!productData.price,
        hasImage: !!productData.image,
        hasDimensions: !!productData.dimensions,
        hasVariant: !!productData.variant
      });

      return productData;

    } catch (error) {
      return this.handleZyteError(error, url, retailer);
    }
  }

  getOptimizedConfig(url, retailer) {
    const baseConfig = {
      url: url,
      httpResponseBody: true,
      product: true,
      productOptions: {
        extractFrom: 'httpResponseBody'
      }
    };

    // Retailer-specific optimizations based on Zyte documentation
    switch (retailer) {
      case 'Amazon':
        return {
          body: {
            ...baseConfig,
            // Amazon-specific optimizations
            geolocation: 'US',
            device: 'desktop',
            requestHeaders: {
              'Accept-Language': 'en-US,en;q=0.9'
            },
            productOptions: {
              extractFrom: 'httpResponseBody',
              includeVariants: true,
              includePricing: true,
              includeAvailability: true
            }
          },
          timeout: 60000 // Amazon can be slow
        };
        
      case 'Wayfair':
        return {
          body: {
            ...baseConfig,
            geolocation: 'US',
            device: 'desktop',
            productOptions: {
              extractFrom: 'httpResponseBody',
              includeVariants: true,
              includePricing: true,
              includeDimensions: true
            }
          },
          timeout: 45000
        };
        
      case 'Target':
        return {
          body: {
            ...baseConfig,
            geolocation: 'US',
            device: 'desktop',
            requestHeaders: {
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
          },
          timeout: 40000
        };
        
      case 'Walmart':
        return {
          body: {
            ...baseConfig,
            geolocation: 'US',
            device: 'desktop',
            requestHeaders: {
              'Accept-Language': 'en-US,en;q=0.9'
            }
          },
          timeout: 40000
        };
        
      default:
        return {
          body: baseConfig,
          timeout: 35000
        };
    }
  }

  handleZyteError(error, url, retailer) {
    console.error('❌ Zyte scraping failed:', error.message);
    
    if (error.response) {
      console.error('Response status:', error.response.status);
      
      if (error.response.status === 401) {
        console.error('❌ Authentication failed - check Zyte API key');
      } else if (error.response.status === 403) {
        console.error('❌ Access forbidden - check Zyte subscription');
      } else if (error.response.status === 422) {
        console.error('❌ Invalid request parameters for', retailer);
        console.error('Response data:', error.response.data);
      } else if (error.response.status === 429) {
        console.error('❌ Rate limit exceeded - implementing backoff');
        // Could implement exponential backoff here
      } else if (error.response.status >= 500) {
        console.error('❌ Zyte server error - try again later');
      }
    }
    
    throw error;
  }

  parseZyteResponse(data, url, retailer) {
    console.log('🔍 Parsing Zyte response with retailer-specific logic...');
    
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

    // Priority 1: Extract from Zyte's automatic product extraction
    if (data.product) {
      const product = data.product;
      
      // Product name with retailer-specific cleaning
      productData.name = this.extractName(product, retailer);
      
      // Price extraction with multiple fallbacks
      productData.price = this.extractPrice(product, retailer);
      
      // Image extraction with quality preference
      productData.image = this.extractImage(product, retailer);
      
      // Brand extraction
      productData.brand = product.brand || product.manufacturer || null;

      // Category/Breadcrumbs
      productData.category = this.extractCategory(product, retailer);

      // Availability with retailer-specific logic
      productData.inStock = this.extractAvailability(product, retailer);

      // Variants with smart extraction
      productData.variant = this.extractVariant(product, retailer);
      
      // Dimensions and weight (if available)
      productData.dimensions = this.extractDimensions(product, retailer);
      productData.weight = this.extractWeight(product, retailer);
    }

    // Priority 2: Parse from HTML if structured data is incomplete
    if (data.httpResponseBody && this.needsHtmlFallback(productData)) {
      console.log('   🔍 Using HTML fallback with retailer-specific selectors...');
      const htmlData = this.parseHTML(data.httpResponseBody, url, retailer);
      
      // Merge data intelligently
      productData.name = productData.name || htmlData.name;
      productData.price = productData.price || htmlData.price;
      productData.image = productData.image || htmlData.image;
      productData.dimensions = productData.dimensions || htmlData.dimensions;
      productData.weight = productData.weight || htmlData.weight;
      productData.variant = productData.variant || htmlData.variant;
    }

    return productData;
  }

  extractName(product, retailer) {
    let name = product.name || product.title || null;
    if (!name) return null;
    
    name = name.trim();
    
    // Retailer-specific name cleaning
    switch (retailer) {
      case 'Amazon':
        // Remove Amazon-specific suffixes
        name = name.replace(/\s*\(.*?\)\s*$/, ''); // Remove parenthetical at end
        name = name.replace(/\s*-\s*Amazon\.com\s*$/, ''); // Remove Amazon suffix
        break;
      case 'Wayfair':
        // Wayfair often has brand at the end
        name = name.replace(/\s*by\s+[^,]+$/, ''); // Remove "by Brand" at end
        break;
    }
    
    return name.substring(0, 200);
  }

  extractPrice(product, retailer) {
    const priceFields = ['price', 'currentPrice', 'salePrice', 'regularPrice', 'listPrice'];
    
    for (const field of priceFields) {
      if (product[field]) {
        let priceValue = product[field];
        
        // Handle object format
        if (typeof priceValue === 'object') {
          priceValue = priceValue.value || priceValue.amount || priceValue.price;
        }
        
        // Extract numeric value
        const price = parseFloat(String(priceValue).replace(/[^0-9.]/g, ''));
        
        if (price > 0 && price < 100000) {
          console.log(`   💰 Price from ${field}: $${price}`);
          return price;
        }
      }
    }
    
    return null;
  }

  extractImage(product, retailer) {
    // Try multiple image sources in order of preference
    const imageSources = [
      product.images?.[0],
      product.mainImage,
      product.image,
      product.thumbnailImage,
      product.primaryImage
    ];
    
    for (const imageSource of imageSources) {
      if (imageSource) {
        const imageUrl = typeof imageSource === 'object' ? imageSource.url : imageSource;
        if (imageUrl && imageUrl.startsWith('http')) {
          // Prefer higher quality images
          if (imageUrl.includes('_SL1500_') || imageUrl.includes('large') || imageUrl.includes('original')) {
            console.log('   🖼️ High quality image found');
            return imageUrl;
          }
          return imageUrl;
        }
      }
    }
    
    return null;
  }

  extractCategory(product, retailer) {
    if (product.breadcrumbs && Array.isArray(product.breadcrumbs) && product.breadcrumbs.length > 0) {
      const lastBreadcrumb = product.breadcrumbs[product.breadcrumbs.length - 1];
      return typeof lastBreadcrumb === 'object' ? lastBreadcrumb.name : lastBreadcrumb;
    }
    
    return product.category || null;
  }

  extractAvailability(product, retailer) {
    if (product.availability) {
      const availability = String(product.availability).toLowerCase();
      return !availability.includes('out of stock') && 
             !availability.includes('unavailable') &&
             !availability.includes('sold out') &&
             !availability.includes('discontinued');
    }
    
    return true; // Default to in stock
  }

  extractVariant(product, retailer) {
    const variantParts = [];
    
    // Check for variants array
    if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
      const selectedVariant = product.variants.find(v => v.selected) || product.variants[0];
      if (selectedVariant) {
        this.extractVariantProperties(selectedVariant, variantParts);
      }
    }
    
    // Check for direct variant properties
    if (variantParts.length === 0) {
      this.extractVariantProperties(product, variantParts);
    }
    
    return variantParts.length > 0 ? variantParts.join(', ') : null;
  }

  extractDimensions(product, retailer) {
    // Check for structured dimensions
    if (product.dimensions && typeof product.dimensions === 'object') {
      const { length, width, height } = product.dimensions;
      if (length && width && height) {
        return {
          length: parseFloat(length),
          width: parseFloat(width),
          height: parseFloat(height)
        };
      }
    }
    
    // Check for dimension strings in product attributes
    const dimensionFields = ['dimensions', 'size', 'measurements', 'specs'];
    for (const field of dimensionFields) {
      if (product[field] && typeof product[field] === 'string') {
        const dimMatch = product[field].match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
        if (dimMatch) {
          return {
            length: parseFloat(dimMatch[1]),
            width: parseFloat(dimMatch[2]),
            height: parseFloat(dimMatch[3])
          };
        }
      }
    }
    
    return null;
  }

  extractWeight(product, retailer) {
    const weightFields = ['weight', 'shippingWeight', 'itemWeight'];
    
    for (const field of weightFields) {
      if (product[field]) {
        const weightStr = String(product[field]);
        const weightMatch = weightStr.match(/(\d+(?:\.\d+)?)\s*(lb|pound|kg|g|oz)?/i);
        
        if (weightMatch) {
          let weight = parseFloat(weightMatch[1]);
          const unit = (weightMatch[2] || 'lb').toLowerCase();
          
          // Convert to pounds
          switch(unit) {
            case 'kg': weight *= 2.205; break;
            case 'g': weight *= 0.00220462; break;
            case 'oz': weight *= 0.0625; break;
          }
          
          return Math.round(weight * 10) / 10;
        }
      }
    }
    
    return null;
  }

  needsHtmlFallback(productData) {
    return !productData.name || !productData.price || !productData.image;
  }

  parseHTML(html, url, retailer) {
    const $ = cheerio.load(html);
    
    const productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      variant: null
    };

    // Use retailer-specific selectors
    const selectors = this.getRetailerSelectors(retailer);
    
    // Extract name
    for (const selector of selectors.title) {
      const element = $(selector).first();
      if (element.length && element.text().trim()) {
        productData.name = element.text().trim().replace(/\s+/g, ' ').substring(0, 200);
        console.log('   📝 HTML name found');
        break;
      }
    }

    // Extract price with multiple methods
    productData.price = this.extractPriceFromHTML($, selectors.price, html);
    
    // Extract image
    for (const selector of selectors.image) {
      const element = $(selector).first();
      if (element.length) {
        let imgSrc = element.attr('src') || element.attr('data-src') || 
                     element.attr('data-original') || element.attr('data-lazy-src');
        
        if (imgSrc && imgSrc.startsWith('http')) {
          productData.image = imgSrc;
          console.log('   🖼️ HTML image found');
          break;
        }
      }
    }

    // Extract variant
    productData.variant = this.extractVariantFromHTML($, selectors.variant);

    // Extract dimensions from text
    const bodyText = $.text();
    const dimMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i);
    if (dimMatch) {
      productData.dimensions = {
        length: parseFloat(dimMatch[1]),
        width: parseFloat(dimMatch[2]),
        height: parseFloat(dimMatch[3])
      };
    }

    return productData;
  }

  extractPriceFromHTML($, priceSelectors, html) {
    // Method 1: Try CSS selectors
    for (const selector of priceSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const priceText = element.text().replace(/[^0-9.]/g, '');
        const price = parseFloat(priceText);
        if (price > 0 && price < 100000) {
          console.log('   💰 HTML price found via selector');
          return price;
        }
      }
    }
    
    // Method 2: Regex patterns in HTML
    const pricePatterns = [
      /"price":\s*"?\$?(\d+(?:,\d{3})*(?:\.\d{2})?)"?/g,
      /"currentPrice":\s*"?\$?(\d+(?:,\d{3})*(?:\.\d{2})?)"?/g,
      /"salePrice":\s*"?\$?(\d+(?:,\d{3})*(?:\.\d{2})?)"?/g,
      /data-price[^>]*=["']?\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/g,
      /\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g
    ];
    
    for (const pattern of pricePatterns) {
      const matches = [...html.matchAll(pattern)];
      for (const match of matches) {
        const price = parseFloat(match[1].replace(/,/g, ''));
        if (price > 1 && price < 100000) {
          console.log('   💰 HTML price found via regex');
          return price;
        }
      }
    }
    
    return null;
  }

  extractVariantFromHTML($, variantSelectors) {
    const variants = [];
    
    for (const selector of variantSelectors) {
      const elements = $(selector);
      elements.each((i, el) => {
        const variantText = $(el).text().trim();
        if (variantText.length >= 2 && variantText.length <= 50 && 
            !variantText.toLowerCase().includes('select') &&
            !variants.includes(variantText)) {
          variants.push(variantText);
        }
      });
    }
    
    return variants.length > 0 ? variants.join(', ') : null;
  }

  getRetailerSelectors(retailer) {
    const selectors = {
      Amazon: {
        title: [
          '#productTitle',
          'h1.a-size-large',
          'h1[data-automation-id="product-title"]',
          '.product-title'
        ],
        price: [
          '.a-price-current .a-offscreen',
          '.a-price .a-offscreen',
          '.a-price-whole',
          '.a-price-range .a-price .a-offscreen',
          '.apexPriceToPay .a-offscreen',
          '.a-price.a-text-price .a-offscreen'
        ],
        image: [
          '#landingImage',
          '.a-dynamic-image',
          'img[data-old-hires]',
          '.imgTagWrapper img'
        ],
        variant: [
          '.a-button-selected .a-button-text',
          '.a-dropdown-prompt',
          '#variation_color_name .selection',
          '#variation_size_name .selection'
        ]
      },
      Wayfair: {
        title: [
          'h1[data-testid="product-title"]',
          'h1.ProductTitle',
          '.ProductTitle'
        ],
        price: [
          '.MoneyPrice',
          '[data-testid="price"]',
          '.price-current'
        ],
        image: [
          'img[data-testid="product-image"]',
          '.ProductImages img',
          '.hero-image img'
        ],
        variant: [
          '.SelectedOption',
          '.option-selected',
          '.selected-swatch'
        ]
      },
      Target: {
        title: [
          'h1[data-test="product-title"]',
          'h1.ProductTitle'
        ],
        price: [
          '[data-test="product-price"]',
          '.h-text-red',
          '.price-current'
        ],
        image: [
          '.ProductImages img',
          'img[data-test="product-image"]'
        ],
        variant: [
          '.selected-variant',
          '.swatch--selected'
        ]
      },
      Walmart: {
        title: [
          'h1[data-automation-id="product-title"]',
          'h1.prod-ProductTitle'
        ],
        price: [
          '[data-automation-id="product-price"]',
          '.price-current'
        ],
        image: [
          'img[data-automation-id="product-image"]',
          '.prod-hero-image img'
        ],
        variant: [
          '.selected-variant-value',
          '[data-selected="true"]'
        ]
      }
    };
    
    // Return retailer-specific selectors or generic ones
    return selectors[retailer] || {
      title: ['h1', '.product-title', '.product-name'],
      price: ['.price', '[class*="price"]', '.current-price'],
      image: ['.product-image img', 'img[class*="product"]'],
      variant: ['.selected', '.selected-option', '[aria-selected="true"]']
    };
  }

  extractVariantProperties(obj, variantParts) {
    const variantFields = ['color', 'size', 'style', 'material', 'finish', 'pattern', 'type'];
    
    for (const [prop, value] of Object.entries(obj)) {
      if (value && typeof value === 'string' && value.trim()) {
        const trimmedValue = value.trim();
        if (trimmedValue.length >= 2 && trimmedValue.length <= 50) {
          const lowerProp = prop.toLowerCase();
          const lowerValue = trimmedValue.toLowerCase();
          
          if (variantFields.includes(lowerProp)) {
            const propName = prop.charAt(0).toUpperCase() + prop.slice(1);
            variantParts.push(`${propName}: ${trimmedValue}`);
          } else if (this.isColorValue(lowerValue)) {
            variantParts.push(`Color: ${trimmedValue}`);
          } else if (this.isSizeValue(lowerValue)) {
            variantParts.push(`Size: ${trimmedValue}`);
          }
        }
      }
    }
  }

  isColorValue(value) {
    const colorKeywords = /\b(black|white|brown|gray|grey|blue|red|green|yellow|beige|tan|navy|cream|ivory|khaki|charcoal|burgundy|maroon|olive|teal|coral|sage|taupe|mocha|espresso|latte|camel|sand|stone|slate|pewter|bronze|copper|gold|silver|rose|blush|mint|seafoam|turquoise|aqua|lavender|purple|violet|magenta|pink|orange|peach|apricot|rust|terracotta|denim|indigo|natural|antique|vintage)\b/i;
    return colorKeywords.test(value);
  }

  isSizeValue(value) {
    const sizeKeywords = /\b(twin|full|queen|king|california|cal|single|double|xl|extra|small|medium|large|xs|s|m|l|xl|xxl|xxxl|\d+['"]\s*x\s*\d+['"']|\d+\s*x\s*\d+|\d+['"]\s*wide|\d+['"]\s*deep|\d+['"]\s*high|\d+\s*inch|\d+\s*ft|\d+\s*cm|\d+\s*mm)\b/i;
    return sizeKeywords.test(value);
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
      if (domain.includes('lunafurn.com')) return 'Luna Furniture';
      if (domain.includes('overstock.com')) return 'Overstock';
      if (domain.includes('cb2.com')) return 'CB2';
      if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
      if (domain.includes('westelm.com')) return 'West Elm';
      if (domain.includes('potterybarn.com')) return 'Pottery Barn';
      return 'Unknown';
    } catch (e) {
      return 'Unknown';
    }
  }
}

module.exports = ZyteScraper;