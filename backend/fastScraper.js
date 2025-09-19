const SHIPPING_RATE_PER_CUBIC_FOOT = 7.50; // $7.50 per cubic foot for competitive pricing
    const upcDimensions = await getUPCDimensions(productData.name);
    if (upcDimensions) {
      productData.dimensions = upcDimensions;
      console.log('   ✅ UPCitemdb override - provided more accurate dimensions');
      
      if (scrapingMethod === 'zyte') {
        scrapingMethod = 'zyte+upcitemdb';
      } else if (scrapingMethod === 'gpt-fallback') {
        scrapingMethod = 'gpt+upcitemdb';
      } else {
        scrapingMethod = scrapingMethod + '+upcitemdb';
      }
    }
  }
  
  // STEP 3.5: IKEA Multi-Box Estimation
  if (retailer === 'IKEA' && productData && productData.dimensions && productData.name && productData.price) {
    const ikeaEstimate = estimateIkeaMultiBoxShipping(productData.dimensions, productData.name, productData.price);
    
    if (ikeaEstimate.boxCount > 1) {
      productData.dimensions = ikeaEstimate.dimensions;
      productData.ikeaMultiBox = {
        estimatedBoxes: ikeaEstimate.boxCount,
        confidence: ikeaEstimate.confidence,
        singleBoxVolume: ikeaEstimate.singleBoxVolume,
        totalVolume: ikeaEstimate.totalVolume
      };
      
      if (scrapingMethod.includes('upcitemdb')) {
        scrapingMethod = scrapingMethod + '+ikea-multibox';
      } else {
        scrapingMethod = scrapingMethod + '+ikea-multibox';
      }
      
      console.log(`   🎯 Applied IKEA multi-box estimation (${ikeaEstimate.confidence} confidence)`);
    }
  }
  
  // STEP 7: Final fallback - intelligent estimation
  if (!productData || !productData.dimensions) {
    // Try BOL category patterns one more time
    const categoryEstimate = await bolHistory.getSmartEstimate('', category, retailer);
    
    if (categoryEstimate && categoryEstimate.dimensions) {
      productData.dimensions = categoryEstimate.dimensions;
      console.log('   📐 Using BOL category-level dimension estimate');
      scrapingMethod = scrapingMethod === 'none' ? 'bol-category-estimate' : scrapingMethod + '+bol-estimate';
    } else {
      // Final fallback to basic estimation
      const estimatedDimensions = estimateDimensions(category, productName);
      if (productData) {
        productData.dimensions = estimatedDimensions;
      } else {
        productData = { dimensions: estimatedDimensions };
      }
      if (!productData) productData = {};
      productData.dimensions = estimateDimensions(productCategory, productName);
      console.log('   📐 Estimated dimensions based on category:', productCategory);
      if (scrapingMethod === 'none') {
        scrapingMethod = 'estimation';
      }
    }
  }
  
  if (!productData || !productData.weight) {
    if (!productData) productData = {};
    const estimatedWeight = estimateWeight(productData.dimensions, category);
    if (productData) {
      productData.weight = estimatedWeight;
    } else {
      productData = { ...productData, weight: estimatedWeight };
    }
    productData.weight = estimateWeight(productData.dimensions, productCategory);
    console.log('   ⚖️ Estimated weight based on dimensions');
  }
  
  // Calculate shipping cost
  const shippingCost = calculateShippingCost(
    productData.dimensions,
    productData.weight,
    (productData && productData.price) ? productData.price : 100
  );
  
  // Prepare final product object
  const product = {
    id: productId,
    url: url,
    name: productName,
    price: (productData && productData.price) ? productData.price : null,
    image: (productData && productData.image) ? productData.image : 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=SDL',
    category: productCategory,
    retailer: retailer,
    dimensions: productData.dimensions,
    weight: productData.weight,
    shippingCost: shippingCost,
    scrapingMethod: scrapingMethod,
    confidence: confidence,
    variant: (productData && productData.variant) ? productData.variant : null,
    dataCompleteness: {
      hasName: !!(productData && productData.name),
      hasImage: !!(productData && productData.image),
      hasDimensions: !!(productData && productData.dimensions),
      hasWeight: !!(productData && productData.weight),
      hasPrice: !!(productData && productData.price),
      hasVariant: !!(productData && productData.variant),
      hasBOLHistory: scrapingMethod.includes('bol'),
      hasUPCitemdb: scrapingMethod.includes('upcitemdb')
    }
  };
  
  console.log(`   💰 Shipping cost: $${shippingCost}`);
  console.log(`   📊 Data source: ${scrapingMethod}`);
  if (confidence !== null) {
    console.log(`   🎯 Confidence: ${(confidence * 100).toFixed(1)}%`);
  }
  if (scrapingMethod.includes('bol')) {
    console.log(`   📚 Enhanced with BOL historical data`);
  }
  if (scrapingMethod.includes('upcitemdb')) {
    console.log(`   💎 Enhanced with UPCitemdb data`);
  }
  console.log(`   ✅ Product processed\n`);

  return product;
}

