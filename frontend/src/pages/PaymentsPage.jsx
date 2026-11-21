import { useState } from 'react';
import { sendPayment } from '../api.js';
import { fmt } from '../utils.js';

export default function PaymentsPage() {
  const [eventId,    setEventId]    = useState('');
  const [orderId,    setOrderId]    = useState('');
  const [amountCents,setAmount]     = useState('');
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setResult(null);
    const amt = parseInt(amountCents, 10);
    if (!eventId.trim())              { setError('Event ID is required.'); return; }
    if (!orderId.trim())              { setError('Order ID is required.'); return; }
    if (isNaN(amt) || amt <= 0)       { setError('Amount must be a positive integer (cents).'); return; }

    setLoading(true);
    try {
      const res = await sendPayment({
        id: eventId.trim(),
        type: 'payment.succeeded',
        order_id: parseInt(orderId, 10),
        amount_cents: amt,
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div className="page-heading">
        <h1>Payment Webhooks</h1>
        <p>Simulate a <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 4, fontSize: '0.85em' }}>payment.succeeded</code> webhook event.</p>
      </div>

      <div className="section-card">
        <div className="section-header">
          <div>
            <div className="section-title">💳 Send Payment Event</div>
            <div className="section-subtitle">The backend deduplicates by event_id — safe to retry</div>
          </div>
        </div>
        <div className="section-body">
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="evt-id">Event ID</label>
                <input id="evt-id" className="form-input" value={eventId} onChange={e => setEventId(e.target.value)}
                  placeholder="e.g. evt_abc123" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pay-order-id">Order ID</label>
                <input id="pay-order-id" className="form-input" type="number" min="1"
                  value={orderId} onChange={e => setOrderId(e.target.value)} placeholder="e.g. 1" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pay-amount">Amount (cents)</label>
                <input id="pay-amount" className="form-input" type="number" min="1"
                  value={amountCents} onChange={e => setAmount(e.target.value)} placeholder="e.g. 1200" />
              </div>
            </div>

            {amountCents && !isNaN(parseInt(amountCents)) && (
              <div className="alert alert-info" style={{ fontSize: '0.8rem' }}>
                💡 Sending {fmt(parseInt(amountCents, 10))} for order #{orderId || '?'}
              </div>
            )}

            {error  && <div className="alert alert-error">⚠️ {error}</div>}
            {result && (
              <div className="alert alert-success">
                ✅ Payment accepted — order status is now <strong style={{ marginLeft: 4 }}>{result.status}</strong>
              </div>
            )}

            <button className="btn btn-primary" type="submit" disabled={loading} style={{ alignSelf: 'flex-start' }}>
              {loading ? '⏳ Sending…' : '📤 Send Payment'}
            </button>
          </form>
        </div>
      </div>

      {/* Explanation */}
      <div className="section-card">
        <div className="section-header">
          <div className="section-title">📖 How It Works</div>
        </div>
        <div className="section-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { icon: '🔁', title: 'Idempotent',      text: 'Sending the same event_id twice is safe — the second call is a no-op. Revenue is never double-counted. (Bug 1 fix)' },
              { icon: '⚡', title: 'Marks as Paid',   text: 'Once the total payment amount meets or exceeds the order total, the order status changes from pending → paid.' },
              { icon: '🚨', title: 'Duplicate Alert', text: 'A new event_id for an already-paid order is flagged as an overpayment and returns HTTP 409. Staff are alerted to refund the customer. (Bug 6 fix)' },
            ].map(({ icon, title, text }) => (
              <div key={title} style={{ display: 'flex', gap: 14, padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '1.4rem' }}>{icon}</span>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
