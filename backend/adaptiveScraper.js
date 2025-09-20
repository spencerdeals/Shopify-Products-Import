// backend/adaptiveScraper.js - Self-Learning Scraping System
const fs = require('fs').promises;
const path = require('path');

class AdaptiveScraper {
  constructor() {
    this.configPath = path.join(__dirname, 'scraping-config.json');
    this.config = null;
    this.learningData = new Map(); // Store learning data in memory
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      // Load existing config or create default
      const configExists = await fs.access(this.configPath).then(() => true).catch(() => false);
      
      if (configExists) {
        const configData = await fs.readFile(this.configPath, 'utf8');
        this.config = JSON.parse(configData);
        console.log('📚 Loaded adaptive scraping config');
      } else {
        this.config = this.getDefaultConfig();
        await this.saveConfig();
        console.log('🆕 Created new adaptive scraping config');
      }
      
      this.initialized = true;
    } catch (error) {
      console.error('❌ Failed to initialize adaptive scraper:', error);
      this.config = this.getDefaultConfig();
      this.initialized = true;
    }
  }

  getDefaultConfig() {
    return {
      version: "1.0",
      lastUpdated: new Date().toISOString(),
      retailers: {
        "amazon": {
          successRate: 0.8,
          commonFailures: [],
          titleSelectors: [
            "#productTitle",
            "h1.a-size-large",
            "h1[data-automation-id='product-title']"
          ],
          priceSelectors: [
            ".a-price-whole",
            ".a-price .a-offscreen",
            ".a-price-range .a-price .a-offscreen"
          ],
          imageSelectors: [
            "#landingImage",
            ".a-dynamic-image",
            "img[data-old-hires]",
            ".imgTagWrapper img"
          ],
          variantSelectors: [
            ".a-button-selected .a-button-text",
            ".a-dropdown-prompt",
            "#variation_color_name .selection",
            "#variation_size_name .selection",
            "#variation_style_name .selection",
            ".swatches .a-button-selected span"
          ]
        },
        "wayfair": {
          successRate: 0.75,
          commonFailures: [],
          titleSelectors: [
            "h1[data-testid='product-title']",
            "h1.ProductTitle"
          ],
          priceSelectors: [
            ".MoneyPrice",
            "[data-testid='price']"
          ],
          imageSelectors: [
            "img[data-testid='product-image']",
            ".ProductImages img"
          ],
          variantSelectors: [
            ".SelectedOption",
            ".option-selected",
            ".selected-swatch",
            "[data-testid='selected-option']",
            ".ProductOptionPills .selected",
            ".OptionPill.selected"
          ]
        },
        "target": {
          successRate: 0.7,
          commonFailures: [],
          titleSelectors: [
            "h1[data-test='product-title']",
            "h1.ProductTitle"
          ],
          priceSelectors: [
            "[data-test='product-price']",
            ".h-text-red"
          ],
          imageSelectors: [
            ".ProductImages img",
            "img[data-test='product-image']"
          ],
          variantSelectors: [
            ".selected-variant",
            ".h-text-bold",
            "[data-test='selected-variant']",
            ".swatch--selected"
          ]
        },
        "ikea": {
          successRate: 0.6,
          commonFailures: ["variants_incomplete"],
          titleSelectors: [
            "h1.notranslate",
            ".range-revamp-header-section h1",
            ".pip-header-section h1"
          ],
          priceSelectors: [
            ".notranslate .range-revamp-price",
            ".pip-price-module__current-price",
            ".range-revamp-price__integer"
          ],
          imageSelectors: [
            ".range-revamp-media-grid img",
            ".pip-media-grid img",
            ".range-revamp-aspect-ratio-image img"
          ],
          variantSelectors: [
            ".range-revamp-pip-selected",
            ".pip-selected",
            ".range-revamp-color-image.selected",
            ".range-revamp-size-option.selected",
            "[aria-pressed='true']",
            ".range-revamp-pip-color-image[aria-pressed='true']",
            ".range-revamp-pip-size[aria-pressed='true']"
          ]
        },
        "crate & barrel": {
          successRate: 0.5,
          commonFailures: ["low_success_rate"],
          titleSelectors: [
            "h1.product-name",
            ".pdp-product-name h1",
            ".product-details h1"
          ],
          priceSelectors: [
            ".price-current",
            ".product-price .price",
            ".pdp-price .price-current"
          ],
          imageSelectors: [
            ".product-images img",
            ".pdp-images img",
            ".hero-image img"
          ],
          variantSelectors: [
            ".selected-swatch",
            ".swatch.selected",
            ".option-selected",
            ".variant-selected",
            "[data-selected='true']",
            ".color-swatch.selected",
            ".size-option.selected"
          ]
        }
      }
    };
  }

  async saveConfig() {
    try {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('❌ Failed to save adaptive config:', error);
    }
  }

  // Record scraping attempt and result
  async recordScrapingAttempt(url, retailer, success, extractedData, failureReasons = []) {
    await this.initialize();
    
    const retailerKey = retailer.toLowerCase().replace(/\s+/g, ' ');
    
    if (!this.config.retailers[retailerKey]) {
      this.config.retailers[retailerKey] = {
        successRate: 0,
        commonFailures: [],
        titleSelectors: [],
        priceSelectors: [],
        imageSelectors: [],
        variantSelectors: []
      };
    }
    
    const retailerConfig = this.config.retailers[retailerKey];
    
    // Update success rate (simple moving average)
    const currentRate = retailerConfig.successRate || 0;
    retailerConfig.successRate = (currentRate * 0.9) + (success ? 0.1 : 0);
    
    // Track failure reasons
    if (!success && failureReasons.length > 0) {
      failureReasons.forEach(reason => {
        if (!retailerConfig.commonFailures.includes(reason)) {
          retailerConfig.commonFailures.push(reason);
        }
      });
    }
    
    // Store learning data for analysis
    const attemptData = {
      url,
      retailer: retailerKey,
      success,
      extractedData,
      failureReasons,
      timestamp: new Date().toISOString()
    };
    
    if (!this.learningData.has(retailerKey)) {
      this.learningData.set(retailerKey, []);
    }
    
    const retailerData = this.learningData.get(retailerKey);
    retailerData.push(attemptData);
    
    // Keep only last 50 attempts per retailer
    if (retailerData.length > 50) {
      retailerData.splice(0, retailerData.length - 50);
    }
    
    console.log(`📊 Recorded ${success ? 'successful' : 'failed'} scrape for ${retailer} (Success rate: ${(retailerConfig.successRate * 100).toFixed(1)}%)`);
    
    // Auto-improve if success rate is low
    if (retailerConfig.successRate < 0.6) {
      await this.suggestImprovements(retailerKey);
    }
    
    // Save config periodically
    if (Math.random() < 0.1) { // 10% chance to save
      await this.saveConfig();
    }
  }

  // Get optimized selectors for a retailer
  getSelectorsForRetailer(retailer) {
    const retailerKey = retailer.toLowerCase().replace(/\s+/g, ' ');
    const config = this.config?.retailers[retailerKey];
    
    if (!config) {
      return this.getGenericSelectors();
    }
    
    return {
      title: [...config.titleSelectors, ...this.getGenericSelectors().title],
      price: [...config.priceSelectors, ...this.getGenericSelectors().price],
      image: [...config.imageSelectors, ...this.getGenericSelectors().image],
      variant: [...config.variantSelectors, ...this.getGenericSelectors().variant]
    };
  }

  getGenericSelectors() {
    return {
      title: [
        'h1[data-testid*="title"]',
        'h1[data-testid*="name"]',
        'h1.product-title',
        'h1.ProductTitle',
        'h1',
        '.product-title h1',
        '.product-name h1'
      ],
      price: [
        '.price',
        '[class*="price"]',
        '.current-price',
        '.sale-price',
        '[data-testid*="price"]'
      ],
      image: [
        '.product-image img',
        'img[class*="product"]',
        '.hero-image img',
        'img[data-testid*="image"]'
      ],
      variant: [
        '.selected',
        '.selected-option',
        '.selected-variant',
        '[aria-selected="true"]',
        '.variant-selected'
      ]
    };
  }

  // Analyze failures and suggest improvements
  async suggestImprovements(retailerKey) {
    const retailerData = this.learningData.get(retailerKey);
    if (!retailerData || retailerData.length < 5) return;
    
    const recentFailures = retailerData
      .filter(attempt => !attempt.success)
      .slice(-10); // Last 10 failures
    
    if (recentFailures.length === 0) return;
    
    console.log(`🔍 Analyzing ${recentFailures.length} recent failures for ${retailerKey}...`);
    
    // Analyze common failure patterns
    const failurePatterns = {};
    recentFailures.forEach(failure => {
      failure.failureReasons.forEach(reason => {
        failurePatterns[reason] = (failurePatterns[reason] || 0) + 1;
      });
    });
    
    // Suggest new selectors based on patterns
    const suggestions = [];
    
    if (failurePatterns['no_title'] > 2) {
      suggestions.push('Add more title selectors');
    }
    if (failurePatterns['no_price'] > 2) {
      suggestions.push('Add more price selectors');
    }
    if (failurePatterns['variants_incomplete'] > 2) {
      suggestions.push('Improve variant extraction');
    }
    
    if (suggestions.length > 0) {
      console.log(`💡 Suggestions for ${retailerKey}:`, suggestions);
      
      // Auto-add some common selectors
      await this.autoImproveSelectors(retailerKey, failurePatterns);
    }
  }

  // Automatically add new selectors based on failure patterns
  async autoImproveSelectors(retailerKey, failurePatterns) {
    const config = this.config.retailers[retailerKey];
    let improved = false;
    
    // Add common missing selectors
    if (failurePatterns['no_title'] > 2) {
      const newTitleSelectors = [
        '.product-name',
        '[data-product-title]',
        '.pdp-product-name',
        '.item-title'
      ];
      
      newTitleSelectors.forEach(selector => {
        if (!config.titleSelectors.includes(selector)) {
          config.titleSelectors.push(selector);
          improved = true;
        }
      });
    }
    
    if (failurePatterns['no_price'] > 2) {
      const newPriceSelectors = [
        '.product-price',
        '[data-price]',
        '.pdp-price',
        '.item-price'
      ];
      
      newPriceSelectors.forEach(selector => {
        if (!config.priceSelectors.includes(selector)) {
          config.priceSelectors.push(selector);
          improved = true;
        }
      });
    }
    
    if (failurePatterns['variants_incomplete'] > 2) {
      const newVariantSelectors = [
        '[data-variant-selected]',
        '.variant-option.active',
        '.option.chosen',
        '[aria-current="true"]'
      ];
      
      newVariantSelectors.forEach(selector => {
        if (!config.variantSelectors.includes(selector)) {
          config.variantSelectors.push(selector);
          improved = true;
        }
      });
    }
    
    if (improved) {
      console.log(`🔧 Auto-improved selectors for ${retailerKey}`);
      await this.saveConfig();
    }
  }

  // Get retailer statistics
  getRetailerStats() {
    const stats = {};
    
    for (const [retailer, config] of Object.entries(this.config?.retailers || {})) {
      const learningData = this.learningData.get(retailer) || [];
      
      stats[retailer] = {
        successRate: (config.successRate * 100).toFixed(1) + '%',
        totalAttempts: learningData.length,
        recentAttempts: learningData.filter(a => 
          new Date(a.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
        ).length,
        commonFailures: config.commonFailures,
        selectorCount: {
          title: config.titleSelectors.length,
          price: config.priceSelectors.length,
          image: config.imageSelectors.length,
          variant: config.variantSelectors.length
        }
      };
    }
    
    return stats;
  }
}

module.exports = AdaptiveScraper;