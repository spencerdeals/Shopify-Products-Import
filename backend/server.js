const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');
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

// Initialize Turso Database
class TursoLearningDB {
    constructor() {
        if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
            console.log('⚠️ Turso not configured - falling back to memory storage');
            this.enabled = false;
            return;
        }
        
        this.enabled = true;
        this.client = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN
        });
        
        this.initializeDatabase();
    }
    
    async initializeDatabase() {
        if (!this.enabled) return;
        
        try {
            await this.client.execute(`
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT UNIQUE NOT NULL,
                    name TEXT,
                    retailer TEXT,
                    category TEXT,
                    price REAL,
                    weight REAL,
                    length REAL,
                    width REAL,
                    height REAL,
                    variant TEXT,
                    sku TEXT,
                    last_scraped DATETIME DEFAULT CURRENT_TIMESTAMP,
                    times_seen INTEGER DEFAULT 1,
                    confidence REAL DEFAULT 0.5
                )
            `);
            
            await this.client.execute(`
                CREATE TABLE IF NOT EXISTS category_patterns (
                    category TEXT PRIMARY KEY,
                    avg_weight REAL,
                    avg_length REAL,
                    avg_width REAL,
                    avg_height REAL,
                    sample_count INTEGER DEFAULT 0,
                    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            await this.client.execute(`
                CREATE TABLE IF NOT EXISTS retailer_stats (
                    retailer TEXT PRIMARY KEY,
                    total_attempts INTEGER DEFAULT 0,
                    successful_scrapes INTEGER DEFAULT 0,
                    avg_data_completeness REAL,
                    best_method TEXT,
                    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            console.log('✅ Turso learning database initialized');
        } catch (error) {
            console.error('❌ Turso initialization error:', error);
            this.enabled = false;
        }
    }
    
    async getKnownProduct(url) {
        if (!this.enabled) return null;
        
        try {
            const result = await this.client.execute({
                sql: `SELECT * FROM products 
                      WHERE url = ? 
                      AND datetime(last_scraped) > datetime('now', '-24 hours')
                      AND confidence > 0.7`,
                args: [url]
            });
            
            if (result.rows.length > 0) {
                const product = result.rows[0];
                
                await this.client.execute({
                    sql: 'UPDATE products SET times_seen = times_seen + 1 WHERE url = ?',
                    args: [url]
                });
                
                console.log('   📚 Using learned data from Turso');
                
                return {
                    name: product.name,
                    price: product.price,
                    weight: product.weight,
                    dimensions: product.length ? {
                        length: product.length,
                        width: product.width,
                        height: product.height
                    } : null,
                    variant: product.variant,
                    sku: product.sku,
                    retailer: product.retailer,
                    category: product.category,
                    fromCache: true
                };
            }
            
            return null;
        } catch (error) {
            console.error('Error getting known product:', error);
            return null;
        }
    }
    
    async saveProduct(product) {
        if (!this.enabled) return;
        
        try {
            let confidence = 0.3;
            if (product.name && product.name !== 'Unknown Product') confidence += 0.2;
            if (product.price) confidence += 0.2;
            if (product.dimensions) confidence += 0.2;
            if (product.weight) confidence += 0.1;
            
            await this.client.execute({
                sql: `INSERT INTO products 
                      (url, name, retailer, category, price, weight, length, width, height, variant, sku, confidence)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(url) DO UPDATE SET
                      name = excluded.name,
                      price = excluded.price,
                      weight = excluded.weight,
                      length = excluded.length,
                      width = excluded.width,
                      height = excluded.height,
                      variant = excluded.variant,
                      sku = excluded.sku,
                      times_seen = times_seen + 1,
                      confidence = excluded.confidence,
                      last_scraped = CURRENT_TIMESTAMP`,
                args: [
                    product.url,
                    product.name,
                    product.retailer,
                    product.category,
                    product.price,
                    product.weight,
                    product.dimensions?.length || null,
                    product.dimensions?.width || null,
                    product.dimensions?.height || null,
                    product.variant,
                    product.sku,
                    confidence
                ]
            });
            
            if (product.category && product.dimensions) {
                await this.updateCategoryPattern(product);
            }
            
            await this.updateRetailerStats(product.retailer, true);
            
        } catch (error) {
            console.error('Error saving product:', error);
        }
    }
    
    async updateCategoryPattern(product) {
        if (!this.enabled || !product.category || !product.dimensions) return;
        
        try {
            const existing = await this.client.execute({
                sql: 'SELECT * FROM category_patterns WHERE category = ?',
                args: [product.category]
            });
            
            if (existing.rows.length === 0) {
                await this.client.execute({
                    sql: `INSERT INTO category_patterns 
                          (category, avg_weight, avg_length, avg_width, avg_height, sample_count)
                          VALUES (?, ?, ?, ?, ?, 1)`,
                    args: [
                        product.category,
                        product.weight || 0,
                        product.dimensions.length || 0,
                        product.dimensions.width || 0,
                        product.dimensions.height || 0
                    ]
                });
            } else {
                const pattern = existing.rows[0];
                const newCount = pattern.sample_count + 1;
                
                await this.client.execute({
                    sql: `UPDATE category_patterns SET
                          avg_weight = ((avg_weight * sample_count) + ?) / ?,
                          avg_length = ((avg_length * sample_count) + ?) / ?,
                          avg_width = ((avg_width * sample_count) + ?) / ?,
                          avg_height = ((avg_height * sample_count) + ?) / ?,
                          sample_count = ?,
                          last_updated = CURRENT_TIMESTAMP
                          WHERE category = ?`,
                    args: [
                        product.weight || pattern.avg_weight, newCount,
                        product.dimensions.length || pattern.avg_length, newCount,
                        product.dimensions.width || pattern.avg_width, newCount,
                        product.dimensions.height || pattern.avg_height, newCount,
                        newCount,
                        product.category
                    ]
                });
            }
        } catch (error) {
            console.error('Error updating category pattern:', error);
        }
    }
    
    async updateRetailerStats(retailer, success) {
        if (!this.enabled) return;
        
        try {
            const existing = await this.client.execute({
                sql: 'SELECT * FROM retailer_stats WHERE retailer = ?',
                args: [retailer]
            });
            
            if (existing.rows.length === 0) {
                await this.client.execute({
                    sql: `INSERT INTO retailer_stats 
                          (retailer, total_attempts, successful_scrapes)
                          VALUES (?, 1, ?)`,
                    args: [retailer, success ? 1 : 0]
                });
            } else {
                await this.client.execute({
                    sql: `UPDATE retailer_stats SET
                          total_attempts = total_attempts + 1,
                          successful_scrapes = successful_scrapes + ?,
                          last_updated = CURRENT_TIMESTAMP
                          WHERE retailer = ?`,
                    args: [success ? 1 : 0, retailer]
                });
            }
        } catch (error) {
            console.error('Error updating retailer stats:', error);
        }
    }
    
    async getSmartEstimation(category, retailer) {
        if (!this.enabled) return null;
        
        try {
            const result = await this.client.execute({
                sql: 'SELECT * FROM category_patterns WHERE category = ? AND sample_count > 5',
                args: [category]
            });
            
            if (result.rows.length > 0) {
                const pattern = result.rows[0];
                console.log(`   🤖 Using AI patterns from ${pattern.sample_count} ${category} products`);
                
                return {
                    dimensions: {
                        length: Math.round(pattern.avg_length),
                        width: Math.round(pattern.avg_width),
                        height: Math.round(pattern.avg_height)
                    },
                    weight: Math.round(pattern.avg_weight),
                    confidence: Math.min(0.9, 0.3 + (pattern.sample_count * 0.02)),
                    source: 'turso_patterns'
                };
            }
            
            return null;
        } catch (error) {
            console.error('Error getting smart estimation:', error);
            return null;
        }
    }
}

const learningDB = new TursoLearningDB();

// BOL-BASED SHIPPING PATTERNS
const BOL_PATTERNS = {
  furniture: {
    avgWeight: 348,
    avgCubicFeet: 49.5,
    dimensions: {
      sofa: { length: 84, width: 38, height: 36, weight: 185 },
      chair: { length: 36, width: 32, height: 38, weight: 65 },
      table: { length: 60, width: 36, height: 30, weight: 120 },
      dresser: { length: 60, width: 20, height: 48, weight: 250 },
      mattress: { length: 80, width: 60, height: 12, weight: 100 },
      cabinet: { length: 36, width: 18, height: 72, weight: 150 },
      default: { length: 48, width: 30, height: 36, weight: 150 }
    }
  },
  electronics: {
    avgWeight: 45,
    avgCubicFeet: 12,
    dimensions: {
      tv: { length: 55, width: 8, height: 35, weight: 45 },
      default: { length: 24, width: 18, height: 20, weight: 35 }
    }
  },
  appliances: {
    avgWeight: 220,
    avgCubicFeet: 55,
    dimensions: {
      refrigerator: { length: 36, width: 36, height: 70, weight: 350 },
      washer: { length: 30, width: 30, height: 40, weight: 200 },
      default: { length: 32, width: 32, height: 48, weight: 180 }
    }
  },
  toys: {
    avgWeight: 15,
    avgCubicFeet: 8,
    dimensions: {
      default: { length: 20, width: 16, height: 14, weight: 10 }
    }
  },
  clothing: {
    avgWeight: 5,
    avgCubicFeet: 3,
    dimensions: {
      default: { length: 14, width: 12, height: 4, weight: 3 }
    }
  },
  general: {
    avgWeight: 75,
    avgCubicFeet: 25,
    dimensions: {
      default: { length: 24, width: 20, height: 18, weight: 50 }
    }
  }
};

console.log('=== SDL IMPORT CALCULATOR SERVER ===');
console.log(`Environment: ${TEST_MODE ? 'TEST' : 'PRODUCTION'}`);
console.log(`Port: ${PORT}`);
console.log(`Shopify: ${SHOPIFY_ACCESS_TOKEN ? 'CONNECTED' : 'NOT CONFIGURED'}`);
console.log(`Email: ${sendgrid ? 'ENABLED' : 'DISABLED'}`);
console.log(`Turso Learning DB: ${learningDB.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`UPCitemdb: ${USE_UPCITEMDB ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`Apify: ${ENABLE_APIFY && apifyClient ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`ScrapingBee: ${SCRAPINGBEE_API_KEY ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log('Margin: FIXED 15% + 3.5% card fee (hidden)');
console.log('Flat-Pack Intelligence: ENABLED');
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

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));

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
      tursoLearning: learningDB.enabled,
      upcitemdb: USE_UPCITEMDB,
      apify: !!apifyClient,
      scrapingBee: !!SCRAPINGBEE_API_KEY
    }
  });
});

