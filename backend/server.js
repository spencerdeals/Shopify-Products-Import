const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || 'spencer-deals-ltd.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sdl2024admin';
const BERMUDA_DUTY_RATE = 0.265;
const SHIPPING_RATE_PER_CUBIC_FOOT = 6;
const SDL_MARGIN_RATE = 0.15; // Fixed 15%
const CARD_FEE_RATE = 0.035; // 3.5% credit card fee (hidden in shipping)
const TEST_MODE = process.env.TEST_MODE === 'true';
const DOCUMENTATION_FEE_PER_VENDOR = 10;

// Email configuration
const EMAIL_FROM = process.env.EMAIL_FROM || 'orders@sdl.bm';
const EMAIL_TO_ADMIN = process.env.EMAIL_TO_ADMIN || 'admin@sdl.bm';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';

// Load optional APIs
let sendgrid = null;

// Apify configuration
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';
const ENABLE_APIFY = true;

// UPCitemdb configuration
const UPCItemDB = require('./upcitemdb');
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY || '';
const upcItemDB = new UPCItemDB(UPCITEMDB_API_KEY);
const USE_UPCITEMDB = !!UPCITEMDB_API_KEY;

// Initialize Apify
let apifyClient = null;
try {
  if (ENABLE_APIFY && APIFY_API_KEY) {
    const { ApifyClient } = require('apify-client');
    apifyClient = new ApifyClient({ token: APIFY_API_KEY });
    console.log('✅ Apify initialized for enhanced scraping');
  }
} catch (error) {
  console.log('⚠️ Apify client not available:', error.message);
}

if (SENDGRID_API_KEY) {
  try {
    sendgrid = require('@sendgrid/mail');
    sendgrid.setApiKey(SENDGRID_API_KEY);
    console.log('✅ SendGrid email configured');
  } catch (error) {
    console.log('⚠️ SendGrid not installed');
  }
}

// Simple learning database (JSON file fallback)
const LEARNING_DB_PATH = path.join(__dirname, 'learning_data.json');
let LEARNING_DB = {
  products: {},
  patterns: {},
  retailer_stats: {}
};

try {
  if (fs.existsSync(LEARNING_DB_PATH)) {
    LEARNING_DB = JSON.parse(fs.readFileSync(LEARNING_DB_PATH, 'utf8'));
    console.log('✅ Loaded learning database with', Object.keys(LEARNING_DB.products).length, 'products');
  }
} catch (error) {
  console.log('📝 Starting with fresh learning database');
}

function saveLearningDB() {
  try {
    fs.writeFileSync(LEARNING_DB_PATH, JSON.stringify(LEARNING_DB, null, 2));
  } catch (error) {
    console.error('Error saving learning database:', error);
  }
}

