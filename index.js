/**
 * Main Server Entry Point
 * Mounts all API routes and serves frontend
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Mount API routes
const adminRoutes = require('./backend/routes/admin');
const batchRoutes = require('./backend/routes/batch');
const dimensionsRoutes = require('./backend/routes/dimensions');
const shopifyRoutes = require('./backend/routes/shopify');
const versionRoutes = require('./backend/routes/version');

app.use('/api/admin', adminRoutes);
app.use('/api/batch', batchRoutes);
app.use('/api/quote', dimensionsRoutes); // Legacy dimensions/order route
app.use('/api/shopify', shopifyRoutes);
app.use('/api/version', versionRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend
app.use(express.static(path.join(__dirname, 'frontend')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Frontend: http://localhost:${PORT}`);
  console.log(`📍 API Health: http://localhost:${PORT}/health`);
  console.log(`📍 Admin Panel: http://localhost:${PORT}/admin`);
  console.log(`\n=== API ENDPOINTS ===`);
  console.log('POST /api/batch/process - Process products via Zyte');
  console.log('GET  /api/batch/csv/:batchId - Export Shopify CSV');
  console.log('POST /api/batch/draft-order - Create Shopify draft order');
  console.log('POST /api/batch/quote-pdf - Generate quote PDF');
  console.log('GET  /api/admin/products/:handle - Get product details');
  console.log('GET  /api/version - Get server version info');
});