// Rate limiters
const scrapeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many scraping requests',
  trustProxy: true
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

function categorizeProduct(name, url) {
  const text = (name + ' ' + url).toLowerCase();
  
  if (/\b(sofa|couch|chair|recliner|ottoman|table|desk|dresser|bed|mattress|furniture|dining|patio|console|buffet|cabinet|shelf|bookcase)\b/.test(text)) return 'furniture';
  if (/\b(tv|television|monitor|laptop|computer|tablet|phone|camera|speaker|headphone|electronic)\b/.test(text)) return 'electronics';
  if (/\b(refrigerator|fridge|washer|dryer|dishwasher|microwave|oven|stove|appliance)\b/.test(text)) return 'appliances';
  if (/\b(toy|game|puzzle|doll|lego|playset|bounce|slide|tikes)\b/.test(text)) return 'toys';
  if (/\b(shirt|pants|dress|jacket|shoes|clothing|apparel|wear)\b/.test(text)) return 'clothing';
  return 'general';
}

// FLAT-PACK INTELLIGENCE SYSTEM
function isFlatPackable(category, productName, retailer) {
  const name = productName.toLowerCase();
  
  const nonFlatPackable = [
    'refrigerator', 'fridge', 'washer', 'dryer', 'dishwasher', 
    'oven', 'stove', 'range', 'microwave',
    'mattress', 'box spring',
    'tv', 'television', 'monitor', 'computer',
    'sofa', 'couch', 'loveseat', 'recliner', 'sectional',
    'upholstered', 'ottoman'
  ];
  
  if (nonFlatPackable.some(item => name.includes(item))) {
    return false;
  }
  
  const flatPackRetailers = [
    'Wayfair', 'IKEA', 'Amazon', 'Target', 'Walmart', 
    'Overstock', 'Home Depot', 'Lowes', 'CB2', 
    'West Elm', 'Article', 'Ashley Furniture'
  ];
  
  const flatPackableItems = [
    'table', 'desk', 'console', 'buffet', 'sideboard',
    'bookshelf', 'shelf', 'shelving', 'cabinet', 'dresser',
    'nightstand', 'end table', 'coffee table', 'dining',
    'chair', 'stool', 'bench', 'bed frame', 'headboard',
    'wardrobe', 'armoire', 'vanity', 'cart', 'stand',
    'entertainment center', 'tv stand', 'media console',
    'patio', 'outdoor', 'garden', 'deck', 'gazebo',
    'filing', 'office', 'workstation',
    'storage', 'organizer', 'rack', 'tower'
  ];
  
  if (category === 'furniture') {
    if (flatPackRetailers.includes(retailer)) {
      if (flatPackableItems.some(item => name.includes(item))) {
        return true;
      }
    }
  }
  
  const flatPackKeywords = [
    'assembly required', 'requires assembly', 'easy assembly',
    'flat pack', 'flat-pack', 'flatpack', 'knockdown',
    'ready to assemble', 'rta', 'diy'
  ];
  
  if (flatPackKeywords.some(keyword => name.includes(keyword))) {
    return true;
  }
  
  if (category === 'furniture' && flatPackRetailers.includes(retailer)) {
    return true;
  }
  
  return false;
}

