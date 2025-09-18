// backend/zyteScraper.js - Fixed Zyte API Integration
const axios = require('axios');
const cheerio = require('cheerio');

class ZyteScraper {
  constructor() {
    this.apiKey = process.env.ZYTE_API_KEY;
    this.enabled = !!this.apiKey;
    this.baseURL = 'https://api.zyte.com/v1/extract';
    
    console.log('🕷️ ZyteScraper Constructor:');
    console.log(`   API Key: ${this.apiKey ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   API Key (first 8 chars): ${this.apiKey ? this.apiKey.substring(0, 8) + '...' : 'N/A'}`);
    console.log(`   Status: ${this.enabled ? '✅ ENABLED (v2.0)' : '❌ DISABLED'}`);
    
    if (!this.enabled) {
      console.log('   ⚠️ Set ZYTE_API_KEY environment variable to enable Zyte scraping');
    } else {
      console.log('   🎯 Ready to use Zyte API for web scraping');
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Zyte not configured - missing API key');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🕷️ Zyte scraping ${retailer}: ${url.substring(0, 60)}...`);

    try {
      console.log('   📤 Sending request to Zyte API...');
      
      // Use Basic Auth with API key as username, empty password
      const response = await axios.post(this.baseURL, {
        url: url,
        httpResponseBody: true,
        product: true,
        productOptions: {
          extractFrom: 'httpResponseBody'
        }
      }, {
        auth: {
          username: this.apiKey,
          password: ''
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 45000
      });

      console.log('✅ Zyte request completed successfully');
      console.log('📊 Response status:', response.status);
      console.log('📊 Response headers:', Object.keys(response.headers || {}));
      
      if (!response.data) {
        throw new Error('No data received from Zyte API');
      }
      
      // Parse the Zyte response
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
      return this.handleZyteError(error);
    }
  }

  handleZyteError(error) {
    console.error('❌ Zyte scraping failed:', error.message);
    
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
      
      if (error.response.status === 401) {
        console.error('❌ Authentication failed - check Zyte API key');
      } else if (error.response.status === 403) {
        console.error('❌ Access forbidden - check Zyte subscription');
      } else if (error.response.status >= 500) {
        console.error('❌ Zyte server error - try again later');
      }
    }
    
    throw error;
  }

  parseZyteResponse(data, url, retailer) {
    console.log('🔍 Parsing Zyte response...');
    
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
      
      // Product name
      productData.name = product.name || product.title || null;
      if (productData.name) {
        productData.name = productData.name.trim().substring(0, 200);
        console.log('   📝 Product name:', productData.name.substring(0, 50) + '...');
      }

      // Price - handle multiple formats
      if (product.price) {
        let priceValue = product.price;
        if (typeof priceValue === 'object' && priceValue.value) {
          priceValue = priceValue.value;
        }
        productData.price = parseFloat(String(priceValue).replace(/[^0-9.]/g, ''));
        if (productData.price > 0 && productData.price < 100000) {
          console.log('   💰 Price: $' + productData.price);
        } else {
          productData.price = null;
        }
      } else if (product.regularPrice) {
        productData.price = parseFloat(String(product.regularPrice).replace(/[^0-9.]/g, ''));
        console.log('   💰 Regular Price: $' + productData.price);
      }

      // Images - handle multiple formats
      if (product.images && product.images.length > 0) {
        const firstImage = product.images[0];
        productData.image = typeof firstImage === 'object' ? firstImage.url : firstImage;
        console.log('   🖼️ Image: Found');
      } else if (product.mainImage) {
        productData.image = typeof product.mainImage === 'object' ? product.mainImage.url : product.mainImage;
        console.log('   🖼️ Image: Found (main)');
      }

      // Brand
      productData.brand = product.brand || null;

      // Category/Breadcrumbs
      if (product.breadcrumbs && product.breadcrumbs.length > 0) {
        productData.category = product.breadcrumbs[product.breadcrumbs.length - 1].name || 
                              product.breadcrumbs[product.breadcrumbs.length - 1];
      }

      // Availability
      if (product.availability) {
        const availability = String(product.availability).toLowerCase();
        productData.inStock = !availability.includes('out of stock') && 
                             !availability.includes('unavailable') &&
                             !availability.includes('sold out');
      }

      // Variants - Enhanced extraction
      if (product.variants && product.variants.length > 0) {
        const selectedVariant = product.variants.find(v => v.selected) || product.variants[0];
        if (selectedVariant) {
          const variantParts = [];
          
          // Smart variant detection - check what the value actually represents
          if (selectedVariant.color) {
            const colorValue = selectedVariant.color.toLowerCase();
          }
          // Collect ALL variant properties from selected variant
          this.extractVariantProperties(selectedVariant, variantParts);
          
          if (variantParts.length > 0) {
            productData.variant = variantParts.join(', ');
            console.log('   🎨 Variant:', productData.variant);
          }
        }
      } else if (product.color || product.size || product.style || product.material || product.finish) {
        // Direct variant properties from product level
        const variantParts = [];
        this.extractVariantProperties(product, variantParts);
        
        if (variantParts.length > 0) {
          productData.variant = variantParts.join(', ');
          console.log('   🎨 Direct Variant:', productData.variant);
        }
      }
    }

    // Priority 2: Parse from browser HTML if structured data is incomplete
    if (data.httpResponseBody && (!productData.name || !productData.price)) {
      console.log('   🔍 Falling back to HTML parsing...');
      const htmlData = this.parseHTML(data.httpResponseBody, url, retailer);
      
      // Merge data - prefer structured data but fill gaps with HTML parsing
      productData.name = productData.name || htmlData.name;
      productData.price = productData.price || htmlData.price;
      productData.image = productData.image || htmlData.image;
      productData.dimensions = productData.dimensions || htmlData.dimensions;
      productData.weight = productData.weight || htmlData.weight;
      // For variants, prefer HTML parsing as it's more accurate
      productData.variant = htmlData.variant || productData.variant;
    }

    return productData;
  }

