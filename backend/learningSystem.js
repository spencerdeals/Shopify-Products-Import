// backend/learningSystem.js - Turso Cloud Database Version
const { createClient } = require('@libsql/client');

// Initialize Turso cloud database
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

console.log('🔄 Connecting to Turso cloud database...');

// Initialize database tables
async function initDatabase() {
  try {
    // Main product knowledge base
    await db.execute(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE,
        name TEXT,
        retailer TEXT,
        category TEXT,
        price REAL,
        weight REAL,
        length REAL,
        width REAL,
        height REAL,
        image TEXT,
        scrape_method TEXT,
        confidence REAL DEFAULT 0.5,
        times_seen INTEGER DEFAULT 1,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Category learning patterns
    await db.execute(`
      CREATE TABLE IF NOT EXISTS category_patterns (
        category TEXT PRIMARY KEY,
        avg_weight REAL,
        avg_length REAL,
        avg_width REAL,
        avg_height REAL,
        min_weight REAL,
        max_weight REAL,
        min_price REAL,
        max_price REAL,
        sample_count INTEGER DEFAULT 0
      )
    `);

    // Retailer success patterns
    await db.execute(`
      CREATE TABLE IF NOT EXISTS retailer_patterns (
        retailer TEXT PRIMARY KEY,
        success_rate REAL,
        avg_scrape_time REAL,
        best_method TEXT,
        total_attempts INTEGER DEFAULT 0,
        successful_scrapes INTEGER DEFAULT 0
      )
    `);

    console.log('✅ Turso AI Learning Database initialized');
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
      const result = await db.execute({
        sql: `SELECT * FROM products 
              WHERE url = ? 
              AND datetime(last_updated) > datetime('now', '-30 days')
              AND confidence > 0.7`,
        args: [url]
      });

      if (result.rows && result.rows.length > 0) {
        const product = result.rows[0];
        
        // Increase confidence each time we successfully retrieve
        await db.execute({
          sql: `UPDATE products 
                SET times_seen = times_seen + 1,
                    confidence = MIN(1.0, confidence + 0.05)
                WHERE url = ?`,
          args: [url]
        });
        
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
      const existing = await db.execute({
        sql: 'SELECT times_seen FROM products WHERE url = ?',
        args: [url]
      });
      
      const timesSeen = existing.rows.length > 0 ? existing.rows[0].times_seen + 1 : 1;
      
      await db.execute({
        sql: `INSERT OR REPLACE INTO products 
              (url, name, retailer, category, price, weight, length, width, height, image, scrape_method, confidence, times_seen)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          url, name, retailer, category, price, weight,
          dimensions?.length || 0, dimensions?.width || 0, dimensions?.height || 0,
          image, scrapingMethod, confidence, timesSeen
        ]
      });
      
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
      const result = await db.execute({
        sql: 'SELECT * FROM category_patterns WHERE category = ?',
        args: [category]
      });

      if (result.rows.length === 0) {
        // First time seeing this category
        await db.execute({
          sql: `INSERT INTO category_patterns 
                (category, avg_weight, avg_length, avg_width, avg_height, min_weight, max_weight, min_price, max_price, sample_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          args: [
            category,
            weight || 0,
            dimensions?.length || 0,
            dimensions?.width || 0,
            dimensions?.height || 0,
            weight || 0,
            weight || 999999,
            price || 0,
            price || 999999
          ]
        });
      } else {
        // Update running averages
        const row = result.rows[0];
        const count = row.sample_count;
        const newCount = count + 1;
        
        await db.execute({
          sql: `UPDATE category_patterns SET
                avg_weight = ((avg_weight * ?) + ?) / ?,
                avg_length = ((avg_length * ?) + ?) / ?,
                avg_width = ((avg_width * ?) + ?) / ?,
                avg_height = ((avg_height * ?) + ?) / ?,
                min_weight = MIN(min_weight, ?),
                max_weight = MAX(max_weight, ?),
                min_price = MIN(min_price, ?),
                max_price = MAX(max_price, ?),
                sample_count = ?
                WHERE category = ?`,
          args: [
            count, weight || row.avg_weight, newCount,
            count, dimensions?.length || row.avg_length, newCount,
            count, dimensions?.width || row.avg_width, newCount,
            count, dimensions?.height || row.avg_height, newCount,
            weight || row.min_weight,
            weight || row.max_weight,
            price || row.min_price,
            price || row.max_price,
            newCount,
            category
          ]
        });
      }
    } catch (error) {
      console.error('Error updating category patterns:', error);
    }
  }

  // Track which scraping methods work best for each retailer
  async updateRetailerSuccess(retailer, method, wasSuccessful) {
    try {
      const result = await db.execute({
        sql: 'SELECT * FROM retailer_patterns WHERE retailer = ?',
        args: [retailer]
      });

      if (result.rows.length === 0) {
        await db.execute({
          sql: `INSERT INTO retailer_patterns 
                (retailer, success_rate, best_method, total_attempts, successful_scrapes)
                VALUES (?, ?, ?, 1, ?)`,
          args: [retailer, wasSuccessful ? 100 : 0, method, wasSuccessful ? 1 : 0]
        });
      } else {
        const row = result.rows[0];
        const newTotal = row.total_attempts + 1;
        const newSuccess = row.successful_scrapes + (wasSuccessful ? 1 : 0);
        const newRate = (newSuccess / newTotal) * 100;
        
        await db.execute({
          sql: `UPDATE retailer_patterns SET
                success_rate = ?,
                best_method = CASE WHEN ? THEN ? ELSE best_method END,
                total_attempts = ?,
                successful_scrapes = ?
                WHERE retailer = ?`,
          args: [newRate, wasSuccessful, method, newTotal, newSuccess, retailer]
        });
      }
    } catch (error) {
      console.error('Error updating retailer patterns:', error);
    }
  }

  // Get AI-improved estimation based on historical data
  async getSmartEstimation(category, productName, retailer) {
    try {
      // First, look for similar products
      const similarResult = await db.execute({
        sql: `SELECT * FROM products 
              WHERE category = ? 
              AND retailer = ?
              AND confidence > 0.6
              ORDER BY times_seen DESC
              LIMIT 10`,
        args: [category, retailer]
      });

      if (similarResult.rows && similarResult.rows.length > 3) {
        // We have enough data to make a smart guess
        const similarProducts = similarResult.rows;
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
      const patternResult = await db.execute({
        sql: `SELECT * FROM category_patterns 
              WHERE category = ? 
              AND sample_count > 5`,
        args: [category]
      });

      if (patternResult.rows && patternResult.rows.length > 0) {
        const pattern = patternResult.rows[0];
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

  // Get insights about scraping performance
  async getInsights() {
    try {
      const insights = {};
      
      // Get category insights
      const categoriesResult = await db.execute(
        'SELECT * FROM category_patterns WHERE sample_count > 5 ORDER BY sample_count DESC'
      );
      insights.categories = categoriesResult.rows;
      
      // Get retailer insights
      const retailersResult = await db.execute(
        'SELECT * FROM retailer_patterns ORDER BY success_rate DESC'
      );
      insights.retailers = retailersResult.rows;
      
      // Get total products learned
      const statsResult = await db.execute(
        'SELECT COUNT(*) as total, AVG(confidence) as avg_confidence FROM products'
      );
      const stats = statsResult.rows[0];
      insights.totalProducts = stats.total;
      insights.avgConfidence = stats.avg_confidence;
      
      console.log('\n📊 AI LEARNING INSIGHTS:');
      console.log(`   Total products learned: ${stats.total}`);
      console.log(`   Average confidence: ${(stats.avg_confidence * 100).toFixed(1)}%`);
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
