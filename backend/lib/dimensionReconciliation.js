const { validateDimensions } = require('./dimensionUtils');

const SOURCE_WEIGHTS = {
  'manual': 1.20,
  'override': 1.20,
  'amazon': 1.05,
  'zyte': 1.00,
  'other': 0.95
};

function calculateRecencyWeight(observedAt) {
  const now = new Date();
  const observed = new Date(observedAt);
  const daysDiff = (now - observed) / (1000 * 60 * 60 * 24);
  return Math.max(0.5, 1.0 - daysDiff / 180);
}

function calculateObservationScore(observation) {
  const baseWeight = SOURCE_WEIGHTS[observation.source] || SOURCE_WEIGHTS['other'];
  const confLevel = observation.conf_level || 0.80;
  const recencyWeight = calculateRecencyWeight(observation.observed_at);
  return baseWeight * confLevel * recencyWeight;
}

function isComplete(observation) {
  return observation.box_length_in > 0 &&
         observation.box_width_in > 0 &&
         observation.box_height_in > 0;
}

function calculateVolume(length, width, height) {
  return length * width * height;
}

function volumesMatch(vol1, vol2) {
  if (!vol1 || vol2) return false;
  const ratio = vol1 / vol2;
  return ratio >= 0.9 && ratio <= 1.1;
}

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
  return createClient(supabaseUrl, supabaseKey);
}

async function reconcileVariantDimensions(variantId) {
  console.log(`[Reconcile] Processing variant: ${variantId}`);

  const { data: observations, error } = await getSupabase()
    .from('dimension_observations')
    .select('*')
    .eq('variant_id', variantId)
    .order('observed_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('[Reconcile] Error fetching observations:', error);
    return null;
  }

  if (!observations || observations.length === 0) {
    console.log('[Reconcile] No observations found');
    return null;
  }

  const scored = observations
    .map(obs => ({
      ...obs,
      score: calculateObservationScore(obs),
      isComplete: isComplete(obs)
    }))
    .sort((a, b) => b.score - a.score);

  const bestComplete = scored.find(obs => obs.isComplete);

  if (!bestComplete) {
    console.log('[Reconcile] No complete observations found');
    return null;
  }

  console.log(`[Reconcile] Best observation: source=${bestComplete.source}, score=${bestComplete.score.toFixed(3)}, conf=${bestComplete.conf_level}`);

  let finalWeight = bestComplete.box_weight_lb;

  if (!finalWeight || finalWeight === 0) {
    const bestVolume = calculateVolume(
      bestComplete.box_length_in,
      bestComplete.box_width_in,
      bestComplete.box_height_in
    );

    for (const obs of scored) {
      if (obs.id === bestComplete.id) continue;
      if (!obs.box_weight_lb || obs.box_weight_lb === 0) continue;
      if (!obs.isComplete) continue;

      const obsVolume = calculateVolume(
        obs.box_length_in,
        obs.box_width_in,
        obs.box_height_in
      );

      if (volumesMatch(bestVolume, obsVolume)) {
        finalWeight = obs.box_weight_lb;
        console.log(`[Reconcile] Supplemented weight from ${obs.source}: ${finalWeight} lb`);
        break;
      }
    }
  }

  const reconciledPackage = {
    variant_id: variantId,
    box_length_in: bestComplete.box_length_in,
    box_width_in: bestComplete.box_width_in,
    box_height_in: bestComplete.box_height_in,
    box_weight_lb: finalWeight || 10,
    boxes_per_unit: bestComplete.boxes_per_unit || 1,
    reconciled_source: bestComplete.source,
    reconciled_conf_level: Math.min(0.99, Math.max(0.5, bestComplete.conf_level))
  };

  const validationErrors = validateDimensions(reconciledPackage);
  if (validationErrors.length > 0) {
    console.error('[Reconcile] Validation errors:', validationErrors);
    return null;
  }

  const { error: upsertError } = await getSupabase()
    .from('packaging')
    .upsert(reconciledPackage, { onConflict: 'variant_id' });

  if (upsertError) {
    console.error('[Reconcile] Error upserting packaging:', upsertError);
    return null;
  }

  console.log(`[Reconcile] RECONCILE: variant_id=${variantId}, source=${reconciledPackage.reconciled_source}, conf=${reconciledPackage.reconciled_conf_level.toFixed(2)}, dims=${reconciledPackage.box_length_in}×${reconciledPackage.box_width_in}×${reconciledPackage.box_height_in}`);

  return reconciledPackage;
}

async function insertObservationAndReconcile(variantId, observation) {
  const validationErrors = validateDimensions(observation);
  if (validationErrors.length > 0) {
    console.error('[DimObs] Validation errors:', validationErrors);
    throw new Error(`Invalid dimensions: ${validationErrors.join(', ')}`);
  }

  const { data, error } = await getSupabase()
    .from('dimension_observations')
    .insert({
      variant_id: variantId,
      source: observation.source || 'other',
      box_length_in: observation.length,
      box_width_in: observation.width,
      box_height_in: observation.height,
      box_weight_lb: observation.weight,
      boxes_per_unit: observation.boxesPerUnit || 1,
      conf_level: observation.confLevel || 0.80
    })
    .select()
    .single();

  if (error) {
    console.error('[DimObs] Error inserting observation:', error);
    throw error;
  }

  console.log(`[DimObs] OBS_INSERT: variant_id=${variantId}, source=${observation.source}, dims=${observation.length}×${observation.width}×${observation.height}, conf=${observation.confLevel}`);

  await reconcileVariantDimensions(variantId);

  return data;
}

module.exports = {
  reconcileVariantDimensions,
  insertObservationAndReconcile,
  calculateObservationScore,
  calculateRecencyWeight,
  SOURCE_WEIGHTS
};
