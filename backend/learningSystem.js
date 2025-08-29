// backend/learningSystem.js - In-Memory Database Version
const fs = require('fs');
const path = require('path');

// Initialize in-memory database (compatible with WebContainer)
const dbPath = path.join(__dirname, 'learning.json');
let db = {
  products: [],
  category_patterns: [],
  retailer_patterns: [],
  scraping_failures: []
};

// Load existing data if available
try {
  if (fs.existsSync(dbPath)) {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
} catch (error) {
  console.log('Starting with fresh database');
}

// Save database to file
function saveDatabase() {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

console.log('🔄 Connecting to JSON database...');

// Initialize database tables
async function initDatabase() {
  try {
    // Initialize arrays if they don't exist
    if (!db.products) db.products = [];
    if (!db.category_patterns) db.category_patterns = [];
    if (!db.retailer_patterns) db.retailer_patterns = [];
    if (!db.scraping_failures) db.scraping_failures = [];
    
    console.log('✅ JSON AI Learning Database initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Initialize on startup
initDatabase();

class LearningSystem {
  // Check if we've seen this exact product before
  async getKnownProduct(url) {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const product = db.products.find(p => 
        p.url === url && 
        new Date(p.last_updated) > thirtyDaysAgo && 
        p.confidence > 0.7
      );

      if (product) {
        
        // Increase confidence each time we successfully retrieve
        product.times_seen = (product.times_seen || 1) + 1;
        product.confidence = Math.min(1.0, product.confidence + 0.05);
        saveDatabase();
        
        return product;
      }
      return null;
    } catch (error) {
      console.error('Error getting known product:', error);
      return null;
    }
  }

  // Save successful scrape for future learning
  async saveProduct(product) {
    try {
      const { url, name, retailer, category, price, weight, dimensions, image, scrapingMethod } = product;
      
      // Calculate confidence based on data completeness
      let confidence = 0.3;
      if (name && name !== 'Unknown Product') confidence += 0.2;
      if (price) confidence += 0.2;
      if (dimensions && dimensions.length > 0) confidence += 0.2;
      if (weight) confidence += 0.1;
      
      // Check if product exists  
      const existingIndex = db.products.findIndex(p => p.url === url);
      const existing = existingIndex >= 0 ? db.products[existingIndex] : null;
      
      const timesSeen = existing ? existing.times_seen + 1 : 1;
      
      const productData = {
        id: existing ? existing.id : Date.now(),
        url, name, retailer, category, price, weight,
        length: dimensions?.length || 0,
        width: dimensions?.width || 0, 
        height: dimensions?.height || 0,
        image, scrape_method: scrapingMethod, confidence, times_seen: timesSeen,
        last_updated: new Date().toISOString()
      };
      
      if (existingIndex >= 0) {
        db.products[existingIndex] = productData;
      } else {
        db.products.push(productData);
      }
      
      saveDatabase();
      
      // Update category patterns
      await this.updateCategoryPatterns(category, dimensions, weight, price);
      
      // Update retailer success
      await this.updateRetailerSuccess(retailer, scrapingMethod, confidence > 0.5);
      
    } catch (error) {
      console.error('Error saving product:', error);
    }
  }

  // Update category averages for better future estimates
  async updateCategoryPatterns(category, dimensions, weight, price) {
    if (!category) return;

    try {
      const existingIndex = db.category_patterns.findIndex(p => p.category === category);
      const existing = existingIndex >= 0 ? db.category_patterns[existingIndex] : null;

      if (!existing) {
        // First time seeing this category
        const newPattern = {
          category,
          avg_weight: weight || 0,
          avg_length: dimensions?.length || 0,
          avg_width: dimensions?.width || 0,
          avg_height: dimensions?.height || 0,
          min_weight: weight || 0,
          max_weight: weight || 999999,
          min_price: price || 0,
          max_price: price || 999999,
          sample_count: 1
        };
        db.category_patterns.push(newPattern);
      } else {
        // Update running averages
        const count = existing.sample_count;
        const newCount = count + 1;
        
        existing.avg_weight = ((existing.avg_weight * count) + (weight || existing.avg_weight)) / newCount;
        existing.avg_length = ((existing.avg_length * count) + (dimensions?.length || existing.avg_length)) / newCount;
        existing.avg_width = ((existing.avg_width * count) + (dimensions?.width || existing.avg_width)) / newCount;
        existing.avg_height = ((existing.avg_height * count) + (dimensions?.height || existing.avg_height)) / newCount;
        existing.min_weight = Math.min(existing.min_weight, weight || existing.min_weight);
        existing.max_weight = Math.max(existing.max_weight, weight || existing.max_weight);
        existing.min_price = Math.min(existing.min_price, price || existing.min_price);
        existing.max_price = Math.max(existing.max_price, price || existing.max_price);
        existing.sample_count = newCount;
      }
      
      saveDatabase();
    } catch (error) {
      console.error('Error updating category patterns:', error);
    }
  }

  // Track which scraping methods work best for each retailer
  async updateRetailerSuccess(retailer, method, wasSuccessful) {
    try {
      const existingIndex = db.retailer_patterns.findIndex(p => p.retailer === retailer);
      const existing = existingIndex >= 0 ? db.retailer_patterns[existingIndex] : null;

      if (!existing) {
        const newPattern = {
          retailer,
          success_rate: wasSuccessful ? 100 : 0,
          best_method: method,
          total_attempts: 1,
          successful_scrapes: wasSuccessful ? 1 : 0
        };
        db.retailer_patterns.push(newPattern);
      } else {
        const newTotal = existing.total_attempts + 1;
        const newSuccess = existing.successful_scrapes + (wasSuccessful ? 1 : 0);
        const newRate = (newSuccess / newTotal) * 100;
        
        existing.success_rate = newRate;
        if (wasSuccessful) existing.best_method = method;
        existing.total_attempts = newTotal;
        existing.successful_scrapes = newSuccess;
      }
      
      saveDatabase();
    } catch (error) {
      console.error('Error updating retailer patterns:', error);
    }
  }

  // Get AI-improved estimation based on historical data
  async getSmartEstimation(category, productName, retailer) {
    try {
      // First, look for similar products
      const similarProducts = db.products
        .filter(p => p.category === category && p.retailer === retailer && p.confidence > 0.6)
        .sort((a, b) => (b.times_seen || 1) - (a.times_seen || 1))
        .slice(0, 10);

      if (similarProducts && similarProducts.length > 3) {
        // We have enough data to make a smart guess
        const avgDimensions = {
          length: this.calculateSmartAverage(similarProducts.map(p => p.length)),
          width: this.calculateSmartAverage(similarProducts.map(p => p.width)),
          height: this.calculateSmartAverage(similarProducts.map(p => p.height))
        };
        const avgWeight = this.calculateSmartAverage(similarProducts.map(p => p.weight));
        
        console.log(`   🤖 AI: Using data from ${similarProducts.length} similar ${category} products from ${retailer}`);
        
        return {
          dimensions: avgDimensions,
          weight: avgWeight,
          confidence: Math.min(0.9, 0.5 + (similarProducts.length * 0.05)),
          source: 'ai_similar_products'
        };
      }

      // Fall back to category patterns
      const pattern = db.category_patterns.find(p => p.category === category && p.sample_count > 5);

      if (pattern) {
        console.log(`   🤖 AI: Using patterns from ${pattern.sample_count} ${category} products`);
        
        return {
          dimensions: {
            length: pattern.avg_length,
            width: pattern.avg_width,
            height: pattern.avg_height
          },
          weight: pattern.avg_weight,
          confidence: Math.min(0.7, 0.3 + (pattern.sample_count * 0.02)),
          source: 'ai_category_patterns'
        };
      }

      return null;
    } catch (error) {
      console.error('Error getting smart estimation:', error);
      return null;
    }
  }

  // Smart average that removes outliers
  calculateSmartAverage(numbers) {
    const filtered = numbers.filter(n => n && n > 0);
    if (filtered.length === 0) return 0;
    
    // Remove outliers (top and bottom 20% if we have enough data)
    if (filtered.length > 5) {
      filtered.sort((a, b) => a - b);
      const cutoff = Math.floor(filtered.length * 0.2);
      const trimmed = filtered.slice(cutoff, -cutoff || undefined);
      return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    }
    
    return filtered.reduce((a, b) => a + b, 0) / filtered.length;
  }

  // Record scraping results for failure tracking
  async recordScrapingResult(url, retailer, productData, scrapingMethod) {
    try {
      const missing = {
        name: !productData.name || productData.name === 'Unknown Product' || productData.name.includes('Product from'),
        price: !productData.price,
        image: !productData.image || productData.image.includes('placehold'),
        dimensions: !productData.dimensions
      };
      
      // If anything is missing, record it
      if (missing.name || missing.price || missing.image || missing.dimensions) {
        const failure = {
          id: Date.now(),
          url,
          retailer,
          missing_name: missing.name ? 1 : 0,
          missing_price: missing.price ? 1 : 0,
          missing_image: missing.image ? 1 : 0,
          missing_dimensions: missing.dimensions ? 1 : 0,
          timestamp: new Date().toISOString()
        };
        db.scraping_failures.push(failure);
        saveDatabase();
        
        console.log(`   ⚠️ Missing data for ${retailer}:`, missing);
      }
    } catch (error) {
      console.error('Error recording scraping result:', error);
    }
  }

  // Generate scraping report
  async getScrapingReport() {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const recentFailures = db.scraping_failures.filter(f => new Date(f.timestamp) > sevenDaysAgo);
      
      const failuresByRetailer = {};
      recentFailures.forEach(f => {
        if (!failuresByRetailer[f.retailer]) {
          failuresByRetailer[f.retailer] = {
            retailer: f.retailer,
            total_failures: 0,
            missing_names: 0,
            missing_prices: 0,
            missing_images: 0,
            missing_dimensions: 0
          };
        }
        const stats = failuresByRetailer[f.retailer];
        stats.total_failures++;
        stats.missing_names += f.missing_name;
        stats.missing_prices += f.missing_price;
        stats.missing_images += f.missing_image;
        stats.missing_dimensions += f.missing_dimensions;
      });
      
      const sortedFailures = Object.values(failuresByRetailer)
        .sort((a, b) => b.total_failures - a.total_failures);
      
      return {
        problemRetailers: sortedFailures,
        recommendation: sortedFailures[0] ? 
          `${sortedFailures[0].retailer} needs attention - ${sortedFailures[0].total_failures} failures this week` : 
          'All retailers working well'
      };
    } catch (error) {
      console.error('Error generating report:', error);
      return { error: 'Could not generate report' };
    }
  }

  // Get insights about scraping performance
  async getInsights() {
    try {
      const insights = {};
      
      // Get category insights
      insights.categories = db.category_patterns
        .filter(c => c.sample_count > 5)
        .sort((a, b) => b.sample_count - a.sample_count);
      
      // Get retailer insights
      insights.retailers = db.retailer_patterns
        .sort((a, b) => b.success_rate - a.success_rate);
      
      // Get total products learned
      insights.totalProducts = db.products.length;
      insights.avgConfidence = db.products.length > 0 ? 
        db.products.reduce((sum, p) => sum + p.confidence, 0) / db.products.length : 0;
      
      console.log('\n📊 AI LEARNING INSIGHTS:');
      console.log(`   Total products learned: ${insights.totalProducts}`);
      console.log(`   Average confidence: ${(insights.avgConfidence * 100).toFixed(1)}%`);
      console.log(`   Categories tracked: ${insights.categories.length}`);
      if (insights.retailers.length > 0) {
        console.log(`   Best retailer: ${insights.retailers[0].retailer} (${insights.retailers[0].success_rate?.toFixed(1)}% success)`);
      }
      
      return insights;
    } catch (error) {
      console.error('Error getting insights:', error);
      return {};
    }
  }
}

module.exports = new LearningSystem();