// Batch processing with concurrency control
async function processBatch(urls, batchSize = MAX_CONCURRENT) {
  const results = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(url => scrapeProduct(url).catch(error => {
        console.error(`Failed to process ${url}:`, error);
        return {
          id: generateProductId(),
          url: url,
          name: 'Failed to load product',
          category: 'general',
          retailer: detectRetailer(url),
          shippingCost: 50,
          error: true
        };
      }))
    );
    results.push(...batchResults);
  }
  return results;
}

// API endpoint for scraping
app.post('/api/scrape', async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'No URLs provided' });
    }
    
    // Check for SDL domains
    const sdlUrls = urls.filter(url => isSDLDomain(url));
    if (sdlUrls.length > 0) {
      return res.status(400).json({ 
        error: 'SDL domain detected. This calculator is for importing products from other retailers.' 
      });
    }
    
    console.log(`\n🚀 Starting batch scrape for ${urls.length} products...`);
    
    const products = await processBatch(urls);
    console.log(`\n✅ Completed scraping ${products.length} products\n`);
    
    res.json({ 
      products
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape products' });
  }
});

// API endpoint for manual webpage processing
app.post('/api/process-manual-content', async (req, res) => {
  try {
    const { url, htmlContent } = req.body;
    
    if (!url || !htmlContent) {
      return res.status(400).json({ error: 'URL and HTML content required' });
    }
    
    console.log(`\n🤖 Processing manual content for: ${url}`);
    console.log(`📄 Content length: ${htmlContent.length} characters`);
    console.log(`📄 Content preview: ${htmlContent.substring(0, 200)}...`);
    
    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
      console.log('❌ OpenAI API key not found');
      return res.status(500).json({ 
        error: 'GPT processing not available - missing OpenAI API key' 
      });
    }
    
    console.log('✅ OpenAI API key found, proceeding with GPT parsing...');
    
    // Use OpenAI directly to parse the content
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    try {
      console.log('🤖 Calling GPT parser...');
      
      const retailer = detectRetailer(url);
      
      // Trim content to avoid token limits
      const trimmedContent = htmlContent.substring(0, 15000);
      
      const prompt = `Extract product information from this ${retailer} webpage content and return ONLY valid JSON with these fields:
- name (string)
- price (number, no currency symbols)
- dimensions (object with length, width, height in inches if found)
- sku (string if found)
- variant (string like color/size if found)

For Crate & Barrel: Extract dimensions from format like "23.8"H height 85.4"W width 37"D depth" as length=85.4, width=37, height=23.8.

Content: ${trimmedContent}`;

      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a product data extractor. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
      });

      const gptData = JSON.parse(response.choices[0].message.content || '{}');
      console.log('📊 GPT parser result:', {
        hasName: !!gptData?.name,
        hasPrice: !!gptData?.price,
        name: gptData?.name?.substring(0, 50),
        price: gptData?.price
      });
      
      if (gptData && gptData.name && gptData.price) {
        const retailer = detectRetailer(url);
        const category = gptData.category || categorizeProduct(gptData.name, url);
        
        // Convert to our expected format
        const productData = {
          name: gptData.name,
          price: gptData.price,
          image: gptData.image,
          dimensions: gptData.dimensions || gptData.package_dimensions,
          weight: gptData.weight || gptData.package_weight_lbs,
          brand: gptData.brand,
          category: category,
          inStock: gptData.inStock,
          variant: gptData.variant
        };
        
        // Fill in missing data with estimations
        if (!productData.dimensions) {
          productData.dimensions = estimateDimensions(category, productData.name);
        }
        
        // Smart UPCitemdb lookup for manual entry too
        if (productData.name && dimensionsLookSuspicious(productData.dimensions)) {
          console.log('   🔍 Checking UPCitemdb for manual entry dimensions...');
          const upcDimensions = await getUPCDimensions(productData.name);
          if (upcDimensions) {
            productData.dimensions = upcDimensions;
            console.log('   ✅ UPCitemdb provided dimensions for manual entry');
          }
        }
        
        if (!productData.weight) {
          productData.weight = estimateWeight(productData.dimensions, category);
        }
        
        const shippingCost = calculateShippingCost(
          productData.dimensions,
          productData.weight,
          productData.price
        );
        
        const product = {
          id: generateProductId(),
          url: url,
          name: productData.name,
          price: productData.price,
          image: productData.image || 'https://placehold.co/400x400/7CB342/FFFFFF/png?text=SDL',
          category: category,
          retailer: retailer,
          dimensions: productData.dimensions,
          weight: productData.weight,
          shippingCost: shippingCost,
          scrapingMethod: 'manual-gpt',
          confidence: null,
          variant: productData.variant,
          dataCompleteness: {
            hasName: !!productData.name,
            hasImage: !!productData.image,
            hasDimensions: !!productData.dimensions,
            hasWeight: !!productData.weight,
            hasPrice: !!productData.price,
            hasVariant: !!productData.variant
          }
        };
        
        console.log('   ✅ Manual content processed successfully');
        res.json({ success: true, product });
        
      } else {
        console.log('❌ GPT extraction failed - missing required data:', {
          hasName: !!gptData?.name,
          hasPrice: !!gptData?.price,
          gptData: gptData
        });
        throw new Error('GPT could not extract required data from manual content');
      }
      
    } catch (error) {
      console.log('❌ GPT parsing error details:', error.message);
      console.log('📄 Content sample for debugging:', htmlContent.substring(0, 500));
      console.log('   ❌ Manual content processing failed:', error.message);
      res.status(400).json({ 
        error: `GPT parsing failed: ${error.message}. Please try copying the webpage content again, including product name and price.` 
      });
    }
    
  } catch (error) {
    console.error('Manual content processing error:', error);
    res.status(500).json({ error: 'Failed to process manual content' });
  }
});