  extractVariantProperties(obj, variantParts) {
    for (const [prop, value] of Object.entries(obj)) {
      if (value && typeof value === 'string' && value.trim()) {
        const trimmedValue = value.trim();
        if (trimmedValue.length >= 2 && trimmedValue.length <= 50) {
          // Smart categorization based on actual content
          const lowerValue = trimmedValue.toLowerCase();
          
          if (this.isColorValue(lowerValue)) {
            variantParts.push(`Color: ${trimmedValue}`);
          } else if (this.isSizeValue(lowerValue)) {
            variantParts.push(`Size: ${trimmedValue}`);
          } else if (prop === 'material' || this.isMaterialValue(lowerValue)) {
            variantParts.push(`Material: ${trimmedValue}`);
          } else if (prop === 'style' || prop === 'type') {
            variantParts.push(`Style: ${trimmedValue}`);
          } else if (prop === 'finish') {
            variantParts.push(`Finish: ${trimmedValue}`);
          } else if (prop === 'pattern') {
            variantParts.push(`Pattern: ${trimmedValue}`);
          } else {
            // Default to the property name
            const propName = prop.charAt(0).toUpperCase() + prop.slice(1);
            variantParts.push(`${propName}: ${trimmedValue}`);
          }
        }
      }
    }
  }

  isColorValue(value) {
    const colorKeywords = /\b(black|white|brown|gray|grey|blue|red|green|yellow|beige|tan|navy|cream|ivory|khaki|charcoal|burgundy|maroon|olive|teal|coral|sage|taupe|mocha|espresso|latte|camel|sand|stone|slate|pewter|bronze|copper|gold|silver|rose|blush|mint|seafoam|turquoise|aqua|lavender|purple|violet|magenta|pink|orange|peach|apricot|rust|terracotta|denim|indigo|rattan|wicker|natural|antique|vintage|distressed|weathered|aged)\b/i;
    return colorKeywords.test(value);
  }

