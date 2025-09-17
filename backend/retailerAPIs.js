// backend/retailerAPIs.js
const axios = require('axios');

class RetailerAPIs {
  constructor() {
    // Walmart Open API - Free, no key required for basic product info
    this.walmartBaseURL = 'https://api.walmart.com/v1';
    
    // Target RedSky API - Unofficial but works
    this.targetBaseURL = 'https://redsky.target.com/redsky_aggregations/v1';
    
    // Best Buy API - requires key but has free tier
    this.bestBuyAPIKey = process.env.BESTBUY_API_KEY || '';
    this.bestBuyBaseURL = 'https://api.bestbuy.com/v1';
    
    console.log('🏪 Retailer APIs initialized:');
    console.log(`   Walmart: ✅ Available (no key required)`);
    console.log(`   Target: ✅ Available (unofficial API)`);
    console.log(`   Best Buy: ${this.bestBuyAPIKey ? '✅ Available' : '❌ No API key'}`);
  }

  // Extract product ID from URL
  extractProductId(url, retailer) {
    try {
      switch(retailer) {
        case 'Walmart':
          // Walmart URLs: /ip/Product-Name/12345678
          const walmartMatch = url.match(/\/ip\/[^\/]+\/(\d+)/);
          return walmartMatch ? walmartMatch[1] : null;
          
        case 'Target':
          // Target URLs: /p/product-name/-/A-12345678
          const targetMatch = url.match(/\/p\/[^\/]+\/-\/A-(\d+)/);
          return targetMatch ? targetMatch[1] : null;
          
        case 'Best Buy':
          // Best Buy URLs: /site/product-name/12345678.p
          const bestBuyMatch = url.match(/\/site\/[^\/]+\/(\d+)\.p/);
          return bestBuyMatch ? bestBuyMatch[1] : null;
          
        default:
          return null;
      }
    } catch (error) {
      console.error(`Error extracting product ID for ${retailer}:`, error.message);
      return null;
    }
  }

  // Walmart Product API
  async getWalmartProduct(url) {
    try {
      const productId = this.extractProductId(url, 'Walmart');
      if (!productId) {
        console.log('❌ Could not extract Walmart product ID from URL');
        return null;
      }

      console.log(`🔍 Fetching Walmart product ${productId}...`);
      
      // Use Walmart's public API endpoint
      const response = await axios.get(`${this.walmartBaseURL}/items/${productId}`, {
        params: {
          format: 'json'
        },
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; SDL-Import-Calculator/1.0)'
        },
        timeout: 10000
      });

      const product = response.data;
      
      if (!product) {
        console.log('❌ No product data from Walmart API');
        return null;
      }

      console.log('✅ Walmart API returned product data');
      
