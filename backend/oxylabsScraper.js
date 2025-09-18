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
      if (domain.includes('walmart.com')) return 'walmart';
      if (domain.includes('target.com')) return 'target';
      if (domain.includes('bestbuy.com')) return 'bestbuy';
      if (domain.includes('lowes.com')) return 'lowes';
      if (domain.includes('costco.com')) return 'costco';
      if (domain.includes('kroger.com')) return 'kroger';
      if (domain.includes('etsy.com')) return 'etsy';
      if (domain.includes('ebay.com')) return 'ebay';
      return 'universal';
    } catch (e) {
      return 'universal';
    }
  }

  getOxylabsSource(retailer, url) {
    // Use dedicated sources when available for better results
    switch (retailer) {
      case 'amazon':
        return 'amazon';
      case 'walmart':
        return 'universal'; // Walmart has walmart_product but needs product ID
      case 'target':
        return 'universal'; // Target has target_product but needs product ID
      case 'bestbuy':
        return 'universal'; // Best Buy has bestbuy_product but needs product ID
      case 'lowes':
        return 'lowes';
      case 'kroger':
        return 'kroger';
      case 'costco':
        return 'universal'; // Costco only has search, not product
      case 'etsy':
        return 'universal'; // Etsy has etsy_product but needs product ID
      case 'ebay':
        return 'universal'; // eBay has ebay_search but we need product pages
      default:
        return 'universal';
    }
  }

  getParsingInstructions(retailer) {
    // Retailer-specific parsing instructions for better accuracy
    const baseInstructions = {
      title: {
        _fns: [
          {
            _fn: 'xpath',
            _args: ['//h1[@id="productTitle"]//text() | //h1[contains(@class,"product") or contains(@class,"title")]//text() | //h1//text()']
          }
        ]
      },
      price: {
        _fns: [
          {
            _fn: 'xpath', 
            _args: ['//span[contains(@class,"a-price-whole")]//text() | //span[contains(@class,"price") or contains(@class,"MoneyPrice")]//text() | //*[contains(@class,"price")]//*[contains(text(),"$")]//text()']
          }
        ]
      },
      image: {
        _fns: [
          {
            _fn: 'xpath',
            _args: ['//img[@id="landingImage"]/@src | //img[contains(@class,"product") or contains(@data-testid,"image")]/@src | //img[contains(@alt,"product") or contains(@alt,"main")]/@src']
          }
        ]
      },
      availability: {
        _fns: [
          {
            _fn: 'xpath',
            _args: ['//*[contains(text(),"in stock") or contains(text(),"available") or contains(text(),"Add to Cart")]//text() | //*[contains(text(),"out of stock") or contains(text(),"unavailable")]//text()']
          }
        ]
      },
      variant: {
        _fns: [
          {
            _fn: 'xpath',
            _args: ['//span[contains(@class,"selection") or contains(@class,"selected")]//text() | //*[@aria-selected="true"]//text() | //*[contains(@class,"variant") or contains(@class,"option")]//text()']
          }
        ]
      },
      dimensions: {
        _fns: [
          {
            _fn: 'xpath',
            _args: ['//*[contains(text(),"dimensions") or contains(text(),"Dimensions") or contains(text(),"Size")]//following::text()[contains(.,"x") and (contains(.,"inch") or contains(.,"in") or contains(.,"\""))]']
          }
        ]
      },
      weight: {
        _fns: [
          {
            _fn: 'xpath',
            _args: ['//*[contains(text(),"weight") or contains(text(),"Weight") or contains(text(),"Shipping")]//following::text()[contains(.,"lb") or contains(.,"pound") or contains(.,"lbs")]']
          }
        ]
      }
    };

    // Retailer-specific optimizations
    switch (retailer) {
      case 'amazon':
        baseInstructions.price._fns[0]._args = [
          '//span[contains(@class,"a-price-whole")]//text() | //span[@class="a-price-range"]//span[@class="a-offscreen"]//text() | //span[@class="a-price"]//span[@class="a-offscreen"]//text()'
        ];
        baseInstructions.image._fns[0]._args = [
          '//img[@id="landingImage"]/@src | //img[@id="landingImage"]/@data-old-hires | //div[@id="imgTagWrapperId"]//img/@src'
        ];
        break;
        
      case 'walmart':
        baseInstructions.price._fns[0]._args = [
          '//*[@data-automation-id="product-price"]//text() | //*[contains(@class,"price")]//text()[contains(.,"$")]'
        ];
        baseInstructions.image._fns[0]._args = [
          '//img[@data-automation-id="product-image"]/@src | //img[contains(@class,"product")]/@src'
        ];
        break;
        
      case 'target':
        baseInstructions.price._fns[0]._args = [
          '//*[@data-test="product-price"]//text() | //*[contains(@class,"Price")]//text()'
        ];
        break;
        
      case 'bestbuy':
        baseInstructions.price._fns[0]._args = [
          '//*[contains(@class,"pricing-price__value")]//text() | //*[contains(@class,"sr-only") and contains(text(),"current price")]//text()'
        ];
        break;
    }

    return baseInstructions;
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Oxylabs not configured - missing credentials');
    }

    const retailer = this.detectRetailer(url);
    const source = this.getOxylabsSource(retailer, url);
    console.log(`🌐 Oxylabs (UPGRADED) scraping ${retailer}: ${url.substring(0, 60)}...`);

    try {
      // Oxylabs API payload with optimized source and parsing
      const payload = {
        source: source,
        url: url,
        user_agent_type: 'desktop',
        render: 'html',
        premium_proxy: 'true',  // Now available with upgraded plan
        country_code: 'us'
        // Temporarily disable parsing to see raw HTML first
      };

      console.log(`   📤 Oxylabs UPGRADED payload: ${source} source, premium proxy enabled`);

      // Make request to Oxylabs
      const response = await axios.post(this.baseURL, payload, {
        auth: {
          username: this.username,
          password: this.password
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      console.log(`   📥 Oxylabs UPGRADED response: ${response.status} (${response.data?.results?.length || 0} results)`);
      
      if (response.data && response.data.results && response.data.results[0]) {
        const result = response.data.results[0];
        
        // Debug the actual response structure
        console.log(`   📊 Oxylabs response structure:`, {
          hasContent: !!result.content,
          hasHtml: !!(result.content && result.content.html),
          hasBody: !!(result.content && result.content.body),
          hasText: !!(result.content && result.content.text),
          hasData: !!(result.content && result.content.data),
          directHtml: !!result.html,
          directBody: !!result.body,
          status: result.status_code,
          contentKeys: result.content ? Object.keys(result.content) : [],
          resultKeys: Object.keys(result)
        });
        
        // Try multiple response formats for upgraded accounts
        let html = null;
        
        if (result.content) {
          // Try all possible content formats
          html = result.content.html || 
                 result.content.body || 
                 result.content.text ||
                 result.content.data ||
                 result.content.page_content ||
                 result.content.raw_html ||
                 result.content;
        } else if (result.html) {
          html = result.html;
        } else if (result.body) {
          html = result.body;
        } else if (result.text) {
          html = result.text;
        } else if (result.data) {
          html = result.data;
        } else if (typeof result === 'string') {
          html = result;
        }
        
        // If still no HTML, try parsing the entire result as HTML
        if (!html && typeof result === 'object') {
          // Sometimes the HTML is nested deeper
          const possibleHtml = JSON.stringify(result);
          if (possibleHtml.includes('<html') || possibleHtml.includes('<body')) {
            // Extract HTML from JSON string
            const htmlMatch = possibleHtml.match(/"([^"]*<html[^"]*>.*?<\/html>[^"]*)"/) ||
                             possibleHtml.match(/"([^"]*<body[^"]*>.*?<\/body>[^"]*)"/) ||
                             possibleHtml.match(/"([^"]*<!DOCTYPE[^"]*>.*?<\/html>[^"]*)"/) ;
            if (htmlMatch) {
              html = htmlMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
            }
          }
        }
        
        if (html && typeof html === 'string' && html.length > 100) {
          console.log(`✅ Oxylabs UPGRADED: Got ${html.length} chars of HTML`);
          return this.parseHtmlContent(html, url);
        } else {
          console.log(`❌ Oxylabs UPGRADED: No valid HTML content (got ${html ? html.length : 0} chars)`);
          console.log(`   Raw result sample:`, JSON.stringify(result).substring(0, 500) + '...');
        }
      } else {
        console.log(`❌ Oxylabs UPGRADED: No results array`);
        console.log(`   Full response:`, JSON.stringify(response.data).substring(0, 500) + '...');
      }
      
      throw new Error('No valid results from Oxylabs UPGRADED');
      
    } catch (error) {
      console.error(`❌ Oxylabs UPGRADED failed: ${error.message}`);
      if (error.response) {
        console.error(`   UPGRADED Status: ${error.response.status} - ${error.response.data?.message || 'Unknown error'}`);
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
    // Enhanced HTML parsing with better regex patterns
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

    // Extract title from HTML - multiple patterns
    const titlePatterns = [
      /<h1[^>]*class="[^"]*product[^"]*title[^"]*"[^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*data-testid="[^"]*title[^"]*"[^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<title[^>]*>([^<]+?)\s*[-|]\s*[^<]*<\/title>/i, // Remove site name from title
      /"name"\s*:\s*"([^"]+)"/i, // JSON-LD structured data
      /property="og:title"[^>]+content="([^"]+)"/i
    ];
    
    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1].trim()) {
        data.name = match[1].trim()
          .replace(/&[^;]+;/g, '') // Remove HTML entities
          .replace(/\s+/g, ' ') // Normalize whitespace
          .substring(0, 200); // Limit length
        console.log('   📝 Extracted title:', data.name.substring(0, 50) + '...');
        break;
      }
    }

    // Extract price from HTML - enhanced patterns
    const pricePatterns = [
      /class="[^"]*price[^"]*"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      /data-testid="[^"]*price[^"]*"[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      /"price"\s*:\s*"?\$?(\d+(?:,\d{3})*(?:\.\d{2})?)"?/i,
      /property="product:price:amount"[^>]+content="([^"]+)"/i,
      /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g // Fallback: any dollar amount
    ];
    
    for (const pattern of pricePatterns) {
      if (pattern.global) {
        // Handle global regex differently
        const matches = [...html.matchAll(pattern)];
        for (const match of matches) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (price > 0 && price < 100000) {
            data.price = price;
            console.log('   💰 Extracted price: $' + data.price);
            break;
          }
        }
        if (data.price) break;
      } else {
        const match = html.match(pattern);
        if (match) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (price > 0 && price < 100000) {
            data.price = price;
            console.log('   💰 Extracted price: $' + data.price);
            break;
          }
        }
      }
    }

    // Extract image from HTML - enhanced patterns
    const imagePatterns = [
      /class="[^"]*product[^"]*image[^"]*"[^>]*src="([^"]+)"/i,
      /data-testid="[^"]*image[^"]*"[^>]*src="([^"]+)"/i,
      /property="og:image"[^>]+content="([^"]+)"/i,
      /"image"\s*:\s*"([^"]+)"/i,
      /src="([^"]+)"[^>]*(?:alt="[^"]*product|class="[^"]*main)/i
    ];
    
    for (const pattern of imagePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        let imageUrl = match[1];
        // Handle relative URLs
        if (imageUrl.startsWith('//')) {
          imageUrl = 'https:' + imageUrl;
        } else if (imageUrl.startsWith('/')) {
          try {
            const urlObj = new URL(url);
            imageUrl = urlObj.origin + imageUrl;
          } catch (e) {
            continue;
          }
        }
        
        if (imageUrl.startsWith('http')) {
          data.image = imageUrl;
          console.log('   🖼️ Extracted image URL');
          break;
        }
      }
    }

    // Extract dimensions from HTML
    const dimensionPatterns = [
      /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i,
      /dimensions?[^>]*>[\s\S]*?(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
      /L:\s*(\d+(?:\.\d+)?).*?W:\s*(\d+(?:\.\d+)?).*?H:\s*(\d+(?:\.\d+)?)/i
    ];
    
    for (const pattern of dimensionPatterns) {
      const match = html.match(pattern);
      if (match) {
        data.dimensions = {
          length: parseFloat(match[1]),
          width: parseFloat(match[2]),
          height: parseFloat(match[3])
        };
        console.log('   📏 Extracted dimensions:', data.dimensions);
        break;
      }
    }

    // Extract weight from HTML
    const weightPatterns = [
      /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
      /weight[^>]*>[\s\S]*?(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)/i,
      /(\d+(?:\.\d+)?)\s*(?:kilograms?|kgs?)/i
    ];
    
    for (const pattern of weightPatterns) {
      const match = html.match(pattern);
      if (match) {
        let weight = parseFloat(match[1]);
        // Convert kg to lbs if needed
        if (/kg/i.test(match[0])) weight *= 2.205;
        
        data.weight = Math.round(weight * 10) / 10;
        console.log('   ⚖️ Extracted weight:', data.weight + ' lbs');
        break;
      }
    }

    // Check availability
    const outOfStockKeywords = /out of stock|unavailable|sold out|not available|temporarily unavailable/i;
    data.inStock = !outOfStockKeywords.test(html);
    
    console.log('📦 Oxylabs HTML parsing results:', {
      hasName: !!data.name,
      hasPrice: !!data.price,
      hasImage: !!data.image,
      hasDimensions: !!data.dimensions,
      hasWeight: !!data.weight
    });

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