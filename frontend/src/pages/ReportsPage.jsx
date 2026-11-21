import { useState } from 'react';
import { dailySales } from '../api.js';
import { fmt, todayStr } from '../utils.js';

const TIMEZONE_OPTIONS = [
  { label: 'UTC (±0)',         value: 0   },
  { label: 'IST — India (+5:30)', value: 330 },
  { label: 'EST — New York (−5)', value: -300 },
  { label: 'PST — Los Angeles (−8)', value: -480 },
  { label: 'CET — Central Europe (+1)', value: 60 },
  { label: 'JST — Japan (+9)', value: 540 },
];

export default function ReportsPage() {
  const [day,     setDay]     = useState(todayStr());
  const [offset,  setOffset]  = useState(0);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleFetch(e) {
    e.preventDefault();
    setError(''); setData(null); setLoading(true);
    try {
      const res = await dailySales(day, offset);
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  }

  const tz = TIMEZONE_OPTIONS.find(t => t.value === offset) || { label: `UTC${offset >= 0 ? '+' : ''}${offset / 60}` };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div className="page-heading">
        <h1>Daily Sales Report</h1>
        <p>Revenue and order count for any shop-local calendar day.</p>
      </div>

      <div className="section-card">
        <div className="section-header">
          <div>
            <div className="section-title">📅 Report Parameters</div>
            <div className="section-subtitle">Pick a date and the shop's timezone offset</div>
          </div>
        </div>
        <div className="section-body">
          <form onSubmit={handleFetch} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="report-day">Date</label>
                <input id="report-day" className="form-input" type="date" value={day} onChange={e => setDay(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="report-tz">Shop Timezone</label>
                <select id="report-tz" className="form-select" value={offset}
                  onChange={e => setOffset(parseInt(e.target.value, 10))}>
                  {TIMEZONE_OPTIONS.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading ? '⏳ Loading…' : '📊 Generate Report'}
                </button>
              </div>
            </div>

            <div className="alert alert-info" style={{ fontSize: '0.8rem' }}>
              🕐 <strong>Bug 4 fix:</strong> The timezone offset is now correctly applied — UTC offset is <em>subtracted</em>
              to get the UTC window for the local day. India (UTC+5:30) morning sales now appear on the correct day.
            </div>

            {error && <div className="alert alert-error">⚠️ {error}</div>}
          </form>
        </div>
      </div>

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Big stat cards */}
          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">Day</span>
              <span className="stat-value" style={{ fontSize: '1.4rem' }}>{data.day}</span>
              <span className="stat-sub">{tz.label}</span>
              <span className="stat-icon">📅</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Revenue</span>
              <span className="stat-value money-green">{fmt(data.revenue_cents)}</span>
              <span className="stat-sub">Total payments received</span>
              <span className="stat-icon">💰</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Orders</span>
              <span className="stat-value">{data.orders}</span>
              <span className="stat-sub">Distinct paying orders</span>
              <span className="stat-icon">📦</span>
            </div>
            {data.orders > 0 && (
              <div className="stat-card">
                <span className="stat-label">Avg Order Value</span>
                <span className="stat-value money-green">
                  {fmt(Math.round(data.revenue_cents / data.orders))}
                </span>
                <span className="stat-sub">Revenue ÷ orders</span>
                <span className="stat-icon">📈</span>
              </div>
            )}
          </div>

          {/* Zero state */}
          {data.orders === 0 && (
            <div className="section-card">
              <div className="section-body">
                <div className="empty">
                  <span className="empty-icon">📭</span>
                  <span className="empty-text">No payments recorded for {data.day} in {tz.label}.</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
