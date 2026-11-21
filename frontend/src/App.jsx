import { useState } from 'react';
import DashboardPage from './pages/DashboardPage.jsx';
import ProductsPage  from './pages/ProductsPage.jsx';
import OrdersPage    from './pages/OrdersPage.jsx';
import PaymentsPage  from './pages/PaymentsPage.jsx';
import ReportsPage   from './pages/ReportsPage.jsx';

const NAV = [
  { id: 'dashboard', label: 'Dashboard',  icon: '🏠', group: 'Overview' },
  { id: 'products',  label: 'Products',   icon: '🏷️', group: 'Shop' },
  { id: 'orders',    label: 'Orders',     icon: '📦', group: 'Shop' },
  { id: 'payments',  label: 'Payments',   icon: '💳', group: 'Shop' },
  { id: 'reports',   label: 'Reports',    icon: '📊', group: 'Analytics' },
];

const PAGES = {
  dashboard: DashboardPage,
  products:  ProductsPage,
  orders:    OrdersPage,
  payments:  PaymentsPage,
  reports:   ReportsPage,
};

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    (acc[item[key]] = acc[item[key]] || []).push(item);
    return acc;
  }, {});
}

export default function App() {
  const [page, setPage] = useState('dashboard');
  const PageComponent   = PAGES[page] || DashboardPage;
  const groups          = groupBy(NAV, 'group');

  return (
    <div className="app-shell">
      {/* ---- Topbar ---- */}
      <header className="topbar">
        <div className="topbar-logo">
          <div className="topbar-logo-dot" />
          Tillpoint
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-status">API Connected</div>
      </header>

      {/* ---- Sidebar ---- */}
      <nav className="sidebar" aria-label="Main navigation">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <div className="sidebar-label">{group}</div>
            {items.map(({ id, label, icon }) => (
              <button
                key={id}
                id={`nav-${id}`}
                className={`sidebar-btn ${page === id ? 'active' : ''}`}
                onClick={() => setPage(id)}
                aria-current={page === id ? 'page' : undefined}
              >
                <span className="icon" aria-hidden="true">{icon}</span>
                {label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* ---- Main ---- */}
      <main className="main" id="main-content">
        <PageComponent />
      </main>
    </div>
  );
}
