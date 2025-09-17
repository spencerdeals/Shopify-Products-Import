// backend/apifyScraper.js
let ApifyClient;

try {
  const apifyModule = require('apify-client');
  ApifyClient = apifyModule.ApifyClient;
  console.log('✅ Apify client module loaded successfully');
} catch (error) {
  console.log('⚠️ Apify client not installed - Scraping will fallback to ScrapingBee');
  ApifyClient = null;
}

class ApifyScraper {
  constructor(apiKey) {
    this.enabled = false;
    this.client = null;

    if (!ApifyClient) {
      console.log('⚠️ Apify client library not available');
      return;
    }

    if (!apiKey) {
      console.log('⚠️ Apify API key not provided');
      return;
    }

    try {
      this.client = new ApifyClient({ token: apiKey });
      this.enabled = true;
      console.log('✅ Apify scraper initialized for all retailers');
    } catch (error) {
      console.error('❌ Failed to initialize Apify client:', error.message);
    }
  }

  isAvailable() {
    return this.enabled && this.client !== null;
  }

  // Main scraping method that routes to appropriate scraper
  async scrapeProduct(url) {
    if (!this.isAvailable()) {
      throw new Error('Apify not available or not configured');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🔄 Apify scraping ${retailer} product...`);

    try {
      let result;
      
      // Route to appropriate scraper based on retailer
      switch(retailer) {
        case 'Amazon':
          result = await this.scrapeAmazon(url);
          break;
        case 'Wayfair':
          result = await this.scrapeWayfair(url);
          break;
        case 'Walmart':
          result = await this.scrapeWalmart(url);
          break;
        case 'Target':
          result = await this.scrapeTarget(url);
          break;
        case 'Best Buy':
          result = await this.scrapeBestBuy(url);
          break;
        case 'Home Depot':
          result = await this.scrapeHomeDepot(url);
          break;
        default:
          // Use universal scraper for unknown retailers
          result = await this.scrapeUniversal(url);
          break;
      }

      return result;
    } catch (error) {
      console.error(`❌ Apify scrape failed for ${retailer}:`, error.message);
      throw error;
    }
  }

  detectRetailer(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain.includes('amazon.com')) return 'Amazon';
      if (domain.includes('wayfair.com')) return 'Wayfair';
      if (domain.includes('target.com')) return 'Target';
      if (domain.includes('bestbuy.com')) return 'Best Buy';
      if (domain.includes('walmart.com')) return 'Walmart';
      if (domain.includes('homedepot.com')) return 'Home Depot';
      if (domain.includes('lowes.com')) return 'Lowes';
      if (domain.includes('costco.com')) return 'Costco';
      if (domain.includes('macys.com')) return 'Macys';
      if (domain.includes('ikea.com')) return 'IKEA';
      if (domain.includes('overstock.com')) return 'Overstock';
      if (domain.includes('cb2.com')) return 'CB2';
      if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
      if (domain.includes('westelm.com')) return 'West Elm';
      if (domain.includes('potterybarn.com')) return 'Pottery Barn';
      return 'Unknown Retailer';
    } catch (e) {
      return 'Unknown Retailer';
    }
  }

  // Amazon scraper - your existing implementation
  async scrapeAmazon(url) {
    try {
      console.log('🔄 Starting Apify Amazon scrape for:', url);
      
      const run = await this.client.actor('junglee/Amazon-crawler').call({
        categoryOrProductUrls: [
          { url: url, method: "GET" }
        ],
        maxItemsPerStartUrl: 1,
        scraperProductDetails: true,
        locationDelverableRoutes: [
          "PRODUCT",
          "SEARCH", 
          "OFFERS"
        ],
        maxOffersPerStartUrl: 0,
        useCaptchaSolver: false,
        proxyCountry: "AUTO_SELECT_PROXY_COUNTRY"
      });

      console.log('⏳ Apify run started, waiting for results...');
      await this.client.run(run.id).waitForFinish({ waitSecs: 60 });

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (!items || items.length === 0) {
        console.log('❌ No results from Apify');
        throw new Error('No product data found');
      }

      const product = items[0];
      console.log('✅ Apify scrape successful');

      return this.parseAmazonData(product);

    } catch (error) {
      console.error('❌ Apify Amazon scrape failed:', error.message);
      throw error;
    }
  }

  // Universal scraper using web scraper actor
  async scrapeUniversal(url) {
    try {
      console.log('🔄 Starting Apify universal scrape for:', url);
      
      const run = await this.client.actor('apify/web-scraper').call({
        startUrls: [{ url: url }],
        pseudoUrls: [],
        linkSelector: '',
        keepUrlFragments: false,
        pageFunction: `
          async function pageFunction(context) {
            const { $, request } = context;
            
            // Try multiple selectors for each field
            const titleSelectors = [
              'h1', 
              '[data-testid="product-title"]',
              '.product-title',
              '#productTitle',
              '[itemprop="name"]',
              '.product-name',
              '.product-info h1',
              '.pdp-title',
              '.product-details h1'
            ];
            
            const priceSelectors = [
              '[data-testid="product-price"]',
              '.price-now',
              '.price',
              '[itemprop="price"]',
              '.product-price',
              '.current-price',
              'span.wux-price-display',
              '.pdp-price',
              '.sale-price',
              '[data-price]'
            ];
            
            const imageSelectors = [
              'img.mainImage',
              '[data-testid="product-image"] img',
              '.product-photo img',
              '#landingImage',
              '[itemprop="image"]',
              '.primary-image img',
              '.product-image img',
              '.gallery-image img',
              'picture img'
            ];
            
            // Extract text with fallback
            function extractText(selectors) {
              for (const selector of selectors) {
                const element = $(selector).first();
                if (element.length) {
                  return element.text().trim();
                }
              }
              return null;
            }
            
            // Extract image URL
            function extractImage(selectors) {
              for (const selector of selectors) {
                const element = $(selector).first();
                if (element.length) {
                  return element.attr('src') || element.attr('data-src');
                }
              }
              return null;
            }
            
            // Extract dimensions from text
            function extractDimensions() {
              const text = $('body').text();
              const patterns = [
                /(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*(?:inches|in|")/gi,
                /L:\s*(\d+\.?\d*).*W:\s*(\d+\.?\d*).*H:\s*(\d+\.?\d*)/gi
              ];
              
              for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match && match[0]) {
                  return match[0];
                }
              }
              return null;
            }
            
            return {
              url: request.url,
              title: extractText(titleSelectors),
              price: extractText(priceSelectors),
              image: extractImage(imageSelectors),
              description: $('.product-description, .product-details, .product-info').text().slice(0, 500),
              dimensions: extractDimensions(),
              timestamp: new Date()
            };
          }
        `,
        proxyConfiguration: {
          useApifyProxy: true
        },
        maxRequestsPerCrawl: 10,
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: 60
      });

      console.log('⏳ Waiting for universal scraper...');
      await this.client.run(run.id).waitForFinish({ waitSecs: 60 });

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (!items || items.length === 0) {
        throw new Error('No data found');
      }

      const data = items[0];
      console.log('✅ Universal scrape successful');

      return this.parseGenericData(data);

    } catch (error) {
      console.error('❌ Universal scrape failed:', error.message);
      throw error;
    }
  }

  // Wayfair specific scraper
  async scrapeWayfair(url) {
    try {
      console.log('🔄 Starting Apify Wayfair scrape...');
      
      // Try using the universal scraper with Wayfair-specific selectors
      const run = await this.client.actor('apify/web-scraper').call({
        startUrls: [{ url: url }],
        pageFunction: `
          async function pageFunction(context) {
            const { $, request } = context;
            
            // Enhanced Wayfair title selectors
            const titleSelectors = [
              'h1[data-enzyme-id="ProductTitle"]',
              'h1.pl-Heading',
              'h1[data-testid="product-title"]',
              '.ProductDetailInfoBlock h1',
              '.ProductTitle h1',
              'h1.ProductTitle'
            ];
            
            let title = '';
            for (const selector of titleSelectors) {
              const element = $(selector).first();
              if (element.length && element.text().trim()) {
                title = element.text().trim();
                break;
              }
            }
            
            // Updated Wayfair price selectors for 2025 structure
            const priceSelectors = [
              '[data-testid="PriceBlock"] [data-testid="PriceDisplay"]',
              '[data-testid="PriceDisplay"]',
              '.BasePriceBlock span:not([class*="strike"])',
              '.PriceBlock span:not([class*="strike"])',
              '[class*="PriceDisplay"] span',
              '.ProductPrice span:first-child',
              '[data-enzyme-id="PriceBlock"] span:not([class*="strike"]):not([class*="was"])',
              '[data-testid="product-price"]',
              '.ProductDetailInfoBlock [class*="Price"]:not([class*="Strike"]):not([class*="Was"])',
              '.price:not(.strike):not(.was-price)',
              'span[class*="price"]:not([class*="strike"]):not([class*="was"])'
            ];
            
            let price = '';
            for (const selector of priceSelectors) {
              const element = $(selector).first();
              if (element.length) {
                const priceText = element.text().trim();
                console.log('Checking selector:', selector, 'Text:', priceText);
                
                // Multiple price patterns to match
                const pricePatterns = [
                  /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/,
                  /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*\$/,
                  /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/
                ];
                
                for (const pattern of pricePatterns) {
                  const priceMatch = priceText.match(pattern);
                  if (priceMatch) {
                    const extractedPrice = priceMatch[1] || priceMatch[0];
                    const numericPrice = parseFloat(extractedPrice.replace(/[,$]/g, ''));
                    
                    // Validate price range
                    if (numericPrice >= 1 && numericPrice <= 50000) {
                      price = '$' + numericPrice.toFixed(2);
                      console.log('Found valid price:', price);
                      break;
                    }
                  }
                }
                
                if (priceMatch) {
                  break;
                }
              }
            }
            
            // If no price found, try searching in all text content
            if (!price) {
              const allText = $('body').text();
              const priceMatch = allText.match(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
              if (priceMatch) {
                const numericPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
                if (numericPrice >= 1 && numericPrice <= 50000) {
                  price = '$' + numericPrice.toFixed(2);
                }
              }
            }
            
            // Enhanced image selectors
            const imageSelectors = [
              '[data-enzyme-id="ProductImageCarousel"] img',
              '.ProductDetailImageThumbnail img',
              '.ImageComponent img',
              '.ProductImageCarousel img',
              '.product-image img',
              '.ProductDetailImages img'
            ];
            
            let image = '';
            for (const selector of imageSelectors) {
              const element = $(selector).first();
              if (element.length && element.attr('src')) {
                image = element.attr('src');
                if (!image.includes('placeholder') && !image.includes('loading')) {
                  break;
                }
              }
            }
            
            // Look for dimensions in specifications
            const dimensions = $('.Specifications').text() || 
                             $('.ProductSpecs').text() || 
                             $('.product-specs').text() || '';
            
            return {
              url: request.url,
              title: title,
              price: price,
              image: image,
              dimensions: dimensions,
              brand: $('[data-testid="product-brand"]').text().trim() ||
                     $('.brand-name').text().trim() ||
                     $('.ProductBrand').text().trim()
            };
          }
        `,
        proxyConfiguration: {
          useApifyProxy: true
        },
        maxRequestsPerCrawl: 5,
        maxRequestRetries: 5,
        requestHandlerTimeoutSecs: 120
      });

      await this.client.run(run.id).waitForFinish({ waitSecs: 60 });
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (!items || items.length === 0) {
        // Fallback to universal scraper
        return this.scrapeUniversal(url);
      }

      return this.parseGenericData(items[0]);

    } catch (error) {
      // Fallback to universal scraper
      return this.scrapeUniversal(url);
    }
  }

  // Walmart specific scraper
  async scrapeWalmart(url) {
    try {
      console.log('🔄 Starting Apify Walmart scrape...');
      
      const run = await this.client.actor('apify/web-scraper').call({
        startUrls: [{ url: url }],
        pageFunction: `
          async function pageFunction(context) {
            const { $, request } = context;
            
            const title = $('h1[itemprop="name"]').text().trim() || 
                         $('h1.prod-ProductTitle').text().trim();
            
            const price = $('span[itemprop="price"]').text().trim() || 
                         $('.price-now').text().trim();
            
            const image = $('img.hover-zoom-hero-image').attr('src') ||
                         $('.prod-hero-image img').attr('src');
            
            const specs = $('.product-specifications').text() || '';
            
            return {
              url: request.url,
              title: title,
              price: price,
              image: image,
              specifications: specs,
              brand: $('.prod-brandName').text().trim()
            };
          }
        `,
        proxyConfiguration: {
          useApifyProxy: true
        }
      });

      await this.client.run(run.id).waitForFinish({ waitSecs: 60 });
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (!items || items.length === 0) {
        return this.scrapeUniversal(url);
      }

      return this.parseGenericData(items[0]);

    } catch (error) {
      return this.scrapeUniversal(url);
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
            
            const title = $('h1[data-test="product-title"]').text().trim() || 
                         $('h1.Heading__StyledHeading').text().trim();
            
            const price = $('[data-test="product-price"]').text().trim() || 
                         $('.styles__CurrentPrice').text().trim();
            
            const image = $('[data-test="product-image"] img').attr('src') ||
                         $('.styles__ImageWrapper img').first().attr('src');
            
            const details = $('[data-test="item-details-specifications"]').text() || '';
            
            return {
              url: request.url,
              title: title,
              price: price,
              image: image,
              details: details
            };
          }
        `,
        proxyConfiguration: {
          useApifyProxy: true
        }
      });

      await this.client.run(run.id).waitForFinish({ waitSecs: 60 });
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (!items || items.length === 0) {
        return this.scrapeUniversal(url);
      }

      return this.parseGenericData(items[0]);

    } catch (error) {
      return this.scrapeUniversal(url);
    }
  }

  // Best Buy specific scraper
  async scrapeBestBuy(url) {
    try {
      console.log('🔄 Starting Apify Best Buy scrape...');
      
      const run = await this.client.actor('apify/web-scraper').call({
        startUrls: [{ url: url }],
        pageFunction: `
          async function pageFunction(context) {
            const { $, request } = context;
            
            const title = $('.sku-title h1').text().trim() || 
                         $('h1.heading-5').text().trim();
            
            const price = $('.priceView-customer-price span').first().text().trim() || 
                         $('.pricing-price__regular-price').text().trim();
            
            const image = $('.primary-image img').attr('src') ||
                         $('.shop-media-gallery img').first().attr('src');
            
            const specs = $('.specs-table').text() || '';
            
            return {
              url: request.url,
              title: title,
              price: price,
              image: image,
              specifications: specs,
              brand: $('.product-brand a').text().trim()
            };
          }
        `,
        proxyConfiguration: {
          useApifyProxy: true
        }
      });

      await this.client.run(run.id).waitForFinish({ waitSecs: 60 });
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (!items || items.length === 0) {
        return this.scrapeUniversal(url);
      }

      return this.parseGenericData(items[0]);

    } catch (error) {
      return this.scrapeUniversal(url);
    }
  }

  // Home Depot specific scraper
  async scrapeHomeDepot(url) {
    try {
      console.log('🔄 Starting Apify Home Depot scrape...');
      
      const run = await this.client.actor('apify/web-scraper').call({
        startUrls: [{ url: url }],
        pageFunction: `
          async function pageFunction(context) {
            const { $, request } = context;
            
            const title = $('h1.product-details__title').text().trim() || 
                         $('h1[data-testid="product-title"]').text().trim();
            
            const price = $('.price-format__main-price').text().trim() || 
                         $('[data-testid="product-price"]').text().trim();
            
            const image = $('.mediagallery__mainimage img').attr('src') ||
                         $('.product-image img').first().attr('src');
            
            const specs = $('.specifications__table').text() || 
                         $('.specs-table').text() || '';
            
            return {
              url: request.url,
              title: title,
              price: price,
              image: image,
              specifications: specs,
              brand: $('.product-details__brand').text().trim()
            };
          }
        `,
        proxyConfiguration: {
          useApifyProxy: true
        }
      });

      await this.client.run(run.id).waitForFinish({ waitSecs: 60 });
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (!items || items.length === 0) {
        return this.scrapeUniversal(url);
      }

      return this.parseGenericData(items[0]);

    } catch (error) {
      return this.scrapeUniversal(url);
    }
  }

  // Parse Amazon data (your existing implementation)
  parseAmazonData(data) {
    const result = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true
    };

    result.name = data.title || data.name || 'Unknown Product';

    if (data.price) {
      if (typeof data.price === 'object') {
        result.price = data.price.value || data.price.amount || null;
      } else if (typeof data.price === 'string') {
        const priceMatch = data.price.match(/[\d,]+\.?\d*/);
        result.price = priceMatch ? parseFloat(priceMatch[0].replace(',', '')) : null;
      } else {
        result.price = parseFloat(data.price);
      }
    }

    if (!result.price && data.offer?.price) {
      result.price = parseFloat(data.offer.price);
    }

    result.image = data.mainImage || data.image || data.images?.[0] || null;
    result.brand = data.brand || data.manufacturer || null;

    if (data.categories && Array.isArray(data.categories)) {
      result.category = data.categories[0];
    } else if (data.category) {
      result.category = data.category;
    }

    if (data.specifications) {
      result.dimensions = this.extractDimensionsFromSpecs(data.specifications);
      result.weight = this.extractWeightFromSpecs(data.specifications);
    }

    if (!result.weight) {
      if (data.weight) result.weight = this.parseWeightString(data.weight);
      else if (data.itemWeight) result.weight = this.parseWeightString(data.itemWeight);
      else if (data.shippingWeight) result.weight = this.parseWeightString(data.shippingWeight);
    }

    console.log('📦 Parsed Amazon product:', {
      name: result.name?.substring(0, 50) + '...',
      price: result.price,
      hasImage: !!result.image,
      hasDimensions: !!result.dimensions,
      weight: result.weight
    });

    return result;
  }

  // Parse generic data for all other retailers
  parseGenericData(data) {
    const result = {
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      brand: null,
      category: null,
      inStock: true
    };

    // Product name
    result.name = data.title || data.name || 'Unknown Product';

    // Price extraction
    if (data.price) {
      if (typeof data.price === 'number') {
        result.price = data.price;
      } else if (typeof data.price === 'string') {
        const priceMatch = data.price.match(/[\d,]+\.?\d*/);
        result.price = priceMatch ? parseFloat(priceMatch[0].replace(',', '')) : null;
      }
    }

    // Image
    result.image = data.image || null;

    // Brand
    result.brand = data.brand || null;

    // Try to extract dimensions from various fields
    const textToSearch = [
      data.dimensions,
      data.specifications, 
      data.details,
      data.description
    ].filter(Boolean).join(' ');

    if (textToSearch) {
      result.dimensions = this.extractDimensionsFromText(textToSearch);
      result.weight = this.extractWeightFromText(textToSearch);
    }

    console.log('📦 Parsed generic product:', {
      name: result.name?.substring(0, 50) + '...',
      price: result.price,
      hasImage: !!result.image,
      hasDimensions: !!result.dimensions,
      weight: result.weight
    });

    return result;
  }

  extractDimensionsFromSpecs(specs) {
    if (!specs) return null;

    const dimensionKeys = [
      'Product Dimensions',
      'Package Dimensions', 
      'Item Dimensions',
      'Dimensions',
      'Size'
    ];

    for (const key of dimensionKeys) {
      if (specs[key]) {
        const parsed = this.parseDimensionString(specs[key]);
        if (parsed) return parsed;
      }
    }

    return null;
  }

  extractWeightFromSpecs(specs) {
    if (!specs) return null;

    const weightKeys = [
      'Item Weight',
      'Product Weight',
      'Package Weight',
      'Weight',
      'Shipping Weight'
    ];

    for (const key of weightKeys) {
      if (specs[key]) {
        const weight = this.parseWeightString(specs[key]);
        if (weight) return weight;
      }
    }

    return null;
  }

  extractDimensionsFromText(text) {
    if (!text) return null;

    const patterns = [
      /(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*(?:inches|in|")?/i,
      /(\d+\.?\d*)"?\s*[WL]\s*[x×]\s*(\d+\.?\d*)"?\s*[DW]\s*[x×]\s*(\d+\.?\d*)"?\s*[HT]/i,
      /L:\s*(\d+\.?\d*).*W:\s*(\d+\.?\d*).*H:\s*(\d+\.?\d*)/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const length = parseFloat(match[1]);
        const width = parseFloat(match[2]);
        const height = parseFloat(match[3]);
        
        if (length > 0 && width > 0 && height > 0 && 
            length < 200 && width < 200 && height < 200) {
          return { length, width, height };
        }
      }
    }

    return null;
  }

  extractWeightFromText(text) {
    if (!text) return null;
    return this.parseWeightString(text);
  }

  parseDimensionString(str) {
    if (!str || typeof str !== 'string') return null;

    const patterns = [
      /(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*[x×]\s*(\d+\.?\d*)\s*(?:inches|in|")?/i,
      /(\d+\.?\d*)"?\s*[WL]\s*[x×]\s*(\d+\.?\d*)"?\s*[DW]\s*[x×]\s*(\d+\.?\d*)"?\s*[HT]/i,
      /L:\s*(\d+\.?\d*).*W:\s*(\d+\.?\d*).*H:\s*(\d+\.?\d*)/i
    ];

    for (const pattern of patterns) {
      const match = str.match(pattern);
      if (match) {
        const length = parseFloat(match[1]);
        const width = parseFloat(match[2]);
        const height = parseFloat(match[3]);
        
        if (length > 0 && width > 0 && height > 0 && 
            length < 200 && width < 200 && height < 200) {
          return { length, width, height };
        }
      }
    }

    return null;
  }

  parseWeightString(weightStr) {
    if (typeof weightStr === 'number') return weightStr;
    if (typeof weightStr !== 'string') return null;

    const patterns = [
      { regex: /(\d+\.?\d*)\s*(?:pounds?|lbs?)/i, multiplier: 1 },
      { regex: /(\d+\.?\d*)\s*(?:kilograms?|kgs?)/i, multiplier: 2.205 },
      { regex: /(\d+\.?\d*)\s*(?:grams?|g)/i, multiplier: 0.00220462 },
      { regex: /(\d+\.?\d*)\s*(?:ounces?|oz)/i, multiplier: 0.0625 }
    ];

    for (const { regex, multiplier } of patterns) {
      const match = weightStr.match(regex);
      if (match) {
        const weight = parseFloat(match[1]) * multiplier;
        if (weight > 0 && weight < 1000) {
          return Math.round(weight * 10) / 10;
        }
      }
    }

    return null;
  }
}

module.exports = ApifyScraper;
