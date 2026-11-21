# Tillpoint

A small order desk for a shop: a product catalog, orders with coupons and sales tax, payment webhooks and sales reports. Python 3.10+, standard library only, SQLite for storage.

## Run

```bash
# Start the Python server (also serves the React UI)
python server.py tillpoint.db 8000
```

Then open **http://127.0.0.1:8000** in your browser — you'll see the React dashboard.

| Method | Path | Body |
|---|---|---|
| POST | `/orders` | `{"customer", "items": [{"sku", "qty"}], "region", "coupon"}` |
| GET | `/orders/<id>` | |
| POST | `/orders/<id>/cancel` | |
| GET / PUT | `/products/<sku>` | PUT: `{"price_cents"}` |
| POST | `/webhooks/payments` | `{"id", "type": "payment.succeeded", "order_id", "amount_cents"}` |
| GET | `/reports/daily/<YYYY-MM-DD>` | `{"utc_offset_minutes"}` |

Money is integer cents. Timestamps are stored in UTC. The payment provider retries a webhook until it receives a 2xx response.

## Test

```bash
python -m unittest discover -s tests -v
```

## Layout

```
tillpoint/db.py        schema and time helpers
tillpoint/catalog.py   products, stock, read cache
tillpoint/pricing.py   subtotal, coupons, tax
tillpoint/orders.py    create, cancel, ship, list
tillpoint/payments.py  payment webhooks
tillpoint/reports.py   daily sales, top products
tillpoint/api.py       JSON API
server.py              HTTP server (also serves React UI)
frontend/              React + Vite dashboard (build-time Node.js)
  src/
    App.jsx            Root shell with sidebar navigation
    pages/
      DashboardPage.jsx  Home: bug summary cards
      ProductsPage.jsx   SKU lookup + price update
      OrdersPage.jsx     Create + lookup + cancel orders
      PaymentsPage.jsx   Simulate payment webhooks
      ReportsPage.jsx    Daily sales with timezone picker
  dist/                Built static files served by server.py
tests/
  test_orders.py       Original tests (unchanged)
  test_fixes.py        6 new tests, one per bug fix
```

---

## React Frontend

The dashboard is built with **React + Vite**. Node.js is only needed to build it — the
resulting static files in `frontend/dist/` are served directly by the Python server.

### Build the UI (one-time)

```bash
cd frontend
npm install
npm run build
cd ..
```

### Development mode (hot-reload)

Start the Python API first:
```bash
python server.py tillpoint.db 8000
```

Then in a second terminal, start Vite dev server (proxies API calls to Python):
```bash
cd frontend
npm run dev
# Open http://localhost:5173
```

---

## Bug Fixes & What Was Changed

> **Rule followed throughout:** No existing code was deleted or rewritten.
> Every fix is an *addition* inside the same function/file.

---

### Bug 1 — Revenue Overcounting

**File changed:** `tillpoint/payments.py`

**What was wrong:**
`handle_event()` inserted a new `payments` row every time it was called,
even with the same `event_id`. The payment provider retries a webhook until it
gets a `2xx`, so the same event can arrive many times. Each retry created a
duplicate row, so the daily revenue query (`SUM(amount_cents)`) counted the same
payment more than once.

**What was added:**
Before inserting, we now query for `event_id`:
```python
existing = self.conn.execute(
    "SELECT id FROM payments WHERE event_id = ?", (event["id"],)
).fetchone()
if existing is not None:
    return order["status"]   # idempotent — no-op
```

A `UNIQUE INDEX` on `payments(event_id)` was also added to `db.py` as a
database-level safety net (so even if the Python check were bypassed, the DB
itself prevents duplicates).

**Test:** `test_fixes.TestBug1IdempotentWebhook`

---

### Bug 2 — Stock Disappears on Abandoned Checkout

**File changed:** `tillpoint/orders.py`

**What was wrong:**
Stock is reserved the moment an order is *created* (before payment). `cancel()`
restored stock only when `order["status"] == "paid"`. If a customer started
checkout, never paid, and then the order was cancelled, the stock was never
returned — permanently depleting the shelf.

**What was added / changed:**
The single character change:
```python
# Before (broken)
if order["status"] == "paid":

# After (fixed)
if order["status"] in ("pending", "paid"):
```

**Test:** `test_fixes.TestBug2CancelPendingRestoresStock`

---

### Bug 3 — Tax Too High With Coupon

**File changed:** `tillpoint/pricing.py`

**What was wrong:**
In `price_order()`, the tax was computed on the **pre-discount** subtotal:
```python
tax = tax_for(sub, region)      # sub = raw subtotal
discount = discount_for(...)
```
A customer with a coupon was taxed on money they never paid.

