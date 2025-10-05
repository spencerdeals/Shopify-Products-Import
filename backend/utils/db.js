const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️  Supabase credentials not found. Database features will be disabled.');
}

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

async function loadScrapeByKey({ retailer, url }) {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('scrapes')
      .select('*')
      .eq('retailer', retailer)
      .eq('url', url)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      return {
        dutyPct: data.duty_pct,
        cubic_feet: data.cubic_feet,
        carton: data.carton,
        dimension_source: data.dimension_source,
        estimation_notes: data.estimation_notes
      };
    }

    return null;
  } catch (err) {
    console.error('DB load error:', err.message);
    return null;
  }
}

async function saveScrape({ retailer, sku, url, title, price, dutyPct, cubic_feet, carton, dimension_source, estimation_notes }) {
  if (!supabase) return;

  try {
    const { data: existing } = await supabase
      .from('scrapes')
      .select('id')
      .eq('retailer', retailer)
      .eq('url', url)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('scrapes')
        .update({
          sku,
          title,
          price,
          duty_pct: dutyPct,
          cubic_feet,
          carton,
          dimension_source,
          estimation_notes
        })
        .eq('id', existing.id);

      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('scrapes')
        .insert({
          retailer,
          sku,
          url,
          title,
          price,
          duty_pct: dutyPct,
          cubic_feet,
          carton,
          dimension_source,
          estimation_notes
        });

      if (error) throw error;
    }
  } catch (err) {
    console.error('DB save error:', err.message);
  }
}

module.exports = {
  loadScrapeByKey,
  saveScrape
};
