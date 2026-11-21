import { useState } from 'react';
import { createOrder, getOrder, cancelOrder } from '../api.js';
import { fmt, fmtDate } from '../utils.js';

const REGIONS = ['NONE', 'CA', 'NY', 'TX', 'DE'];

function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="badge-dot" />
      {status}
    </span>
  );
}

function OrderDetail({ order, onCancel, cancelLoading }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>ORDER ID</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.5px' }}>#{order.id}</div>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 12 }}>
        {[
          { label: 'Customer',  value: order.customer },
          { label: 'Region',    value: order.region },
          { label: 'Coupon',    value: order.coupon || '—' },
          { label: 'Created',   value: fmtDate(order.created_at) },
        ].map(({ label, value }) => (
          <div className="stat-card" key={label} style={{ padding: '14px 16px' }}>
            <span className="stat-label">{label}</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: 4 }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Items table */}
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.8px', textTransform: 'uppercase' }}>Items</div>
        <table className="tp-table">
          <thead><tr><th>SKU</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead>
          <tbody>
            {order.items.map((item, i) => (
              <tr key={i}>
                <td className="bold mono">{item.sku}</td>
                <td>{item.qty}</td>
                <td>{fmt(item.unit_price_cents)}</td>
                <td className="money-green">{fmt(item.unit_price_cents * item.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        {[
          { label: 'Subtotal',  value: fmt(order.subtotal_cents) },
          { label: 'Discount',  value: `− ${fmt(order.discount_cents)}`, color: order.discount_cents ? 'var(--amber)' : undefined },
          { label: 'Tax',       value: fmt(order.tax_cents), color: 'var(--text-secondary)', size: '0.85rem' },
          { label: 'Total',     value: fmt(order.total_cents), big: true },
        ].map(({ label, value, color, big, size }) => (
          <div key={label} style={{ display: 'flex', gap: 24, alignItems: 'baseline' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: 80, textAlign: 'right' }}>{label}</span>
            <span style={{ fontSize: big ? '1.3rem' : (size || '1rem'), fontWeight: big ? 800 : 600, color: color || 'var(--text-primary)', minWidth: 80, textAlign: 'right' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Cancel button */}
      {['pending', 'paid'].includes(order.status) && (
        <div>
          <button className="btn btn-danger" onClick={() => onCancel(order.id)} disabled={cancelLoading}>
            {cancelLoading ? '⏳ Cancelling…' : '🚫 Cancel Order'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  // Create form state
  const [customer,  setCustomer]  = useState('');
  const [region,    setRegion]    = useState('NONE');
  const [coupon,    setCoupon]    = useState('');
  const [items,     setItems]     = useState([{ sku: '', qty: 1 }]);
  const [createErr, setCreateErr] = useState('');
  const [creating,  setCreating]  = useState(false);

  // Lookup state
  const [lookupId,  setLookupId]  = useState('');
  const [order,     setOrder]     = useState(null);
  const [lookupErr, setLookupErr] = useState('');
  const [lookupLd,  setLookupLd]  = useState(false);
  const [cancelLd,  setCancelLd]  = useState(false);
  const [cancelMsg, setCancelMsg] = useState('');

  /* helpers */
  const addItem    = () => setItems(prev => [...prev, { sku: '', qty: 1 }]);
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const setItem    = (i, field, val) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it));

  async function handleCreate(e) {
    e.preventDefault();
    setCreateErr('');
    const payload = {
      customer: customer.trim(),
      region,
      coupon: coupon.trim() || undefined,
      items: items.map(it => ({ sku: it.sku.trim().toUpperCase(), qty: parseInt(it.qty, 10) })),
    };
    if (!payload.customer) { setCreateErr('Customer name is required.'); return; }
    if (payload.items.some(it => !it.sku || isNaN(it.qty) || it.qty <= 0)) {
      setCreateErr('All items need a SKU and positive quantity.'); return;
    }
    setCreating(true);
    try {
      const created = await createOrder(payload);
      setOrder(created); setLookupId(String(created.id));
      setCustomer(''); setRegion('NONE'); setCoupon(''); setItems([{ sku: '', qty: 1 }]);
    } catch (err) { setCreateErr(err.message); }
    finally { setCreating(false); }
  }

  async function handleLookup(e) {
    e.preventDefault();
    if (!lookupId.trim()) return;
    setLookupErr(''); setOrder(null); setCancelMsg('');
    setLookupLd(true);
    try { setOrder(await getOrder(parseInt(lookupId, 10))); }
    catch (err) { setLookupErr(err.message); }
    finally { setLookupLd(false); }
  }

  async function handleCancel(id) {
    setCancelLd(true); setCancelMsg('');
    try {
      const updated = await cancelOrder(id);
      setOrder(updated); setCancelMsg('Order cancelled successfully.');
    } catch (err) { setCancelMsg('Error: ' + err.message); }
    finally { setCancelLd(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div className="page-heading">
        <h1>Orders</h1>
        <p>Create new orders or look up and cancel existing ones.</p>
      </div>

      {/* ---- Create order ---- */}
      <div className="section-card">
        <div className="section-header">
          <div>
            <div className="section-title">🛒 Create Order</div>
            <div className="section-subtitle">Items, region, optional coupon</div>
          </div>
        </div>
        <div className="section-body">
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="cust">Customer Name</label>
                <input id="cust" className="form-input" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="e.g. alice" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="region">Region</label>
                <select id="region" className="form-select" value={region} onChange={e => setRegion(e.target.value)}>
                  {REGIONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="coupon">Coupon Code (optional)</label>
                <input id="coupon" className="form-input" value={coupon} onChange={e => setCoupon(e.target.value)} placeholder="e.g. TEN" />
              </div>
            </div>

            {/* Items */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span className="form-label">Items</span>
                <button type="button" className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: '0.8rem' }} onClick={addItem}>+ Add Item</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((item, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 36px', gap: 10, alignItems: 'center' }}>
                    <input className="form-input" value={item.sku} onChange={e => setItem(i, 'sku', e.target.value)} placeholder="SKU (e.g. MUG)" />
                    <input className="form-input" type="number" min="1" value={item.qty} onChange={e => setItem(i, 'qty', e.target.value)} placeholder="Qty" />
                    <button type="button" className="btn btn-danger" style={{ padding: '8px', justifyContent: 'center' }}
                      onClick={() => removeItem(i)} disabled={items.length === 1}>✕</button>
                  </div>
                ))}
              </div>
            </div>

            {createErr && <div className="alert alert-error">⚠️ {createErr}</div>}
            <button className="btn btn-primary" type="submit" disabled={creating} style={{ alignSelf: 'flex-start' }}>
              {creating ? '⏳ Creating…' : '✅ Place Order'}
            </button>
          </form>
        </div>
      </div>

      {/* ---- Lookup order ---- */}
      <div className="section-card">
        <div className="section-header">
          <div>
            <div className="section-title">🔍 Order Lookup</div>
            <div className="section-subtitle">View or cancel an existing order by ID</div>
          </div>
        </div>
        <div className="section-body">
          <form onSubmit={handleLookup}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="order-id">Order ID</label>
                <input id="order-id" className="form-input" value={lookupId} onChange={e => setLookupId(e.target.value)} placeholder="e.g. 1" type="number" min="1" />
              </div>
              <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" type="submit" disabled={lookupLd}>
                  {lookupLd ? '⏳ Loading…' : '🔍 Fetch'}
                </button>
              </div>
            </div>
          </form>

          {lookupErr && <div className="alert alert-error" style={{ marginTop: 16 }}>⚠️ {lookupErr}</div>}
          {cancelMsg && (
            <div className={`alert ${cancelMsg.startsWith('Error') ? 'alert-error' : 'alert-success'}`} style={{ marginTop: 16 }}>
              {cancelMsg}
            </div>
          )}

          {order && (
            <>
              <div className="divider" />
              <OrderDetail order={order} onCancel={handleCancel} cancelLoading={cancelLd} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
