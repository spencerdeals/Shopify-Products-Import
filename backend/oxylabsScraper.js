// backend/oxylabsScraper.js
const axios = require('axios');

class OxylabsScraper {
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.enabled = !!(username && password);
    this.baseURL = 'https://realtime.oxylabs.io/v1/queries';
    
    console.log(`🌐 OxylabsScraper ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
    if (this.enabled) {
      console.log(`   Using Web Scraping API with user: ${username}`);
    } else {
      console.log('   Missing OXYLABS_USERNAME or OXYLABS_PASSWORD');
    }
  }

  isAvailable() {
    return this.enabled;
  }

  detectRetailer(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain.includes('amazon.com')) return 'amazon';
      if (domain.includes('wayfair.com')) return 'wayfair';
      if (domain.includes('target.com')) return 'target';
      if (domain.includes('walmart.com')) return 'walmart';
      if (domain.includes('bestbuy.com')) return 'bestbuy';
      if (domain.includes('homedepot.com')) return 'homedepot';
      if (domain.includes('lowes.com')) return 'lowes';
      return 'universal';
    } catch (e) {
      return 'universal';
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Oxylabs not configured - missing credentials');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🌐 Oxylabs scraping ${retailer}: ${url.substring(0, 60)}...`);

    try {
      // Oxylabs Web Scraping API payload
      const payload = {
        source: retailer === 'amazon' ? 'amazon_product' : 'universal_ecommerce',
        url: url,
        user_agent_type: 'desktop',
        render: 'html',
        callback_url: null,
        parse: true,
        parsing_instructions: {
          title: {
            _fns: [
              {
                _fn: 'xpath',
                _args: ['//h1[@id="productTitle"]//text() | //h1[contains(@class,"product")]//text() | //h1//text()']
              }
            ]
          },
          price: {
            _fns: [
              {
                _fn: 'xpath', 
                _args: ['//span[contains(@class,"a-price-whole")]//text() | //span[contains(@class,"price")]//text() | //*[contains(@class,"price")]//*[contains(text(),"$")]//text()']
              }
            ]
          },
          image: {
            _fns: [
              {
                _fn: 'xpath',
                _args: ['//img[@id="landingImage"]/@src | //img[contains(@class,"product")]/@src | //img[contains(@data-testid,"image")]/@src']
              }
            ]
          },
          availability: {
            _fns: [
              {
                _fn: 'xpath',
                _args: ['//*[contains(text(),"in stock") or contains(text(),"available")]//text() | //*[contains(text(),"out of stock")]//text()']
              }
            ]
          },
          variant: {
            _fns: [
              {
                _fn: 'xpath',
                _args: ['//span[contains(@class,"selection")]//text() | //*[@aria-selected="true"]//text() | //*[contains(@class,"selected")]//text()']
              }
            ]
          },
          dimensions: {
            _fns: [
              {
                _fn: 'xpath',
                _args: ['//*[contains(text(),"dimensions") or contains(text(),"Dimensions")]//following::text()[contains(.,"x") and contains(.,"inch")]']
              }
            ]
          },
          weight: {
            _fns: [
              {
                _fn: 'xpath',
                _args: ['//*[contains(text(),"weight") or contains(text(),"Weight")]//following::text()[contains(.,"lb") or contains(.,"pound")]']
              }
            ]
          }
        }
      };

      // Make request to Oxylabs
      const response = await axios.post(this.baseURL, payload, {
        auth: {
          username: this.username,
          password: this.password
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 60 seconds for Oxylabs
      });

      if (response.data && response.data.results && response.data.results[0]) {
        const result = response.data.results[0];
        
        if (result.content && result.content.results) {
          console.log(`✅ Oxylabs scraping succeeded for ${retailer}`);
          return this.parseOxylabsResult(result.content.results, url);
        } else if (result.content && result.content.html) {
          // Fallback: parse HTML manually if structured parsing failed
          console.log(`⚠️ Oxylabs structured parsing failed, trying HTML extraction`);
          return this.parseHtmlContent(result.content.html, url);
        }
      }
      
      throw new Error('No valid results from Oxylabs');
      
    } catch (error) {
      console.error(`❌ Oxylabs scraping failed: ${error.message}`);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data:`, error.response.data);
      }
      throw error;
    }
  }

  parseOxylabsResult(results, url) {
    const data = {
      name: null,
      price: null,
      image: null,
      variant: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true
    };

    // Extract title
    if (results.title && Array.isArray(results.title) && results.title[0]) {
      data.name = results.title[0].trim();
    }

    // Extract price
    if (results.price && Array.isArray(results.price) && results.price[0]) {
      const priceText = results.price[0].replace(/[^0-9.]/g, '');
      const price = parseFloat(priceText);
      if (price > 0 && price < 100000) {
        data.price = price;
      }
    }

    // Extract image
    if (results.image && Array.isArray(results.image) && results.image[0]) {
      let imageUrl = results.image[0];
      if (imageUrl.startsWith('//')) {
        imageUrl = 'https:' + imageUrl;
      }
      if (imageUrl.startsWith('http')) {
        data.image = imageUrl;
      }
    }

    // Extract variant
    if (results.variant && Array.isArray(results.variant) && results.variant[0]) {
      const variant = results.variant[0].trim();
      if (variant.length >= 3 && variant.length <= 50 && 
          !/^[\d\-_]+$/.test(variant) && 
          !/^(select|choose|option|default)$/i.test(variant)) {
        data.variant = variant;
      }
    }

    // Extract dimensions
    if (results.dimensions && Array.isArray(results.dimensions) && results.dimensions[0]) {
      const dimText = results.dimensions[0];
      const dimMatch = dimText.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
      if (dimMatch) {
        data.dimensions = {
          length: parseFloat(dimMatch[1]),
          width: parseFloat(dimMatch[2]),
          height: parseFloat(dimMatch[3])
        };
      }
    }

    // Extract weight
    if (results.weight && Array.isArray(results.weight) && results.weight[0]) {
      const weightText = results.weight[0];
      const weightMatch = weightText.match(/(\d+(?:\.\d+)?)\s*(?:lb|pound)/i);
      if (weightMatch) {
        data.weight = parseFloat(weightMatch[1]);
      }
    }

    // Check availability
    if (results.availability && Array.isArray(results.availability) && results.availability[0]) {
      const availText = results.availability[0].toLowerCase();
      data.inStock = !availText.includes('out of stock');
    }

    return data;
  }

  parseHtmlContent(html, url) {
    // Basic HTML parsing fallback
    const data = {
      name: null,
      price: null,
      image: null,
      variant: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true
    };

    // Extract title from HTML
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || 
                      html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      data.name = titleMatch[1].trim().replace(/&[^;]+;/g, '');
    }

    // Extract price from HTML
    const priceMatches = html.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g);
    if (priceMatches) {
      for (const match of priceMatches) {
        const price = parseFloat(match.replace(/[$,]/g, ''));
        if (price > 0 && price < 100000) {
          data.price = price;
          break;
        }
      }
    }

    // Extract image from HTML
    const imgMatch = html.match(/src="([^"]+)"[^>]*(?:product|main)/i) ||
                    html.match(/property="og:image"[^>]+content="([^"]+)"/i);
    if (imgMatch && imgMatch[1].startsWith('http')) {
      data.image = imgMatch[1];
    }

    return data;
  }

  // Batch scraping method
  async scrapeMultipleProducts(urls) {
    if (!this.enabled) {
      throw new Error('Oxylabs not configured');
    }

    const results = [];
    const batchSize = 3; // Oxylabs can handle more concurrent requests
    
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      
      const batchPromises = batch.map(url => 
        this.scrapeProduct(url).catch(error => ({
          url,
          error: error.message,
          success: false
        }))
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches
      if (i + batchSize < urls.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }
}

module.exports = OxylabsScraper;