function calculateFlatPackDimensions(originalDimensions, productName) {
  const name = productName.toLowerCase();
  
  let reductionProfile = {
    length: 1.0,
    width: 1.0,
    height: 0.15
  };
  
  if (name.includes('table') || name.includes('desk') || name.includes('console') || name.includes('buffet')) {
    reductionProfile = {
      length: Math.min(originalDimensions.length, 72),
      width: originalDimensions.width * 1.0,
      height: Math.max(6, originalDimensions.height * 0.12)
    };
  } else if (name.includes('chair') || name.includes('stool')) {
    reductionProfile = {
      length: originalDimensions.length * 0.8,
      width: originalDimensions.width * 0.8,
      height: Math.max(8, originalDimensions.height * 0.25)
    };
  } else if (name.includes('shelf') || name.includes('bookcase') || name.includes('bookshelf')) {
    reductionProfile = {
      length: originalDimensions.length * 1.0,
      width: Math.max(12, originalDimensions.width * 0.3),
      height: Math.max(4, originalDimensions.height * 0.1)
    };
  } else if (name.includes('dresser') || name.includes('cabinet') || name.includes('wardrobe')) {
    reductionProfile = {
      length: originalDimensions.length * 0.9,
      width: originalDimensions.width * 1.0,
      height: Math.max(8, originalDimensions.height * 0.15)
    };
  } else if (name.includes('bed')) {
    reductionProfile = {
      length: Math.min(originalDimensions.length * 0.9, 84),
      width: originalDimensions.width * 0.5,
      height: Math.max(6, originalDimensions.height * 0.2)
    };
  }
  
  const flatPackDims = {
    length: Math.round(reductionProfile.length),
    width: Math.round(reductionProfile.width),
    height: Math.round(reductionProfile.height)
  };
  
  flatPackDims.length = Math.max(3, flatPackDims.length);
  flatPackDims.width = Math.max(3, flatPackDims.width);
  flatPackDims.height = Math.max(3, flatPackDims.height);
  
  console.log(`   📦 Flat-pack: ${originalDimensions.length}x${originalDimensions.width}x${originalDimensions.height} → ${flatPackDims.length}x${flatPackDims.width}x${flatPackDims.height}`);
  
  return flatPackDims;
}

