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
            
            // Updated Wayfair title selectors for 2025
            const titleSelectors = [
              'h1[data-testid="ProductTitle"]',
              'h1.ProductTitle',
              'h1[class*="ProductTitle"]',
              '.ProductDetailInfoBlock h1',
              '.ProductTitleBlock h1',
              'h1[data-enzyme-id="ProductTitle"]',
              'h1.pl-Heading',
              'h1[data-testid="product-title"]'
            ];
            
            let title = '';
            for (const selector of titleSelectors) {
              const element = $(selector).first();
              if (element.length && element.text().trim()) {
                title = element.text().trim();
                console.log('Found title with selector:', selector, 'Title:', title.substring(0, 50));
                break;
              }
            }
            
            // Completely updated Wayfair price selectors for current structure
            const priceSelectors = [
              '[data-testid="PriceDisplay"]',
              '[data-testid="ProductPrice"] [data-testid="PriceDisplay"]',
              '.ProductPrice [data-testid="PriceDisplay"]',
              '.PriceBlock [data-testid="PriceDisplay"]',
              '[class*="PriceDisplay"]',
              '.ProductDetailInfoBlock [class*="Price"]:not([class*="Strike"]):not([class*="Was"])',
              '[data-testid="price"]',
              '.price-current',
              '.current-price',
              '[data-testid="PriceBlock"] [data-testid="PriceDisplay"]',
              '.BasePriceBlock span:not([class*="strike"])',
              '.PriceBlock span:not([class*="strike"])',
              '.ProductPrice span:first-child'
            ];
            
            let price = '';
            for (const selector of priceSelectors) {
              const element = $(selector).first();
              if (element.length) {
                const priceText = element.text().trim();
                console.log('Checking selector:', selector, 'Text:', priceText);
                
                // Enhanced price patterns
                const pricePatterns = [
                  /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/,
                  /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*\$/,
                  /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/,
                  /\$\s*(\d+\s*\.\s*\d{2})/  // Handle spaced decimals
                ];
                
                for (const pattern of pricePatterns) {
                  const priceMatch = priceText.match(pattern);
                  if (priceMatch) {
                    const extractedPrice = priceMatch[1].replace(/[,\s]/g, '');
                    const numericPrice = parseFloat(extractedPrice);
                    
                    // Validate price range
                    if (numericPrice >= 1 && numericPrice <= 50000) {
                      price = '$' + numericPrice.toFixed(2);
                      console.log('Found valid price:', price);
                      break;
                    }
                  }
                }
                
                if (price) {
                  break;
                }
              }
            }
            
            // Fallback: search entire page for price patterns
            if (!price) {
              console.log('No price found with selectors, trying page text search...');
              const pageText = $('body').text();
              const priceMatches = [...pageText.matchAll(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g)];
              
              for (const match of priceMatches) {
                const numericPrice = parseFloat(match[1].replace(/,/g, ''));
                if (numericPrice >= 10 && numericPrice <= 50000) { // Minimum $10 for furniture
                  price = '$' + numericPrice.toFixed(2);
                  console.log('Found price in page text:', price);
                  break;
                }
              }
            }
            
            // Updated image selectors
            const imageSelectors = [
              '[data-testid="ProductImage"] img',
              '.ProductImage img',
              '.ProductDetailImages img:first-child',
              '.MediaCarousel img:first-child',
              '.product-media img:first-child',
              '[data-enzyme-id="ProductImageCarousel"] img',
              '.ProductDetailImageThumbnail img',
              '.ImageComponent img',
              '.ProductImageCarousel img'
            ];
            
            let image = '';
            for (const selector of imageSelectors) {
              const element = $(selector).first();
              if (element.length) {
                const src = element.attr('src') || element.attr('data-src');
                if (src && !src.includes('placeholder') && !src.includes('loading') && !src.includes('data:image')) {
                  image = src;
                  console.log('Found image:', image.substring(0, 50));
                  break;
                }
              }
            }
            
            // Enhanced specifications search
            const specsSelectors = [
              '.ProductSpecifications',
              '.Specifications', 
              '.ProductSpecs',
              '.product-specs',
              '.ProductDetails',
              '[data-testid="ProductSpecifications"]'
            ];
            
            let dimensions = '';
            for (const selector of specsSelectors) {
              const specs = $(selector).text();
              if (specs && specs.length > 10) {
                dimensions = specs;
                break;
              }
            }
            
            // Enhanced brand detection
            const brandSelectors = [
              '[data-testid="ProductBrand"]',
              '.ProductBrand',
              '.brand-name',
              '[data-testid="product-brand"]',
              '.ProductDetailInfoBlock .brand'
            ];
            
            let brand = '';
            for (const selector of brandSelectors) {
              const brandElement = $(selector).first();
              if (brandElement.length && brandElement.text().trim()) {
                brand = brandElement.text().trim();
                break;
              }
            }
            
            return {
              url: request.url,
              title: title,
              price: price,
              image: image,
              dimensions: dimensions,
              brand: brand,
              debug: {
                titleFound: !!title,
                priceFound: !!price,
                imageFound: !!image,
                specsFound: !!dimensions
              }
            };
          }
        `,
        proxyConfiguration: {
          useApifyProxy: true
        },
        maxRequestsPerCrawl: 3,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 60
      });

      await this.client.run(run.id).waitForFinish({ waitSecs: 60 });
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
      
      if (!items || items.length === 0) {
        console.log('❌ Wayfair scraper returned no items, falling back to universal scraper');
        return this.scrapeUniversal(url);
      }

      const result = this.parseGenericData(items[0]);
      console.log('📦 Wayfair scrape result:', {
        hasName: !!result.name,
        hasPrice: !!result.price,
        hasImage: !!result.image,
        debug: items[0].debug
      });
      
      return result;

    } catch (error) {
      console.error('❌ Wayfair scraper failed:', error.message);
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

    // COMPLETELY REWRITTEN Amazon price extraction - 2025 version
    console.log('🔍 Amazon price debug - Raw data:', JSON.stringify(data.price, null, 2));
    
    if (data.price) {
      if (typeof data.price === 'object') {
        // Amazon price object - try ALL possible fields
        const priceFields = [
          data.price.value,
          data.price.amount, 
          data.price.current,
          data.price.now,
          data.price.price,
          data.price.displayPrice,
          data.price.salePrice,
          data.price.listPrice,
          data.price.regularPrice,
          data.price.finalPrice,
          data.price.priceRange?.min,
          data.price.priceRange?.max,
          data.price.min,
          data.price.max
        ].filter(Boolean);
        
        console.log('🔍 Amazon price fields found:', priceFields);
        
        // Find the most reasonable price
        for (const priceField of priceFields) {
          let price = null;
          
          if (typeof priceField === 'number') {
            price = priceField;
          } else if (typeof priceField === 'string') {
            // Parse string prices with multiple patterns
            const patterns = [
              /\$\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/,  // $123.45
              /(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)\s*\$/,  // 123.45$
              /(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/        // 123.45
            ];
            
            for (const pattern of patterns) {
              const match = priceField.match(pattern);
              if (match) {
                price = parseFloat(match[1].replace(/,/g, ''));
                break;
              }
            }
          }
          
          // Validate price - kayaks should be $50-$2000, not $4
          if (price && price >= 10 && price <= 10000) {
            result.price = price;
            console.log(`✅ Amazon price found: $${price} from field:`, priceField);
            break;
          } else if (price) {
            console.log(`⚠️ Amazon price rejected: $${price} (out of range) from:`, priceField);
          }
        }
      } else if (typeof data.price === 'string') {
        // String price - enhanced patterns
        const pricePatterns = [
          /\$\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g,  // $123.45 - global to find all
          /(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)\s*\$/g,  // 123.45$
          /Price:\s*\$?\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/gi, // Price: $123.45
          /(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g        // Just numbers
        ];
        
        console.log('🔍 Amazon string price:', data.price);
        const allPrices = [];
        
        for (const pattern of pricePatterns) {
          const matches = [...data.price.matchAll(pattern)];
          for (const match of matches) {
            const price = parseFloat(match[1].replace(/,/g, ''));
            if (price >= 10 && price <= 10000) {
              allPrices.push(price);
            }
          }
        }
        
        if (allPrices.length > 0) {
          // Take the median price to avoid outliers
          allPrices.sort((a, b) => a - b);
          result.price = allPrices[Math.floor(allPrices.length / 2)];
          console.log(`✅ Amazon string price found: $${result.price} from prices:`, allPrices);
        }
      } else {
        const price = parseFloat(data.price);
        if (price >= 10 && price <= 10000) {
          result.price = price;
        }
      }
    }

    // Try alternative price sources if main price failed
    if (!result.price) {
      console.log('🔍 Amazon trying alternative price sources...');
      const alternativePrices = [
        data.offer?.price,
        data.offers?.[0]?.price,
        data.priceRange?.min,
        data.priceRange?.max,
        data.currentPrice,
        data.listPrice,
        data.salePrice,
        data.regularPrice,
        data.finalPrice,
        data.displayPrice,
        // Try nested price objects
        data.priceInfo?.price,
        data.priceInfo?.current,
        data.pricing?.price,
        data.pricing?.current
      ].filter(Boolean);
      
      console.log('🔍 Amazon alternative prices:', alternativePrices);
      
      for (const altPrice of alternativePrices) {
        let price = null;
        
        if (typeof altPrice === 'number') {
          price = altPrice;
        } else if (typeof altPrice === 'string') {
          const match = altPrice.match(/(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/);
          if (match) {
            price = parseFloat(match[1].replace(/,/g, ''));
          }
        }
        
        if (price && price >= 10 && price <= 10000) {
          result.price = price;
          console.log(`✅ Amazon alternative price found: $${price}`);
          break;
        }
      }
    }
    
    // Final validation and logging
    if (!result.price) {
      console.log('❌ Amazon price extraction completely failed');
      console.log('📊 Full Amazon data structure:', JSON.stringify(data, null, 2));
    } else {
      console.log(`✅ Amazon final price: $${result.price}`);
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
  
  extractVariantFromTitle(title) {
    if (!title) return null;
    
    // Common variant patterns
    const variantPatterns = [
      // Colors
      /\b(Black|White|Red|Blue|Green|Yellow|Orange|Purple|Pink|Brown|Gray|Grey|Silver|Gold|Navy|Beige|Cream|Ivory)\b/i,
      // Sizes  
      /\b(Small|Medium|Large|XL|XXL|XS|Twin|Full|Queen|King|Cal King)\b/i,
      // Specific measurements
      /\b(\d+['"]\s*x\s*\d+['"]\s*x\s*\d+['"']|\d+['"]\s*x\s*\d+['"']|\d+\s*x\s*\d+)\b/i,
      // Material/Style
      /\b(Wood|Metal|Plastic|Fabric|Leather|Cotton|Polyester|Velvet|Linen)\b/i,
      // Amazon specific variants in parentheses or after dash
      /[-–]\s*([^,\n\r]+?)(?:\s*[-–]|$)/,
      /\(([^)]+)\)$/
    ];
    
    for (const pattern of variantPatterns) {
      const match = title.match(pattern);
      if (match && match[1] && match[1].length < 50) {
        return match[1].trim();
      }
    }
    
    return null;
  }
}

module.exports = ApifyScraper;
