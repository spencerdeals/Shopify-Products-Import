const { createClient } = require('@libsql/client');

let client = null;
let dbAvailable = false;

function getClient() {
  if (client) return client;

  const url = process.env.TORSO_DATABASE_URL;
  const authToken = process.env.TORSO_AUTH_TOKEN;

  if (!url || !authToken) {
    console.warn('⚠️  TORSO_DATABASE_URL or TORSO_AUTH_TOKEN not configured - DB persistence disabled');
    dbAvailable = false;
    return null;
  }

  try {
    client = createClient({ url, authToken });
    dbAvailable = true;
    console.log('✅ Turso DB client initialized');
    initializeTable();
    return client;
  } catch (err) {
    console.warn('⚠️  Failed to initialize Turso client:', err.message);
    dbAvailable = false;
    return null;
  }
}

async function initializeTable() {
  const db = getClient();
  if (!db) return;

  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS scrapes (
        id TEXT PRIMARY KEY,
        retailer TEXT,
        sku TEXT,
        url TEXT,
        title TEXT,
        price REAL,
        dutyPct REAL,
        cubic_feet REAL,
        carton TEXT,
        dimension_source TEXT,
        estimation_notes TEXT,
        updated_at TEXT
      )
    `);
    console.log('✅ scrapes table ready');
  } catch (err) {
    console.warn('⚠️  DB table init failed:', err.message);
  }
}

async function saveScrape(obj) {
  const db = getClient();
  if (!db) return;

  try {
    const id = `${obj.retailer}:${obj.sku || obj.url}`;
    const cartonJson = obj.carton ? JSON.stringify(obj.carton) : null;

    await db.execute({
      sql: `INSERT INTO scrapes (id, retailer, sku, url, title, price, dutyPct, cubic_feet, carton, dimension_source, estimation_notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              price = excluded.price,
              dutyPct = COALESCE(scrapes.dutyPct, excluded.dutyPct),
              cubic_feet = COALESCE(scrapes.cubic_feet, excluded.cubic_feet),
              carton = COALESCE(scrapes.carton, excluded.carton),
              dimension_source = COALESCE(scrapes.dimension_source, excluded.dimension_source),
              estimation_notes = COALESCE(scrapes.estimation_notes, excluded.estimation_notes),
              updated_at = excluded.updated_at`,
      args: [
        id,
        obj.retailer,
        obj.sku || null,
        obj.url,
        obj.title || obj.name,
        obj.price,
        obj.dutyPct || null,
        obj.cubic_feet || null,
        cartonJson,
        obj.dimension_source || null,
        obj.estimation_notes || null,
        new Date().toISOString()
      ]
    });
  } catch (err) {
    console.warn('⚠️  DB save failed:', err.message);
  }
}

async function loadScrapeByKey(key) {
  const db = getClient();
  if (!db) return null;

  try {
    const id = `${key.retailer}:${key.sku || key.url}`;
    const result = await db.execute({
      sql: 'SELECT * FROM scrapes WHERE id = ?',
      args: [id]
    });

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      retailer: row.retailer,
      sku: row.sku,
      url: row.url,
      title: row.title,
      price: row.price,
      dutyPct: row.dutyPct,
      cubic_feet: row.cubic_feet,
      carton: row.carton ? JSON.parse(row.carton) : null,
      dimension_source: row.dimension_source,
      estimation_notes: row.estimation_notes,
      updated_at: row.updated_at
    };
  } catch (err) {
    console.warn('⚠️  DB load failed:', err.message);
    return null;
  }
}

module.exports = {
  getClient,
  saveScrape,
  loadScrapeByKey
};
