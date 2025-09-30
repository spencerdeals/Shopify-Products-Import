// server.js - Main server for Bermuda Import Calculator
// Handles instant import API with Zyte normalization
const express = require('express');
const cors = require('cors');
const path = require('path');

// Import instant import router
let instantImportRouter = null;
try {
  const createInstantImportRouter = require('./server/routes/instantImport');
  instantImportRouter = createInstantImportRouter();
} catch (e) {
  console.warn('Instant import router not available:', e.message);
}

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Mount instant import routes at root if available
if (instantImportRouter) {
  app.use('/', instantImportRouter);
  console.log('✅ Instant Import API mounted at root');
} else {
  // Fallback minimal endpoints
  app.post('/', (req, res) => {
    res.json({ 
      error: 'Instant import not configured',
      message: 'Missing dependencies or configuration'
    });
  });
  
  app.post('/instant-import', (req, res) => {
    res.json({ 
      error: 'Instant import not configured',
      message: 'Missing dependencies or configuration'
    });
  });
}

// Mount dev tools (browser-only testing helpers) - commented out due to missing file
// const devTools = require("./routes/devTools");
// app.use("/", devTools());

// Health check endpoint
app.get('/instant-import/health', (req, res) => {
  res.json({ 
    ok: true,
    timestamp: new Date().toISOString(),
    status: 'healthy'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).send(`
    <h1>Bermuda Import Calculator API</h1>
    <p>Server is running on port ${PORT}</p>
    <ul>
      <li><a href="/instant-import/health">Health Check</a></li>
      <li>POST / - Instant Import</li>
      <li>POST /instant-import - Instant Import</li>
    </ul>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/instant-import/health`);
  console.log(`📦 Instant Import: POST http://localhost:${PORT}/`);
});