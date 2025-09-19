// backend/zyteScraper.js - Fixed Zyte API Integration
const axios = require('axios');

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

  categorizeProduct(text) {
    if (/\b(outdoor|patio|garden|deck|poolside|backyard|exterior|weather|teak|wicker|rattan)\b/.test(text)) return 'outdoor';
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

      // Fill in missing data with estimations
      const productName = productData.name || `Product from ${retailer}`;
      const category = productData.category || categorizeProduct(productName, url);
      
      console.log(`   🏷️ Product category: ${category}`);
      
      if (!productData.dimensions) {
        // Try AI estimation first
        // const aiEstimate = await learningSystem.getSmartEstimation(category, productName, retailer);
        // if (aiEstimate) {
        //   productData.dimensions = aiEstimate.dimensions;
        //   productData.weight = productData.weight || aiEstimate.weight;
        //   console.log(`   🤖 AI: Applied learned patterns (confidence: ${(aiEstimate.confidence * 100).toFixed(0)}%)`);
        // } else {
          productData.dimensions = estimateDimensions(category, productName);
          console.log(`   📐 Used category-based estimation for: ${category}`);
        // }
      }
      
      if (!productData.weight) {
        productData.weight = estimateWeight(productData.dimensions, category);
        console.log(`   ⚖️ Estimated weight: ${productData.weight} lbs`);
      }
      
      // Calculate shipping cost
      const shippingCost = calculateShippingCost(
        productData.dimensions,
        productData.weight,
        productData.price || 100
      );
      
      // SAFEGUARD: Final shipping cost validation
      const itemPrice = productData.price || 100;
      const shippingPercentage = (shippingCost / itemPrice) * 100;
      
      if (shippingPercentage > 60) {
        console.log(`   🚨 WARNING: Shipping cost is ${shippingPercentage.toFixed(0)}% of item price - may need manual review`);
      }
      
      // Prepare final product object
      const product = {
        name: productData.name,
        price: productData.price,
        image: productData.image,
        dimensions: productData.dimensions,
        weight: productData.weight,
        brand: productData.brand,
        category: category,
        inStock: productData.inStock,
        variant: productData.variant,
        shippingCost: shippingCost,
        retailer: retailer,
        url: url
      };

      return product;

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
          } else if (prop === 'material') {
            variantParts.push(`Material: ${trimmedValue}`);
          }
        }
      }
    }
  }
}

function estimateDimensions(category, name = '') {
  const text = name.toLowerCase();
  
  // Check if dimensions are in the name
  const dimMatch = text.match(/(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)/);
  if (dimMatch) {
    const dims = {
      length: Math.max(1, parseFloat(dimMatch[1]) * 1.2),
      width: Math.max(1, parseFloat(dimMatch[2]) * 1.2), 
      height: Math.max(1, parseFloat(dimMatch[3]) * 1.2)
    };
    
    if (dims.length <= 120 && dims.width <= 120 && dims.height <= 120) {
      return dims;
    }
  }
  
  // Special handling for high-end furniture retailers
  if (text.includes('crate') || text.includes('barrel') || text.includes('west elm') || 
      text.includes('pottery barn') || text.includes('cb2')) {
    
    // Extract size from product name/URL
    const sizeMatch = text.match(/(\d+)[-\s]*(inch|in|"|')/i);
    if (sizeMatch) {
      const size = parseInt(sizeMatch[1]);
      if (size > 20 && size < 120) {
        return {
          length: size,
          width: Math.round(size * 0.4), // 40% of length
          height: Math.round(size * 0.35) // 35% of length
        };
      }
    }
    
    // Default for high-end outdoor furniture
    if (text.includes('outdoor') || text.includes('patio') || text.includes('sofa')) {
      return {
        length: 85, // Reasonable outdoor sofa length
        width: 35,  // Reasonable depth
        height: 32  // Reasonable height
      };
    }
  }
  
  // Enhanced category estimates with more realistic sizes
  const baseEstimates = {
    'high-end-furniture': {
      length: 72,  // Fixed reasonable size
      width: 32,   // Fixed reasonable size  
      height: 30   // Fixed reasonable size
    },
    'furniture': {
      length: 48,  // Fixed reasonable size
      width: 30,   // Fixed reasonable size
      height: 36   // Fixed reasonable size
    },
    'outdoor': {
      length: 78,  // Fixed reasonable size
      width: 34,   // Fixed reasonable size
      height: 32   // Fixed reasonable size
    },
    'electronics': {
      length: 24,  // Fixed reasonable size
      width: 16,   // Fixed reasonable size
      height: 12   // Fixed reasonable size
    },
    'appliances': {
      length: 30,  // Fixed reasonable size
      width: 30,   // Fixed reasonable size
      height: 48   // Fixed reasonable size
    },
    'clothing': {
      length: 14,  // Fixed reasonable size
      width: 12,   // Fixed reasonable size
      height: 3    // Fixed reasonable size
    },
    'books': {
      length: 10,  // Fixed reasonable size
      width: 7,    // Fixed reasonable size
      height: 2    // Fixed reasonable size
    },
    'toys': {
      length: 16,  // Fixed reasonable size
      width: 14,   // Fixed reasonable size
      height: 12   // Fixed reasonable size
    },
    'sports': {
      length: 30,  // Fixed reasonable size
      width: 24,   // Fixed reasonable size
      height: 16   // Fixed reasonable size
    },
    'home-decor': {
      length: 18,  // Fixed reasonable size
      width: 15,   // Fixed reasonable size
      height: 18   // Fixed reasonable size
    },
    'tools': {
      length: 20,  // Fixed reasonable size
      width: 15,   // Fixed reasonable size
      height: 8    // Fixed reasonable size
    },
    'garden': {
      length: 30,  // Fixed reasonable size
      width: 24,   // Fixed reasonable size
      height: 18   // Fixed reasonable size
    },
    'general': {
      length: 18,  // Fixed reasonable size
      width: 15,   // Fixed reasonable size
      height: 12   // Fixed reasonable size
    }
  };
  
  const estimate = baseEstimates[category] || baseEstimates['general'];
  
  return {
    length: estimate.length,
    width: estimate.width,
    height: estimate.height
  };
}