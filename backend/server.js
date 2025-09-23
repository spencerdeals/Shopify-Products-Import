const express = require('express');
const cors = require('cors');
const path = require('path');
const BoxEstimator = require('./boxEstimator');
const GPTWebScraper = require('./gptWebScraper');
const ZyteScraper = require('./zyteScraper');

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize scrapers in priority order
const gptWebScraper = new GPTWebScraper();
const zyteScraper = new ZyteScraper();
const boxEstimator = new BoxEstimator();

// Middleware
app.use(cors());
app.use(express
).json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Enhanced scraping function with multiple methods
async function scrapeProductData(url) {
  console.log(`[Server] Starting enhanced scraping with ChatGPT-5 primary, Zyte backup for: ${url}`);
  
  // Try ChatGPT-5 first
  if (gptWebScraper.enabled) {
    try {
      console.log('[Server] Trying ChatGPT-5 scraper as primary...');
      const gptResult = await gptWebScraper.scrapeProduct(url);
      if (gptResult && gptResult.name && gptResult.price) {
        console.log('[Server] ✅ ChatGPT-5 scraping successful');
        
        // If no image from ChatGPT-5, try to get it from Zyte
        if (!gptResult.image && zyteScraper.enabled) {
          try {
            console.log('[Server] Getting image from Zyte...');
            const zyteImageResult = await zyteScraper.scrapeProduct(url);
            if (zyteImageResult && zyteImageResult.image) {
              gptResult.image = zyteImageResult.image;
              console.log('[Server] ✅ Image obtained from Zyte');
            }
          } catch (error) {
            console.log('[Server] ⚠️ Zyte image scraping failed:', error.message);
          }
        }
        
        return gptResult;
      }
    } catch (error) {
      console.log('[Server] ⚠️ ChatGPT-5 scraping failed:', error.message);
    }
  }
  
  // Try Zyte as backup for full scraping
  if (zyteScraper.enabled) {
    try {
      console.log('[Server] Trying Zyte scraper as backup...');
      const zyteResult = await zyteScraper.scrapeProduct(url);
      if (zyteResult && zyteResult.name && zyteResult.price) {
        console.log('[Server] ✅ Zyte scraping successful');
        return zyteResult;
      }
    } catch (error) {
      console.log('[Server] ⚠️ Zyte scraping failed:', error.message);
    }
  }
  
// API Routes
app.post('/api/scrape', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'URLs array is required' });
    }
  // All methods failed
    const products = [];
    for (const url of urls) {
      try {
        const productData = await scrapeProductData(url);
        
        // Estimate box dimensions if not available
        if (!productData.dimensions) {
          const boxes = boxEstimator.estimateBoxDimensions(productData);
          productData.estimatedBoxes = boxes;
          productData.dimensions = boxes[0]; // Use first box as primary dimensions
        }
        
        products.push(productData);
      } catch (error) {
        console.error(`Failed to scrape ${url}:`, error.message);
        products.push({
          url,
          error: error.message,
          name: 'Failed to load',
          price: 0
        });
      }
    }
  throw new Error('All scraping methods failed (ChatGPT-5 and Zyte)');
    res.json({ products });
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: error.message });
  }
});
}
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 ChatGPT-5 enabled: ${gptWebScraper.enabled}`);
  console.log(`🕷️ Zyte backup enabled: ${zyteScraper.enabled}`);
}