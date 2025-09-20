// backend/zyteScraper.js - Fixed Zyte API Integration with Automatic Extraction
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
      const strategies = [
        {
          name: "ai-extraction",
          payload: {
            url: url,
            product: true,
            productOptions: {
              extractFrom: "httpResponseBody"
            }
          }
        },
        {
          name: "browser-request", 
          payload: {
            url: url,
            browserHtml: true,
            product: true
          }
        },
        {
          name: "default-extraction",
          payload: {
            url: url,
            product: true
          }
        }
      ];
      
      let lastError = null;
      let lastGoodResult = null;
      
      for (const strategy of strategies) {
        console.log(`   🎯 Trying strategy: ${strategy.name}`);
        
        try {
          const response = await axios.post(this.baseURL, strategy.payload, {
            auth: {
              username: this.apiKey,
              password: ''
            },
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Accept-Encoding': 'gzip, deflate'
            },
            timeout: 60000
          });
          
          console.log(`   ✅ Strategy ${strategy.name} succeeded!`);
          console.log('📊 Response status:', response.status);
          
          if (response.data && response.data.product) {
            const confidence = response.data.product.metadata?.probability;
            console.log(`   🎯 Confidence: ${confidence ? (confidence * 100).toFixed(1) + '%' : 'unknown'}`);
            
            if (confidence && confidence > 0.8) {
              console.log(`   🚀 High confidence result with strategy: ${strategy.name}`);
              return this.parseZyteResponse(response.data, url, retailer);
            } else if (confidence && confidence > 0.3) {
              console.log(`   ⚠️ Medium confidence result with strategy: ${strategy.name}, continuing...`);
              // Store this result but try next strategy
              lastGoodResult = { data: response.data, strategy: strategy.name };
            }
          }
          
          console.log(`   ⚠️ Strategy ${strategy.name} low/no confidence, trying next...`);
          
        } catch (error) {
          console.log(`   ❌ Strategy ${strategy.name} failed: ${error.message}`);
          lastError = error;
          continue;
        }
      }
      
      // If we have a medium confidence result, use it
      if (lastGoodResult) {
        console.log(`   📊 Using medium confidence result from ${lastGoodResult.strategy}`);
        return this.parseZyteResponse(lastGoodResult.data, url, retailer);
      }
      
      throw lastError || new Error('All strategies failed');
      
    } catch (error) {
      return this.handleZyteError(error);
    }
  }

  async scrapeProductFallback(url) {
    const retailer = this.detectRetailer(url);
    console.log('🔄 Fallback scraping with browser HTML...');
    
    try {
      const requestPayload = {
        url: url,
        browserHtml: true,
        product: true,
        productOptions: {
          extractFrom: "browserHtml",
          ai: true
        }
      };
      
      console.log('🚨 DEBUG: Exact request payload:', JSON.stringify(requestPayload, null, 2));
      console.log('🚨 DEBUG: API Key (first 8 chars):', this.apiKey.substring(0, 8) + '...');
      console.log('🚨 DEBUG: Base URL:', this.baseURL);
      
      // DEBUG: Log exact axios config
      const axiosConfig = {
        auth: {
          username: this.apiKey,
          password: ''
        },
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate'
        },
        timeout: 90000  // Increased to 90 seconds for complex pages
      };
      
      console.log('🚨 DEBUG: Exact axios config:', JSON.stringify(axiosConfig, null, 2));
      
      // Use the EXACT same format as Zyte playground - simplified request
      const response = await axios.post(this.baseURL, requestPayload, axiosConfig);

      console.log('✅ Zyte request completed successfully');
      console.log('📊 Response status:', response.status);
      console.log('📊 Response headers:', JSON.stringify(response.headers, null, 2));
      
      if (!response.data) {
        throw new Error('No data received from Zyte API');
      }
      
      // Parse the Zyte response using automatic extraction data
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
    console.log('🔍 Parsing Zyte response with automatic extraction...');
    
    // Debug what we received
    console.log('📊 Response confidence:', data.product?.metadata?.probability);
    console.log('📊 Has product data:', !!data.product);
    console.log('📊 Browser HTML length:', data.browserHtml?.length || 0);
    
    // Enhanced debugging - log ALL available data
    if (data.product) {
      console.log('📊 Full Zyte product data structure:');
      console.log('   - Name:', data.product.name);
      console.log('   - Price fields:', {
        price: data.product.price,
        salePrice: data.product.salePrice,
        currentPrice: data.product.currentPrice,
        regularPrice: data.product.regularPrice,
        listPrice: data.product.listPrice
      });
      console.log('   - Images:', data.product.images?.length || 0, 'found');
      console.log('   - Variants:', data.product.variants?.length || 0, 'found');
      console.log('   - Additional properties:', data.product.additionalProperties?.length || 0, 'found');
      console.log('   - Breadcrumbs:', data.product.breadcrumbs?.length || 0, 'found');
      console.log('   - Brand:', data.product.brand);
      console.log('   - Availability:', data.product.availability);
    }
    
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
      allVariants: [],
      confidence: null
    };

    // Priority 1: Use Zyte's automatic product extraction
    if (data.product) {
      const product = data.product;
      console.log('   ✅ Using Zyte automatic extraction data with confidence:', product.metadata?.probability);
      
      // Product name
      productData.name = product.name || null;
      if (productData.name) {
        productData.name = productData.name.trim().substring(0, 200);
        console.log('   📝 Product name:', productData.name.substring(0, 50) + '...');
      }

      // Enhanced price parsing - use the main price from Zyte (it's already the correct sale price)
      if (product.price) {
        productData.price = this.extractBestPrice(product);
        console.log('   💰 Final Price: $' + productData.price);
      }

      // Enhanced image extraction - prefer high-quality variant images
      if (product.images && product.images.length > 0) {
        // Use the main image (highest quality) from Zyte
        const mainImageUrl = product.mainImage?.url || product.images[0]?.url || product.images[0];
        if (mainImageUrl && mainImageUrl.startsWith('http')) {
          productData.image = mainImageUrl;
          console.log('   🖼️ Main Image: Found');
        }
      } else if (product.mainImage && product.mainImage.url) {
        productData.image = product.mainImage.url;
        console.log('   🖼️ Main Image: Found');
      }

      // Brand
      if (product.brand && product.brand.name) {
        productData.brand = product.brand.name;
        console.log('   🏷️ Brand:', productData.brand);
      }

      // Category from breadcrumbs
      if (product.breadcrumbs && Array.isArray(product.breadcrumbs) && product.breadcrumbs.length > 0) {
        const lastCrumb = product.breadcrumbs[product.breadcrumbs.length - 1];
        productData.category = typeof lastCrumb === 'object' ? lastCrumb.name : lastCrumb;
        console.log('   📂 Category:', productData.category);
      } else if (product.breadcrumbs && typeof product.breadcrumbs === 'string') {
        productData.category = product.breadcrumbs.split(' / ').pop() || null;
        console.log('   📂 Category:', productData.category);
      }

      // Enhanced variant extraction using Zyte's rich variant data
      const variants = [];
      
      // Extract all variants using comprehensive method
      const extractedVariants = this.extractAllVariants(product);
      variants.push(...extractedVariants.variants);
      
      // Extract dimensions using comprehensive method
      productData.dimensions = this.extractDimensions(product);
      if (productData.dimensions) {
        console.log('   📏 Dimensions extracted:', `${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
      }
      
      // Extract weight if available
      productData.weight = this.extractWeight(product);
      if (productData.weight) {
        console.log('   ⚖️ Weight extracted:', productData.weight, 'lbs');
      }
      
      // Store all variants
      productData.allVariants = variants;
      
      // Create a comprehensive primary variant
      if (variants.length > 0) {
        productData.variant = variants.join(' • ');
        console.log('   🎯 Final variants:', productData.variant);
      }

      // Availability
      if (product.availability) {
        productData.inStock = product.availability.toLowerCase() === 'instock';
        console.log('   📦 In Stock:', productData.inStock);
      }


      // Confidence score
      if (product.metadata && product.metadata.probability) {
        productData.confidence = parseFloat(product.metadata.probability);
        console.log('   🎯 Confidence:', (productData.confidence * 100).toFixed(1) + '%');
      }

      console.log('   ✅ Zyte extraction successful!');
      return productData;
    }

    console.log('   ✅ Zyte parsing completed!');

    return productData;
  }

  // Enhanced price extraction with priority for sale prices
  extractBestPrice(product) {
    console.log('   🔍 Extracting best price from Zyte data...');
    
    // Priority order: sale/current prices first, then regular prices
    const priceFields = [
      { field: 'salePrice', label: 'Sale Price' },
      { field: 'currentPrice', label: 'Current Price' },
      { field: 'specialPrice', label: 'Special Price' },
      { field: 'price', label: 'Main Price' },
      { field: 'regularPrice', label: 'Regular Price' },
      { field: 'listPrice', label: 'List Price' }
    ];
    
    for (const { field, label } of priceFields) {
      const priceValue = product[field];
      if (priceValue) {
        let parsedPrice = null;
        
        if (typeof priceValue === 'string') {
          // Handle string prices like "$299.99" or "299.99"
          const cleanPrice = priceValue.replace(/[$,\s]/g, '');
          parsedPrice = parseFloat(cleanPrice);
        } else if (typeof priceValue === 'number') {
          parsedPrice = priceValue;
        } else if (typeof priceValue === 'object' && priceValue.value) {
          // Handle price objects like { value: 299.99, currency: "USD" }
          parsedPrice = parseFloat(priceValue.value);
        }
        
        if (parsedPrice && parsedPrice > 0 && parsedPrice < 50000) {
          console.log(`   💰 Using ${label}: $${parsedPrice}`);
          return parsedPrice;
        }
      }
    }
    
    console.log('   ❌ No valid price found in any field');
    return null;
  }

  // Comprehensive variant extraction
  extractAllVariants(product) {
    const variants = [];
    const variantData = {};
    
    console.log('   🎨 Extracting variants from Zyte data...');
    
    // Method 1: Use Zyte's variants array (highest quality)
    if (product.variants && Array.isArray(product.variants)) {
      console.log(`   📊 Found ${product.variants.length} variants in Zyte array`);
      
      product.variants.forEach((variant, index) => {
        console.log(`   🔍 Variant ${index + 1}:`, variant);
        
        // Extract color
        if (variant.color) {
          const colorValue = this.cleanVariantValue(variant.color);
          if (colorValue) {
            variants.push(`Color: ${colorValue}`);
            variantData.color = colorValue;
          }
        }
        
        // Extract size
        if (variant.size) {
          const sizeValue = this.cleanVariantValue(variant.size);
          if (sizeValue) {
            variants.push(`Size: ${sizeValue}`);
            variantData.size = sizeValue;
          }
        }
        
        // Extract style
        if (variant.style) {
          const styleValue = this.cleanVariantValue(variant.style);
          if (styleValue) {
            variants.push(`Style: ${styleValue}`);
            variantData.style = styleValue;
          }
        }
        
        // Extract material
        if (variant.material) {
          const materialValue = this.cleanVariantValue(variant.material);
          if (materialValue) {
            variants.push(`Material: ${materialValue}`);
            variantData.material = materialValue;
          }
        }
      });
    }
    
    // Method 2: Extract from individual product fields
    if (product.color && !variantData.color) {
      const colorValue = this.cleanVariantValue(product.color);
      if (colorValue) {
        variants.push(`Color: ${colorValue}`);
        variantData.color = colorValue;
      }
    }
    
    if (product.size && !variantData.size) {
      const sizeValue = this.cleanVariantValue(product.size);
      if (sizeValue) {
        variants.push(`Size: ${sizeValue}`);
        variantData.size = sizeValue;
      }
    }
    
    // Method 3: Extract from additionalProperties (rich data source)
    if (product.additionalProperties && Array.isArray(product.additionalProperties)) {
      console.log(`   📊 Found ${product.additionalProperties.length} additional properties`);
      
      product.additionalProperties.forEach(prop => {
        const propName = prop.name?.toLowerCase();
        const propValue = this.cleanVariantValue(prop.value);
        
        if (!propValue) return;
        
        // Map property names to variant types
        if (propName === 'orientation' && !variantData.orientation) {
          variants.push(`Orientation: ${propValue}`);
          variantData.orientation = propValue;
        } else if (propName === 'fabric' && !variantData.fabric) {
          variants.push(`Fabric: ${propValue}`);
          variantData.fabric = propValue;
        } else if (propName === 'finish' && !variantData.finish) {
          variants.push(`Finish: ${propValue}`);
          variantData.finish = propValue;
        } else if (propName === 'configuration' && !variantData.configuration) {
          variants.push(`Configuration: ${propValue}`);
          variantData.configuration = propValue;
        }
      });
    }
    
    // Remove duplicates and clean up
    const uniqueVariants = [...new Set(variants)];
    
    if (uniqueVariants.length > 0) {
      console.log('   ✅ Extracted variants:', uniqueVariants);
    } else {
      console.log('   ⚠️ No variants found');
    }
    
    return {
      variants: uniqueVariants,
      variantData: variantData
    };
  }

  // Clean and normalize variant values
  cleanVariantValue(value) {
    if (!value || typeof value !== 'string') return null;
    
    return value
      .replace(/\s*selected\s*/gi, '')
      .replace(/\s*chosen\s*/gi, '')
      .replace(/^(color|size|style|material):\s*/gi, '')
      .trim();
  }

  // Comprehensive dimension extraction
  extractDimensions(product) {
    console.log('   📏 Extracting dimensions from Zyte data...');
    
    // Method 1: Check additionalProperties for dimension data
    if (product.additionalProperties && Array.isArray(product.additionalProperties)) {
      for (const prop of product.additionalProperties) {
        if (prop.name && prop.value) {
          const propName = prop.name.toLowerCase();
          const propValue = prop.value;
          
          // Look for dimension-related properties
          if (propName.includes('dimension') || propName.includes('size') || propName === 'overall') {
            const dims = this.parseDimensionString(propValue);
            if (dims) {
              console.log(`   ✅ Dimensions from ${prop.name}:`, dims);
              return dims;
            }
          }
        }
      }
    }
    
    // Method 2: Check product.size field
    if (product.size) {
      const dims = this.parseDimensionString(product.size);
      if (dims) {
        console.log('   ✅ Dimensions from size field:', dims);
        return dims;
      }
    }
    
    // Method 3: Check product description or other text fields
    const textFields = [product.description, product.features, product.specifications];
    for (const text of textFields) {
      if (text && typeof text === 'string') {
        const dims = this.parseDimensionString(text);
        if (dims) {
          console.log('   ✅ Dimensions from text field:', dims);
          return dims;
        }
      }
    }
    
    console.log('   ⚠️ No dimensions found');
    return null;
  }

  // Parse dimension strings with multiple formats
  parseDimensionString(text) {
    if (!text || typeof text !== 'string') return null;
    
    // Multiple dimension patterns to try
    const patterns = [
      // Pattern: "25.8"H x 85.4"W x 37"D" or "25.8" H x 85.4" W x 37" D"
      /(\d+(?:\.\d+)?)"?\s*H\s*x\s*(\d+(?:\.\d+)?)"?\s*W\s*x\s*(\d+(?:\.\d+)?)"?\s*D/i,
      // Pattern: "H: 25.8" W: 85.4" D: 37""
      /H:\s*(\d+(?:\.\d+)?)"?\s*W:\s*(\d+(?:\.\d+)?)"?\s*D:\s*(\d+(?:\.\d+)?)"?/i,
      // Pattern: "Height: 25.8, Width: 85.4, Depth: 37"
      /Height:\s*(\d+(?:\.\d+)?),?\s*Width:\s*(\d+(?:\.\d+)?),?\s*Depth:\s*(\d+(?:\.\d+)?)/i,
      // Pattern: "25.8 x 85.4 x 37 inches"
      /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i,
      // Pattern: "25.8 H x 85.4 W x 37 D"
      /(\d+(?:\.\d+)?)\s*H\s*x\s*(\d+(?:\.\d+)?)\s*W\s*x\s*(\d+(?:\.\d+)?)\s*D/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const height = parseFloat(match[1]);
        const width = parseFloat(match[2]);
        const depth = parseFloat(match[3]);
        
        // Validate dimensions are reasonable
        if (height > 0 && height < 200 && width > 0 && width < 200 && depth > 0 && depth < 200) {
          return {
            height: height,
            length: width,  // Width becomes length for our system
            width: depth    // Depth becomes width for our system
          };
        }
      }
    }
    
    return null;
  }

  // Extract weight information
  extractWeight(product) {
    console.log('   ⚖️ Extracting weight from Zyte data...');
    
    // Check additionalProperties for weight
    if (product.additionalProperties && Array.isArray(product.additionalProperties)) {
      for (const prop of product.additionalProperties) {
        if (prop.name && prop.value) {
          const propName = prop.name.toLowerCase();
          
          if (propName.includes('weight')) {
            const weight = this.parseWeightString(prop.value);
            if (weight) {
              console.log(`   ✅ Weight from ${prop.name}: ${weight} lbs`);
              return weight;
            }
          }
        }
      }
    }
    
    // Check other fields that might contain weight
    const textFields = [product.weight, product.specifications, product.description];
    for (const text of textFields) {
      if (text) {
        const weight = this.parseWeightString(text);
        if (weight) {
          console.log('   ✅ Weight from text field:', weight, 'lbs');
          return weight;
        }
      }
    }
    
    console.log('   ⚠️ No weight found');
    return null;
  }

  // Parse weight strings
  parseWeightString(text) {
    if (!text) return null;
    
    const textStr = typeof text === 'string' ? text : text.toString();
    
    // Weight patterns
    const patterns = [
      /(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)/i,
      /(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)/i,
      /Weight:\s*(\d+(?:\.\d+)?)/i
    ];
    
    for (const pattern of patterns) {
      const match = textStr.match(pattern);
      if (match) {
        let weight = parseFloat(match[1]);
        
        // Convert kg to lbs if needed
        if (pattern.source.includes('kg')) {
          weight = weight * 2.20462;
        }
        
        // Validate weight is reasonable (1-500 lbs)
        if (weight > 0 && weight < 500) {
          return weight;
        }
      }
    }
    
    return null;
  }

  extractPriceFromHTML(html) {
    if (!html) return null;
    
    const $ = cheerio.load(html);
    
    // Wayfair-specific price selectors - PRIORITIZE SALE PRICES
    const priceSelectors = [
      // Sale/current prices first (highest priority)
      '.SalePriceBlock .MoneyPrice',
      '.CurrentPriceBlock .MoneyPrice', 
      '.price-current',
      '.sale-price',
      '.current-price',
      '[data-testid="current-price"]',
      '[data-testid="sale-price"]',
      '.price-now',
      '.price-special',
      // Standard price selectors (lower priority)
      '.MoneyPrice',
      '[data-testid="price"]',
      '.BasePriceBlock .MoneyPrice',
      '.PriceBlock .MoneyPrice'
    ];

    return this.extractSalePriceFromHTML(html);
  }

  extractSalePriceFromHTML(html) {
    if (!html) return null;
    
    const $ = cheerio.load(html);
    
    // Enhanced Wayfair-specific sale price selectors
    const salePriceSelectors = [
      // Wayfair sale price selectors (highest priority)
      '.SalePriceBlock .MoneyPrice',
      '.CurrentPriceBlock .MoneyPrice',
      '[data-testid="current-price"]',
      '[data-testid="sale-price"]',
      '.price-current',
      '.sale-price',
      '.price-now',
      '.price-special',
      // Look for prices in red or highlighted containers
      '.price-red .MoneyPrice',
      '.highlight-price .MoneyPrice',
      '.special-price .MoneyPrice',
      // Generic sale price patterns
      '[class*="sale"] [class*="price"]',
      '[class*="current"] [class*="price"]',
      '[class*="now"] [class*="price"]'
    ];
    
    const regularPriceSelectors = [
      '.MoneyPrice',
      '[data-testid="price"]',
      '.BasePriceBlock .MoneyPrice',
      '.PriceBlock .MoneyPrice',
      '.price'
    ];
    
    console.log('   🔍 Searching for price in HTML...');
    
    // First, try to find sale prices
    for (const selector of salePriceSelectors) {
      const elements = $(selector);
      console.log(`   🔍 Checking sale price selector: ${selector} (${elements.length} elements)`);
      
      elements.each((i, el) => {
        const priceText = $(el).text().trim();
        console.log(`   💰 Sale price text found: "${priceText}"`);
        
        const priceMatch = priceText.match(/\$?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(/,/g, ''));
          if (price >= 10 && price <= 10000) {
            console.log(`   ✅ SALE PRICE FOUND: $${price} from ${selector}`);
            return price;
          }
        }
      });
    }
    
    // If no sale price found, look for regular prices
    console.log('   ⚠️ No sale price found, checking regular prices...');
    let foundPrices = [];
    
    for (const selector of regularPriceSelectors) {
      const elements = $(selector);
      console.log(`   🔍 Checking regular price selector: ${selector} (${elements.length} elements)`);
      
      elements.each((i, el) => {
        const priceText = $(el).text().trim();
        console.log(`   💰 Regular price text: "${priceText}"`);
        
        const priceMatch = priceText.match(/\$?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(/,/g, ''));
          if (price >= 10 && price <= 10000) {
            foundPrices.push({ price, selector, text: priceText });
            console.log(`   ✅ Regular price found: $${price} from ${selector}`);
          }
        }
      });
    }
    
    // Return the first regular price found
    if (foundPrices.length > 0) {
      const bestPrice = foundPrices[0];
      console.log(`   🎯 Using regular price $${bestPrice.price} from ${bestPrice.selector}`);
      return bestPrice.price;
    }
    
    // Final fallback: Search for price patterns in raw HTML with sale priority
    const pricePatterns = [
      // Sale price patterns (highest priority)
      /(?:sale|now|current|special|save)[\s\S]{0,50}?\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/gi,
      /\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)[\s\S]{0,50}?(?:sale|now|current|special|save)/gi,
      // Regular price patterns
      /\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g
    ];
    
    for (const pattern of pricePatterns) {
      const matches = [...html.matchAll(pattern)];
      const validPrices = [];
      
      for (const match of matches) {
        const price = parseFloat(match[1].replace(/,/g, ''));
        if (price >= 10 && price <= 10000) {
          validPrices.push(price);
        }
      }
      
      if (validPrices.length > 0) {
        if (pattern.source.includes('sale|now|current|special|save')) {
          console.log(`   ✅ SALE PRICE found in HTML pattern: $${validPrices[0]}`);
          return validPrices[0];
        } else {
          const priceFreq = {};
          validPrices.forEach(p => priceFreq[p] = (priceFreq[p] || 0) + 1);
          const mostCommonPrice = Object.keys(priceFreq).reduce((a, b) => 
            priceFreq[a] > priceFreq[b] ? a : b
          );
          console.log(`   ✅ Most common regular price in HTML: $${mostCommonPrice}`);
          return parseFloat(mostCommonPrice);
        }
      }
    }
    
    console.log('   ❌ No valid price found in HTML at all');
    return null;
  }

  extractDimensionsFromProperties(properties) {
    if (!properties || typeof properties !== 'string') return null;
    
    // Look for dimension patterns in the properties string
    const patterns = [
      // Pattern: "overall: 25'' H X 30'' W X 60'' L"
      /(\d+(?:\.\d+)?)''\s*H\s*X\s*(\d+(?:\.\d+)?)''\s*W\s*X\s*(\d+(?:\.\d+)?)''\s*L/i,
      // Pattern: "25'' H X 30'' W X 60'' L"
      /(\d+(?:\.\d+)?)''\s*H.*?(\d+(?:\.\d+)?)''\s*W.*?(\d+(?:\.\d+)?)''\s*L/i,
      // Pattern: "25 H X 30 W X 60 L"
      /(\d+(?:\.\d+)?)\s*H\s*X\s*(\d+(?:\.\d+)?)\s*W\s*X\s*(\d+(?:\.\d+)?)\s*L/i,
      // Pattern: "25x30x60"
      /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i
    ];
    
    for (const pattern of patterns) {
      const match = properties.match(pattern);
      if (match) {
        return {
          height: parseFloat(match[1]),
          width: parseFloat(match[2]),
          length: parseFloat(match[3])
        };
      }
    }
    
    return null;
  }

  parseHTML(html, url, retailer) {
    // Fallback HTML parsing - simplified since we have automatic extraction
    const productData = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      allVariants: [],
      variant: null
    };

    // Extract product name from HTML title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      productData.name = titleMatch[1].trim().replace(/\s*\|\s*Wayfair.*$/i, '').substring(0, 200);
    }

    // Extract price from HTML
    productData.price = this.extractPriceFromHTML(html);

    return productData;
  }
  
  parseHTMLWithVariants(html, url, retailer) {
    const productData = this.parseHTML(html, url, retailer);
    
    // Enhanced variant extraction from HTML
    const variants = [];
    const $ = require('cheerio').load(html);
    
    // Wayfair-specific variant selectors
    if (retailer === 'Wayfair') {
      // Look for selected options
      $('.SelectedOption, .option-selected, .selected-swatch').each((i, el) => {
        const variantText = $(el).text().trim();
        if (variantText && variantText.length < 50) {
          variants.push(variantText);
        }
      });
      
      // Look for color swatches
      $('[data-testid*="color"], .color-option.selected, .ColorOption.selected').each((i, el) => {
        const colorText = $(el).attr('aria-label') || $(el).text().trim();
        if (colorText && colorText.length < 30) {
          variants.push(`Color: ${colorText}`);
        }
      });
      
      // Look for size options
      $('[data-testid*="size"], .size-option.selected, .SizeOption.selected').each((i, el) => {
        const sizeText = $(el).attr('aria-label') || $(el).text().trim();
        if (sizeText && sizeText.length < 30) {
          variants.push(`Size: ${sizeText}`);
        }
      });
    }
    
    // Generic variant extraction for other retailers
    $('.selected, .selected-option, .selected-variant, [aria-selected="true"]').each((i, el) => {
      const variantText = $(el).text().trim();
      if (variantText && variantText.length > 2 && variantText.length < 50) {
        variants.push(variantText);
      }
    });
    
    productData.allVariants = variants;
    productData.variant = variants.length > 0 ? variants.join(' | ') : null;
    
    if (variants.length > 0) {
      console.log('   🎨 HTML variants found:', variants);
    }
    
    return productData;
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