// Store pending orders temporarily (in memory for now, could use Redis later)
const pendingOrders = new Map();

// Endpoint to store pending order
app.post('/api/store-pending-order', (req, res) => {
  const orderId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  pendingOrders.set(orderId, {
    data: req.body,
    timestamp: Date.now()
  });
  
  // Clean up old orders after 1 hour
  setTimeout(() => pendingOrders.delete(orderId), 3600000);
  
  console.log(`📦 Stored pending order ${orderId}`);
  res.json({ orderId, success: true });
});

// Endpoint to retrieve pending order
app.get('/api/get-pending-order/:orderId', (req, res) => {
  const order = pendingOrders.get(req.params.orderId);
  if (order) {
    console.log(`✅ Retrieved pending order ${req.params.orderId}`);
    res.json(order.data);
    pendingOrders.delete(req.params.orderId); // Delete after retrieval
  } else {
    console.log(`❌ Order ${req.params.orderId} not found`);
    res.status(404).json({ error: 'Order not found or expired' });
  }
});

// Order tracking endpoints
app.post('/api/orders/:orderId/start-tracking', async (req, res) => {
  if (!orderTracker) {
    return res.status(500).json({ error: 'Order tracking not available' });
  }
  
  const { orderId } = req.params;
  const { retailerOrders } = req.body;
  
  const result = await orderTracker.startTracking(orderId, retailerOrders);
  res.json(result);
});

app.get('/api/orders/:orderId/tracking-status', async (req, res) => {
  if (!orderTracker) {
    return res.status(500).json({ error: 'Order tracking not available' });
  }
  
  const { orderId } = req.params;
  const status = await orderTracker.getTrackingStatus(orderId);
  res.json(status);
});

app.post('/api/orders/:orderId/stop-tracking', async (req, res) => {
  if (!orderTracker) {
    return res.status(500).json({ error: 'Order tracking not available' });
  }
  
  const { orderId } = req.params;
  const result = await orderTracker.stopTracking(orderId);
  res.json(result);
});

