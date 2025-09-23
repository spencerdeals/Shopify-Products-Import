const express = require('express');
const cors = require('cors');
const path = require('path');
const GPTWebScraper = require('./gptWebScraper');
const ZyteScraper = require('./zyteScraper');

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize scrapers - GPT-4 primary, Zyte backup
const gptWebScraper = new GPTWebScraper();
const zyteScraper = new ZyteScraper();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Enhanced scraping function - GPT-4 primary, Zyte backup and image scraping
async function scrapeProductData(url) {
  console.log(`[Server] Starting GPT-4 primary scraping for: ${url}`);
  
  // Try GPT-4 Web Browsing first (PRIMARY)
  if (gptWebScraper.enabled) {
    try {
      console.log('[Server] 🤖 Using GPT-4 web browsing (PRIMARY)...');
      const gptResult = await gptWebScraper.scrapeProduct(url);
      if (gptResult && gptResult.name && gptResult.price) {
        console.log('[Server] ✅ GPT-4 web browsing successful!');
        
        // Use Zyte for image scraping if GPT didn't get one
        if (!gptResult.image && zyteScraper.enabled) {
          try {
            console.log('[Server] 🖼️ Getting image via Zyte...');
            const zyteResult = await zyteScraper.scrapeProduct(url);
            if (zyteResult && zyteResult.image) {
              gptResult.image = zyteResult.image;
              console.log('[Server] ✅ Image retrieved via Zyte!');
            }
          } catch (imageError) {
            console.log('[Server] ⚠️ Zyte image scraping failed:', imageError.message);
          }
        }
        
        return gptResult;
      }
    } catch (error) {
      console.log('[Server] ⚠️ GPT-4 primary scraping failed:', error.message);
    }
  }
  
  // Try Zyte as FULL BACKUP
  if (zyteScraper.enabled) {
    try {
      console.log('[Server] 🕷️ Using Zyte as FULL BACKUP...');
      const zyteResult = await zyteScraper.scrapeProduct(url);
      if (zyteResult && zyteResult.name && zyteResult.price) {
        console.log('[Server] ✅ Zyte backup scraping successful!');
        return zyteResult;
      }
    } catch (error) {
      console.log('[Server] ⚠️ Zyte backup failed:', error.message);
    }
  }
  
  // Both GPT-4 and Zyte failed
  throw new Error('Both GPT-4 and Zyte scraping failed');
}