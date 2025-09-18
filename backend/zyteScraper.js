// backend/zyteScraper.js - Simple Zyte API Integration
const axios = require('axios');

class ZyteScraper {
  constructor() {
    this.apiKey = process.env.ZYTE_API_KEY;
    this.enabled = !!this.apiKey;
    this.baseURL = 'https://api.zyte.com/v1/extract';
    
    if (this.enabled) {
      console.log('🕷️ ZyteScraper ENABLED');
    } else {
      console.log('🕷️ ZyteScraper DISABLED (no API key)');
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Zyte not configured - missing API key');
    }

    try {
      const response = await axios.post(this.baseURL, {
        url: url,
        httpResponseBody: true,
        product: true
      }, {
        auth: {
          username: this.apiKey,
          password: ''
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (!response.data) {
        throw new Error('No data received from Zyte API');
      }
      
      return this.parseZyteResponse(response.data);

    } catch (error) {
      console.error('❌ Zyte scraping failed:', error.message);
      throw error;
    }
  }

  parseZyteResponse(data) {
    const result = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      variant: null
    };

    // Extract product data
    if (data.product) {
      result.name = data.product.name;
      result.price = data.product.price;
      result.image = data.product.mainImage;
    }

    return result;
  }
}

module.exports = ZyteScraper;