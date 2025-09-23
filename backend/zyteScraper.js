const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

// Zyte Scraper Class
class ZyteScraper {
  constructor() {
    this.apiKey = process.env.ZYTE_API_KEY;
    this.enabled = !!this.apiKey;
    
    if (this.enabled) {
      console.log('🕷️ ZyteScraper Constructor:');
      console.log('   API Key: ✅ SET');
      console.log('   Status: ✅ ENABLED (v4.0 - Fixed Price Parsing)');
      console.log('   🎯 Ready to use Zyte API with automatic product extraction and smart price parsing');
    } else {
      console.log('🕷️ ZyteScraper Constructor:');
      console.log('   API Key: ❌ NOT SET');
      console.log('   Status: ❌ DISABLED');
      console.log('   🚨 Set ZYTE_API_KEY environment variable to enable');
    }
  }

  async scrapeProduct(url) {
    if (!this.enabled) {
      throw new Error('Zyte API key not configured');
    }

    console.log(`🕷️ Zyte scraping: ${url.substring(0, 50)}...`);
    
    const axios = require('axios');
    
    try {
      const response = await axios.post('https://api.zyte.com/v1/extract', {
        url: url,
        product: true,
        productOptions: {
          extractFrom: 'httpResponseBody'
        },
        httpResponseBody: true
      }, {
        auth: {
          username: this.apiKey,
          password: ''
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 60000
      });

      if (response.data && response.data.product) {
        const product = response.data.product;
        
        // Extract basic info
        const name = product.name || 'Unknown Product';
        const price = parseFloat(product.price) || 0;
        const image = product.mainImage || null;
        const brand = product.brand?.name || null;
        
        // Extract dimensions if available
        let dimensions = null;
        if (product.size) {
          const sizeMatch = product.size.match(/(\d+\.?\d*)"?\s*[Ww]\s*x\s*(\d+\.?\d*)"?\s*[Dd]/);
          if (sizeMatch) {
            dimensions = {
              length: parseFloat(sizeMatch[1]),
              width: parseFloat(sizeMatch[2]),
              height: 33 // Default height
            };
          }
        }
        
        if (!dimensions) {
          dimensions = { length: 24, width: 18, height: 12 }; // Default
        }

        console.log(`✅ Zyte success! Product: "${name}" Price: $${price}`);
        
        return {
          url,
          name,
          price,
          currency: 'USD',
          image,
          brand,
          dimensions,
          inStock: true,
          category: product.breadcrumbs?.[product.breadcrumbs.length - 1] || null,
          variant: product.variants?.[0] || null,
          manualEntryRequired: false
        };
      }
      
const GPTWebScraper = require('./gptWebScraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize scrapers
const zyteScraper = new ZyteScraper();
const gptWebScraper = new GPTWebScraper();
const gptBackupScraper = new GPTScraper();

// Trust proxy for Railway deployment
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  trustProxy: true
});
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Main scraping endpoint
app.post('/api/scrape', async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an array of URLs to scrape'
      });
    }

    if (urls.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 10 URLs allowed per request'
      });
    }

    console.log(`[Server] Starting scrape for ${urls.length} URLs`);
    const results = [];
    const errors = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].trim();
      
      if (!url) {
        errors.push({ url: '', error: 'Empty URL provided' });
        continue;
      }

      try {
        console.log(`[Server] Scraping ${i + 1}/${urls.length}: ${url}`);
        
        let product = null;
        
        // Try GPT Web browsing first (most reliable)
        if (gptWebScraper.enabled) {
          try {
            product = await gptWebScraper.scrapeProduct(url);
            console.log(`✅ GPT Web browsing succeeded for ${url}`);
          } catch (gptWebError) {
            console.log(`❌ GPT Web browsing failed for ${url}: ${gptWebError.message}`);
            
            // Try Zyte as backup
            if (zyteScraper.enabled) {
              try {
                console.log(`🕷️ Trying Zyte backup for ${url}`);
                product = await zyteScraper.scrapeProduct(url);
                console.log(`✅ Zyte backup succeeded for ${url}`);
              } catch (zyteError) {
                console.log(`❌ Zyte backup also failed for ${url}: ${zyteError.message}`);
                
                // Try GPT HTML parsing as final backup
                if (gptBackupScraper.enabled) {
                  try {
                    console.log(`🤖 Trying GPT HTML parsing as final backup for ${url}`);
                    product = await gptBackupScraper.scrapeProduct(url);
                    console.log(`✅ GPT HTML parsing succeeded for ${url}`);
                  } catch (gptBackupError) {
                    console.log(`❌ All scrapers failed for ${url}`);
                    throw new Error(`All scrapers failed: ${gptWebError.message}`);
                  }
                } else {
                  throw new Error(`GPT Web and Zyte failed: ${gptWebError.message}`);
                }
              }
            } else {
              throw gptWebError;
            }
          }
        } else if (zyteScraper.enabled) {
          // Only Zyte available
          product = await zyteScraper.scrapeProduct(url);
        } else if (gptBackupScraper.enabled) {
          // Only GPT HTML parsing available
          product = await gptBackupScraper.scrapeProduct(url);
        } else {
          throw new Error('No scrapers configured');
        }
        
        // Ensure we have minimum required data
        if (!product.name || !product.price) {
          throw new Error('Missing required product data (name or price)');
        }

        // Add retailer detection
        const hostname = new URL(url).hostname.toLowerCase();
        let retailer = 'Unknown';
        if (hostname.includes('wayfair')) retailer = 'Wayfair';
        else if (hostname.includes('amazon')) retailer = 'Amazon';
        else if (hostname.includes('walmart')) retailer = 'Walmart';
        else if (hostname.includes('target')) retailer = 'Target';
        else if (hostname.includes('bestbuy')) retailer = 'Best Buy';
        else if (hostname.includes('homedepot')) retailer = 'Home Depot';
        else if (hostname.includes('crateandbarrel')) retailer = 'Crate & Barrel';
        else if (hostname.includes('ikea')) retailer = 'IKEA';

        // Ensure dimensions exist (use defaults if missing)
        if (!product.dimensions) {
          product.dimensions = { length: 24, width: 18, height: 12 };
        }

        results.push({
          ...product,
          retailer,
          success: true
        });

      } catch (error) {
        console.error(`[Server] Error scraping ${url}:`, error.message);
        errors.push({
          url,
          error: error.message,
          success: false
        });
      }
    }

    // Return results
    const response = {
      success: results.length > 0,
      products: results,
      errors: errors,
      summary: {
        total: urls.length,
        successful: results.length,
        failed: errors.length
      }
    };

    console.log(`[Server] Scraping complete: ${results.length}/${urls.length} successful`);
    res.json(response);

  } catch (error) {
    console.error('[Server] Scraping endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during scraping',
      details: error.message
    });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

app.get('/admin-calculator', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin-calculator.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 SDL Import Calculator running on port ${PORT}`);
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`🔧 Calculator: http://localhost:${PORT}/admin-calculator`);
  console.log(`🤖 GPT Web browsing enabled: ${gptWebScraper.enabled}`);
  console.log(`🕷️ Zyte enabled: ${zyteScraper.enabled}`);
  console.log(`🤖 GPT HTML backup enabled: ${gptBackupScraper.enabled}`);
});

module.exports = app;