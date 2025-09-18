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
      // Simple, working Zyte configuration
      const requestData = {
        url: url,
        product: true,
        productOptions: {
          extractFrom: 'httpResponseBody'
        }
      };
      
      const response = await axios.post(this.baseURL, requestData, {
        auth: {
          username: this.apiKey,
          password: ''
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 25000,
        validateStatus: function (status) {
          return status >= 200 && status < 500; // Don't throw on 4xx errors
        }
      });

      if (response.status >= 400) {
        throw new Error(`Zyte API error: ${response.status} - ${response.data?.error || 'Unknown error'}`);
      }

      if (!response.data) {
        throw new Error('No data received from Zyte API');
      }
      
      return this.parseZyteResponse(response.data);

    } catch (error) {
      if (error.response && error.response.status === 422) {
        console.error('❌ Zyte 422: Invalid request format');
      } else {
        console.error('❌ Zyte scraping failed:', error.message);
      }
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