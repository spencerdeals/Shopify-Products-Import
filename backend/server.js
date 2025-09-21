const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { parseProduct } = require('./fastScraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
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
        const product = await parseProduct(url);
        
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
});

module.exports = app;