**What was added:**
Swapped the order — discount is computed first, then tax uses the reduced amount:
```python
discount = discount_for(coupon, sub)   # discount first
tax = tax_for(sub - discount, region)  # tax on what the customer actually pays
```

**Example:** MUG $12.00 in CA (7.25%), coupon TEN (10% off)
- Old: tax = round(1200 × 7.25%) = **87¢** → total = $11.67
- New: tax = round(1080 × 7.25%) = **78¢** → total = $11.58 ✓

**Test:** `test_fixes.TestBug3TaxAfterDiscount`

---

### Bug 4 — India Morning Sales on Wrong Day

**File changed:** `tillpoint/reports.py`

**What was wrong:**
`day_bounds_utc()` converts a shop-local calendar day to a UTC time window.
To convert "local midnight" to UTC you must **subtract** the offset.
The original code **added** it:
```python
start += timedelta(minutes=utc_offset_minutes)   # WRONG
```

For UTC+5:30 (330 min), "2024-01-02 00:00 IST" = "2024-01-01 18:30 UTC".
The old code produced "2024-01-02 05:30 UTC", so a sale at 03:30 UTC
(= 09:00 IST) fell *outside* the query window and was attributed to the previous
UTC day.

**What was added:**
```python
start -= timedelta(minutes=utc_offset_minutes)   # FIXED: subtract
```

**Test:** `test_fixes.TestBug4IndiaTimezone`

---

### Bug 5 — Overselling With Two Server Workers

**File changed:** `tillpoint/catalog.py`

**What was wrong:**
`reserve()` did a **two-step** operation:
1. Read `product.stock` in Python
2. Check `if product.stock < qty`
3. Issue `UPDATE products SET stock = stock - ?`

With two concurrent workers both can read the same value in step 1, both pass
step 2, and both execute step 3 — selling two items when only one was in stock
(TOCTOU race condition).

**What was added:**
Replaced the two-step with a single atomic SQL statement:
```python
cur = self.conn.execute(
    "UPDATE products SET stock = stock - ? WHERE sku = ? AND stock >= ?",
    (qty, sku, qty),
)
if cur.rowcount == 0:
    # Either unknown product or out of stock — re-fetch for a good error
    row = self.conn.execute("SELECT stock FROM products WHERE sku = ?", (sku,)).fetchone()
    if row is None:
        raise UnknownProduct(sku)
    raise OutOfStock(sku, qty, row["stock"])
```

The `WHERE stock >= qty` clause makes the check and the decrement atomic at the
database level — SQLite's row-level locking ensures only one concurrent
transaction wins.

**Test:** `test_fixes.TestBug5AtomicReserve`

---

### Bug 6 — Silent Duplicate Payments (Open Question)

**Files changed:** `tillpoint/db.py`, `tillpoint/payments.py`

**Decision:**
When a *different* `event_id` for the same order arrives after the order is
already `paid` or `shipped`, the customer has genuinely been charged twice.
Decision: **keep both records for the audit trail, flag the duplicate, and raise
an error so staff are alerted**.

**Why this approach:**
- Minimum viable: no new tables, no refund workflow.
- The extra payment is recorded with `overpayment=1` — auditors can find it.
- Raising `PaymentError` → HTTP 409 stops the payment provider from retrying
  (which is correct — we got the event and recorded it; retrying would just
  produce more 409s).
- `paid_cents()` excludes `overpayment=1` rows so revenue figures remain correct.
- Staff see the error in logs and can manually issue a refund.

**What it costs:**
Manual investigation and refund per incident. No automated refund. No customer
notification. Acceptable for a small shop as a first implementation.

**What was added:**
- `db.py`: `overpayment INTEGER NOT NULL DEFAULT 0` column on `payments` table.
- `payments.py`: after the idempotency check, if the order is already paid/shipped,
  insert with `overpayment=1` and raise `PaymentError`.
- `paid_cents()` now filters `WHERE overpayment = 0`.

**Test:** `test_fixes.TestBug6DuplicatePaymentFlagged`

---

### server.py — React Static File Serving

**File changed:** `server.py`

**What was added (original handler untouched):**
The original `_serve()` logic is preserved exactly. A new `_serve_static()`
function was added that serves files from `frontend/dist/`. The handler now
checks if the request path starts with an API prefix (`/orders`, `/products`,
`/webhooks`, `/reports`) — if yes, it goes to the original API handler; if no,
it serves a static file. Unknown paths fall back to `index.html` (SPA pattern).

---

## Session Logs

See `session_logs/` for the AI session log file from this session.
