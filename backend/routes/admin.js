const express = require('express');
const { saveScrape, loadScrapeByKey } = require('../utils/db');

const router = express.Router();

function requireAdminKey(req, res, next) {
  const auth = req.headers.authorization;
  const adminKey = process.env.ADMIN_KEY;

  if (!adminKey) {
    return res.status(500).json({ error: 'ADMIN_KEY not configured' });
  }

  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const token = auth.slice(7);
  if (token !== adminKey) {
    return res.status(401).json({ error: 'Invalid authorization' });
  }

  next();
}

router.post('/override', requireAdminKey, async (req, res) => {
  try {
    const { retailer, sku, url, overrides } = req.body;

    if (!retailer || (!sku && !url)) {
      return res.status(400).json({ error: 'retailer and (sku or url) required' });
    }

    if (!overrides || typeof overrides !== 'object') {
      return res.status(400).json({ error: 'overrides object required' });
    }

    const key = { retailer, sku, url };
    const existing = await loadScrapeByKey(key);

    const merged = {
      retailer,
      sku: sku || null,
      url: url || '',
      title: existing?.title || 'Admin Override',
      price: existing?.price || 0,
      dutyPct: overrides.dutyPct !== undefined ? overrides.dutyPct : existing?.dutyPct,
      cubic_feet: overrides.cubic_feet !== undefined ? overrides.cubic_feet : existing?.cubic_feet,
      carton: overrides.carton !== undefined ? overrides.carton : existing?.carton,
      dimension_source: overrides.dimension_source !== undefined ? overrides.dimension_source : existing?.dimension_source,
      estimation_notes: overrides.estimation_notes !== undefined ? overrides.estimation_notes : existing?.estimation_notes
    };

    await saveScrape(merged);

    res.json({
      success: true,
      record: {
        id: `${retailer}:${sku || url}`,
        ...merged
      }
    });
  } catch (err) {
    console.error('Admin override error:', err);
    res.status(500).json({ error: 'Failed to save override' });
  }
});

module.exports = router;
