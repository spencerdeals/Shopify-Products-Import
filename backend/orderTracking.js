// backend/orderTracking.js
const axios = require('axios');
const retailerAPIs = require('./retailerAPIs');

class OrderTrackingSystem {
  constructor(shopifyDomain, shopifyAccessToken) {
    this.shopifyDomain = shopifyDomain;
    this.shopifyAccessToken = shopifyAccessToken;
    this.retailerAPIs = new retailerAPIs();
    this.trackingIntervals = new Map(); // Store active tracking intervals
    
    console.log('📦 Order Tracking System initialized');
  }

  // Start tracking an order
  async startTracking(shopifyOrderId, retailerOrders) {
    console.log(`🔄 Starting tracking for Shopify order #${shopifyOrderId}`);
    
    // Store the retailer order details
    const trackingData = {
      shopifyOrderId,
      retailerOrders, // Array of { retailer, orderId, items }
      lastStatus: {},
      trackingStarted: new Date()
    };

    // Check status immediately
    await this.checkOrderStatus(trackingData);

    // Set up periodic checking (every 4 hours)
    const intervalId = setInterval(async () => {
      try {
        await this.checkOrderStatus(trackingData);
      } catch (error) {
        console.error(`❌ Tracking error for order ${shopifyOrderId}:`, error.message);
      }
    }, 4 * 60 * 60 * 1000); // 4 hours

    this.trackingIntervals.set(shopifyOrderId, intervalId);
    
    return { success: true, message: 'Tracking started' };
  }

  // Check status of all retailer orders
  async checkOrderStatus(trackingData) {
    const { shopifyOrderId, retailerOrders } = trackingData;
    let hasUpdates = false;
    const statusUpdates = [];

    console.log(`🔍 Checking status for ${retailerOrders.length} retailer orders...`);

    for (const retailerOrder of retailerOrders) {
      try {
        const newStatus = await this.getRetailerOrderStatus(
          retailerOrder.retailer, 
          retailerOrder.orderId
        );

        const lastStatus = trackingData.lastStatus[retailerOrder.retailer];
        
        if (!lastStatus || newStatus.status !== lastStatus.status) {
          console.log(`📈 Status change for ${retailerOrder.retailer}: ${lastStatus?.status || 'unknown'} → ${newStatus.status}`);
          
          trackingData.lastStatus[retailerOrder.retailer] = newStatus;
          hasUpdates = true;
          
          statusUpdates.push({
            retailer: retailerOrder.retailer,
            orderId: retailerOrder.orderId,
            items: retailerOrder.items,
            oldStatus: lastStatus?.status || 'unknown',
            newStatus: newStatus.status,
            trackingNumber: newStatus.trackingNumber,
            estimatedDelivery: newStatus.estimatedDelivery,
            carrierInfo: newStatus.carrierInfo
          });
        }
      } catch (error) {
        console.error(`❌ Failed to check ${retailerOrder.retailer} order:`, error.message);
      }
    }

    if (hasUpdates) {
      await this.updateShopifyOrder(shopifyOrderId, statusUpdates);
    }

    return statusUpdates;
  }

  // Get order status from specific retailer
  async getRetailerOrderStatus(retailer, orderId) {
    switch (retailer.toLowerCase()) {
      case 'amazon':
        return await this.getAmazonOrderStatus(orderId);
      case 'walmart':
        return await this.getWalmartOrderStatus(orderId);
      case 'target':
        return await this.getTargetOrderStatus(orderId);
      case 'wayfair':
        return await this.getWayfairOrderStatus(orderId);
      case 'best buy':
        return await this.getBestBuyOrderStatus(orderId);
      case 'home depot':
        return await this.getHomeDepotOrderStatus(orderId);
      default:
        throw new Error(`Tracking not supported for ${retailer}`);
    }
  }

  // Amazon order tracking
  async getAmazonOrderStatus(orderId) {
    // Note: Amazon doesn't provide order tracking via Product API
    // This would require Amazon SP-API (Selling Partner API) with special permissions
    // For now, return a placeholder that could be enhanced with SP-API
    return {
      status: 'processing',
      trackingNumber: null,
      estimatedDelivery: null,
      carrierInfo: null,
      note: 'Amazon tracking requires SP-API integration'
    };
  }

