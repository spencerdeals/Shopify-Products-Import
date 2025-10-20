/**
 * Batch Processing Routes
 *
 * Handles batch product processing, CSV export, draft orders, and quote PDFs.
 */

const express = require('express');
const router = express.Router();

const { processBatch } = require('../batch/processor');
const { exportBatchCSV } = require('../batch/csvExporter');
const { createDraftOrder } = require('../shopify/draftOrder');
const { generateQuotePDF } = require('../quote/pdfGenerator');

// In-memory storage for batch sessions (in production, use Redis or database)
const batchSessions = new Map();

/**
 * POST /api/batch/process
 * Process multiple products in batch and return handles
 */
router.post('/process', async (req, res) => {
  try {
    const { products } = req.body; // Array of Zyte product data

    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ error: 'Invalid products array' });
    }

    console.log(`\n[Batch API] Processing ${products.length} products`);

    // Process batch
    const results = await processBatch(products);

    // Extract handles for successful products
    const handles = results
      .filter(r => !r.error)
      .map(r => r.handle);

    // Create batch session
    const batchId = Date.now().toString();
    batchSessions.set(batchId, {
      handles,
      products,
      results,
      createdAt: new Date()
    });

    // Clean up old sessions (older than 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [id, session] of batchSessions.entries()) {
      if (session.createdAt.getTime() < oneHourAgo) {
        batchSessions.delete(id);
      }
    }

    res.json({
      success: true,
      batchId,
      handles,
      processed: results.length,
      errors: results.filter(r => r.error).length
    });
  } catch (error) {
    console.error('[Batch API] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/batch/csv/:batchId
 * Export Shopify CSV for batch
 */
router.get('/csv/:batchId', async (req, res) => {
  try {
    const { batchId } = req.params;
    const session = batchSessions.get(batchId);

    if (!session) {
      return res.status(404).json({ error: 'Batch session not found or expired' });
    }

    console.log(`\n[Batch API] Exporting CSV for batch ${batchId}`);

    // Generate CSV
    const { content, filename, rowCount } = await exportBatchCSV(session.handles);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);

    console.log(`[Batch API] CSV downloaded: ${filename}, ${rowCount} rows`);
  } catch (error) {
    console.error('[Batch API] CSV Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/batch/draft-order
 * Create Shopify draft order
 */
router.post('/draft-order', async (req, res) => {
  try {
    const { batchId, customerEmail, customerName, quantities } = req.body;
    const session = batchSessions.get(batchId);

    if (!session) {
      return res.status(404).json({ error: 'Batch session not found or expired' });
    }

    console.log(`\n[Batch API] Creating draft order for batch ${batchId}`);

    // Create draft order
    const draftOrder = await createDraftOrder(session.handles, {
      customerEmail,
      customerName,
      quantities
    });

    res.json({
      success: true,
      draftOrder
    });
  } catch (error) {
    console.error('[Batch API] Draft Order Error:', error);
    res.status(500).json({
      error: error.message,
      suggestion: error.message.includes('not found in Shopify')
        ? 'Please import the CSV into Shopify first'
        : null
    });
  }
});

/**
 * POST /api/batch/quote-pdf
 * Generate quote PDF
 */
router.post('/quote-pdf', async (req, res) => {
  try {
    const { batchId, customerName, customerEmail, customerPhone, quantities } = req.body;
    const session = batchSessions.get(batchId);

    if (!session) {
      return res.status(404).json({ error: 'Batch session not found or expired' });
    }

    console.log(`\n[Batch API] Generating quote PDF for batch ${batchId}`);

    // Generate PDF
    const { buffer, filename, quoteNumber } = await generateQuotePDF(session.handles, {
      customerName,
      customerEmail,
      customerPhone,
      quantities
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

    console.log(`[Batch API] PDF downloaded: ${filename} (Quote #${quoteNumber})`);
  } catch (error) {
    console.error('[Batch API] PDF Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
