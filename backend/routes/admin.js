const express = require('express');
const fs = require('fs');
const path = require('path');
const { saveScrape, loadScrapeByKey, getCalibration, setCalibration } = require('../utils/db');
const { updateEMA, kProfileVendor, kRetailerProfile } = require('../utils/calibration');
const { loadOverrides, saveOverrides, getOverrideKey } = require('../utils/cartonEstimator');

const router = express.Router();
const DEFAULTS_PATH = path.join(__dirname, '../../data/defaults.json');

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
      dimension_source: overrides.carton !== undefined ? 'admin_override' : (overrides.dimension_source !== undefined ? overrides.dimension_source : existing?.dimension_source),
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

router.post('/actual-cartons', requireAdminKey, async (req, res) => {
  try {
    const { retailer, sku, url, profile, vendorTier, boxes, est_ft3 } = req.body || {};

    if (!retailer || !(sku || url)) {
      return res.status(400).json({ error: 'retailer and (sku or url) required' });
    }

    if (!Array.isArray(boxes) || boxes.length === 0) {
      return res.status(400).json({ error: 'boxes[] array required' });
    }

    let actual = 0;
    for (const b of boxes) {
      const L = Number(b.L || b.length || 0);
      const W = Number(b.W || b.width || 0);
      const H = Number(b.H || b.height || 0);
      if (L > 0 && W > 0 && H > 0) {
        actual += (L * W * H) / 1728;
      }
    }
    actual = Math.round(actual * 2) / 2;

    const overrides = loadOverrides();
    const key = getOverrideKey(retailer, sku, url);
    if (key) {
      overrides[key] = {
        retailer,
        sku: sku || null,
        url: url || null,
        profile: profile || 'other',
        vendorTier: vendorTier || 'neutral',
        boxes,
        est_ft3: actual,
        actual_ft3: actual,
        updated_at: new Date().toISOString()
      };
      saveOverrides(overrides);
    }

    const p = profile || 'other';
    const vt = vendorTier || 'neutral';
    const estimated = Number(est_ft3) || actual || 1;
    const observedM = Math.max(0.1, Math.min(5, actual / Math.max(0.1, estimated)));

    const db = { getCalibration, setCalibration };
    const m1 = await updateEMA(db, kRetailerProfile(retailer, p), observedM);
    const m2 = await updateEMA(db, kProfileVendor(p, vt), observedM);

    return res.json({
      ok: true,
      actual_ft3: actual,
      observed_multiplier: observedM,
      updated: {
        retailer_profile: { key: kRetailerProfile(retailer, p), multiplier: m1 },
        profile_vendor: { key: kProfileVendor(p, vt), multiplier: m2 }
      }
    });
  } catch (err) {
    console.error('actual-cartons error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/actual-cartons-csv', requireAdminKey, async (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ error: 'csv field required (text/csv content)' });
    }

    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV must have header + at least one data row' });
    }

    const header = lines[0].toLowerCase().split(',').map(h => h.trim());
    const overrides = loadOverrides();
    const results = { success: 0, errors: [] };

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',').map(c => c.trim());
      const record = {};
      header.forEach((h, idx) => { record[h] = row[idx] || ''; });

      const retailer = record.retailer;
      const sku = record.sku || null;
      const url = record.url || null;
      const profile = record.profile || 'other';
      const vendorTier = record.vendortier || 'neutral';

      if (!retailer || !(sku || url)) {
        results.errors.push({ line: i + 1, error: 'missing retailer or (sku/url)' });
        continue;
      }

      const boxes = [];
      let boxIdx = 1;
      while (record[`box${boxIdx}_l`]) {
        const L = parseFloat(record[`box${boxIdx}_l`]);
        const W = parseFloat(record[`box${boxIdx}_w`]);
        const H = parseFloat(record[`box${boxIdx}_h`]);
        if (L > 0 && W > 0 && H > 0) {
          boxes.push({ L, W, H });
        }
        boxIdx++;
      }

      if (boxes.length === 0) {
        results.errors.push({ line: i + 1, error: 'no valid boxes found' });
        continue;
      }

      let actual = 0;
      for (const b of boxes) {
        actual += (b.L * b.W * b.H) / 1728;
      }
      actual = Math.round(actual * 2) / 2;

      const key = getOverrideKey(retailer, sku, url);
      if (key) {
        overrides[key] = {
          retailer,
          sku,
          url,
          profile,
          vendorTier,
          boxes,
          est_ft3: actual,
          actual_ft3: actual,
          updated_at: new Date().toISOString()
        };
        results.success++;
      }
    }

    saveOverrides(overrides);

    return res.json({
      ok: true,
      imported: results.success,
      errors: results.errors
    });
  } catch (err) {
    console.error('CSV upload error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/ping', (req, res) => {
  const oceanRate = Number(process.env.OCEAN_RATE_PER_FT3 || 8.5);
  const minFreight = Number(process.env.MIN_FREIGHT_USD || 30);
  const njTaxRate = Number(process.env.NJ_TAX_RATE_PCT || 6.625);

  res.json({
    ok: true,
    env: {
      rate: oceanRate,
      min: minFreight,
      njTaxRate: njTaxRate
    }
  });
});

router.get('/defaults', requireAdminKey, (req, res) => {
  try {
    const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
    res.json({ ok: true, defaults });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load defaults' });
  }
});

router.post('/defaults', requireAdminKey, (req, res) => {
  try {
    const { defaults } = req.body;
    if (!defaults || typeof defaults !== 'object') {
      return res.status(400).json({ error: 'defaults object required' });
    }

    let current = {};
    try {
      current = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
    } catch (e) {
    }

    const merged = { ...current, ...defaults };
    fs.writeFileSync(DEFAULTS_PATH, JSON.stringify(merged, null, 2), 'utf8');

    res.json({ ok: true, defaults: merged });
  } catch (err) {
    console.error('Defaults update error:', err);
    res.status(500).json({ error: 'Failed to update defaults' });
  }
});

module.exports = router;
