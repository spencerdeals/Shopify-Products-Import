// backend/fastScraper.js
// Ultra-fast, reliable scraping with GPT intelligence

const axios = require('axios');
const { parseProduct } = require('./gptParser');

class FastScraper {
  constructor() {
    this.scrapingBeeKey = process.env.SCRAPINGBEE_API_KEY;
    this.enabled = !!this.scrapingBeeKey;
    
    console.log('⚡ FastScraper initialized');
    console.log(`   ScrapingBee: ${this.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
  }

  async scrapeProduct(url) {
    console.log(`⚡ FastScraper processing: ${url.substring(0, 60)}...`);
    
    // Step 1: Try ScrapingBee first (fastest, most reliable)
    let html = null;
    let method = 'none';
    
    if (this.enabled) {
      try {
        console.log('   🐝 Trying ScrapingBee...');
        html = await this.fetchWithScrapingBee(url);
        if (html) {
          method = 'scrapingbee';
          console.log('   ✅ ScrapingBee success');
        }
      } catch (error) {
        console.log('   ❌ ScrapingBee failed:', error.message);
      }
    }
    
    // Step 2: Fallback to direct fetch if ScrapingBee fails
    if (!html) {
      try {
        console.log('   🌐 Trying direct fetch...');
        html = await this.fetchDirect(url);
        if (html) {
          method = 'direct';
          console.log('   ✅ Direct fetch success');
        }
      } catch (error) {
        console.log('   ❌ Direct fetch failed:', error.message);
      }
    }
    
    // Step 3: Use GPT to parse the HTML intelligently
    if (html) {
      try {
        console.log('   🤖 Using GPT to parse content...');
        const productData = await parseProduct(url, { html });
        
        if (productData) {
          console.log('   ✅ GPT parsing successful');
          return {
            ...productData,
            scrapingMethod: method + '+gpt',
            dataQuality: 'high'
          };
        }
      } catch (error) {
        console.log('   ❌ GPT parsing failed:', error.message);
      }
    }
    
    // Step 4: If all else fails, use GPT with just the URL
    try {
      console.log('   🤖 GPT fallback with URL only...');
      const productData = await parseProduct(url);
      return {
        ...productData,
        scrapingMethod: 'gpt-only',
        dataQuality: 'medium'
      };
    } catch (error) {
      console.log('   ❌ All methods failed');
      throw new Error('Failed to scrape product: ' + error.message);
    }
  }

  async fetchWithScrapingBee(url) {
    const response = await axios.get('https://app.scrapingbee.com/api/v1/', {
      params: {
        api_key: this.scrapingBeeKey,
        url: url,
        render_js: 'false',  // Faster without JS
        country_code: 'us',
        block_resources: 'true',  // Block images/css for speed
        premium_proxy: 'false',   // Faster without premium
        wait: 1000  // Minimal wait
      },
      timeout: 15000,  // 15 second timeout
      validateStatus: () => true
    });

    if (response.status === 200 && response.data) {
      return typeof response.data === 'string' ? response.data : response.data.toString();
    }
    
    throw new Error(`ScrapingBee returned status ${response.status}`);
  }

  async fetchDirect(url) {
    const response = await axios.get(url, {
      timeout: 10000,  // 10 second timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      validateStatus: () => true
    });

    if (response.status === 200 && response.data) {
      return typeof response.data === 'string' ? response.data : response.data.toString();
    }
    
    throw new Error(`Direct fetch returned status ${response.status}`);
  }
}

module.exports = FastScraper;