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

// Enhanced scraping function with multiple methods
async function scrapeProductData(url) {
  console.log(`[Server] Starting enhanced scraping for: ${url}`);
  
  // Try Zyte as backup
  if (zyteScraper.enabled) {
    try {
      console.log('[Server] Trying Zyte scraper as primary...');
      const zyteResult = await zyteScraper.scrapeProduct(url);
      if (zyteResult && zyteResult.name && zyteResult.price) {
        console.log('[Server] ✅ Zyte scraping successful');
        return zyteResult;
      }
    } catch (error) {
      console.log('[Server] ⚠️ Zyte scraping failed:', error.message);
    }
  }
  
  // All methods failed
  throw new Error('All scraping methods failed');
}