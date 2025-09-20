// Order Tracking System for SDL Import Calculator

class OrderTracker {
  constructor(dbClient) {
    this.db = dbClient;
  }

  static async create() {
    try {
      // Dynamic import using Function constructor to bypass static parsing
      const { createClient } = await new Function('return import("@libsql/client")')();
      
      // Create the database client
      const dbClient = createClient({
        url: process.env.TURSO_DATABASE_URL || 'file:orders.db',
        authToken: process.env.TURSO_AUTH_TOKEN
      });
      
      // Create the OrderTracker instance
      const tracker = new OrderTracker(dbClient);
      
      // Initialize the database
      await tracker.initDatabase();
      
      return tracker;
    } catch (error) {
      console.error('❌ Failed to create OrderTracker:', error);
      throw error;
    }
  }

  async initDatabase() {
    try {
      // Create orders table if it doesn't exist
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS tracked_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          shopify_order_id TEXT UNIQUE NOT NULL,
          retailer_orders TEXT NOT NULL,
          status TEXT DEFAULT 'tracking',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
          tracking_data TEXT
        )
      `);
      
      console.log('✅ Order tracking database initialized');
    } catch (error) {
      console.error('❌ Failed to initialize order tracking database:', error);
    }
  }

  async startTracking(shopifyOrderId, retailerOrders) {
    try {
      const retailerOrdersJson = JSON.stringify(retailerOrders);
      
      await this.db.execute({
        sql: `INSERT OR REPLACE INTO tracked_orders 
              (shopify_order_id, retailer_orders, status, last_updated) 
              VALUES (?, ?, 'tracking', CURRENT_TIMESTAMP)`,
        args: [shopifyOrderId, retailerOrdersJson]
      });
      
      console.log(`📦 Started tracking order ${shopifyOrderId} with ${retailerOrders.length} retailer orders`);
      return { success: true };
      
    } catch (error) {
      console.error('❌ Failed to start tracking:', error);
      return { success: false, message: error.message };
    }
  }

  async stopTracking(shopifyOrderId) {
    try {
      await this.db.execute({
        sql: `UPDATE tracked_orders SET status = 'stopped', last_updated = CURRENT_TIMESTAMP WHERE shopify_order_id = ?`,
        args: [shopifyOrderId]
      });
      
      console.log(`⏹️ Stopped tracking order ${shopifyOrderId}`);
      return { success: true };
      
    } catch (error) {
      console.error('❌ Failed to stop tracking:', error);
      return { success: false, message: error.message };
    }
  }

  async getTrackingStatus(shopifyOrderId) {
    try {
      const result = await this.db.execute({
        sql: `SELECT * FROM tracked_orders WHERE shopify_order_id = ?`,
        args: [shopifyOrderId]
      });
      
      if (result.rows.length === 0) {
        return {
          isTracking: false,
          lastUpdate: null,
          retailerStatuses: {}
        };
      }
      
      const order = result.rows[0];
      const retailerOrders = JSON.parse(order.retailer_orders);
      const trackingData = order.tracking_data ? JSON.parse(order.tracking_data) : {};
      
      return {
        isTracking: order.status === 'tracking',
        lastUpdate: order.last_updated,
        retailerStatuses: trackingData,
        retailerOrders: retailerOrders
      };
      
    } catch (error) {
      console.error('❌ Failed to get tracking status:', error);
      return {
        isTracking: false,
        lastUpdate: null,
        retailerStatuses: {},
        error: error.message
      };
    }
  }

  async updateTrackingData(shopifyOrderId, trackingData) {
    try {
      await this.db.execute({
        sql: `UPDATE tracked_orders 
              SET tracking_data = ?, last_updated = CURRENT_TIMESTAMP 
              WHERE shopify_order_id = ?`,
        args: [JSON.stringify(trackingData), shopifyOrderId]
      });
      
      return { success: true };
      
    } catch (error) {
      console.error('❌ Failed to update tracking data:', error);
      return { success: false, message: error.message };
    }
  }

  async getAllTrackedOrders() {
    try {
      const result = await this.db.execute(`
        SELECT shopify_order_id, status, created_at, last_updated 
        FROM tracked_orders 
        WHERE status = 'tracking' 
        ORDER BY created_at DESC
      `);
      
      return result.rows;
      
    } catch (error) {
      console.error('❌ Failed to get tracked orders:', error);
      return [];
    }
  }
}

module.exports = OrderTracker;