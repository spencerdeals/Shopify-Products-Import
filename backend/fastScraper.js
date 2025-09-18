// backend/fastScraper.js
// Ultra-fast, reliable scraping with Oxylabs proxy + GPT intelligence

const axios = require('axios');
const { parseProduct } = require('./gptParser');

class FastScraper {
  constructor() {
    this.scrapingBeeKey = process.env.SCRAPINGBEE_API_KEY;
    this.oxyUsername = process.env.OXYLABS_USERNAME;
    this.oxyPassword = process.env.OXYLABS_PASSWORD;
    
    this.useOxylabs = !!(this.oxyUsername && this.oxyPassword);
    this.useScrapingBee = !!this.scrapingBeeKey;
    
    console.log('⚡ FastScraper initialized');
    console.log(`   Oxylabs Proxy: ${this.useOxylabs ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`   ScrapingBee: ${this.useScrapingBee ? '✅ ENABLED (Fallback)' : '❌ DISABLED'}`);
  }

  async scrapeProduct(url) {
    console.log(`⚡ FastScraper processing: ${url.substring(0, 60)}...`);
    
    let html = null;
    let method = 'none';
    
    // Step 1: Try Oxylabs Proxy first (premium, real-time)
    if (this.useOxylabs) {
      try {
        console.log('   🔥 Trying Oxylabs Proxy...');
        html = await this.fetchWithOxylabs(url);
        if (html) {
          method = 'oxylabs';
          console.log('   ✅ Oxylabs Proxy success');
        }
      } catch (error) {
        console.log('   ❌ Oxylabs Proxy failed:', error.message);
      }
    }
    
    // Step 2: Fallback to ScrapingBee if Oxylabs fails
    if (!html && this.useScrapingBee) {
      try {
        console.log('   🐝 Trying ScrapingBee fallback...');
        html = await this.fetchWithScrapingBee(url);
        if (html) {
          method = 'scrapingbee';
          console.log('   ✅ ScrapingBee success');
        }
      } catch (error) {
        console.log('   ❌ ScrapingBee failed:', error.message);
      }
    }
    
    // Step 3: Last resort - direct fetch
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
    
    // Step 4: Use GPT to parse the HTML intelligently
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
    
    // Step 5: If all else fails, use GPT with just the URL
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

  async fetchWithOxylabs(url) {
    const proxyConfig = {
      host: 'realtime.oxylabs.io',
      port: 60000,
      auth: {
        username: this.oxyUsername,
        password: this.oxyPassword
      }
    };

    const response = await axios.get(url, {
      proxy: proxyConfig,
      timeout: 30000, // 30 seconds for Oxylabs
      headers: {
        'x-oxylabs-user-agent-type': 'desktop_chrome',
        'x-oxylabs-geo-location': 'United States',
        'x-oxylabs-render': 'html' // Get rendered HTML
      },
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false // Ignore SSL certificates as recommended
      }),
      validateStatus: () => true
    });

    if (response.status === 200 && response.data) {
      return typeof response.data === 'string' ? response.data : response.data.toString();
    }
    
    throw new Error(`Oxylabs returned status ${response.status}`);
  }

  async fetchWithScrapingBee(url) {
    const response = await axios.get('https://app.scrapingbee.com/api/v1/', {
      params: {
        api_key: this.scrapingBeeKey,
        url: url,
        render_js: 'false',
        country_code: 'us',
        block_resources: 'true',
        premium_proxy: 'false',
        wait: 1000
      },
      timeout: 15000,
      validateStatus: () => true
    });

    if (response.status === 200 && response.data) {
      return typeof response.data === 'string' ? response.data : response.data.toString();
    }
    
    throw new Error(`ScrapingBee returned status ${response.status}`);
  }

  async fetchDirect(url) {
    const response = await axios.get(url, {
      timeout: 10000,
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