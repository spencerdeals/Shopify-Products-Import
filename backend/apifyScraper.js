const { ApifyApi } = require('apify-client');

class ApifyScraper {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = apiKey ? new ApifyApi({ token: apiKey }) : null;
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
      const retailer = this.detectRetailer(url);
      console.log(`🔄 Starting Apify scrape for ${retailer}...`);
      
      // Use retailer-specific scraper if available
      switch (retailer.toLowerCase()) {
        case 'amazon':
          return await this.scrapeAmazon(url);
        case 'wayfair':
          return await this.scrapeWayfair(url);
        case 'target':
          return await this.scrapeTarget(url);
        case 'walmart':
          return await this.scrapeWalmart(url);
        default:
          return await this.scrapeGeneric(url);
      }
    } catch (error) {
      console.error('❌ Apify scraping failed:', error.message);
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
      if (domain.includes('bestbuy.com')) return 'Best Buy';
      return 'Generic';
    } catch (e) {
      return 'Generic';
    }
  }

  // Amazon specific scraper
  async scrapeAmazon(url) {
    try {
      console.log('🔄 Starting Apify Amazon scrape...');
      
      const run = await this.client.actor('apify/amazon-product-scraper').call({
        startUrls: [{ url: url }],
        maxItems: 1,
        proxy: {
          useApifyProxy: true,
          apifyProxyGroups: ['RESIDENTIAL']
        }
      });

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('✅ Amazon scrape successful');
        
        return {
          name: item.title || null,
          price: item.price?.value || null,
          image: item.images?.[0]?.url || null,
          dimensions: this.extractDimensions(item),
          weight: this.extractWeight(item),
          brand: item.brand || null,
          category: item.category || null,
          inStock: item.availability !== 'OUT_OF_STOCK'
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Amazon scrape failed:', error.message);
      throw error;
    }
  }

  // Wayfair specific scraper
  async scrapeWayfair(url) {
    try {
      console.log('🔄 Starting Apify Wayfair scrape...');
      
      const run = await this.client.actor('apify/web-scraper').call({
        startUrls: [{ url: url }],
        pageFunction: `
          async function pageFunction(context) {
            const { $, request } = context;
            
            // COMPLETELY UPDATED Wayfair selectors for current site structure
            const titleSelectors = [
              'h1[data-testid="product-title"]',
              'h1[data-testid="ProductTitle"]', 
              'h1.ProductTitle-module',
              'h1[class*="ProductTitle"]',
              '.ProductDetailInfoBlock h1',
              '.ProductTitleBlock h1', 
              'h1.pl-Heading',
              '.pdp-product-name h1',
              '.product-title h1',
              'h1:contains("by")',
              'h1'
            ];
            
            let title = '';
            for (const selector of titleSelectors) {
              const element = $(selector).first();
              if (element.length && element.text().trim()) {
                title = element.text().trim();
                console.log('✅ Found title with selector:', selector, 'Title:', title.substring(0, 50));
                break;
              }
            }
            
            // ENHANCED Wayfair price selectors - try everything possible
            const priceSelectors = [
              // Current Wayfair structure (2025)
              '[data-testid="product-price"]',
              '[data-testid="ProductPrice"]',
              '[data-testid="PriceDisplay"]',
              '.ProductPrice [data-testid="PriceDisplay"]',
              '.PriceBlock [data-testid="PriceDisplay"]',
              '.price-display',
              '.price-value',
              '.current-price',
              '.sale-price',
              '.regular-price',
              // Legacy selectors
              '.ProductPrice .price',
              '.price .currency',
              '.price-current',
              '.price-now',
              // Generic patterns
              '[class*="price" i] [class*="display" i]',
              '[class*="price" i] [class*="value" i]',
              '[class*="price" i] [class*="current" i]',
              '[data-cy*="price"]',
              '[data-test*="price"]',
              // Fallback to any element with price-like content
              '*:contains("$")'
            ];
            
            let price = null;
            for (const selector of priceSelectors) {
              const elements = $(selector);
              elements.each((i, el) => {
                const text = $(el).text().trim();
                const priceMatch = text.match(/\\$\\s*(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?)/);
                if (priceMatch) {
                  const priceValue = parseFloat(priceMatch[1].replace(/,/g, ''));
                  if (priceValue > 0 && priceValue < 50000) {
                    price = priceValue;
                    console.log('✅ Found price with selector:', selector, 'Price:', price);
                    return false; // Break out of each loop
                  }
                }
              });
              if (price) break;
            }
            
            // Enhanced image selectors for current Wayfair
            const imageSelectors = [
              '[data-testid="product-image"] img',
              '[data-testid="ProductImage"] img',
              '.ProductImage img',
              '.product-image img',
              '.hero-image img',
              '.main-image img',
              '.primary-image img',
              '[class*="ProductImage"] img',
              '[class*="product-image" i] img',
              '.carousel-item img',
              '.image-gallery img'
            ];
            
            let image = '';
            for (const selector of imageSelectors) {
              const img = $(selector).first();
              if (img.length) {
                let src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy');
                if (src && !src.includes('placeholder') && !src.includes('loading')) {
                  if (src.startsWith('//')) src = 'https:' + src;
                  else if (src.startsWith('/')) src = 'https://www.wayfair.com' + src;
                  image = src;
                  console.log('✅ Found image with selector:', selector);
                  break;
                }
              }
            }
            
            // Enhanced specifications extraction
            const specSelectors = [
              '[data-testid="product-specifications"]',
              '[data-testid="ProductSpecifications"]',
              '.ProductSpecifications',
              '.product-specs',
              '.specifications',
              '.product-details',
              '.details-section',
              '[class*="specification" i]',
              '[class*="details" i]'
            ];
            
            let specifications = '';
            for (const selector of specSelectors) {
              const spec = $(selector).first();
              if (spec.length) {
                specifications = spec.text();
                console.log('✅ Found specifications with selector:', selector);
                break;
              }
            }
            
            return {
              title: title || '',
              price: price,
              image: image || '',
              specifications: specifications || '',
              url: request.url
            };
          }
        `,
        maxRequestsPerCrawl: 1,
        proxy: {
          useApifyProxy: true,
          apifyProxyGroups: ['RESIDENTIAL']
        }
      });

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('✅ Wayfair scrape successful');
        
        return {
          name: item.title || null,
          price: item.price || null,
          image: item.image || null,
          dimensions: this.extractDimensionsFromText(item.specifications),
          weight: this.extractWeightFromText(item.specifications),
          brand: null,
          category: 'furniture',
          inStock: true
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Wayfair scrape failed:', error.message);
      throw error;
    }
  }

  // Target specific scraper
  async scrapeTarget(url) {
    try {
      console.log('🔄 Starting Apify Target scrape...');
      
      const run = await this.client.actor('apify/web-scraper').call({
        startUrls: [{ url: url }],
        pageFunction: `
          async function pageFunction(context) {
            const { $, request } = context;
            
            const titleSelectors = [
              'h1[data-test="product-title"]',
              'h1.ProductTitle',
              'h1[class*="ProductTitle"]',
              '.pdp-product-name h1',
              'h1'
            ];
            
            let title = '';
            for (const selector of titleSelectors) {
              const element = $(selector).first();
              if (element.length && element.text().trim()) {
                title = element.text().trim();
                break;
              }
            }
            
            const priceSelectors = [
              '[data-test="product-price"]',
              '.Price-characteristic',
              '.price-current',
              '[class*="price" i]'
            ];
            
            let price = null;
            for (const selector of priceSelectors) {
              const element = $(selector).first();
              if (element.length) {
                const text = element.text().trim();
                const priceMatch = text.match(/\\$\\s*(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?)/);
                if (priceMatch) {
                  price = parseFloat(priceMatch[1].replace(/,/g, ''));
                  if (price > 0 && price < 50000) break;
                }
              }
            }
            
            const imageSelectors = [
              '[data-test="product-image"] img',
              '.ProductImages img',
              '.hero-image img'
            ];
            
            let image = '';
            for (const selector of imageSelectors) {
              const img = $(selector).first();
              if (img.length) {
                let src = img.attr('src') || img.attr('data-src');
                if (src && !src.includes('placeholder')) {
                  if (src.startsWith('//')) src = 'https:' + src;
                  image = src;
                  break;
                }
              }
            }
            
            return {
              title: title || '',
              price: price,
              image: image || '',
              url: request.url
            };
          }
        `,
        maxRequestsPerCrawl: 1
      });

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('✅ Target scrape successful');
        
        return {
          name: item.title || null,
          price: item.price || null,
          image: item.image || null,
          dimensions: null,
          weight: null,
          brand: null,
          category: null,
          inStock: true
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Target scrape failed:', error.message);
      throw error;
    }
  }

  // Walmart specific scraper
  async scrapeWalmart(url) {
    try {
      console.log('🔄 Starting Apify Walmart scrape...');
      
      const run = await this.client.actor('apify/walmart-scraper').call({
        startUrls: [{ url: url }],
        maxItems: 1
      });

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('✅ Walmart scrape successful');
        
        return {
          name: item.name || null,
          price: item.price || null,
          image: item.image || null,
          dimensions: null,
          weight: null,
          brand: item.brand || null,
          category: null,
          inStock: item.inStock !== false
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Walmart scrape failed:', error.message);
      throw error;
    }
  }

  // Generic web scraper for other retailers
  async scrapeGeneric(url) {
    try {
      console.log('🔄 Starting Apify generic scrape...');
      
      const run = await this.client.actor('apify/web-scraper').call({
        startUrls: [{ url: url }],
        pageFunction: `
          async function pageFunction(context) {
            const { $, request } = context;
            
            // Generic title selectors
            const titleSelectors = [
              'h1',
              '.product-title',
              '.product-name',
              '[class*="title" i]',
              '[class*="name" i]'
            ];
            
            let title = '';
            for (const selector of titleSelectors) {
              const element = $(selector).first();
              if (element.length && element.text().trim()) {
                title = element.text().trim();
                break;
              }
            }
            
            // Generic price selectors
            const priceSelectors = [
              '.price',
              '.cost',
              '[class*="price" i]',
              '[class*="cost" i]'
            ];
            
            let price = null;
            for (const selector of priceSelectors) {
              const element = $(selector).first();
              if (element.length) {
                const text = element.text().trim();
                const priceMatch = text.match(/\\$\\s*(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?)/);
                if (priceMatch) {
                  price = parseFloat(priceMatch[1].replace(/,/g, ''));
                  if (price > 0 && price < 50000) break;
                }
              }
            }
            
            // Generic image selectors
            const imageSelectors = [
              '.product-image img',
              '.main-image img',
              '.hero-image img',
              '[class*="image" i] img'
            ];
            
            let image = '';
            for (const selector of imageSelectors) {
              const img = $(selector).first();
              if (img.length) {
                let src = img.attr('src') || img.attr('data-src');
                if (src && !src.includes('placeholder')) {
                  if (src.startsWith('//')) src = 'https:' + src;
                  else if (src.startsWith('/')) src = new URL(request.url).origin + src;
                  image = src;
                  break;
                }
              }
            }
            
            return {
              title: title || '',
              price: price,
              image: image || '',
              url: request.url
            };
          }
        `,
        maxRequestsPerCrawl: 1
      });

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('✅ Generic scrape successful');
        
        return {
          name: item.title || null,
          price: item.price || null,
          image: item.image || null,
          dimensions: null,
          weight: null,
          brand: null,
          category: null,
          inStock: true
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Generic scrape failed:', error.message);
      throw error;
    }
  }

  // Helper methods
  extractDimensions(item) {
    if (item.dimensions) {
      return {
        length: item.dimensions.length || 0,
        width: item.dimensions.width || 0,
        height: item.dimensions.height || 0
      };
    }
    return null;
  }

  extractWeight(item) {
    if (item.weight) {
      return parseFloat(item.weight) || null;
    }
    return null;
  }

  extractDimensionsFromText(text) {
    if (!text) return null;
    
    const dimMatch = text.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
    if (dimMatch) {
      return {
        length: parseFloat(dimMatch[1]),
        width: parseFloat(dimMatch[2]),
        height: parseFloat(dimMatch[3])
      };
    }
    return null;
  }

  extractWeightFromText(text) {
    if (!text) return null;
    
    const weightMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?|kg)/i);
    if (weightMatch) {
      let weight = parseFloat(weightMatch[1]);
      if (text.toLowerCase().includes('kg')) {
        weight *= 2.205; // Convert kg to lbs
      }
      return weight;
    }
    return null;
  }
}

module.exports = ApifyScraper;