console.log('=== SDL IMPORT CALCULATOR SERVER ===');
console.log(`Environment: ${TEST_MODE ? 'TEST' : 'PRODUCTION'}`);
console.log(`Port: ${PORT}`);
console.log(`Shopify: ${SHOPIFY_ACCESS_TOKEN ? 'CONNECTED' : 'NOT CONFIGURED'}`);
console.log(`Email: ${sendgrid ? 'ENABLED' : 'DISABLED'}`);
console.log(`UPCitemdb: ${USE_UPCITEMDB ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`Apify: ${ENABLE_APIFY && apifyClient ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`ScrapingBee: ${SCRAPINGBEE_API_KEY ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log('Margin: FIXED 15% + 3.5% card fee (hidden)');
console.log('====================================\n');

// Middleware
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', true);

// Security headers for iframe embedding
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Debug: Check what files exist
console.log('Current directory:', __dirname);
console.log('Looking for frontend at:', path.join(__dirname, '../frontend'));
try {
  const frontendPath = path.join(__dirname, '../frontend');
  if (fs.existsSync(frontendPath)) {
    const files = fs.readdirSync(frontendPath);
    console.log('Frontend files found:', files);
  } else {
    console.log('❌ Frontend directory not found at expected location');
  }
} catch (err) {
  console.error('Error checking frontend directory:', err);
}

// CRITICAL: ROOT ROUTE MUST BE FIRST - BEFORE ANY STATIC MIDDLEWARE
app.get('/', (req, res) => {
  console.log('Root route handler triggered');
  const indexPath = path.join(__dirname, '../frontend/index.html');
  
  console.log('Attempting to serve:', indexPath);
  console.log('File exists?', fs.existsSync(indexPath));
  
  if (fs.existsSync(indexPath)) {
    res.type('html');
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend index.html not found at: ' + indexPath);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: TEST_MODE ? 'test' : 'production',
    marginStructure: 'fixed-15%',
    cardFee: '3.5% (hidden)',
    services: {
      shopify: !!SHOPIFY_ACCESS_TOKEN,
      upcitemdb: USE_UPCITEMDB,
      apify: !!apifyClient,
      scrapingBee: !!SCRAPINGBEE_API_KEY
    }
  });
});

// NOW serve static files for CSS, JS, images
app.use(express.static(path.join(__dirname, '../frontend')));

// Rate limiters
const scrapeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many scraping requests',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'default'
});

// Utilities
function generateOrderId() {
  return 'SDL' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

function detectRetailer(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    
    if (domain.includes('amazon.com')) return 'Amazon';
    if (domain.includes('wayfair.com')) return 'Wayfair';
    if (domain.includes('walmart.com')) return 'Walmart';
    if (domain.includes('target.com')) return 'Target';
    if (domain.includes('bestbuy.com')) return 'Best Buy';
    if (domain.includes('homedepot.com')) return 'Home Depot';
    if (domain.includes('lowes.com')) return 'Lowes';
    if (domain.includes('costco.com')) return 'Costco';
    if (domain.includes('ikea.com')) return 'IKEA';
    if (domain.includes('overstock.com')) return 'Overstock';
    if (domain.includes('crateandbarrel.com')) return 'Crate & Barrel';
    if (domain.includes('potterybarn.com')) return 'Pottery Barn';
    if (domain.includes('westelm.com')) return 'West Elm';
    if (domain.includes('cb2.com')) return 'CB2';
    if (domain.includes('article.com')) return 'Article';
    if (domain.includes('ashleyfurniture.com')) return 'Ashley Furniture';
    
    return 'Other Retailer';
  } catch (e) {
    return 'Unknown Retailer';
  }
}

function isSDLDomain(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    const blockedPatterns = ['spencer-deals-ltd.myshopify.com', 'sdl.bm', 'spencer-deals'];
    return blockedPatterns.some(pattern => domain.includes(pattern));
  } catch (e) {
    return false;
  }
}

// INTELLIGENT PRODUCT ANALYSIS SYSTEM
function analyzeProductIntelligently(name, category, retailer) {
  const analysis = {
    productType: null,
    estimatedDimensions: null,
    estimatedWeight: null,
    confidence: 0,
    isFlatPackLikely: false,
    reasoning: []
  };
  
  const nameLower = name.toLowerCase();
  
  // EXTRACT DIMENSIONS FROM NAME (many products have dimensions in title)
  const dimPattern = /(\d+(?:\.\d+)?)\s*(?:"|''|inches?|in)?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:"|''|inches?|in)?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:"|''|inches?|in)?/;
  const dimMatch = name.match(dimPattern);
  
  if (dimMatch) {
    analysis.estimatedDimensions = {
      length: parseFloat(dimMatch[1]),
      width: parseFloat(dimMatch[2]),
      height: parseFloat(dimMatch[3])
    };
    analysis.confidence = 0.9;
    analysis.reasoning.push('Dimensions found in product name');
  }
  
  // SPECIFIC PRODUCT TYPE DETECTION
  if (nameLower.includes('bar stool') || nameLower.includes('counter stool')) {
    analysis.productType = 'bar-stool';
    if (!analysis.estimatedDimensions) {
      analysis.estimatedDimensions = { length: 18, width: 18, height: 30 };
      analysis.estimatedWeight = 25;
    }
  } else if (nameLower.includes('5 piece') && (nameLower.includes('patio') || nameLower.includes('rattan'))) {
    analysis.productType = 'patio-set-5pc';
    analysis.isFlatPackLikely = true;
    if (!analysis.estimatedDimensions) {
      // Flat-packed patio set
      analysis.estimatedDimensions = { length: 48, width: 36, height: 12 };
      analysis.estimatedWeight = 120;
    }
  } else if (nameLower.includes('sofa') && nameLower.includes('seating group')) {
    analysis.productType = 'outdoor-sofa-set';
    analysis.isFlatPackLikely = true;
    if (!analysis.estimatedDimensions) {
      analysis.estimatedDimensions = { length: 50, width: 40, height: 14 };
      analysis.estimatedWeight = 140;
    }
  } else if (nameLower.includes('chair') && !nameLower.includes('stool')) {
    analysis.productType = 'chair';
    if (!analysis.estimatedDimensions) {
      analysis.estimatedDimensions = { length: 28, width: 28, height: 35 };
      analysis.estimatedWeight = 35;
    }
  } else if (nameLower.includes('table')) {
    analysis.productType = 'table';
    if (!analysis.estimatedDimensions) {
      analysis.estimatedDimensions = { length: 48, width: 30, height: 30 };
      analysis.estimatedWeight = 60;
    }
  }
