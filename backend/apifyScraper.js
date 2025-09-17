const axios = require('axios');
const { ApifyClient } = require('apify-client');

class ApifyScraper {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = apiKey ? new ApifyClient({ token: apiKey }) : null;
    this.enabled = !!apiKey;
    
    if (this.enabled) {
      console.log('✅ ApifyScraper initialized successfully');
    } else {
      console.log('❌ ApifyScraper disabled - no API key provided');
    }
  }

  isAvailable() {
    return this.enabled;
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Apify not configured');
    }

    try {
      console.log('🔄 Starting Apify scrape for:', url);
      
      // Detect retailer and use appropriate actor
      const retailer = this.detectRetailer(url);
      let actorId;
      
      switch (retailer.toLowerCase()) {
        case 'amazon':
          actorId = 'junglee/amazon-crawler';
          break;
        case 'wayfair':
          actorId = 'dtrungtin/wayfair-scraper';
          break;
        case 'target':
          actorId = 'tugkan/target-scraper';
          break;
        case 'walmart':
          actorId = 'walmart-scraper';
          break;
        default:
          actorId = 'apify/web-scraper';
      }

      const input = {
        startUrls: [{ url }],
        maxRequestsPerCrawl: 1,
        maxConcurrency: 1
      };

      // Run the actor
      const run = await this.client.actor(actorId).call(input, {
        timeout: 30000,
        memory: 256
      });

      // Get results
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('✅ Apify scrape successful');
        
        return {
          name: item.title || item.name || null,
          price: this.extractPrice(item),
          image: item.image || item.imageUrl || null,
          dimensions: this.extractDimensions(item),
          weight: this.extractWeight(item),
          brand: item.brand || null,
          category: null,
          inStock: item.availability !== 'out of stock'
        }
        return this.parseProCrawlerData(item);
      }
      
      console.log('❌ Apify: No results found');
      return null;
      
    } catch (error) {
      console.error('❌ Apify scrape failed:', error.message);
      throw error;
    }
  }

  detectRetailer(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain.includes('amazon.com')) return 'Amazon';
      if (domain.includes('wayfair.com')) return 'Wayfair';
      if (domain.includes('target.com')) return 'Target';
      if (domain.includes('walmart.com')) return 'Walmart';
      return 'Unknown';
    } catch (e) {
      return 'Unknown';
    }
  }

  extractPrice(item) {
    // Try various price fields
    const priceFields = ['price', 'currentPrice', 'salePrice', 'regularPrice'];
    
    for (const field of priceFields) {
      if (item[field]) {
        const price = typeof item[field] === 'string' ? 
          parseFloat(item[field].replace(/[^0-9.]/g, '')) : 
          parseFloat(item[field]);
        
        if (price > 0 && price < 50000) {
          return price;
        }
      }
    }
    
    return null;
  }

  extractDimensions(item) {
    // Try to find dimensions in various fields
    const dimensionFields = ['dimensions', 'size', 'specs', 'details'];
    
    for (const field of dimensionFields) {
      if (item[field]) {
        const dimText = typeof item[field] === 'string' ? item[field] : JSON.stringify(item[field]);
        const match = dimText.match(/(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)/i);
        
        if (match) {
          return {
            length: parseFloat(match[1]),
            width: parseFloat(match[2]),
            height: parseFloat(match[3])
          };
        }
      }
    }
    
    return null;
  }

  extractWeight(item) {
    // Try to find weight in various fields
    const weightFields = ['weight', 'shippingWeight', 'itemWeight'];
    
    for (const field of weightFields) {
      if (item[field]) {
        const weightText = typeof item[field] === 'string' ? item[field] : String(item[field]);
        const match = weightText.match(/(\d+\.?\d*)\s*(lb|pound|kg|g|oz)?/i);
        
        if (match) {
          let weight = parseFloat(match[1]);
          const unit = (match[2] || 'lb').toLowerCase();
          
          // Convert to pounds
          switch(unit) {
            case 'kg': return weight * 2.205;
            case 'g': return weight * 0.00220462;
            case 'oz': return weight * 0.0625;
            default: return weight; // assume pounds
          }
        }
      }
    }
    
    return null;
  }
}

module.exports = ApifyScraper;