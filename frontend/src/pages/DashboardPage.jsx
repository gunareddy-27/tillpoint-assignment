/**
 * DashboardPage — The home/overview page shown when the app loads.
 * Explains what the app is and summarises all 6 bug fixes.
 */
export default function DashboardPage() {
  const fixes = [
    {
      num: 1,
      title: 'Revenue Overcounting',
      file: 'payments.py',
      color: 'var(--rose)',
      icon: '💸',
      summary: 'Payment webhooks were retried, inserting duplicate rows — inflating revenue.',
      fix: 'Added an idempotency check: if event_id already exists, return early without inserting.',
    },
    {
      num: 2,
      title: 'Stock Disappears on Abandoned Checkout',
      file: 'orders.py',
      color: 'var(--amber)',
      icon: '📦',
      summary: 'cancel() only released stock for "paid" orders. Cancelled "pending" orders never returned stock.',
      fix: 'Changed the guard to release stock for both "pending" and "paid" statuses.',
    },
    {
      num: 3,
      title: 'Tax Too High With Coupon',
      file: 'pricing.py',
      color: 'var(--violet)',
      icon: '🏷️',
      summary: 'Tax was computed on the pre-discount subtotal instead of what the customer actually paid.',
      fix: 'Compute discount first, then apply tax on (subtotal − discount).',
    },
    {
      num: 4,
      title: 'India Morning Sales on Wrong Day',
      file: 'reports.py',
      color: 'var(--sky)',
      icon: '🕐',
      summary: 'day_bounds_utc() ADDED the UTC offset instead of subtracting it, misplacing IST morning sales.',
      fix: 'Changed start += timedelta(...) to start -= timedelta(...) to correctly convert local midnight to UTC.',
    },
    {
      num: 5,
      title: 'Overselling With Two Workers',
      file: 'catalog.py',
      color: 'var(--accent)',
      icon: '⚡',
      summary: 'reserve() was a two-step read-then-update — a classic TOCTOU race with concurrent workers.',
      fix: 'Single atomic SQL: UPDATE … WHERE stock >= qty. rowcount == 0 means out of stock.',
    },
    {
      num: 6,
      title: 'Silent Duplicate Payments',
      file: 'payments.py',
      color: 'var(--emerald)',
      icon: '🚨',
      summary: 'A second genuine charge for the same order was silently recorded as normal revenue.',
      fix: 'New event_id on a paid/shipped order is stored with overpayment=1 and raises HTTP 409 to alert staff.',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.08) 100%)',
        border: '1px solid rgba(99,102,241,0.25)',
        borderRadius: 'var(--r-xl)',
        padding: '36px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -60, right: -60, fontSize: '12rem', opacity: 0.04, pointerEvents: 'none' }}>🛒</div>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--accent-light)' }}>
          TILLPOINT DASHBOARD
        </div>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 900, letterSpacing: '-1px',
          background: 'linear-gradient(135deg, #f1f5f9 30%, #818cf8)', WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent', backgroundClip: 'text', margin: 0 }}>
          Shop Order Desk
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', maxWidth: 560, lineHeight: 1.7 }}>
          A Python + SQLite backend for products, orders, coupons, tax, payment webhooks and daily
          sales reports. All 6 reported bugs have been identified, fixed and tested.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
          {['Python 3.10+', 'SQLite', 'React + Vite', '20 Tests — All Pass'].map(tag => (
            <span key={tag} className="chip" style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent-light)' }}>{tag}</span>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="stat-grid">
        {[
          { label: 'Bugs Fixed',  value: '6', icon: '🐛', color: 'var(--emerald)' },
          { label: 'Tests Added', value: '13',icon: '✅', color: 'var(--accent-light)' },
          { label: 'Files Changed',value:'5', icon: '📝', color: 'var(--violet)' },
          { label: 'Tests Total', value: '20', icon: '🧪', color: 'var(--sky)' },
        ].map(({ label, value, icon, color }) => (
          <div className="stat-card" key={label}>
            <span className="stat-label">{label}</span>
            <span className="stat-value" style={{ color }}>{value}</span>
            <span className="stat-icon">{icon}</span>
          </div>
        ))}
      </div>

      {/* Bug cards */}
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
          color: 'var(--text-muted)', marginBottom: 16 }}>Bug Fix Summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {fixes.map(({ num, title, file, color, icon, summary, fix }) => (
            <div key={num} className="section-card" style={{ transition: 'transform 0.2s, box-shadow 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px',
                borderBottom: `1px solid rgba(255,255,255,0.06)`, background: `linear-gradient(90deg, ${color}18 0%, transparent 100%)` }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}22`,
                  border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>
                  {icon}
                </div>
                <div>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color }}>Bug #{num} · {file}</div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginTop: 2 }}>{title}</div>
                </div>
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                  <strong style={{ color: 'var(--rose)' }}>Problem:</strong> {summary}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                  <strong style={{ color: 'var(--emerald)' }}>Fix:</strong> {fix}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