function adjustFlatPackWeight(originalWeight, category) {
  if (category === 'furniture') {
    return Math.round(originalWeight * 0.85);
  }
  return originalWeight;
}

async function estimateDimensionsFromPatterns(category, name, retailer) {
  // First try Turso learned patterns
  const smartEstimate = await learningDB.getSmartEstimation(category, retailer);
  if (smartEstimate) {
    return smartEstimate.dimensions;
  }
  
  // Fall back to BOL patterns
  const text = name.toLowerCase();
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  
  if (category === 'furniture') {
    if (text.includes('sofa') || text.includes('couch')) return patterns.dimensions.sofa;
    if (text.includes('chair')) return patterns.dimensions.chair;
    if (text.includes('table')) return patterns.dimensions.table;
    if (text.includes('dresser')) return patterns.dimensions.dresser;
    if (text.includes('mattress')) return patterns.dimensions.mattress;
    if (text.includes('cabinet')) return patterns.dimensions.cabinet;
  }
  
  const dims = patterns.dimensions.default;
  const variance = 0.85 + Math.random() * 0.3;
  
  return {
    length: Math.round(dims.length * variance),
    width: Math.round(dims.width * variance),
    height: Math.round(dims.height * variance)
  };
}

async function estimateWeightFromPatterns(dimensions, category, retailer) {
  // First try Turso learned patterns
  const smartEstimate = await learningDB.getSmartEstimation(category, retailer);
  if (smartEstimate && smartEstimate.weight) {
    return smartEstimate.weight;
  }
  
  // Fall back to BOL patterns
  const patterns = BOL_PATTERNS[category] || BOL_PATTERNS.general;
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  const weightPerCubic = patterns.avgWeight / patterns.avgCubicFeet;
  const estimatedWeight = Math.max(10, cubicFeet * weightPerCubic);
  return Math.round(estimatedWeight);
}