      return {
        name: product.name,
        price: product.salePrice || product.msrp,
        image: product.mediumImage || product.thumbnailImage,
        dimensions: this.parseWalmartDimensions(product),
        weight: this.parseWalmartWeight(product),
        brand: product.brandName,
        category: product.categoryPath,
        inStock: product.availableOnline
      };

    } catch (error) {
      console.error('❌ Walmart API error:', error.message);
      return null;
    }
  }

  // Target RedSky API
  async getTargetProduct(url) {
    try {
      const productId = this.extractProductId(url, 'Target');
      if (!productId) {
        console.log('❌ Could not extract Target product ID from URL');
        return null;
      }

      console.log(`🔍 Fetching Target product ${productId}...`);
      
      const response = await axios.get(`${this.targetBaseURL}/redsky/default/v2/pdp/tcin/${productId}`, {
        params: {
          excludes: 'taxonomy,price,promotion,bulk_ship,rating_and_review_reviews,rating_and_review_statistics,question_answer_statistics',
          key: 'ff457966e64d5e877fdbad070f276d18ecec4a01'
        },
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; SDL-Import-Calculator/1.0)'
        },
        timeout: 10000
      });

      const productData = response.data?.data?.product;
      
      if (!productData) {
        console.log('❌ No product data from Target API');
        return null;
      }

      console.log('✅ Target API returned product data');
      
      return {
        name: productData.item?.product_description?.title,
        price: productData.price?.current_retail,
        image: productData.item?.enrichment?.images?.primary_image_url,
        dimensions: this.parseTargetDimensions(productData),
        weight: this.parseTargetWeight(productData),
        brand: productData.item?.product_brand?.brand,
        category: productData.item?.product_classification?.product_type_name,
        inStock: productData.available_to_promise_network?.availability_status === 'IN_STOCK'
      };

    } catch (error) {
      console.error('❌ Target API error:', error.message);
      return null;
    }
  }

  // Best Buy API (requires key)
  async getBestBuyProduct(url) {
    if (!this.bestBuyAPIKey) {
      console.log('❌ Best Buy API key not configured');
      return null;
    }

    try {
      const productId = this.extractProductId(url, 'Best Buy');
      if (!productId) {
        console.log('❌ Could not extract Best Buy product ID from URL');
        return null;
      }

      console.log(`🔍 Fetching Best Buy product ${productId}...`);
      
      const response = await axios.get(`${this.bestBuyBaseURL}/products/${productId}.json`, {
        params: {
          apikey: this.bestBuyAPIKey,
          show: 'name,salePrice,image,weight,height,width,depth,manufacturer,categoryPath,onlineAvailability'
        },
        timeout: 10000
      });

      const product = response.data;
      
      if (!product) {
        console.log('❌ No product data from Best Buy API');
        return null;
      }

      console.log('✅ Best Buy API returned product data');
      
      return {
        name: product.name,
        price: product.salePrice,
        image: product.image,
        dimensions: {
          length: product.depth,
          width: product.width,
          height: product.height
        },
        weight: product.weight,
        brand: product.manufacturer,
        category: product.categoryPath?.[0]?.name,
        inStock: product.onlineAvailability
      };

    } catch (error) {
      console.error('❌ Best Buy API error:', error.message);
      return null;
    }
  }

  // Parse Walmart dimensions
  parseWalmartDimensions(product) {
    // Check for shipping dimensions first
    if (product.shippingWeight && product.shippingLength && product.shippingWidth && product.shippingHeight) {
      return {
        length: parseFloat(product.shippingLength),
        width: parseFloat(product.shippingWidth),
        height: parseFloat(product.shippingHeight)
      };
    }
    
    // Check for product dimensions
    if (product.productLength && product.productWidth && product.productHeight) {
      // Add 20% padding for shipping box
      return {
        length: parseFloat(product.productLength) * 1.2,
        width: parseFloat(product.productWidth) * 1.2,
        height: parseFloat(product.productHeight) * 1.2
      };
    }
    
    return null;
  }

  // Parse Walmart weight
  parseWalmartWeight(product) {
    if (product.shippingWeight) {
      return parseFloat(product.shippingWeight);
    }
    if (product.weight) {
      return parseFloat(product.weight);
    }
    return null;
  }

  // Parse Target dimensions
  parseTargetDimensions(productData) {
    const specs = productData.item?.product_description?.soft_bullets?.bullets || [];
    
    // Look for dimensions in specifications
    for (const spec of specs) {
      const dimMatch = spec.match(/(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*(?:inches|in|")/i);
      if (dimMatch) {
        return {
          length: parseFloat(dimMatch[1]),
          width: parseFloat(dimMatch[2]),
          height: parseFloat(dimMatch[3])
        };
      }
    }
    
    // Check item details
    const details = productData.item?.enrichment?.buy_box_merchandising?.specifications || {};
    if (details.dimensions) {
      const dimMatch = details.dimensions.match(/(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)/i);
      if (dimMatch) {
        return {
          length: parseFloat(dimMatch[1]),
          width: parseFloat(dimMatch[2]),
          height: parseFloat(dimMatch[3])
        };
      }
    }
    
    return null;
  }

  // Parse Target weight
  parseTargetWeight(productData) {
    const specs = productData.item?.product_description?.soft_bullets?.bullets || [];
    
    for (const spec of specs) {
      const weightMatch = spec.match(/(\d+\.?\d*)\s*(?:pounds?|lbs?|kg)/i);
      if (weightMatch) {
        let weight = parseFloat(weightMatch[1]);
        if (/kg/i.test(spec)) {
          weight *= 2.205; // Convert kg to lbs
        }
        return weight;
      }
    }
    
    return null;
  }

  // Main method to get product data from any supported retailer
  async getProductData(url, retailer) {
    console.log(`🏪 Attempting ${retailer} API lookup...`);
    
    switch(retailer) {
      case 'Walmart':
        return await this.getWalmartProduct(url);
      case 'Target':
        return await this.getTargetProduct(url);
      case 'Best Buy':
        return await this.getBestBuyProduct(url);
      default:
        console.log(`❌ No API available for ${retailer}`);
        return null;
    }
  }
}

module.exports = RetailerAPIs;