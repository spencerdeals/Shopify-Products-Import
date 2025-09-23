const express = require('express');
const cors = require('cors');
const path = require('path');
const GPTWebScraper = require('./gptWebScraper');
const ZyteScraper = require('./zyteScraper');

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize scrapers in priority order
const gptWebScraper = new GPTWebScraper();
const zyteScraper = new ZyteScraper();

// Middleware

// Enhanced scraping function with multiple methods
async function scrapeProductData(url) {
  console.log(`[Server] Starting enhanced scraping for: ${url}`);
  
  // Try GPT-4 Web Browsing first (primary)
  if (gptWebScraper.enabled) {
    try {
      console.log('[Server] Trying GPT-4 web browsing...');
      const gptResult = await gptWebScraper.scrapeProduct(url);
      if (gptResult && gptResult.name && gptResult.price) {
        console.log('[Server] ✅ GPT-4 web browsing successful');
        
        // Use Zyte to get the image if GPT didn't get one
        if (!gptResult.image && zyteScraper.enabled) {
          try {
            console.log('[Server] Getting image via Zyte...');
            const zyteResult = await zyteScraper.scrapeProduct(url);
            if (zyteResult && zyteResult.image) {
              gptResult.image = zyteResult.image;
              console.log('[Server] ✅ Image retrieved via Zyte');
            }
          } catch (imageError) {
            console.log('[Server] ⚠️ Zyte image retrieval failed:', imageError.message);
          }
        }
        
        return gptResult;
      }
    } catch (error) {
      console.log('[Server] ⚠️ GPT-4 web browsing failed:', error.message);
    }
  }
  
  // Try Zyte as backup
  if (zyteScraper.enabled) {
    try {
      console.log('[Server] Trying Zyte scraper as backup...');
      const zyteResult = await zyteScraper.scrapeProduct(url);
      if (zyteResult && zyteResult.name && zyteResult.price) {
        console.log('[Server] ✅ Zyte backup scraping successful');
        return zyteResult;
      }
    } catch (error) {
      console.log('[Server] ⚠️ Zyte backup scraping failed:', error.message);
    }
  }
  
  // All methods failed
  throw new Error('All scraping methods failed');
}