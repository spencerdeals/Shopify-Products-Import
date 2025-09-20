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
      }

      // Brand
      productData.brand = product.brand || null;

      // Category
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

      // CRITICAL: Extract shipping dimensions from Zyte data
      productData.dimensions = this.extractShippingDimensions(product);
      if (productData.dimensions) {
        console.log('   📦 Shipping dimensions found:', `${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
      }

      // Extract weight from Zyte data
      productData.weight = this.extractWeight(product);
      if (productData.weight) {
        console.log('   ⚖️ Weight found:', productData.weight + ' lbs');
      }
      // Variants
      if (product.variants && product.variants.length > 0) {
        const selectedVariant = product.variants.find(v => v.selected) || product.variants[0];
        if (selectedVariant) {
          const variantParts = [];
          this.extractVariantProperties(selectedVariant, variantParts);
          
          if (variantParts.length > 0) {
            productData.variant = variantParts.join(', ');
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

  // Extract shipping dimensions from Zyte product data
  extractShippingDimensions(product) {
    console.log('   🔍 Searching for shipping dimensions in Zyte data...');
    
    // Method 1: Check description for shipping dimensions
    if (product.description) {
      const shippingDims = this.parseShippingDimensionsFromText(product.description);
      if (shippingDims) {
        console.log('   📦 Found shipping dimensions in description');
        return shippingDims;
      }
    }
    
    // Method 2: Check additionalProperties for shipping dimensions
    if (product.additionalProperties) {
      const propsText = typeof product.additionalProperties === 'object' 
        ? JSON.stringify(product.additionalProperties) 
        : String(product.additionalProperties);
      
      const shippingDims = this.parseShippingDimensionsFromText(propsText);
      if (shippingDims) {
        console.log('   📦 Found shipping dimensions in additional properties');
        return shippingDims;
      }
    }
    
    // Method 3: Check for product dimensions and convert to shipping
    if (product.additionalProperties && typeof product.additionalProperties === 'string') {
      const productDimMatch = product.additionalProperties.match(/product dimensions:\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*inches/i);
      if (productDimMatch) {
        const productDims = {
          length: parseFloat(productDimMatch[1]),
          width: parseFloat(productDimMatch[2]),
          height: parseFloat(productDimMatch[3])
        };
        
        // Convert product dimensions to shipping dimensions (add packaging)
        const shippingDims = this.convertToShippingDimensions(productDims);
        console.log('   📦 Converted product dimensions to shipping dimensions');
        return shippingDims;
      }
    }
    
    console.log('   ❌ No shipping dimensions found in Zyte data');
    return null;
  }

  // Parse shipping dimensions from text (like your example)
  parseShippingDimensionsFromText(text) {
    const patterns = [
      // "Shipping Dimensions: 12 Inch King: 20*20*41; Approx. 110lbs"
      /shipping\s+dimensions?[^:]*:\s*[^:]*:\s*(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)/i,
      // "12 Inch King: 20*20*41"
      /(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)[^0-9]*(?:approx\.?\s*)?(\d+(?:\.\d+)?)\s*lbs?/i,
      // Generic shipping dimensions
      /shipping[^:]*:\s*(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)/i,
      // Box dimensions
      /box\s+dimensions?[^:]*:\s*(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const length = parseFloat(match[1]);
        const width = parseFloat(match[2]);
        const height = parseFloat(match[3]);
        
        // Validate dimensions are reasonable
        if (length > 0 && width > 0 && height > 0 && 
            length < 200 && width < 200 && height < 200) {
          return {
            length: Math.round(length * 10) / 10,
            width: Math.round(width * 10) / 10,
            height: Math.round(height * 10) / 10
          };
        }
      }
    }
    
    return null;
  }

  // Convert product dimensions to shipping dimensions by adding packaging
  convertToShippingDimensions(productDims) {
    // Add 2-4 inches per dimension for packaging
    return {
      length: Math.round((productDims.length + 3) * 10) / 10,
      width: Math.round((productDims.width + 3) * 10) / 10,
      height: Math.round((productDims.height + 2) * 10) / 10
    };
  }

  // Extract weight from Zyte product data
  extractWeight(product) {
    console.log('   🔍 Searching for weight in Zyte data...');
    
    // Method 1: Direct weight property
    if (product.weight) {
      if (typeof product.weight === 'object' && product.weight.value) {
        const weight = parseFloat(product.weight.value);
        const unit = (product.weight.unit || 'pound').toLowerCase();
        
        // Convert to pounds if needed
        if (unit.includes('kg') || unit.includes('kilogram')) {
          return Math.round(weight * 2.205 * 10) / 10;
        } else {
          return Math.round(weight * 10) / 10;
        }
      } else if (typeof product.weight === 'string') {
        const weightMatch = product.weight.match(/(\d+(?:\.\d+)?)\s*(lb|pound|kg|kilogram)?/i);
        if (weightMatch) {
          const weight = parseFloat(weightMatch[1]);
          const unit = (weightMatch[2] || 'lb').toLowerCase();
          
          if (unit.includes('kg')) {
            return Math.round(weight * 2.205 * 10) / 10;
          } else {
            return Math.round(weight * 10) / 10;
          }
        }
      }
    }
    
    // Method 2: Check description for weight
    if (product.description) {
      const weightMatch = product.description.match(/approx\.?\s*(\d+(?:\.\d+)?)\s*lbs?/i);
      if (weightMatch) {
        console.log('   ⚖️ Found weight in description');
        return Math.round(parseFloat(weightMatch[1]) * 10) / 10;
      }
    }
    
    // Method 3: Check additionalProperties for item weight
    if (product.additionalProperties && typeof product.additionalProperties === 'string') {
      const weightMatch = product.additionalProperties.match(/item weight:\s*(\d+(?:\.\d+)?)\s*pounds?/i);
      if (weightMatch) {
        console.log('   ⚖️ Found weight in additional properties');
        return Math.round(parseFloat(weightMatch[1]) * 10) / 10;
      }
    }
    
    console.log('   ❌ No weight found in Zyte data');
    return null;
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
          } else {
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