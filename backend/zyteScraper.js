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
    console.log(`   Status: ${this.enabled ? '✅ ENABLED (v4.0 - Fixed Price Parsing)' : '❌ DISABLED'}`);
    
    if (!this.enabled) {
      console.log('   ⚠️ Set ZYTE_API_KEY environment variable to enable Zyte scraping');
    } else {
      console.log('   🎯 Ready to use Zyte API with automatic product extraction and smart price parsing');
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Zyte not configured - missing API key');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🕷️ Zyte scraping ${retailer}: ${url.substring(0, 60)}...`);

    try {
      console.log('   📤 Sending request to Zyte API with automatic extraction...');
      
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
      
      if (!response.data) {
        throw new Error('No data received from Zyte API');
      }
      
      const productData = this.parseZyteResponse(response.data, url, retailer);
      
      console.log('📦 Zyte extraction results:', {
        hasName: !!productData.name,
        hasPrice: !!productData.price,
        hasImage: !!productData.image,
        hasDimensions: !!productData.dimensions,
        hasWeight: !!productData.weight,
        hasVariant: !!productData.variant,
        confidence: productData.confidence
      });

      return productData;

    } catch (error) {
      console.error('❌ Zyte scraping failed:', error.message);
      throw error;
    }
  }

  parseZyteResponse(data, url, retailer) {
    console.log('🔍 Parsing Zyte response with automatic extraction...');
    
    const productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true,
      variant: null,
      confidence: null
    };

    // Priority 1: Extract from Zyte's automatic product extraction
    if (data.product) {
      console.log('   ✅ Using Zyte automatic extraction data');
      const product = data.product;
      
      // Product name
      productData.name = product.name || product.title || null;
      if (productData.name) {
        productData.name = productData.name.trim().substring(0, 200);
        console.log('   📝 Product name:', productData.name.substring(0, 50) + '...');
      }

      // Price - handle multiple formats with validation
      if (product.price) {
        let priceValue = product.price;
        if (typeof priceValue === 'object' && priceValue.value) {
          priceValue = priceValue.value;
        }
        
        if (typeof priceValue === 'string') {
          const priceMatch = priceValue.match(/[\d,]+\.?\d*/);
          if (priceMatch) {
            const price = parseFloat(priceMatch[0].replace(/,/g, ''));
            if (price > 0 && price < 100000) {
              productData.price = price;
              console.log('   💰 Price: $' + productData.price);
            }
          }
        } else if (typeof priceValue === 'number' && priceValue > 0 && priceValue < 100000) {
          productData.price = priceValue;
          console.log('   💰 Price: $' + productData.price);
        }
      }

      // If Zyte price is invalid, try HTML parsing
      if (!productData.price && data.httpResponseBody) {
        console.log('   🔍 Zyte price invalid, falling back to HTML parsing...');
        const htmlPrice = this.extractPriceFromHTML(data.httpResponseBody, retailer);
        if (htmlPrice) {
          productData.price = htmlPrice;
          console.log('   💰 HTML Price: $' + productData.price);
        } else {
          console.log('   ⚠️ Using Zyte price as fallback: $' + product.price);
        }
      }

      // Images
      if (product.images && product.images.length > 0) {
        const firstImage = product.images[0];
        productData.image = typeof firstImage === 'object' ? firstImage.url : firstImage;
        console.log('   🖼️ Image: Found');
      } else if (product.mainImage) {
        productData.image = typeof product.mainImage === 'object' ? product.mainImage.url : product.mainImage;
        console.log('   🖼️ Image: Found (main)');
      // Variants - Clean extraction focusing on meaningful data
      const variantParts = [];
      
      // Try variants array first
      if (product.variants && product.variants.length > 0) {
        const selectedVariant = product.variants.find(v => v.selected) || product.variants[0];
        if (selectedVariant) {
          this.extractVariantProperties(selectedVariant, variantParts);
        }
      }
      
      // If no good variants from array, try direct properties
      if (variantParts.length === 0) {
        // Check for direct variant properties
        const directVariants = {};
        if (product.color && typeof product.color === 'string') directVariants.color = product.color;
        if (product.size && typeof product.size === 'string') directVariants.size = product.size;
        if (product.style && typeof product.style === 'string') directVariants.style = product.style;
        if (product.material && typeof product.material === 'string') directVariants.material = product.material;
        if (product.finish && typeof product.finish === 'string') directVariants.finish = product.finish;
        
        this.extractVariantProperties(directVariants, variantParts);
      }
      
      // Set final variant
      if (variantParts.length > 0) {
        productData.variant = variantParts.join(', ');
        console.log('   🎨 Variant:', productData.variant);
      } else {
        console.log('   🎨 No clean variants found');
      }
            console.log('   🎨 Variant:', productData.variant);
          }
        }
      }
    }

    // Priority 2: Parse from HTML if structured data is incomplete
    if (data.httpResponseBody && (!productData.name || !productData.price)) {
      console.log('   🔍 Falling back to HTML parsing...');
      const htmlData = this.parseHTML(data.httpResponseBody, url, retailer);
      
      productData.name = productData.name || htmlData.name;
      productData.price = productData.price || htmlData.price;
      productData.image = productData.image || htmlData.image;
      productData.dimensions = productData.dimensions || htmlData.dimensions;
      productData.weight = productData.weight || htmlData.weight;
      productData.variant = htmlData.variant || productData.variant;
    }

    // Calculate confidence
    const hasEssentials = !!(productData.name && productData.price);
    const hasExtras = !!(productData.image && (productData.variant || productData.brand));
    
    if (hasEssentials && hasExtras) {
      productData.confidence = 0.9;
    } else if (hasEssentials) {
      productData.confidence = 0.7;
    } else {
      productData.confidence = 0.3;
    }

    return productData;
  }

  extractPriceFromHTML(html, retailer) {
    console.log('   🔍 Searching for price in HTML...');
    const $ = cheerio.load(html);
    
    const priceSelectors = this.getPriceSelectors(retailer);
    
    for (const selector of priceSelectors) {
      const elements = $(selector);
      console.log(`   🔍 Found ${elements.length} elements for selector: ${selector}`);
      
      elements.each((i, el) => {
        const priceText = $(el).text().trim();
        const priceMatch = priceText.match(/[\d,]+\.?\d*/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[0].replace(/,/g, ''));
          if (price > 0 && price < 100000) {
            console.log(`   💰 Found valid price: $${price} from selector: ${selector}`);
            return price;
          }
        }
      });
    }
    
    console.log('   ❌ No valid price found in HTML');
    return null;
  }

  extractVariantProperties(obj, variantParts) {
    for (const [prop, value] of Object.entries(obj)) {
      if (value && typeof value === 'string' && value.trim()) {
        const trimmedValue = value.trim();
        if (trimmedValue.length >= 2 && trimmedValue.length <= 50) {
          // Skip raw data dumps and focus on meaningful variants
          if (this.isRawDataDump(trimmedValue)) {
            return; // Skip this property entirely
          
          const lowerValue = trimmedValue.toLowerCase();
          const lowerProp = prop.toLowerCase();
          
          // Smart categorization based on property name and content
          if (lowerProp === 'size' || this.isSizeValue(lowerValue)) {
            variantParts.push(`Size: ${trimmedValue}`);
          } else if (lowerProp === 'color' || lowerProp === 'colour' || this.isColorValue(lowerValue)) {
            variantParts.push(`Color: ${trimmedValue}`);
          } else if (lowerProp === 'material' || this.isMaterialValue(lowerValue)) {
            variantParts.push(`Material: ${trimmedValue}`);
          } else if (lowerProp === 'style' || lowerProp === 'type') {
            variantParts.push(`Style: ${trimmedValue}`);
          } else if (lowerProp === 'finish') {
            variantParts.push(`Finish: ${trimmedValue}`);
          } else if (lowerProp === 'pattern') {
            variantParts.push(`Pattern: ${trimmedValue}`);
          } else if (this.isValidVariantValue(trimmedValue)) {
            // Only add if it looks like a real variant (not raw data)
            variantParts.push(trimmedValue);
          }
        }
      }
    }
  }

  isRawDataDump(value) {
    // Detect raw data dumps that shouldn't be variants
    const indicators = [
      '|', // Pipe separators like "SET | B844-54S | B844-57"
      'Price:', 'Currency:', 'Availability:', 'Sku:', 'RegularPrice:',
      'InStock', 'OutOfStock',
      /\d{3,}/, // Long numbers (likely SKUs/IDs)
      /[A-Z]\d{3}-\d{2}[A-Z]?/, // SKU patterns like B844-54S
    ];
    
    return indicators.some(indicator => {
      if (typeof indicator === 'string') {
        return value.includes(indicator);
      } else {
        return indicator.test(value);
      }
    });
  }

  isValidVariantValue(value) {
    // Check if this looks like a real variant value
    const lowerValue = value.toLowerCase();
    
    // Skip if it contains raw data indicators
    if (this.isRawDataDump(value)) return false;
    
    // Skip if it's just numbers or codes
    if (/^[A-Z0-9\-_]+$/.test(value)) return false;
    
    // Skip if it's too long (likely description text)
    if (value.length > 30) return false;
    
    // Accept common variant patterns
    const validPatterns = [
      /\b(small|medium|large|xl|xxl|xs)\b/i,
      /\b(twin|full|queen|king|california)\b/i,
      /\b\d+['"]\s*x\s*\d+['"]\b/i, // Dimensions like 60" x 80"
      /\b(black|white|brown|gray|blue|red|green)\b/i,
      /\b(wood|metal|fabric|leather|cotton)\b/i,
    ];
    
    return validPatterns.some(pattern => pattern.test(lowerValue));
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

    // Extract product name
    const titleSelectors = this.getTitleSelectors(retailer);
    for (const selector of titleSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim()) {
        productData.name = element.text().trim().replace(/\s+/g, ' ').substring(0, 200);
        break;
      }
    }

    // Extract price
    const priceSelectors = this.getPriceSelectors(retailer);
    for (const selector of priceSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const priceText = element.text().replace(/[^0-9.]/g, '');
        const price = parseFloat(priceText);
        if (price > 0 && price < 100000) {
          productData.price = price;
          break;
        }
      }
    }

    // Extract image
    const imageSelectors = this.getImageSelectors(retailer);
    for (const selector of imageSelectors) {
      const element = $(selector).first();
      if (element.length) {
        let imgSrc = element.attr('src') || element.attr('data-src') || element.attr('data-original');
        if (imgSrc && imgSrc.startsWith('http')) {
          productData.image = imgSrc;
          break;
        }
      }
    }

    return productData;
  }

  getTitleSelectors(retailer) {
    const specific = {
      'Crate & Barrel': [
        'h1.product-name',
        '.pdp-product-name h1',
        '.product-details h1',
        'h1[data-testid="product-name"]'
      ],
      'Amazon': [
        '#productTitle',
        'h1.a-size-large'
      ],
      'Wayfair': [
        'h1[data-testid="product-title"]',
        'h1.ProductTitle'
      ]
    };

    const common = [
      'h1',
      '.product-title',
      '.product-name',
      '[class*="title"]'
    ];

    return [...(specific[retailer] || []), ...common];
  }

  getPriceSelectors(retailer) {
    const specific = {
      'Crate & Barrel': [
        '.price-current',
        '.product-price .price',
        '.pdp-price .price-current',
        '[data-testid="price"]',
        '.price-block .price',
        '.current-price'
      ],
      'Amazon': [
        '.a-price .a-offscreen',
        '.a-price-whole'
      ],
      'Wayfair': [
        '.MoneyPrice',
        '[data-testid="price"]'
      ]
    };

    const common = [
      '.price',
      '[class*="price"]',
      '.current-price',
      '.sale-price'
    ];

    return [...(specific[retailer] || []), ...common];
  }

  getImageSelectors(retailer) {
    const common = [
      '.product-image img',
      'img[class*="product"]',
      '.hero-image img'
    ];

    return common;
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
      if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
      if (domain.includes('cb2.com')) return 'CB2';
      if (domain.includes('westelm.com')) return 'West Elm';
      if (domain.includes('potterybarn.com')) return 'Pottery Barn';
      return 'Unknown';
    } catch (e) {
      return 'Unknown';
    }
  }
}

module.exports = ZyteScraper;