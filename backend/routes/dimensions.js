/**
 * Dimensions API Routes
 *
 * Serves dimension data to quote estimator with intelligent fallback chain:
 * packaging → observation → category → defaults
 */

const express = require('express');
const router = express.Router();
const { calculateCubicFeet, validateDimensions } = require('../lib/dimensionUtils');
const { insertObservationAndReconcile } = require('../lib/dimensionReconciliation');
const { getCategoryPattern, extractLeafCategory } = require('../lib/categoryPatternLearning');

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials');
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * GET /api/quote/dimensions?variantSku=XXX
 *
 * Returns dimensions with 4-tier fallback chain
 */
router.get('/dimensions', async (req, res) => {
  const { variantSku } = req.query;

  if (!variantSku) {
    return res.status(400).json({ error: 'variantSku is required' });
  }

  try {
    const supabase = getSupabase();

    // Get variant with product data
    const { data: variant, error: variantError } = await supabase
      .from('variants')
      .select('id, variant_sku, products (id, title, breadcrumbs)')
      .eq('variant_sku', variantSku)
      .maybeSingle();

    if (variantError) throw variantError;

    if (!variant) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    console.log(`[QuoteDims] Looking up dimensions for ${variantSku}`);

    // TIER 1: Try packaging (current best)
    const { data: pkg, error: pkgError } = await supabase
      .from('packaging')
      .select('*')
      .eq('variant_id', variant.id)
      .maybeSingle();

    if (!pkgError && pkg && pkg.box_length_in && pkg.box_width_in && pkg.box_height_in) {
      const cuft = calculateCubicFeet(
        pkg.box_length_in,
        pkg.box_width_in,
        pkg.box_height_in,
        pkg.boxes_per_unit || 1
      );

      console.log(`[QuoteDims] ESTIMATOR_DIM_SOURCE: variantSku=${variantSku}, strategy=packaging, cuft=${cuft}`);

      return res.json({
        variantSku,
        source: 'packaging',
        confLevel: pkg.reconciled_conf_level || 0.80,
        dimensions: {
          lengthIn: pkg.box_length_in,
          widthIn: pkg.box_width_in,
          heightIn: pkg.box_height_in,
          weightLb: pkg.box_weight_lb || 10,
          boxesPerUnit: pkg.boxes_per_unit || 1
        },
        cuft,
        notes: `Reconciled from ${pkg.reconciled_source || 'unknown'} source`
      });
    }

    // TIER 2: Try latest high-confidence observation
    const { data: recentObs, error: obsError } = await supabase
      .from('dimension_observations')
      .select('*')
      .eq('variant_id', variant.id)
      .gte('conf_level', 0.8)
      .not('box_length_in', 'is', null)
      .not('box_width_in', 'is', null)
      .not('box_height_in', 'is', null)
      .order('observed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!obsError && recentObs) {
      const cuft = calculateCubicFeet(
        recentObs.box_length_in,
        recentObs.box_width_in,
        recentObs.box_height_in,
        recentObs.boxes_per_unit || 1
      );

      console.log(`[QuoteDims] ESTIMATOR_DIM_SOURCE: variantSku=${variantSku}, strategy=observation, cuft=${cuft}`);

      return res.json({
        variantSku,
        source: 'observation',
        confLevel: recentObs.conf_level,
        dimensions: {
          lengthIn: recentObs.box_length_in,
          widthIn: recentObs.box_width_in,
          heightIn: recentObs.box_height_in,
          weightLb: recentObs.box_weight_lb || 10,
          boxesPerUnit: recentObs.boxes_per_unit || 1
        },
        cuft,
        notes: `Latest ${recentObs.source} observation from ${new Date(recentObs.observed_at).toISOString().split('T')[0]}`
      });
    }

    // TIER 3: Try category pattern
    if (variant.products && variant.products.breadcrumbs) {
      const category = extractLeafCategory(variant.products.breadcrumbs);
      const pattern = await getCategoryPattern(category);

      if (pattern && pattern.avg_length > 0) {
        const cuft = calculateCubicFeet(
          pattern.avg_length,
          pattern.avg_width,
          pattern.avg_height,
          1
        );

        console.log(`[QuoteDims] ESTIMATOR_DIM_SOURCE: variantSku=${variantSku}, strategy=category, cuft=${cuft}`);

        return res.json({
          variantSku,
          source: 'category',
          confLevel: 0.50,
          dimensions: {
            lengthIn: pattern.avg_length,
            widthIn: pattern.avg_width,
            heightIn: pattern.avg_height,
            weightLb: pattern.avg_weight || 10,
            boxesPerUnit: 1
          },
          cuft,
          notes: `Category pattern from ${pattern.sample_count} samples in "${category}"`
        });
      }
    }

    // TIER 4: Safe defaults
    const defaultDims = { lengthIn: 24, widthIn: 18, heightIn: 12, weightLb: 10, boxesPerUnit: 1 };
    const cuft = calculateCubicFeet(defaultDims.lengthIn, defaultDims.widthIn, defaultDims.heightIn, 1);

    console.log(`[QuoteDims] ESTIMATOR_DIM_SOURCE: variantSku=${variantSku}, strategy=default, cuft=${cuft}`);

    return res.json({
      variantSku,
      source: 'default',
      confLevel: 0.30,
      dimensions: defaultDims,
      cuft,
      notes: 'Safe defaults (no dimension data available)'
    });

  } catch (error) {
    console.error('[QuoteDims] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/dimensions/ingest
 *
 * Manual dimension entry or Amazon fast-ingest
 * Body: { variantSku, dimensions: { length, width, height, weight, boxesPerUnit }, source, confLevel }
 */
router.post('/ingest', async (req, res) => {
  const { variantSku, dimensions, source = 'manual', confLevel = 0.95 } = req.body;

  if (!variantSku || !dimensions) {
    return res.status(400).json({ error: 'variantSku and dimensions are required' });
  }

  try {
    const supabase = getSupabase();

    // Get variant ID
    const { data: variant, error: variantError } = await supabase
      .from('variants')
      .select('id')
      .eq('variant_sku', variantSku)
      .maybeSingle();

    if (variantError) throw variantError;

    if (!variant) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    // Validate dimensions
    const validationErrors = validateDimensions({
      length: dimensions.length,
      width: dimensions.width,
      height: dimensions.height,
      weight: dimensions.weight
    });

    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Invalid dimensions', details: validationErrors });
    }

    // Insert observation and reconcile
    const observation = {
      source,
      length: dimensions.length,
      width: dimensions.width,
      height: dimensions.height,
      weight: dimensions.weight,
      boxesPerUnit: dimensions.boxesPerUnit || 1,
      confLevel
    };

    await insertObservationAndReconcile(variant.id, observation);

    console.log(`[DimIngest] Successfully ingested dimensions for ${variantSku}`);

    res.json({
      success: true,
      variantSku,
      message: 'Dimensions ingested and reconciled successfully'
    });

  } catch (error) {
    console.error('[DimIngest] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/dimensions/bulk-ingest
 *
 * Bulk dimension entry for multiple variants
 * Body: { entries: [{ variantSku, dimensions, source, confLevel }, ...] }
 */
router.post('/bulk-ingest', async (req, res) => {
  const { entries } = req.body;

  if (!entries || !Array.isArray(entries)) {
    return res.status(400).json({ error: 'entries array is required' });
  }

  try {
    const supabase = getSupabase();
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const entry of entries) {
      try {
        const { variantSku, dimensions, source = 'manual', confLevel = 0.95 } = entry;

        // Get variant ID
        const { data: variant } = await supabase
          .from('variants')
          .select('id')
          .eq('variant_sku', variantSku)
          .maybeSingle();

        if (!variant) {
          results.push({ variantSku, success: false, error: 'Variant not found' });
          errorCount++;
          continue;
        }

        // Validate
        const validationErrors = validateDimensions({
          length: dimensions.length,
          width: dimensions.width,
          height: dimensions.height,
          weight: dimensions.weight
        });

        if (validationErrors.length > 0) {
          results.push({ variantSku, success: false, error: validationErrors.join(', ') });
          errorCount++;
          continue;
        }

        // Insert and reconcile
        const observation = {
          source,
          length: dimensions.length,
          width: dimensions.width,
          height: dimensions.height,
          weight: dimensions.weight,
          boxesPerUnit: dimensions.boxesPerUnit || 1,
          confLevel
        };

        await insertObservationAndReconcile(variant.id, observation);

        results.push({ variantSku, success: true });
        successCount++;

      } catch (error) {
        results.push({ variantSku: entry.variantSku, success: false, error: error.message });
        errorCount++;
      }
    }

    console.log(`[BulkIngest] Processed ${entries.length} entries: ${successCount} success, ${errorCount} errors`);

    res.json({
      success: true,
      totalProcessed: entries.length,
      successCount,
      errorCount,
      results
    });

  } catch (error) {
    console.error('[BulkIngest] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
