import { useState } from 'react';
import { getProduct, updatePrice } from '../api.js';
import { fmt } from '../utils.js';

export default function ProductsPage() {
  const [sku,    setSku]    = useState('');
  const [product, setProduct] = useState(null);
  const [newPrice, setNewPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  async function handleLookup(e) {
    e.preventDefault();
    if (!sku.trim()) return;
    setError(''); setSuccess(''); setProduct(null);
    setLoading(true);
    try {
      const p = await getProduct(sku.trim().toUpperCase());
      setProduct(p);
      setNewPrice(String(p.price_cents));
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  }

  async function handleUpdatePrice(e) {
    e.preventDefault();
    const price = parseInt(newPrice, 10);
    if (isNaN(price) || price < 0) { setError('Price must be a non-negative integer (cents).'); return; }
    setLoading(true); setError(''); setSuccess('');
    try {
      await updatePrice(product.sku, price);
      setProduct(prev => ({ ...prev, price_cents: price }));
      setSuccess(`Price updated to ${fmt(price)}`);
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="page-heading">
        <h1>Products</h1>
        <p>Look up a product by SKU and update its price.</p>
      </div>

      {/* Lookup form */}
      <div className="section-card">
        <div className="section-header">
          <div>
            <div className="section-title">Product Lookup</div>
            <div className="section-subtitle">Enter a product SKU to view details</div>
          </div>
        </div>
        <div className="section-body">
          <form onSubmit={handleLookup}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="sku-input">SKU</label>
                <input
                  id="sku-input"
                  className="form-input"
                  value={sku}
                  onChange={e => setSku(e.target.value)}
                  placeholder="e.g. MUG"
                  autoFocus
                />
              </div>
              <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading ? '⏳ Loading…' : '🔍 Lookup'}
                </button>
              </div>
            </div>
          </form>

          {error   && <div className="alert alert-error"   style={{ marginTop: 16 }}>⚠️ {error}</div>}
          {success && <div className="alert alert-success" style={{ marginTop: 16 }}>✅ {success}</div>}

          {product && (
            <>
              <div className="divider" />
              {/* Product card */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 14 }}>
                {[
                  { label: 'SKU',   value: product.sku },
                  { label: 'Name',  value: product.name },
                  { label: 'Price', value: fmt(product.price_cents) },
                  { label: 'Stock', value: product.stock ?? '—',
                    style: { color: product.stock === 0 ? 'var(--rose)' : 'var(--emerald)', fontWeight: 700 } },
                ].map(({ label, value, style }) => (
                  <div className="stat-card" key={label}>
                    <span className="stat-label">{label}</span>
                    <span className="stat-value" style={{ fontSize: '1.1rem', ...style }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Price update */}
              <div className="divider" />
              <form onSubmit={handleUpdatePrice}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="new-price">New Price (cents)</label>
                    <input
                      id="new-price"
                      className="form-input"
                      type="number"
                      min="0"
                      value={newPrice}
                      onChange={e => setNewPrice(e.target.value)}
                      placeholder="e.g. 1500"
                    />
                  </div>
                  <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-primary" type="submit" disabled={loading}>
                      💾 Update Price
                    </button>
                  </div>
                </div>
                <div className="alert alert-info" style={{ marginTop: 10, fontSize: '0.78rem' }}>
                  💡 Prices are stored as integer cents. $12.50 = 1250 cents.
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
