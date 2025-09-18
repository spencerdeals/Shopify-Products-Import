// backend/oxylabsScraper.js - Oxylabs Proxy Endpoint Implementation
const axios = require('axios');
const cheerio = require('cheerio');

class OxylabsScraper {
  constructor() {
    this.username = process.env.OXYLABS_USERNAME;
    this.password = process.env.OXYLABS_PASSWORD;
    this.proxyEndpoint = 'https://realtime.oxylabs.io:60000';
    this.enabled = !!(this.username && this.password);
    
    console.log('🚀 OxylabsScraper Constructor:');
    console.log(`   Username: ${this.username ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   Password: ${this.password ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   Endpoint: ${this.proxyEndpoint}`);
    console.log(`   Status: ${this.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    
    if (!this.enabled) {
      console.log('   ⚠️ Set OXYLABS_USERNAME and OXYLABS_PASSWORD environment variables');
    } else {
      console.log('   🎯 Ready to use Oxylabs proxy endpoint');
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Oxylabs not configured - missing credentials');
    }

    const retailer = this.detectRetailer(url);
    console.log(`🚀 Oxylabs scraping ${retailer}: ${url.substring(0, 60)}...`);

    // Special handling for different retailers
    let geoLocation = 'United States';
    let renderType = 'html';
    
    if (retailer === 'Amazon') {
      renderType = 'png'; // Try PNG rendering for Amazon to avoid blocks
    }
    try {
      // Use Oxylabs proxy endpoint as actual HTTP proxy
      const response = await axios({
        method: 'GET',
        url: url,
        proxy: {
          protocol: 'https',
          host: 'realtime.oxylabs.io',
          port: 60000,
          auth: {
            username: this.username,
            password: this.password
          }
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'x-oxylabs-user-agent-type': 'desktop_chrome',
          'x-oxylabs-geo-location': geoLocation,
          'x-oxylabs-render': renderType
        },
        timeout: 30000,
        maxRedirects: 5,
        httpsAgent: new (require('https').Agent)({
          rejectUnauthorized: false // Equivalent to curl -k --insecure
        }),
        validateStatus: function (status) {
          return status >= 200 && status < 300;
        }
      });

      console.log('✅ Oxylabs request completed successfully');
      
      if (!response.data) {
        throw new Error('No HTML content received from Oxylabs');
      }

      console.log('📄 HTML length received:', response.data.length);
      console.log('📊 Response headers:', Object.keys(response.headers));
      
      // CRITICAL DEBUG: Check if we're getting the actual product page or a block/redirect
      const htmlPreview = response.data.substring(0, 1000);
      console.log('📄 HTML preview (first 1000 chars):', htmlPreview);
      
      // Check for common blocking/error patterns
      const isBlocked = /blocked|captcha|access denied|forbidden|robot|bot detection/i.test(htmlPreview);
      const isRedirect = /redirect|location\.href|window\.location/i.test(htmlPreview);
      const isEmpty = response.data.length < 10000; // Suspiciously small for a product page
      
      console.log('🔍 Content Analysis:');
      console.log('   Is Blocked/Captcha:', isBlocked);
      console.log('   Has Redirects:', isRedirect);
      console.log('   Suspiciously Small:', isEmpty);
      console.log('   Contains "price":', /price/i.test(response.data));
      console.log('   Contains "add to cart":', /add to cart|addtocart/i.test(response.data));
      console.log('   Contains product data:', /product|item|buy/i.test(response.data));
      
      // Parse the HTML response
      const productData = this.parseHTML(response.data, url, retailer);
      
      console.log('📦 Oxylabs extraction results:', {
        hasName: !!productData.name,
        hasPrice: !!productData.price,
        hasImage: !!productData.image,
        hasDimensions: !!productData.dimensions,
        hasVariant: !!productData.variant
      });

      return productData;

    } catch (error) {
      console.error('❌ Oxylabs scraping failed:', error.message);
      
      if (error.response) {
        console.error('Response status:', error.response.status);
        
        if (error.response.status === 401) {
          console.error('❌ Authentication failed - check Oxylabs credentials');
        } else if (error.response.status === 403) {
          console.error('❌ Access forbidden - check Oxylabs subscription');
        } else if (error.response.status === 407) {
          console.error('❌ Proxy authentication required - check credentials');
        } else if (error.response.status >= 500) {
          console.error('❌ Oxylabs server error - try again later');
        }
      } else if (error.code === 'ECONNREFUSED') {
        console.error('❌ Connection refused - check Oxylabs endpoint');
      } else if (error.code === 'ETIMEDOUT') {
        console.error('❌ Request timeout - Oxylabs may be slow');
      }
      
      throw error;
    }
  }

  parseHTML(html, url, retailer) {
    const $ = cheerio.load(html);
    
    // CRITICAL DEBUG: See what elements actually exist
    console.log('🔍 HTML Element Analysis:');
    console.log('   Total elements:', $('*').length);
    console.log('   H1 tags:', $('h1').length);
    console.log('   IMG tags:', $('img').length);
    console.log('   Elements with "price":', $('[class*="price"], [id*="price"]').length);
    console.log('   Elements with "product":', $('[class*="product"], [id*="product"]').length);
    
    // Show actual H1 content if any exists
    if ($('h1').length > 0) {
      console.log('   First H1 content:', $('h1').first().text().trim().substring(0, 100));
    }
    
    // Show actual price-related elements
    const priceElements = $('[class*="price"], [id*="price"]');
    if (priceElements.length > 0) {
      console.log('   First price element class:', priceElements.first().attr('class'));
      console.log('   First price element text:', priceElements.first().text().trim());
    }
    
    const productData = {
      vendor: retailer,
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      variant: null
    };

    // AGGRESSIVE product name extraction
    const titleSelectors = [
      // Wayfair specific
      'h1[data-testid="product-title"]', 'h1.ProductTitle', '.ProductTitle h1',
      // Amazon specific  
      '#productTitle', 'h1.a-size-large', 'h1[data-automation-id="product-title"]',
      // Target specific
      'h1[data-test="product-title"]', 'h1.ProductTitle',
      // Walmart specific
      'h1[data-automation-id="product-title"]', 'h1.prod-ProductTitle',
      // Generic fallbacks
      'h1', '.product-title', '.product-name', '[class*="title"]', '[class*="Title"]'
    ];
    
    console.log(`   🔍 Searching for title with ${titleSelectors.length} selectors...`);
    for (const selector of titleSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim()) {
        productData.name = element.text().trim().replace(/\s+/g, ' ').substring(0, 200);
        console.log('   📝 Product name:', productData.name.substring(0, 60) + '...');
        break;
      }
    }
    if (!productData.name) {
      console.log('   ❌ No product name found with any selector');
      // Try to find any h1 tags for debugging
      const allH1s = $('h1');
      console.log(`   🔍 Found ${allH1s.length} h1 tags in HTML`);
      if (allH1s.length > 0) {
        console.log('   📝 First h1 content:', allH1s.first().text().trim().substring(0, 100));
      }
    }

    // AGGRESSIVE price extraction - try multiple methods
    const priceSelectors = [
      // Wayfair specific
      '[data-testid="price"]', '.MoneyPrice', '.price-current', '.BasePriceBlock', 
      '.PriceBlock', '.price-block', '[class*="Price"]', '[data-price]',
      // Amazon specific
      '.a-price-whole', '.a-price .a-offscreen', '.a-price-range .a-price .a-offscreen',
      // Target specific
      '[data-test="product-price"]', '.h-text-red',
      // Walmart specific
      '[data-automation-id="product-price"]', '.price-current',
      // Generic fallbacks
      '.price', '[class*="price"]', '.current-price', '.sale-price', '[class*="Price"]'
    ];
    
    console.log(`   🔍 Searching for price with ${priceSelectors.length} selectors...`);
    // Method 1: Try selectors
    for (const selector of priceSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const priceText = element.text().replace(/[^0-9.]/g, '');
        const price = parseFloat(priceText);
        if (price > 0 && price < 100000) {
          productData.price = price;
          console.log('   💰 Price (selector): $' + productData.price);
          break;
        }
      }
    }
    
    // Method 2: Regex search in HTML if selectors failed
    if (!productData.price) {
      console.log('   🔍 Trying regex price patterns...');
      const pricePatterns = [
        /"price":\s*"?\$?(\d+(?:,\d{3})*(?:\.\d{2})?)"?/g,
        /data-price[^>]*=["']?\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/g,
        /"currentPrice":\s*"?\$?(\d+(?:,\d{3})*(?:\.\d{2})?)"?/g,
        /"salePrice":\s*"?\$?(\d+(?:,\d{3})*(?:\.\d{2})?)"?/g,
        /\$(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g,
        /"price":\s*"?\$?(\d+(?:,\d{3})*(?:\.\d{2})?)"?/g,
        /price[^>]*>[\s\S]*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/gi
      ];
      
      for (const pattern of pricePatterns) {
        const matches = [...html.matchAll(pattern)];
        console.log(`   🔍 Pattern found ${matches.length} matches`);
        if (matches.length > 0) {
          console.log(`   🔍 First few matches:`, matches.slice(0, 3).map(m => m[1]));
        }
        for (const match of matches) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (price > 10 && price < 100000) { // Reasonable price range
            productData.price = price;
            console.log('   💰 Price (regex): $' + productData.price);
            break;
          }
        }
        if (productData.price) break;
      }
    }
    if (!productData.price) {
      console.log('   ❌ No price found with selectors or regex');
    }

    // AGGRESSIVE image extraction
    const imageSelectors = [
      // Wayfair specific
      '[data-testid="product-image"] img', '.ProductImages img', '.hero-image img',
      '.MediaCarousel img', '.product-media img', '.main-image img', 
      'img[data-testid*="image"]', 'img[class*="Product"]',
      // Amazon specific
      '#landingImage', '.a-dynamic-image', 'img[data-old-hires]', '.imgTagWrapper img',
      // Target specific
      '.ProductImages img', 'img[data-test="product-image"]',
      // Generic fallbacks
      '.product-image img', 'img[class*="product"]', 'img[class*="hero"]'
    ];
    
    console.log(`   🔍 Searching for image with ${imageSelectors.length} selectors...`);
    for (const selector of imageSelectors) {
      const element = $(selector).first();
      if (element.length) {
        let imgSrc = element.attr('src') || element.attr('data-src') || 
                     element.attr('data-original') || element.attr('data-lazy') ||
                     element.attr('data-srcset') || element.attr('data-large-src') ||
                     element.attr('data-zoom-src') || element.attr('srcset');
        
        // Handle srcset - take the largest image
        if (imgSrc && imgSrc.includes(',')) {
          const srcsetParts = imgSrc.split(',');
          imgSrc = srcsetParts[srcsetParts.length - 1].trim().split(' ')[0];
        }
        
        if (imgSrc) {
          // Handle relative URLs
          if (imgSrc.startsWith('//')) {
            imgSrc = 'https:' + imgSrc;
          } else if (imgSrc.startsWith('/')) {
            const urlObj = new URL(url);
            imgSrc = urlObj.protocol + '//' + urlObj.host + imgSrc;
          }
          
          if (imgSrc.startsWith('http') && 
              !imgSrc.includes('placeholder') && 
              !imgSrc.includes('loading') &&
              !imgSrc.includes('spinner') &&
              !imgSrc.includes('blank') &&
              imgSrc.length > 20) {
            productData.image = imgSrc;
            console.log('   🖼️ Image: Found');
            break;
          }
        }
      }
    }
    
    // Method 2: Search for images in script tags (JSON data)
    if (!productData.image) {
      console.log('   🔍 Searching for images in script tags...');
      const scriptTags = $('script');
      for (let i = 0; i < scriptTags.length; i++) {
        const scriptContent = $(scriptTags[i]).html();
        if (scriptContent && (scriptContent.includes('image') || scriptContent.includes('photo'))) {
          // Look for image URLs in JSON
          const imageMatches = scriptContent.match(/"(https?:\/\/[^"]*\.(jpg|jpeg|png|webp)[^"]*)"/gi);
          if (imageMatches && imageMatches.length > 0) {
            let imgUrl = imageMatches[0].replace(/"/g, '');
            if (imgUrl.length > 20 && !imgUrl.includes('placeholder')) {
              productData.image = imgUrl;
              console.log('   🖼️ Image: Found in script tag');
              break;
            }
          }
        }
      }
    }
    if (!productData.image) {
      console.log('   ❌ No image found with selectors');
      // Try to find any img tags for debugging
      const allImgs = $('img');
      console.log(`   🔍 Found ${allImgs.length} img tags in HTML`);
      if (allImgs.length > 0) {
        const firstImg = allImgs.first();
        console.log('   📝 First img src:', firstImg.attr('src') || 'no src');
        console.log('   📝 First img data-src:', firstImg.attr('data-src') || 'no data-src');
      }
    }

    // AGGRESSIVE variant extraction
    const variantSelectors = [
      // Amazon specific
      '.a-button-selected .a-button-text', '.a-dropdown-prompt', '#variation_color_name .selection',
      '#variation_size_name .selection', '.swatches .a-button-selected span',
      // Wayfair specific  
      '.SelectedOption', '.option-selected', '.selected-swatch', '[data-testid="selected-option"]',
      // Target specific
      '.selected-variant', '.h-text-bold', '[data-test="selected-variant"]', '.swatch--selected',
      // Generic fallbacks
      '.selected', '.selected-option', '[aria-selected="true"]', '.variant-selected'
    ];
    
    for (const selector of variantSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim()) {
        const variantText = element.text().trim();
        if (!/^(select|choose|option|default|click|tap|size|color)$/i.test(variantText) && 
            variantText.length >= 2 && variantText.length <= 50 &&
            !/^[\d\-_]+$/.test(variantText)) {
          productData.variant = variantText;
          console.log('   🎨 Variant:', productData.variant);
          break;
        }
      }
    }

    // Extract dimensions from text
    const bodyText = $.text();
    
    // AGGRESSIVE dimension patterns
    const dimPatterns = [
      /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches?|in\.?|")/i,
      /dimensions?[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
      /L:\s*(\d+(?:\.\d+)?)[^0-9]*W:\s*(\d+(?:\.\d+)?)[^0-9]*H:\s*(\d+(?:\.\d+)?)/i,
      /length[^:]*:\s*(\d+(?:\.\d+)?)[^0-9]*width[^:]*:\s*(\d+(?:\.\d+)?)[^0-9]*height[^:]*:\s*(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*w\s*x\s*(\d+(?:\.\d+)?)\s*d\s*x\s*(\d+(?:\.\d+)?)\s*h/i,
      /(\d+(?:\.\d+)?)\s*"\s*x\s*(\d+(?:\.\d+)?)\s*"\s*x\s*(\d+(?:\.\d+)?)\s*"/i
    ];
    
    for (const pattern of dimPatterns) {
      const match = bodyText.match(pattern);
      if (match) {
        const dims = {
          length: parseFloat(match[1]),
          width: parseFloat(match[2]),
          height: parseFloat(match[3])
        };
        // Validate dimensions are reasonable
        if (dims.length > 0 && dims.width > 0 && dims.height > 0 && 
            dims.length < 200 && dims.width < 200 && dims.height < 200) {
          productData.dimensions = dims;
          console.log('   📏 Dimensions:', `${dims.length}" × ${dims.width}" × ${dims.height}"`);
          break;
        }
      }
    }

    console.log('   ✅ Oxylabs extraction complete:', {
      vendor: !!productData.vendor,
      name: !!productData.name,
      price: !!productData.price,
      image: !!productData.image,
      variant: !!productData.variant,
      dimensions: !!productData.dimensions
    });

    return productData;
  }

  getTitleSelectors(retailer) {
    const common = [
      'h1[data-testid*="title"]',
      'h1[data-testid*="name"]',
      'h1.product-title',
      'h1.ProductTitle',
      'h1',
      '.product-title h1',
      '.product-name h1'
    ];

    const specific = {
      'Amazon': [
        '#productTitle',
        'h1.a-size-large',
        'h1[data-automation-id="product-title"]'
      ],
      'Wayfair': [
        'h1[data-testid="product-title"]',
        'h1.ProductTitle'
      ],
      'Target': [
        'h1[data-test="product-title"]',
        'h1.ProductTitle'
      ],
      'Walmart': [
        'h1[data-automation-id="product-title"]',
        'h1.prod-ProductTitle'
      ],
      'Best Buy': [
        'h1.sr-only',
        'h1.heading-5'
      ]
    };

    return [...(specific[retailer] || []), ...common];
  }

  getPriceSelectors(retailer) {
    const common = [
      '.price',
      '[class*="price"]',
      '.current-price',
      '.sale-price',
      '[data-testid*="price"]'
    ];

    const specific = {
      'Amazon': [
        '.a-price-whole',
        '.a-price .a-offscreen',
        '.a-price-range .a-price .a-offscreen'
      ],
      'Wayfair': [
        '.MoneyPrice',
        '[data-testid="price"]'
      ],
      'Target': [
        '[data-test="product-price"]',
        '.h-text-red'
      ],
      'Walmart': [
        '[data-automation-id="product-price"]',
        '.price-current'
      ],
      'Best Buy': [
        '.pricing-price__value',
        '.sr-only:contains("current price")'
      ]
    };

    return [...(specific[retailer] || []), ...common];
  }

  getImageSelectors(retailer) {
    const common = [
      '.product-image img',
      'img[class*="product"]',
      '.hero-image img',
      'img[data-testid*="image"]'
    ];

    const specific = {
      'Amazon': [
        '#landingImage',
        '.a-dynamic-image',
        'img[data-old-hires]',
        '.imgTagWrapper img'
      ],
      'Wayfair': [
        'img[data-testid="product-image"]',
        '.ProductImages img'
      ],
      'Target': [
        '.ProductImages img',
        'img[data-test="product-image"]'
      ],
      'Walmart': [
        'img[data-automation-id="product-image"]',
        '.prod-hero-image img'
      ],
      'Best Buy': [
        '.product-image img',
        '.hero-image img'
      ]
    };

    return [...(specific[retailer] || []), ...common];
  }

  getVariantSelectors(retailer) {
    const common = [
      '.selected',
      '.selected-option',
      '.selected-variant',
      '[aria-selected="true"]',
      '.variant-selected',
      '.option-selected',
      '.swatch-selected',
      '.color-selected',
      '.size-selected'
    ];

    const specific = {
      'Amazon': [
        '.a-button-selected .a-button-text',
        '.a-dropdown-prompt',
        '#variation_color_name .selection',
        '#variation_size_name .selection',
        '#variation_style_name .selection',
        '.swatches .a-button-selected span'
      ],
      'Wayfair': [
        '.SelectedOption',
        '.option-selected',
        '.selected-swatch',
        '[data-testid="selected-option"]'
      ],
      'Target': [
        '.selected-variant',
        '.h-text-bold',
        '[data-test="selected-variant"]',
        '.swatch--selected'
      ],
      'Walmart': [
        '.selected-variant-value',
        '[data-selected="true"]',
        '.variant-pill--selected'
      ],
      'Best Buy': [
        '.selected-variation',
        '.variation-selected'
      ]
    };

    return [...(specific[retailer] || []), ...common];
  }

  detectRetailer(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain.includes('amazon.com')) return 'Amazon';
      if (domain.includes('wayfair.com')) return 'Wayfair';
      if (domain.includes('target.com')) return 'Target';
      if (domain.includes('walmart.com')) return 'Walmart';
      if (domain.includes('bestbuy.com')) return 'Best Buy';
      if (domain.includes('homedepot.com')) return 'Home Depot';
      if (domain.includes('lowes.com')) return 'Lowes';
      if (domain.includes('costco.com')) return 'Costco';
      if (domain.includes('macys.com')) return 'Macys';
      if (domain.includes('ikea.com')) return 'IKEA';
      return 'Unknown';
    } catch (e) {
      return 'Unknown';
    }
  }
}

module.exports = OxylabsScraper;