  isSizeValue(value) {
    const sizeKeywords = /\b(twin|full|queen|king|california|cal|single|double|xl|extra|small|medium|large|xs|s|m|l|xl|xxl|xxxl|\d+['"]\s*x\s*\d+['"']|\d+\s*x\s*\d+|\d+['"]\s*wide|\d+['"]\s*deep|\d+['"]\s*high|\d+\s*inch|\d+\s*ft|\d+\s*cm|\d+\s*mm)\b/i;
    return sizeKeywords.test(value);
  }

  isMaterialValue(value) {
    const materialKeywords = /\b(wood|wooden|metal|steel|iron|aluminum|plastic|fabric|cotton|linen|polyester|leather|velvet|suede|silk|wool|bamboo|rattan|wicker|glass|ceramic|marble|granite|stone|concrete|oak|pine|cherry|maple|walnut|mahogany|teak|cedar|birch|ash|poplar|acacia|mango|sheesham|rosewood)\b/i;
    return materialKeywords.test(value);
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

    // Extract product name from HTML
    const titleSelectors = this.getTitleSelectors(retailer);
    for (const selector of titleSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim()) {
        productData.name = element.text().trim().replace(/\s+/g, ' ').substring(0, 200);
        console.log('   📝 HTML Product name:', productData.name.substring(0, 50) + '...');
        break;
      }
    }

    // Extract price from HTML
    const priceSelectors = this.getPriceSelectors(retailer);
    for (const selector of priceSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const priceText = element.text().replace(/[^0-9.]/g, '');
        const price = parseFloat(priceText);
        if (price > 0 && price < 100000) {
          productData.price = price;
          console.log('   💰 HTML Price: $' + productData.price);
          break;
        }
      }
    }

    // Extract main image
    const imageSelectors = this.getImageSelectors(retailer);
    for (const selector of imageSelectors) {
      const element = $(selector).first();
      if (element.length) {
        let imgSrc = element.attr('src') || element.attr('data-src') || element.attr('data-original');
        if (imgSrc && imgSrc.startsWith('http')) {
          productData.image = imgSrc;
          console.log('   🖼️ HTML Image: Found');
          break;
        }
      }
    }

    // Extract variant information
    const variantSelectors = this.getVariantSelectors(retailer);
    const allVariants = [];
    
    for (const selector of variantSelectors) {
      const elements = $(selector);
      elements.each((i, el) => {
        const variantText = $(el).text().trim();
        if (variantText.length >= 2 && variantText.length <= 50 && 
            !variantText.toLowerCase().includes('select') &&
            !variantText.toLowerCase().includes('choose') &&
            !allVariants.includes(variantText)) {
          allVariants.push(variantText);
        }
      });
    }
    
    // Combine all found variants
    if (allVariants.length > 0) {
      productData.variant = allVariants.join(', ');
      console.log('   🎨 HTML Variants:', productData.variant);
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
      console.log('   📏 HTML Dimensions:', `${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
    }

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
      '.selected',
      '.selected-option',
      '.selected-variant',
      '[aria-selected="true"]',
      '.variant-selected'
    ];

    const specific = {
      'Amazon': [
        '.a-button-selected .a-button-text',
        '.a-dropdown-prompt',
        '#variation_color_name .selection',
        '#variation_size_name .selection',
        '#variation_style_name .selection',
        '.swatches .a-button-selected span'
      ],
      'Wayfair': [
        '.SelectedOption',
        '.option-selected',
        '.selected-swatch',
        '[data-testid="selected-option"]',
        '.ProductOptionPills .selected',
        '.OptionPill.selected'
      ],
      'Target': [
        '.selected-variant',
        '.h-text-bold',
        '[data-test="selected-variant"]',
        '.swatch--selected'
      ],
      'Walmart': [
        '.selected-variant-value',
        '[data-selected="true"]',
        '.variant-pill--selected'
      ],
      'Best Buy': [
        '.selected-variation',
        '.variation-selected'
      ],
      'IKEA': [
        '.range-revamp-pip-selected',
        '.pip-selected',
        '.range-revamp-color-image.selected',
        '.range-revamp-size-option.selected',
        '[aria-pressed="true"]'
      ],
      'Crate & Barrel': [
        '.selected-swatch',
        '.swatch.selected',
        '.option-selected',
        '.variant-selected',
        '[data-selected="true"]',
        '.color-swatch.selected',
        '.size-option.selected'
      ],
      'Luna Furniture': [
        '.product-form__input:checked + label',
        '.variant-input:checked + label',
        '.swatch.selected',
        '.option-value.selected',
        '.variant-option.selected',
        '.product-option.selected'
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
      if (domain.includes('lunafurn.com')) return 'Luna Furniture';
      if (domain.includes('overstock.com')) return 'Overstock';
      if (domain.includes('cb2.com')) return 'CB2';
      if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
      if (domain.includes('westelm.com')) return 'West Elm';
      if (domain.includes('potterybarn.com')) return 'Pottery Barn';
      if (domain.includes('ashleyfurniture.com')) return 'Ashley Furniture';
      if (domain.includes('roomstogo.com')) return 'Rooms To Go';
      if (domain.includes('livingspaces.com')) return 'Living Spaces';
      return 'Unknown';
    } catch (e) {
      return 'Unknown';
    }
  }
}

module.exports = ZyteScraper;