// Shopify Draft Order Creation
app.post('/apps/instant-import/create-draft-order', async (req, res) => {
  try {
    const { products, deliveryFees, totals, customer, originalUrls } = req.body;
    
    if (!SHOPIFY_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Shopify not configured. Please check API credentials.' });
    }
    
    if (!customer || !customer.email || !customer.name) {
      return res.status(400).json({ error: 'Customer information required' });
    }
    
    // Create line items for the draft order
    const lineItems = [];
    
    // Add each product as a line item
    products.forEach(product => {
      if (product.price && product.price > 0) {
        lineItems.push({
          title: product.name,
          price: product.price.toFixed(2),
          quantity: 1,
          properties: [
            { name: 'Source URL', value: product.url },
            { name: 'Retailer', value: product.retailer },
            { name: 'Category', value: product.category }
          ]
        });
      }
    });
    
    // Add duty as a line item
    if (totals.dutyAmount > 0) {
      lineItems.push({
        title: 'Bermuda Duty + Wharfage (26.5%)',
        price: totals.dutyAmount.toFixed(2),
        quantity: 1,
        taxable: false
      });
    }
    
    // Add delivery fees as line items
    Object.entries(deliveryFees).forEach(([vendor, fee]) => {
      if (fee > 0) {
        lineItems.push({
          title: `${vendor} US Delivery Fee`,
          price: fee.toFixed(2),
          quantity: 1,
          taxable: false
        });
      }
    });
    
    // Add shipping cost as a line item
    if (totals.totalShippingCost > 0) {
      lineItems.push({
        title: 'Shipping & Handling to Bermuda',
        price: (totals.shippingCost || totals.totalShippingCost || 0).toFixed(2),
        quantity: 1,
        taxable: false
      });
    }
    
    // Create the draft order
    const draftOrderData = {
      draft_order: {
        line_items: lineItems,
        customer: {
          email: customer.email,
          first_name: customer.name.split(' ')[0],
          last_name: customer.name.split(' ').slice(1).join(' ') || ''
        },
        email: customer.email,
        note: `Import Calculator Order\n\nOriginal URLs:\n${originalUrls}`,
        tags: 'import-calculator, ocean-freight',
        tax_exempt: true,
        send_receipt: false,
        send_fulfillment_receipt: false
      }
    };
    
    console.log(`📝 Creating draft order for ${customer.email}...`);
    
    // Make request to Shopify
    const shopifyResponse = await axios.post(
      `https://${SHOPIFY_DOMAIN}/admin/api/2023-10/draft_orders.json`,
      draftOrderData,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const draftOrder = shopifyResponse.data.draft_order;
    console.log(`✅ Draft order ${draftOrder.name} created successfully`);
    
    // Don't send invoice automatically - let customer complete checkout
    res.json({
      success: true,
      draftOrderId: draftOrder.id,
      draftOrderNumber: draftOrder.name,
      invoiceUrl: draftOrder.invoice_url,
      checkoutUrl: `https://${SHOPIFY_DOMAIN}/admin/draft_orders/${draftOrder.id}`,
      totalAmount: totals.grandTotal
    });
    
  } catch (error) {
    console.error('Draft order creation error:', error.response?.data || error);
    res.status(500).json({ 
      error: 'Failed to create draft order. Please try again or contact support.',
      details: error.response?.data?.errors || error.message
    });
  }
});

// Add API endpoint to view BOL statistics
app.get('/api/bol-stats', async (req, res) => {
  await bolHistory.initialize();
  
  const stats = {
    initialized: bolHistory.initialized,
    totalPatterns: bolHistory.volumePatterns.size,
    productKeywords: bolHistory.productPatterns.size,
    categories: {}
  };
  
  // Get category breakdown
  bolHistory.volumePatterns.forEach((volumeStats, category) => {
    stats.categories[category] = {
      samples: volumeStats.count,
      avgVolume: volumeStats.average.toFixed(2) + ' ft³',
      range: `${volumeStats.min.toFixed(1)}-${volumeStats.max.toFixed(1)} ft³`
    };
  });
  
  res.json(stats);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📍 Admin Panel: http://localhost:${PORT}/admin (admin:1064)`);
});