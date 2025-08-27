// TEMPORARY DEBUG SERVER - Replace your entire server.js with this code
const express = require('express');
const app = express();

// Get port from Railway environment
const PORT = process.env.PORT || 3000;

console.log('=== DEBUG SERVER STARTING ===');
console.log(`Environment PORT: ${process.env.PORT}`);
console.log(`Using PORT: ${PORT}`);
console.log(`Node version: ${process.version}`);
console.log('Environment variables:', Object.keys(process.env).filter(k => !k.includes('KEY') && !k.includes('TOKEN')));

// CRITICAL: Health check must be first and simple
app.get('/health', (req, res) => {
  console.log('Health check hit!');
  res.status(200).json({ 
    status: 'OK',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Debug server running',
    port: PORT
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({
    working: true,
    env: {
      hasScrapingBee: !!process.env.SCRAPINGBEE_API_KEY,
      hasShopify: !!process.env.SHOPIFY_ACCESS_TOKEN,
      port: PORT
    }
  });
});

// CRITICAL: Bind to 0.0.0.0 for Railway
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Debug server listening on 0.0.0.0:${PORT}`);
  console.log(`✅ Health check: http://0.0.0.0:${PORT}/health`);
}).on('error', (err) => {
  console.error('❌ Server failed to start:', err);
  process.exit(1);
});

// Log every 10 seconds to show server is alive
setInterval(() => {
  console.log(`[${new Date().toISOString()}] Server still running on port ${PORT}`);
}, 10000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