// SIMPLIFIED SHIPPING CALCULATION
function calculateShippingCost(dimensions, weight, price) {
  if (!dimensions) {
    return Math.round(Math.max(25, price * 0.08));
  }
  
  const cubicInches = dimensions.length * dimensions.width * dimensions.height;
  const cubicFeet = cubicInches / 1728;
  
  // Base ocean freight cost
  const baseCost = Math.max(15, cubicFeet * SHIPPING_RATE_PER_CUBIC_FOOT);
  
  // Heavy weight fee only (removed oversize and value fees)
  const heavyWeightFee = weight > 150 ? weight * 0.25 : 0;
  
  // Handling fee
  const handlingFee = 15;
  
  // Calculate base shipping
  const baseShipping = baseCost + heavyWeightFee + handlingFee;
  
  // Add SDL margin (15%)
  const marginAmount = baseShipping * SDL_MARGIN_RATE;
  
  // Calculate total order value for card fee
  const estimatedTotal = price + (price * BERMUDA_DUTY_RATE) + baseShipping + marginAmount;
  
  // Add hidden credit card fee (3.5% of estimated total)
  const cardFee = estimatedTotal * CARD_FEE_RATE;
  
  // Total shipping includes margin and hidden card fee
  const totalShipping = Math.round(baseShipping + marginAmount + cardFee);
  
  return totalShipping;
}

// ENHANCED SCRAPING WITH ALL METHODS
async function scrapeWithScrapingBee(url) {
  if (TEST_MODE) {
    return {
      price: 99.99,
      title: 'Test Product',
      image: 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=Test',
      variant: 'Test Variant',
      sku: 'TEST-SKU-123'
    };
  }
  
  const retailer = detectRetailer(url);
  
  // Try Apify for Wayfair
  if (retailer === 'Wayfair' && ENABLE_APIFY && apifyClient) {
    try {
      console.log('   🔄 Using Apify for Wayfair...');
      
      const run = await apifyClient.actor('123webdata/wayfair-scraper').call({
        productUrls: [url],
        includeOptionDetails: true,
        includeAllImages: true,
        proxy: {
          useApifyProxy: true,
          apifyProxyCountry: 'US'
        }
      });
      
      const result = await apifyClient.run(run.id).waitForFinish({ waitSecs: 30 });
      const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
      
      if (items && items.length > 0) {
        const item = items[0];
        console.log('   ✅ Apify success');
        
        return {
          price: parseFloat((item.price || item.salePrice || '0').toString().replace(/[^0-9.]/g, '')),
          title: item.title || 'Wayfair Product',
          image: item.images?.[0] || item.image,
          variant: item.selectedOptions ? Object.values(item.selectedOptions).join(', ') : null,
          sku: item.sku || item.productId
        };
      }
    } catch (error) {
      console.log('   ⚠️ Apify failed:', error.message);
    }
  }
  
  // Fall back to ScrapingBee
  try {
    console.log('   🐝 Using ScrapingBee...');
    
    const response = await axios({
      method: 'GET',
      url: 'https://app.scrapingbee.com/api/v1',
      params: {
        api_key: SCRAPINGBEE_API_KEY,
        url: url,
        premium_proxy: 'true',
        country_code: 'us',
        render_js: 'true',
        wait: '3000',
        ai_extract_rules: JSON.stringify({
          price: "Product Price or Sale Price in USD",
          title: "Product Title or Name",
          variant: "Selected options, color, size, or configuration",
          image: "Main Product Image URL",
          sku: "SKU, Product ID, or Item Number"
        })
      },
      timeout: 20000
    });
    
    const data = response.data;
    
    return {
      price: data.price ? parseFloat(data.price.toString().replace(/[^0-9.]/g, '')) : null,
      title: data.title || 'Product',
      image: data.image,
      variant: data.variant,
      sku: data.sku
    };
    
  } catch (error) {
    console.log('   ❌ ScrapingBee failed:', error.message);
    return {
      price: null,
      title: 'Product from ' + retailer,
      image: null,
      variant: null,
      sku: null
    };
  }
}

