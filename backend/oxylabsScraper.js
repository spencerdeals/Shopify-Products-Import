// backend/oxylabsScraper.js - Oxylabs Proxy Endpoint Implementation
const axios = require('axios');
const cheerio = require('cheerio');

class OxylabsScraper {
  constructor() {
    this.username = process.env.OXYLABS_USERNAME;
    this.password = process.env.OXYLABS_PASSWORD;
    this.proxyEndpoint = 'realtime.oxylabs.io:60000';
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

    try {
      console.log('   📤 Sending request to Oxylabs API...');
      
      const response = await axios.get(url, {
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
          'x-oxylabs-user-agent-type': 'desktop_chrome',
          'x-oxylabs-geo-location': 'United States',
          'x-oxylabs-render': 'html'
        },
        timeout: 30000,
        httpsAgent: new (require('https').Agent)({
          rejectUnauthorized: false
        }),
        validateStatus: function (status) {
          return status >= 200 && status < 300;
        }
      });

      console.log('✅ Oxylabs request completed successfully');

      console.log('📄 HTML length received:', response.data ? response.data.length : 0);
      console.log('📊 Response headers:', Object.keys(response.headers));
      
      if (!response.data) {
        throw new Error('No HTML content received from Oxylabs');
      }
      
      // Show HTML preview for debugging
      const htmlPreview = response.data.substring(0, 1000);
      console.log('📄 HTML preview (first 1000 chars):', htmlPreview);
      
      // Quick content validation
      if (response.data.length < 5000) {
        console.log('⚠️ Small content received, may be blocked');
        throw new Error('Insufficient content received');
      }
      
      console.log('✅ Content validation passed - proceeding with extraction');
      
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
      // Luna Furniture specific
      '.product__media img', '.product-single__photo img', '.product-photo-main img',
      '.featured-image img', '.product-image-main img',
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
                     element.attr('data-zoom-src') || element.attr('srcset') ||
                     element.attr('data-zoom') || element.attr('data-full-size-image-url');
        
        // Handle srcset - take the largest image
        if (imgSrc && imgSrc.includes(',')) {
          const srcsetParts = imgSrc.split(',');
          imgSrc = srcsetParts[srcsetParts.length - 1].trim().split(' ')[0];
        }
        
        // Handle protocol-relative URLs
        if (imgSrc) {
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
              !imgSrc.includes('no-image') &&
              !imgSrc.includes('default') &&
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
          const imageMatches = scriptContent.match(/"(https?:\/\/[^"]*\.(jpg|jpeg|png|webp|avif)[^"?]*)/gi);
          if (imageMatches && imageMatches.length > 0) {
            // Find the largest/best quality image
            for (const match of imageMatches) {
              let imgUrl = match.replace(/"/g, '');
              if (imgUrl.length > 20 && 
                  !imgUrl.includes('placeholder') && 
                  !imgUrl.includes('thumb') &&
                  !imgUrl.includes('small') &&
                  (imgUrl.includes('large') || imgUrl.includes('master') || imgUrl.includes('original') || imgUrl.width > 400)) {
                productData.image = imgUrl;
                console.log('   🖼️ Image: Found in script tag');
                break;
              }
            }
            // Fallback to first image if no large one found
            if (!productData.image && imageMatches.length > 0) {
              let imgUrl = imageMatches[0].replace(/"/g, '');
              productData.image = imgUrl;
              console.log('   🖼️ Image: Found in script tag');
            }
            if (productData.image) break;
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
      // Luna Furniture / Shopify specific
      '.product-form__input:checked + label', '.variant-input:checked + label', 
      '.swatch.selected', '.option-value.selected', '.variant-option.selected',
      '.product-option.selected', '.color-swatch.selected', '.size-option.selected',
      // Generic fallbacks
      '.selected', '.selected-option', '[aria-selected="true"]', '.variant-selected'
    ];
    
    console.log(`   🔍 Searching for variant with ${variantSelectors.length} selectors...`);
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
    
    // Method 2: Look for variant info in URL parameters or page data
    if (!productData.variant) {
      console.log('   🔍 Searching for variant in URL and page data...');
      
      // Check URL for variant parameter
      try {
        const urlObj = new URL(url);
        const variant = urlObj.searchParams.get('variant') || urlObj.searchParams.get('color') || urlObj.searchParams.get('size');
        if (variant && variant.length > 1 && variant.length < 50) {
          productData.variant = variant;
          console.log('   🎨 Variant (URL):', productData.variant);
        }
      } catch (e) {}
      
      // Look for variant in JSON-LD or other structured data
      if (!productData.variant) {
        const scriptTags = $('script[type="application/ld+json"], script[type="application/json"]');
        for (let i = 0; i < scriptTags.length; i++) {
          try {
            const jsonContent = $(scriptTags[i]).html();
            if (jsonContent) {
              const data = JSON.parse(jsonContent);
              const variant = data.variant || data.selectedVariant || data.color || data.size || data.style;
              if (variant && typeof variant === 'string' && variant.length > 1 && variant.length < 50) {
                productData.variant = variant;
                console.log('   🎨 Variant (JSON):', productData.variant);
                break;
              }
            }
          } catch (e) {}
        }
      }
    }
    
    if (!productData.variant) {
      console.log('   ❌ No variant found with any method');
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

  processParsedData(parsed, url, retailer) {
    console.log('   📊 Processing parsed data from Oxylabs...');
    
    const productData = {
      vendor: retailer,
      name: null,
      price: null,
      image: null,
      dimensions: null,
      weight: null,
      variant: null
    };
    
    // Extract data from parsed response
    if (parsed.title) {
      productData.name = parsed.title.trim();
      console.log('   📝 Product name (parsed):', productData.name.substring(0, 60) + '...');
    }
    
    if (parsed.price) {
      const priceValue = typeof parsed.price === 'object' ? parsed.price.value : parsed.price;
      const price = parseFloat(String(priceValue).replace(/[^0-9.]/g, ''));
      if (price > 0 && price < 100000) {
        productData.price = price;
        console.log('   💰 Price (parsed): $' + productData.price);
      }
    }
    
    if (parsed.images && parsed.images.length > 0) {
      productData.image = parsed.images[0];
      console.log('   🖼️ Image (parsed): Found');
    }
    
    // Look for dimensions in parsed data
    if (parsed.specifications || parsed.details) {
      const specs = parsed.specifications || parsed.details;
      const specsText = JSON.stringify(specs).toLowerCase();
      
      const dimMatch = specsText.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
      if (dimMatch) {
        productData.dimensions = {
          length: parseFloat(dimMatch[1]),
          width: parseFloat(dimMatch[2]),
          height: parseFloat(dimMatch[3])
        };
        console.log('   📏 Dimensions (parsed):', `${productData.dimensions.length}" × ${productData.dimensions.width}" × ${productData.dimensions.height}"`);
      }
    }
    
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
      if (domain.includes('lunafurn.com')) return 'Luna Furniture';
      if (domain.includes('overstock.com')) return 'Overstock';
      if (domain.includes('cb2.com')) return 'CB2';
      if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
      if (domain.includes('westelm.com')) return 'West Elm';
      if (domain.includes('potterybarn.com')) return 'Pottery Barn';
      if (domain.includes('ashleyfurniture.com')) return 'Ashley Furniture';
      if (domain.includes('roomstogo.com')) return 'Rooms To Go';
      if (domain.includes('livingspaces.com')) return 'Living Spaces';
      return 'Unknown';
    } catch (e) {
      return 'Unknown';
    }
  }
}

module.exports = OxylabsScraper;