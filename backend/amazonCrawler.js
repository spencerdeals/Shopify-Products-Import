const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const { URL } = require('url');
const ApifyScraper = require('./apifyScraper');
const OrderTracker = require('./orderTracking');
const UPCItemDB = require('./upcitemdb');
const ProWebCrawler = require('./proWebCrawler');
const AmazonCrawler = require('./amazonCrawler');
require('dotenv').config();

// Import GPT parser if available, with fallback
let parseProduct;
try {
  const gptParser = require('./gptParser');
  parseProduct = gptParser.parseProduct;
  console.log('✅ GPT Parser loaded successfully');
} catch (error) {
  console.log('⚠️ GPT Parser not available:', error.message);
  parseProduct = null;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY || '';
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const BERMUDA_DUTY_RATE = 0.265;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sdl2024admin';

// Initialize services
const apifyScraper = new ApifyScraper(APIFY_API_KEY);
const upcItemDB = new UPCItemDB(UPCITEMDB_API_KEY);
const orderTracker = new OrderTracker();
const proWebCrawler = new ProWebCrawler();
const amazonCrawler = new AmazonCrawler();

const USE_APIFY = apifyScraper.isAvailable();
const USE_SCRAPINGBEE = !!SCRAPINGBEE_API_KEY;
const USE_UPCITEMDB = !!UPCITEMDB_API_KEY;
const USE_PRO_CRAWLER = proWebCrawler.isAvailable();
const USE_AMAZON_CRAWLER = amazonCrawler.isAvailable();

process.on('SIGTERM', () => {
  console.log('🛑 Server shutting down...');
  process.exit(0);
});