  // Walmart order tracking
  async getWalmartOrderStatus(orderId) {
    try {
      // Walmart has order tracking endpoints
      const response = await axios.get(`https://api.walmart.com/v3/orders/${orderId}`, {
        headers: {
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': Date.now().toString(),
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      const order = response.data;
      
      return {
        status: this.mapWalmartStatus(order.orderLines?.[0]?.orderLineStatuses?.[0]?.status),
        trackingNumber: order.orderLines?.[0]?.orderLineStatuses?.[0]?.trackingInfo?.trackingNumber,
        estimatedDelivery: order.orderLines?.[0]?.orderLineStatuses?.[0]?.trackingInfo?.estimatedDeliveryDate,
        carrierInfo: {
          carrier: order.orderLines?.[0]?.orderLineStatuses?.[0]?.trackingInfo?.methodCode,
          trackingUrl: order.orderLines?.[0]?.orderLineStatuses?.[0]?.trackingInfo?.trackingURL
        }
      };
    } catch (error) {
      console.error('Walmart tracking error:', error.message);
      return { status: 'unknown', trackingNumber: null, estimatedDelivery: null, carrierInfo: null };
    }
  }

  // Target order tracking
  async getTargetOrderStatus(orderId) {
    try {
      // Target's internal order tracking API
      const response = await axios.get(`https://api.target.com/fulfillment_aggregator/v2/orders/${orderId}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; SDL-Import-Calculator/1.0)'
        },
        timeout: 10000
      });

      const order = response.data;
      
      return {
        status: this.mapTargetStatus(order.order_status),
        trackingNumber: order.shipments?.[0]?.tracking_number,
        estimatedDelivery: order.shipments?.[0]?.estimated_delivery_date,
        carrierInfo: {
          carrier: order.shipments?.[0]?.carrier,
          trackingUrl: order.shipments?.[0]?.tracking_url
        }
      };
    } catch (error) {
      console.error('Target tracking error:', error.message);
      return { status: 'unknown', trackingNumber: null, estimatedDelivery: null, carrierInfo: null };
    }
  }

  // Wayfair order tracking
  async getWayfairOrderStatus(orderId) {
    try {
      // Wayfair order tracking endpoint
      const response = await axios.get(`https://www.wayfair.com/v/order_tracking/orders/${orderId}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; SDL-Import-Calculator/1.0)'
        },
        timeout: 10000
      });

      const order = response.data;
      
      return {
        status: this.mapWayfairStatus(order.status),
        trackingNumber: order.tracking_number,
        estimatedDelivery: order.estimated_delivery,
        carrierInfo: {
          carrier: order.carrier,
          trackingUrl: order.tracking_url
        }
      };
    } catch (error) {
      console.error('Wayfair tracking error:', error.message);
      return { status: 'unknown', trackingNumber: null, estimatedDelivery: null, carrierInfo: null };
    }
  }

  // Best Buy order tracking
  async getBestBuyOrderStatus(orderId) {
    if (!process.env.BESTBUY_API_KEY) {
      return { status: 'unknown', trackingNumber: null, estimatedDelivery: null, carrierInfo: null };
    }

    try {
      const response = await axios.get(`https://api.bestbuy.com/v1/orders/${orderId}`, {
        params: {
          apiKey: process.env.BESTBUY_API_KEY,
          format: 'json'
        },
        timeout: 10000
      });

      const order = response.data;
      
      return {
        status: this.mapBestBuyStatus(order.status),
        trackingNumber: order.trackingNumber,
        estimatedDelivery: order.estimatedDeliveryDate,
        carrierInfo: {
          carrier: order.carrier,
          trackingUrl: order.trackingUrl
        }
      };
    } catch (error) {
      console.error('Best Buy tracking error:', error.message);
      return { status: 'unknown', trackingNumber: null, estimatedDelivery: null, carrierInfo: null };
    }
  }

  // Home Depot order tracking
  async getHomeDepotOrderStatus(orderId) {
    try {
      // Home Depot order tracking
      const response = await axios.get(`https://www.homedepot.com/api/order/${orderId}/status`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; SDL-Import-Calculator/1.0)'
        },
        timeout: 10000
      });

