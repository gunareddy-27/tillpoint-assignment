/**
 * api.js — Thin wrapper around the Python Tillpoint REST API.
 *
 * During development Vite proxies /api/* → http://127.0.0.1:8000
 * In production the built static files are served by server.py which
 * handles both /api/* routes and static assets from frontend/dist/.
 *
 * Base path is empty so every call is relative to wherever the app is served.
 */

const BASE = '';   // same-origin; proxy or server.py forwards to Python

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---- Products ----
export const getProduct  = (sku)         => request('GET',  `/products/${sku}`);
export const updatePrice = (sku, price)  => request('PUT',  `/products/${sku}`, { price_cents: price });

// ---- Orders ----
export const createOrder = (payload)     => request('POST', '/orders', payload);
export const getOrder    = (id)          => request('GET',  `/orders/${id}`);
export const cancelOrder = (id)          => request('POST', `/orders/${id}/cancel`);

// ---- Payments ----
export const sendPayment = (payload)     => request('POST', '/webhooks/payments', payload);

// ---- Reports ----
export const dailySales  = (day, offsetMins = 0) =>
  request('GET', `/reports/daily/${day}`, { utc_offset_minutes: offsetMins });