// Main product processing with all integrations
async function processProduct(url, index, urls) {
  console.log(`[${index + 1}/${urls.length}] Processing: ${url.substring(0, 80)}...`);
  
  const retailer = detectRetailer(url);
  console.log(`   Retailer: ${retailer}`);
  
  // Step 1: Check Turso for learned data
  const learned = await learningDB.getKnownProduct(url);
  if (learned && learned.price) {
    console.log('   📚 Using cached data from Turso');
    return { ...learned, shippingCost: calculateShippingCost(learned.dimensions, learned.weight, learned.price) };
  }
  
  // Step 2: Scrape with Apify/ScrapingBee
  const scraped = await scrapeWithScrapingBee(url);
  const productName = scraped.title || `${retailer} Product ${index + 1}`;
  const category = categorizeProduct(productName, url);
  
  // Step 3: Try UPCitemdb for missing dimensions/weight
  let dimensions = null;
  let weight = null;
  
  if (USE_UPCITEMDB && productName && (!scraped.dimensions || !scraped.weight)) {
    try {
      console.log('   🔍 Checking UPCitemdb...');
      const upcData = await upcItemDB.searchByName(productName);
      
      if (upcData) {
        if (upcData.dimensions) {
          // Add packaging buffer
          dimensions = {
            length: Math.round(upcData.dimensions.length * 1.25),
            width: Math.round(upcData.dimensions.width * 1.25),
            height: Math.round(upcData.dimensions.height * 1.25)
          };
          console.log('   ✅ UPCitemdb provided dimensions');
        }
        if (upcData.weight) {
          weight = upcData.weight;
          console.log('   ✅ UPCitemdb provided weight');
        }
      }
    } catch (error) {
      console.log('   ⚠️ UPCitemdb lookup failed');
    }
  }
  
  // Step 4: Use AI estimation for missing data
  if (!dimensions) {
    dimensions = await estimateDimensionsFromPatterns(category, productName, retailer);
    console.log('   📐 Estimated dimensions from patterns');
  }
  
  if (!weight) {
    weight = await estimateWeightFromPatterns(dimensions, category, retailer);
    console.log('   ⚖️ Estimated weight from patterns');
  }
  
  // Step 5: Apply flat-pack reduction if applicable
  let packaging = 'ASSEMBLED';
  const isFlatPack = isFlatPackable(category, productName, retailer);
  if (isFlatPack) {
    console.log(`   📦 FLAT-PACK DETECTED`);
    dimensions = calculateFlatPackDimensions(dimensions, productName);
    weight = adjustFlatPackWeight(weight, category);
    packaging = 'FLAT-PACK';
  }
  
  // Step 6: Calculate shipping with hidden fees
  const shippingCost = calculateShippingCost(dimensions, weight, scraped.price || 100);
  
  const product = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    url: url,
    name: productName,
    variant: scraped.variant || null,
    thumbnail: scraped.thumbnail || scraped.image,
    sku: scraped.sku || null,
    price: scraped.price,
    image: scraped.image || 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=No+Image',
    category: category,
    retailer: retailer,
    dimensions: dimensions,
    weight: weight,
    isFlatPack: isFlatPack,
    packaging: packaging,
    shippingCost: shippingCost,
    dataCompleteness: {
      hasName: !!scraped.title,
      hasPrice: !!scraped.price,
      hasImage: !!scraped.image,
      hasDimensions: !!scraped.dimensions,
      hasWeight: !!scraped.weight,
      hasVariant: !!scraped.variant,
      hasSku: !!scraped.sku
    },
    fromCache: false
  };
  
  const cubicFeet = (dimensions.length * dimensions.width * dimensions.height) / 1728;
  console.log(`   Price: ${scraped.price ? '$' + scraped.price : 'Not found'}`);
  console.log(`   Variant: ${scraped.variant || 'Not specified'}`);
  console.log(`   Packaging: ${packaging}`);
  console.log(`   Volume: ${cubicFeet.toFixed(1)} ft³`);
  console.log(`   Weight: ${weight} lbs`);
  console.log(`   Shipping: $${shippingCost} (includes 15% margin + 3.5% card fee)`);
  
  // Step 7: Save to Turso for future learning
  await learningDB.saveProduct(product);
  
  return product;
}