      const order = response.data;
      
      return {
        status: this.mapHomeDepotStatus(order.orderStatus),
        trackingNumber: order.trackingNumber,
        estimatedDelivery: order.estimatedDelivery,
        carrierInfo: {
          carrier: order.carrier,
          trackingUrl: order.trackingUrl
        }
      };
    } catch (error) {
      console.error('Home Depot tracking error:', error.message);
      return { status: 'unknown', trackingNumber: null, estimatedDelivery: null, carrierInfo: null };
    }
  }

  // Status mapping functions
  mapWalmartStatus(status) {
    const statusMap = {
      'Created': 'processing',
      'Acknowledged': 'processing', 
      'Shipped': 'shipped',
      'Delivered': 'delivered',
      'Cancelled': 'cancelled'
    };
    return statusMap[status] || 'unknown';
  }

  mapTargetStatus(status) {
    const statusMap = {
      'OPEN': 'processing',
      'SOURCING': 'processing',
      'IN_PROGRESS': 'processing',
      'SHIPPED': 'shipped',
      'DELIVERED': 'delivered',
      'CANCELLED': 'cancelled'
    };
    return statusMap[status] || 'unknown';
  }

  mapWayfairStatus(status) {
    const statusMap = {
      'Processing': 'processing',
      'In Production': 'processing',
      'Shipped': 'shipped',
      'Out for Delivery': 'out_for_delivery',
      'Delivered': 'delivered',
      'Cancelled': 'cancelled'
    };
    return statusMap[status] || 'unknown';
  }

  mapBestBuyStatus(status) {
    const statusMap = {
      'ORDER_PLACED': 'processing',
      'PREPARING': 'processing',
      'SHIPPED': 'shipped',
      'DELIVERED': 'delivered',
      'CANCELLED': 'cancelled'
    };
    return statusMap[status] || 'unknown';
  }

  mapHomeDepotStatus(status) {
    const statusMap = {
      'SUBMITTED': 'processing',
      'PROCESSING': 'processing',
      'SHIPPED': 'shipped',
      'DELIVERED': 'delivered',
      'CANCELLED': 'cancelled'
    };
    return statusMap[status] || 'unknown';
  }

  // Update Shopify order with tracking information
  async updateShopifyOrder(shopifyOrderId, statusUpdates) {
    try {
      console.log(`📝 Updating Shopify order #${shopifyOrderId} with ${statusUpdates.length} status changes`);

      // Get current order
      const orderResponse = await axios.get(
        `https://${this.shopifyDomain}/admin/api/2023-10/orders/${shopifyOrderId}.json`,
        {
          headers: {
            'X-Shopify-Access-Token': this.shopifyAccessToken,
            'Content-Type': 'application/json'
          }
        }
      );

      const currentOrder = orderResponse.data.order;
      
      // Build comprehensive note with all tracking info
      let trackingNote = `🚚 IMPORT ORDER TRACKING UPDATE - ${new Date().toLocaleString()}\n\n`;
      
      let allShipped = true;
      let anyDelivered = false;
      
      for (const update of statusUpdates) {
        trackingNote += `📦 ${update.retailer.toUpperCase()} ORDER #${update.orderId}\n`;
        trackingNote += `   Status: ${update.oldStatus} → ${update.newStatus.toUpperCase()}\n`;
        
        if (update.trackingNumber) {
          trackingNote += `   Tracking: ${update.trackingNumber}\n`;
        }
        
        if (update.estimatedDelivery) {
          trackingNote += `   Est. Delivery: ${update.estimatedDelivery}\n`;
        }
        
        if (update.carrierInfo?.carrier) {
          trackingNote += `   Carrier: ${update.carrierInfo.carrier}\n`;
        }
        
        trackingNote += `   Items: ${update.items.join(', ')}\n\n`;
        
        // Track overall status
        if (update.newStatus !== 'shipped' && update.newStatus !== 'delivered') {
          allShipped = false;
        }
        if (update.newStatus === 'delivered') {
          anyDelivered = true;
        }
      }

      // Determine overall order status
      let shopifyFulfillmentStatus = null;
      if (anyDelivered && allShipped) {
        shopifyFulfillmentStatus = 'fulfilled';
        trackingNote += `✅ ALL ITEMS DELIVERED TO US WAREHOUSE\n`;
        trackingNote += `🚢 Ready for ocean freight to Bermuda!\n`;
      } else if (allShipped) {
        shopifyFulfillmentStatus = 'partial';
        trackingNote += `🚚 ALL ITEMS SHIPPED - In transit to our warehouse\n`;
      }

      // Add previous notes
      const existingNote = currentOrder.note || '';
      const updatedNote = trackingNote + '\n' + existingNote;

      // Update the order
      const updateData = {
        order: {
          id: shopifyOrderId,
          note: updatedNote,
          tags: currentOrder.tags ? `${currentOrder.tags}, auto-tracked` : 'auto-tracked'
        }
      };

      await axios.put(
        `https://${this.shopifyDomain}/admin/api/2023-10/orders/${shopifyOrderId}.json`,
        updateData,
        {
          headers: {
            'X-Shopify-Access-Token': this.shopifyAccessToken,
            'Content-Type': 'application/json'
          }
        }
      );

      // If items are delivered, create fulfillment
      if (shopifyFulfillmentStatus === 'fulfilled') {
        await this.createShopifyFulfillment(shopifyOrderId, statusUpdates);
      }

      console.log(`✅ Shopify order #${shopifyOrderId} updated successfully`);
      
      return { success: true, updatedStatus: shopifyFulfillmentStatus };

    } catch (error) {
      console.error(`❌ Failed to update Shopify order #${shopifyOrderId}:`, error.message);
      throw error;
    }
  }

  // Create Shopify fulfillment when items are delivered
  async createShopifyFulfillment(shopifyOrderId, statusUpdates) {
    try {
      const deliveredItems = statusUpdates.filter(update => update.newStatus === 'delivered');
      
      if (deliveredItems.length === 0) return;

      const trackingNumbers = deliveredItems
        .map(item => item.trackingNumber)
        .filter(Boolean);

      const fulfillmentData = {
        fulfillment: {
          location_id: null, // Use default location
          tracking_number: trackingNumbers.join(', '),
          tracking_company: 'Multiple Carriers',
          tracking_urls: [],
          notify_customer: true,
          note: `Items delivered to SDL warehouse. Ocean freight to Bermuda will begin shortly.`
        }
      };

      await axios.post(
        `https://${this.shopifyDomain}/admin/api/2023-10/orders/${shopifyOrderId}/fulfillments.json`,
        fulfillmentData,
        {
          headers: {
            'X-Shopify-Access-Token': this.shopifyAccessToken,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`✅ Created fulfillment for order #${shopifyOrderId}`);

    } catch (error) {
      console.error(`❌ Failed to create fulfillment:`, error.message);
    }
  }

  // Stop tracking an order
  stopTracking(shopifyOrderId) {
    const intervalId = this.trackingIntervals.get(shopifyOrderId);
    if (intervalId) {
      clearInterval(intervalId);
      this.trackingIntervals.delete(shopifyOrderId);
      console.log(`⏹️ Stopped tracking order #${shopifyOrderId}`);
      return { success: true, message: 'Tracking stopped' };
    }
    return { success: false, message: 'Order not being tracked' };
  }

  // Get tracking status for an order
  async getTrackingStatus(shopifyOrderId) {
    // This would retrieve tracking data from database
    // For now, return placeholder
    return {
      isTracking: this.trackingIntervals.has(shopifyOrderId),
      lastUpdate: new Date(),
      retailerStatuses: {}
    };
  }

  // Cleanup - stop all tracking
  cleanup() {
    console.log(`🧹 Cleaning up ${this.trackingIntervals.size} tracking intervals`);
    for (const [orderId, intervalId] of this.trackingIntervals) {
      clearInterval(intervalId);
    }
    this.trackingIntervals.clear();
  }
}

module.exports = OrderTrackingSystem;