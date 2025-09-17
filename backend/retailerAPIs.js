const axios = require('axios');

class RetailerAPIs {
  constructor() {
    // Amazon Product Advertising API
    this.amazonConfig = {
      accessKey: process.env.AMAZON_ACCESS_KEY || '',
      secretKey: process.env.AMAZON_SECRET_KEY || '',
      partnerTag: process.env.AMAZON_PARTNER_TAG || '',
      region: 'us-east-1',
      enabled: !!(process.env.AMAZON_ACCESS_KEY && process.env.AMAZON_SECRET_KEY)
    };

    // Walmart API
    this.walmartConfig = {
      apiKey: process.env.WALMART_API_KEY || '',
      enabled: !!process.env.WALMART_API_KEY
    };

    // Target API (RedCircle API)
    this.targetConfig = {
      apiKey: process.env.TARGET_API_KEY || '',
      enabled: !!process.env.TARGET_API_KEY
    };

    // Best Buy API
    this.bestBuyConfig = {
      apiKey: process.env.BESTBUY_API_KEY || '',
      enabled: !!process.env.BESTBUY_API_KEY
    };

    // Wayfair API (if available)
    this.wayfairConfig = {
      apiKey: process.env.WAYFAIR_API_KEY || '',
      enabled: !!process.env.WAYFAIR_API_KEY
    };

    console.log('🏪 Retailer APIs Configuration:');
    console.log(`   Amazon API: ${this.amazonConfig.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`   Walmart API: ${this.walmartConfig.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`   Target API: ${this.targetConfig.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`   Best Buy API: ${this.bestBuyConfig.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`   Wayfair API: ${this.wayfairConfig.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
  }

  // Extract product ID from URL
  extractProductId(url, retailer) {
    try {
      switch (retailer.toLowerCase()) {
        case 'amazon':
          // Amazon ASIN extraction
          const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})|\/gp\/product\/([A-Z0-9]{10})|\/product\/([A-Z0-9]{10})/);
          return asinMatch ? (asinMatch[1] || asinMatch[2] || asinMatch[3]) : null;
          
        case 'walmart':
          // Walmart product ID
          const walmartMatch = url.match(/\/ip\/[^\/]+\/(\d+)/);
          return walmartMatch ? walmartMatch[1] : null;
          
        case 'target':
          // Target DPCI or product ID
          const targetMatch = url.match(/\/p\/[^\/]+\/A-(\d+)/);
          return targetMatch ? targetMatch[1] : null;
          
        case 'best buy':
          // Best Buy SKU
          const bestBuyMatch = url.match(/\/site\/[^\/]+\/(\d+)\.p/);
          return bestBuyMatch ? bestBuyMatch[1] : null;
          
        default:
          return null;
      }
    } catch (error) {
      console.error(`Error extracting product ID from ${url}:`, error.message);
      return null;
    }
  }

  // Amazon Product Advertising API
  async getAmazonProduct(productId) {
    if (!this.amazonConfig.enabled) {
      throw new Error('Amazon API not configured');
    }

    try {
      console.log(`🛒 Fetching Amazon product: ${productId}`);
      
      // Amazon PA API requires complex signing - using simplified approach
      // In production, you'd use the official amazon-paapi library
      const response = await axios.get(`https://webservices.amazon.com/paapi5/getitems`, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Amz-Target': 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems'
        },
        data: {
          PartnerTag: this.amazonConfig.partnerTag,
          PartnerType: 'Associates',
          Marketplace: 'www.amazon.com',
          ItemIds: [productId],
          Resources: [
            'ItemInfo.Title',
            'ItemInfo.Features',
            'ItemInfo.ProductInfo',
            'Images.Primary.Large',
            'Offers.Listings.Price',
            'ItemInfo.TechnicalInfo'
          ]
        },
        timeout: 10000
      });

      const item = response.data.ItemsResult?.Items?.[0];
      if (!item) return null;

      return {
        name: item.ItemInfo?.Title?.DisplayValue || null,
        price: this.extractAmazonPrice(item.Offers?.Listings),
        image: item.Images?.Primary?.Large?.URL || null,
        dimensions: this.extractAmazonDimensions(item.ItemInfo?.TechnicalInfo),
        weight: this.extractAmazonWeight(item.ItemInfo?.TechnicalInfo),
        brand: item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue || null,
        features: item.ItemInfo?.Features?.DisplayValues || [],
        inStock: item.Offers?.Listings?.[0]?.Availability?.Type === 'Now'
      };

    } catch (error) {
      console.error('❌ Amazon API error:', error.message);
      throw error;
    }
  }

  // Walmart API
  async getWalmartProduct(productId) {
    if (!this.walmartConfig.enabled) {
      throw new Error('Walmart API not configured');
    }

    try {
      console.log(`🛒 Fetching Walmart product: ${productId}`);
      
      const response = await axios.get(`https://developer.api.walmart.com/api-proxy/service/affil/product/v2/items/${productId}`, {
        params: {
          apikey: this.walmartConfig.apiKey,
          format: 'json'
        },
        timeout: 10000
      });

      const item = response.data;
      if (!item) return null;

      return {
        name: item.name || null,
        price: parseFloat(item.salePrice) || null,
        image: item.largeImage || item.mediumImage || item.thumbnailImage || null,
        dimensions: this.extractWalmartDimensions(item),
        weight: this.extractWalmartWeight(item),
        brand: item.brandName || null,
        features: item.shortDescription ? [item.shortDescription] : [],
        inStock: item.stock === 'Available'
      };

    } catch (error) {
      console.error('❌ Walmart API error:', error.message);
      throw error;
    }
  }

  // Target API
  async getTargetProduct(productId) {
    if (!this.targetConfig.enabled) {
      throw new Error('Target API not configured');
    }

    try {
      console.log(`🛒 Fetching Target product: ${productId}`);
      
      // Target's RedCircle API
      const response = await axios.get(`https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1`, {
        params: {
          key: this.targetConfig.apiKey,
          tcin: productId,
          pricing_store_id: '911', // Default store
          has_pricing_store_id: 'true'
        },
        timeout: 10000
      });

      const product = response.data?.data?.product;
      if (!product) return null;

      return {
        name: product.item?.product_description?.title || null,
        price: product.price?.current_retail || null,
        image: product.item?.enrichment?.images?.primary_image_url || null,
        dimensions: this.extractTargetDimensions(product.item?.product_description),
        weight: this.extractTargetWeight(product.item?.product_description),
        brand: product.item?.product_brand?.brand || null,
        features: product.item?.product_description?.bullet_descriptions || [],
        inStock: product.available_to_promise_network?.availability_status === 'IN_STOCK'
      };

    } catch (error) {
      console.error('❌ Target API error:', error.message);
      throw error;
    }
  }

  // Best Buy API
  async getBestBuyProduct(productId) {
    if (!this.bestBuyConfig.enabled) {
      throw new Error('Best Buy API not configured');
    }

    try {
      console.log(`🛒 Fetching Best Buy product: ${productId}`);
      
      const response = await axios.get(`https://api.bestbuy.com/v1/products/${productId}.json`, {
        params: {
          apikey: this.bestBuyConfig.apiKey,
          show: 'name,salePrice,image,weight,height,width,depth,manufacturer,features,onlineAvailability'
        },
        timeout: 10000
      });

      const item = response.data;
      if (!item) return null;

      return {
        name: item.name || null,
        price: item.salePrice || null,
        image: item.image || null,
        dimensions: {
          length: item.depth || null,
          width: item.width || null,
          height: item.height || null
        },
        weight: item.weight || null,
        brand: item.manufacturer || null,
        features: item.features ? item.features.map(f => f.feature) : [],
        inStock: item.onlineAvailability
      };

    } catch (error) {
      console.error('❌ Best Buy API error:', error.message);
      throw error;
    }
  }

  // Helper methods for data extraction
  extractAmazonPrice(listings) {
    if (!listings || !listings.length) return null;
    const price = listings[0]?.Price?.Amount;
    return price ? parseFloat(price) : null;
  }

  extractAmazonDimensions(techInfo) {
    if (!techInfo) return null;
    
    const dimensions = {};
    techInfo.forEach(info => {
      const name = info.Name?.toLowerCase() || '';
      const value = parseFloat(info.Value?.replace(/[^\d.]/g, ''));
      
      if (name.includes('length') && value) dimensions.length = value;
      if (name.includes('width') && value) dimensions.width = value;
      if (name.includes('height') && value) dimensions.height = value;
    });
    
    return (dimensions.length && dimensions.width && dimensions.height) ? dimensions : null;
  }

  extractAmazonWeight(techInfo) {
    if (!techInfo) return null;
    
    const weightInfo = techInfo.find(info => 
      info.Name?.toLowerCase().includes('weight')
    );
    
    if (weightInfo) {
      const weight = parseFloat(weightInfo.Value?.replace(/[^\d.]/g, ''));
      return weight || null;
    }
    
    return null;
  }

  extractWalmartDimensions(item) {
    const dimensions = {};
    
    if (item.productAttributes) {
      item.productAttributes.forEach(attr => {
        const name = attr.name?.toLowerCase() || '';
        const value = parseFloat(attr.value?.replace(/[^\d.]/g, ''));
        
        if (name.includes('length') && value) dimensions.length = value;
        if (name.includes('width') && value) dimensions.width = value;
        if (name.includes('height') && value) dimensions.height = value;
      });
    }
    
    return (dimensions.length && dimensions.width && dimensions.height) ? dimensions : null;
  }

  extractWalmartWeight(item) {
    if (item.productAttributes) {
      const weightAttr = item.productAttributes.find(attr => 
        attr.name?.toLowerCase().includes('weight')
      );
      
      if (weightAttr) {
        const weight = parseFloat(weightAttr.value?.replace(/[^\d.]/g, ''));
        return weight || null;
      }
    }
    
    return null;
  }

  extractTargetDimensions(description) {
    if (!description || !description.bullet_descriptions) return null;
    
    const dimensions = {};
    const dimensionText = description.bullet_descriptions.join(' ').toLowerCase();
    
    const dimMatch = dimensionText.match(/(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)/);
    if (dimMatch) {
      return {
        length: parseFloat(dimMatch[1]),
        width: parseFloat(dimMatch[2]),
        height: parseFloat(dimMatch[3])
      };
    }
    
    return null;
  }

  extractTargetWeight(description) {
    if (!description || !description.bullet_descriptions) return null;
    
    const weightText = description.bullet_descriptions.join(' ').toLowerCase();
    const weightMatch = weightText.match(/(\d+\.?\d*)\s*(?:pounds?|lbs?|kg)/);
    
    if (weightMatch) {
      let weight = parseFloat(weightMatch[1]);
      if (weightText.includes('kg')) weight *= 2.205; // Convert kg to lbs
      return weight;
    }
    
    return null;
  }

  // Main method to get product data from appropriate retailer API
  async getProductData(url, retailer) {
    const productId = this.extractProductId(url, retailer);
    if (!productId) {
      throw new Error(`Could not extract product ID from URL: ${url}`);
    }

    console.log(`🏪 Using ${retailer} API for product ID: ${productId}`);

    switch (retailer.toLowerCase()) {
      case 'amazon':
        return await this.getAmazonProduct(productId);
      case 'walmart':
        return await this.getWalmartProduct(productId);
      case 'target':
        return await this.getTargetProduct(productId);
      case 'best buy':
        return await this.getBestBuyProduct(productId);
      default:
        throw new Error(`No API available for retailer: ${retailer}`);
    }
  }

  // Check which retailer APIs are available
  getAvailableAPIs() {
    return {
      amazon: this.amazonConfig.enabled,
      walmart: this.walmartConfig.enabled,
      target: this.targetConfig.enabled,
      bestBuy: this.bestBuyConfig.enabled,
      wayfair: this.wayfairConfig.enabled
    };
  }
}

module.exports = RetailerAPIs;