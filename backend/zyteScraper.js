// backend/zyteScraper.js - Optimized Zyte API Integration with Deep Research
const axios = require('axios');
const cheerio = require('cheerio');

class ZyteScraper {
  constructor() {
    this.apiKey = process.env.ZYTE_API_KEY;
    this.enabled = !!this.apiKey;
    this.baseURL = 'https://api.zyte.com/v1/extract';
    
  }

  async scrapeProduct(url) {
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
        }
        customHttpRequestHeaders: options.userAgent ? {
          password: ''
        },
        headers: {
          'Content-Type': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (!response.data) {
        throw new Error('No data received from Zyte API');
      }
      
      return this.parseZyteResponse(response.data);

    } catch (error) {
      throw error;
    }
  }
}