// Scrape products endpoint
app.post('/api/scrape', scrapeRateLimiter, async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'No URLs provided' });
    }
    
    const sdlUrls = urls.filter(url => isSDLDomain(url));
    if (sdlUrls.length > 0) {
      return res.status(400).json({ 
        error: 'SDL domain detected. This calculator is for importing products from other retailers.' 
      });
    }
    
    console.log(`\n========================================`);
    console.log(`SCRAPING ${urls.length} PRODUCTS`);
    console.log(`========================================\n`);
    
    const products = [];
    
    for (let i = 0; i < urls.length; i++) {
      try {
        const product = await processProduct(urls[i], i, urls);
        products.push(product);
      } catch (error) {
        console.error(`   ❌ Failed to process: ${error.message}`);
        
        const retailer = detectRetailer(urls[i]);
        products.push({
          id: Date.now() + Math.random().toString(36).substr(2, 9),
          url: urls[i],
          name: 'Product from ' + retailer,
          variant: null,
          price: null,
          image: 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=Not+Found',
          category: 'general',
          retailer: retailer,
          dimensions: await estimateDimensionsFromPatterns('general', '', retailer),
          weight: 50,
          shippingCost: 60,
          dataCompleteness: {
            hasName: false,
            hasPrice: false,
            hasImage: false,
            hasDimensions: false,
            hasWeight: false,
            hasVariant: false
          },
          error: true,
          fromCache: false
        });
      }
    }
    
    const successful = products.filter(p => p.price).length;
    const fromCache = products.filter(p => p.fromCache).length;
    const flatPacked = products.filter(p => p.isFlatPack).length;
    const withVariants = products.filter(p => p.variant).length;
    
    console.log(`\n========================================`);
    console.log(`RESULTS: ${products.length} products processed`);
    console.log(`   Scraped: ${successful - fromCache}`);
    console.log(`   From Turso cache: ${fromCache}`);
    console.log(`   Failed: ${products.length - successful}`);
    console.log(`   Flat-packed: ${flatPacked}`);
    console.log(`   With variants: ${withVariants}`);
    console.log(`========================================\n`);
    
    res.json({ 
      products,
      summary: {
        total: products.length,
        successful: successful,
        fromCache: fromCache,
        failed: products.length - successful,
        flatPacked: flatPacked,
        withVariants: withVariants
      }
    });
    
  } catch (error) {
    console.error('❌ Scraping endpoint error:', error);
    res.status(500).json({ 
      error: 'Failed to scrape products',
      message: error.message 
    });
  }
});

// Prepare Shopify checkout endpoint
app.post('/api/prepare-shopify-checkout', async (req, res) => {
  try {
    const checkoutId = generateOrderId();
    
    // Return checkout URL for redirect
    const redirectUrl = `https://${SHOPIFY_DOMAIN}/pages/import-checkout?checkout=${checkoutId}`;
    
    res.json({
      checkoutId: checkoutId,
      redirectUrl: redirectUrl
    });
    
  } catch (error) {
    console.error('Error preparing checkout:', error);
    res.status(500).json({ error: 'Failed to prepare checkout' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health\n`);
});
