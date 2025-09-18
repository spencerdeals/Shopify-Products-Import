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
      // Fixed Zyte configuration - proper format
      const requestData = {
        url: url,
        httpResponseBody: true
      };
      
      const response = await axios.post(this.baseURL, requestData, {
        auth: {
          username: this.apiKey,
          password: ''
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 20000,
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
      
      return this.parseZyteResponse(response.data, url);

    } catch (error) {
      if (error.response && error.response.status === 422) {
        console.error('❌ Zyte 422: Invalid request format');
      } else {
        console.error('❌ Zyte scraping failed:', error.message);
      }
      throw error;
    }
  }

  parseZyteResponse(data, url) {
    const result = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      variant: null
    };

    // Parse HTML response
    if (data.httpResponseBody) {
      const html = data.httpResponseBody;
      
      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                        html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (titleMatch) {
        result.name = titleMatch[1].trim().substring(0, 200);
      }
      
      // Extract price
      const pricePatterns = [
        /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g,
        /price[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i
      ];
      
      for (const pattern of pricePatterns) {
        const matches = [...html.matchAll(pattern)];
        for (const match of matches) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (price > 0 && price < 100000) {
            result.price = price;
            break;
          }
        }
        if (result.price) break;
      }
      
      // Extract image
      const imgMatch = html.match(/<img[^>]+src="([^"]+)"[^>]*product/i) ||
                      html.match(/property="og:image"[^>]+content="([^"]+)"/i);
      if (imgMatch && imgMatch[1].startsWith('http')) {
        result.image = imgMatch[1];
      }
      
      // Extract dimensions
      const dimMatch = html.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i);
      if (dimMatch) {
        result.dimensions = {
          length: parseFloat(dimMatch[1]),
          width: parseFloat(dimMatch[2]),
          height: parseFloat(dimMatch[3])
        };
      }
    }

    return result;
  }
}

module.exports = ZyteScraper;