const axios = require('axios');

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API = process.env.SHOPIFY_API_VERSION || '2023-10';

async function createDraftOrder(payload) {
  if (!SHOP || !TOKEN) {
    throw new Error('Shopify credentials not configured. Set SHOPIFY_SHOP and SHOPIFY_ACCESS_TOKEN.');
  }

  const url = `https://${SHOP}/admin/api/${API}/draft_orders.json`;

  const resp = await axios.post(url, { draft_order: payload }, {
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN
    }
  });

  return resp.data;
}

module.exports = { createDraftOrder };
