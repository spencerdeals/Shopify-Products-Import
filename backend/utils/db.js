const TABLE_SQL = `
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
);
`;

let _client = null;
let _warned = false;

function warnOnce(msg) {
  if (_warned) return;
  _warned = true;
  console.warn(msg);
}

function tryLibsql() {
  try {
    const { createClient } = require('@libsql/client');
    const url = process.env.TORSO_DATABASE_URL;
    const authToken = process.env.TORSO_AUTH_TOKEN;
    if (!url || !authToken) return null;
    return createClient({ url, authToken });
  } catch (_e) {
    return null;
  }
}

async function fetchExecute(sql, params = []) {
  const url = process.env.TORSO_DATABASE_URL;
  const token = process.env.TORSO_AUTH_TOKEN;
  if (!url || !token) throw new Error('TORSO envs missing for fetch fallback');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sql, params }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`DB HTTP error ${r.status}: ${text}`);
  }
  return r.json();
}

async function initSchema(client) {
  if (client && client.execute) {
    await client.execute(TABLE_SQL);
    return;
  }
  await fetchExecute(TABLE_SQL, []);
}

async function getClient() {
  if (_client) return _client;

  const url = process.env.TORSO_DATABASE_URL;
  const token = process.env.TORSO_AUTH_TOKEN;
  if (!url || !token) {
    warnOnce('⚠️  TORSO_DATABASE_URL or TORSO_AUTH_TOKEN not configured - DB persistence disabled');
    _client = { disabled: true };
    return _client;
  }

  const libsqlClient = tryLibsql();
  if (libsqlClient) {
    _client = {
      disabled: false,
      kind: 'libsql',
      execute: (sql, params) => libsqlClient.execute({ sql, args: params }),
    };
  } else {
    _client = {
      disabled: false,
      kind: 'http',
      execute: (sql, params) => fetchExecute(sql, params),
    };
  }

  try {
    await initSchema(_client);
  } catch (e) {
    warnOnce(`⚠️  DB init failed: ${e.message}`);
    _client = { disabled: true };
  }
  return _client;
}

function makeId(retailer, sku, url) {
  const key = sku || url || '';
  return `${(retailer || '').trim()}:${key.trim()}`;
}

async function saveScrape(obj = {}) {
  const client = await getClient();
  if (client.disabled) return { ok: false, reason: 'disabled' };

  const {
    retailer = null,
    sku = null,
    url = null,
    title = null,
    price = null,
    dutyPct = null,
    cubic_feet = null,
    carton = null,
    dimension_source = null,
    estimation_notes = null,
  } = obj;

  const id = makeId(retailer, sku, url);
  const cartonStr = carton ? JSON.stringify(carton) : null;
  const updated_at = new Date().toISOString();

  const sql = `
    INSERT INTO scrapes (id, retailer, sku, url, title, price, dutyPct, cubic_feet, carton, dimension_source, estimation_notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      retailer=excluded.retailer,
      sku=excluded.sku,
      url=excluded.url,
      title=excluded.title,
      price=excluded.price,
      dutyPct=excluded.dutyPct,
      cubic_feet=excluded.cubic_feet,
      carton=excluded.carton,
      dimension_source=excluded.dimension_source,
      estimation_notes=excluded.estimation_notes,
      updated_at=excluded.updated_at
  `;
  const params = [id, retailer, sku, url, title, price, dutyPct, cubic_feet, cartonStr, dimension_source, estimation_notes, updated_at];
  await client.execute(sql, params);
  return { ok: true, id };
}

async function loadScrapeByKey({ retailer, sku, url }) {
  const client = await getClient();
  if (client.disabled) return null;

  const id = makeId(retailer, sku, url);
  const sql = `SELECT * FROM scrapes WHERE id = ? LIMIT 1`;
  const params = [id];

  const res = await client.execute(sql, params);
  const row = (res && (res.rows || res.data || res))?.[0];
  if (!row) return null;

  const get = (k) => (row[k] !== undefined ? row[k] : (row.value && row.value[k]));
  const cartonStr = get('carton');
  let carton = null;
  if (cartonStr && typeof cartonStr === 'string') {
    try { carton = JSON.parse(cartonStr); } catch { carton = null; }
  }

  return {
    id: get('id'),
    retailer: get('retailer'),
    sku: get('sku'),
    url: get('url'),
    title: get('title'),
    price: get('price'),
    dutyPct: get('dutyPct'),
    cubic_feet: get('cubic_feet'),
    carton,
    dimension_source: get('dimension_source'),
    estimation_notes: get('estimation_notes'),
    updated_at: get('updated_at'),
  };
}

module.exports = {
  getClient,
  saveScrape,
  loadScrapeByKey,
};
