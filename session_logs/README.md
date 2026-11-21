Tillpoint Implementation Plan and Guide URL 🔗
https://gemini.google.com/app/dc4f9fc8b5fd80ab
User prompt: Tillpoint Assignment — Implementation Plan A fresher-friendly, additive-only plan: no existing code is deleted or rewritten. Every fix is the smallest addition that closes the root cause. Root Cause Analysis & Proposed Fixes Bug 1 — Revenue overcounting (payments.py) Root cause: The payment provider retries a webhook until it receives 2xx. handle_event() inserts a new row every time the same event_id arrives, so one real payment can be counted twice or more. Fix: Before inserting, check whether that event_id already exists. If it does, return early (idempotent response). This is a pure addition inside handle_event(). [MODIFY] payments.py Add a duplicate-event guard at the top of handle_event(). Bug 2 — Stock disappears on abandoned checkout (catalog.py + orders.py) Root cause (two parts): 1. reserve() is called at order creation, so stock is locked the moment a customer starts checkout — even if they never pay. 2. cancel() only restores stock when order["status"] == "paid". A pending order that is cancelled never gets its stock back. Fix: Change the cancel() guard: restore stock for both "pending" and "paid" statuses (i.e., any status that isn't already "cancelled" or "shipped"). [MODIFY] orders.py Change the condition in cancel() from if order["status"] == "paid": to if order["status"] in ("pending", "paid"):. Bug 3 — Tax too high when coupon is used (pricing.py) Root cause: In price_order(), tax_for(sub, region) uses the pre-discount subtotal. Tax should apply only to the amount the customer actually pays: sub - discount. Fix: Compute discount first, then compute tax on sub - discount. [MODIFY] pricing.py Swap the order of discount and tax computation in price_order(), passing sub - discount to tax_for(). Bug 4 — India morning sales appear on wrong day (reports.py) Root cause: day_bounds_utc() adds utc_offset_minutes to UTC midnight. But to convert a local midnight to UTC, you must subtract the offset. For UTC+5:30 (330 min), "2024-01-02 00:00 IST" = "2024-01-01 18:30 UTC" — the code currently produces "2024-01-02 05:30 UTC" which is wrong. Fix: Change start += timedelta(minutes=utc_offset_minutes) → start -= timedelta(minutes=utc_offset_minutes). [MODIFY] reports.py Flip the sign of the offset subtraction in day_bounds_utc(). Bug 5 — Overselling with two server workers (catalog.py) Root cause: reserve() reads the stock Python-side, checks product.stock < qty, then issues UPDATE products SET stock = stock - ?. With two concurrent workers, both can read the same stock value simultaneously and both pass the check — the classic TOCTOU (time-of-check/time-of-use) race condition. Fix: Do the check and decrement atomically in SQL: UPDATE products SET stock = stock - ? WHERE sku = ? AND stock >= ?. Check rowcount; if 0, raise OutOfStock. This is a pure addition to reserve() — the Python-side check can remain as a fast pre-flight but the SQL is authoritative. [MODIFY] catalog.py Replace the two-step read-then-update in reserve() with a single atomic SQL statement that includes the stock check in the WHERE clause. Bug 6 — Duplicate payment for the same order (payments.py + db.py) My decision: Keep both payment records (audit trail), but once an order is "paid", any further payment.succeeded event for the same order is recorded with a special overpayment flag and a PaymentError is raised so the caller knows something unusual happened. The smallest build: add an overpayment boolean column to payments and raise PaymentError with a clear message when a second real payment arrives for a paid/shipped order. What it costs: Staff must manually investigate and refund the extra charge. No automated refund flow is built. The error response (HTTP 409) means the payment provider will not retry (which is correct — we got the event, we just flagged it). [MODIFY] db.py Add overpayment INTEGER NOT NULL DEFAULT 0 column to the payments table schema. [MODIFY] payments.py After inserting the payment row, if the order was already "paid" or "shipped", update the new row's overpayment = 1 and raise PaymentError("duplicate payment"). Tests to Add All new tests go in tests/test_fixes.py (a new file — does not touch existing test_orders.py). TestWhat it provestest_duplicate_webhook_idempotentSending the same event_id twice counts revenue only once (Bug 1)test_cancel_pending_restocksCancelling a pending order returns stock (Bug 2)test_tax_calculated_after_discountTax on a coupon order uses sub - discount as the base (Bug 3)test_india_offset_day_boundsSales at 03:30 UTC (08:30 IST) appear in the IST calendar day (Bug 4)test_concurrent_reserve_no_oversellTwo simultaneous reserves fail safely when stock is 1 (Bug 5)test_duplicate_payment_flaggedA second real payment for a paid order raises PaymentError (Bug 6) README Changes A new section "Bug Fixes & What Was Changed" will be appended to README.md, with one sub-section per fix explaining: what was wrong, what file was changed, and why. Verification Plan Automated Tests bash python3 -m unittest discover -s tests -v All existing tests must still pass. All 6 new tests must pass after fixes. Manual Verification - Run python3 server.py tillpoint.db 8000 — server starts without errors. - Existing test suite passes with zero failures. give me the steps and the structure to build this application
Response: To build this Tillpoint backend application from scratch (with all 6 bug fixes baked into the architecture cleanly), follow this folder structure and step-by-step build guide.
1. Project Folder Structure
tillpoint/
├── db.py
├── catalog.py
├── pricing.py
├── orders.py
├── payments.py
├── reports.py
├── server.py
├── README.md
└── tests/
├── init.py ├── test_orders.py └── test_fixes.py
# SQLite connection, schema creation, and transaction helper
# Product inventory management & atomic stock reservation
# Subtotal, coupon discount, and post-discount tax calculation
# Order lifecycle (creation, status updates, cancellation/restocking)
# Webhook handler, idempotency guard, and overpayment detection
# Timezone-aware daily sales & revenue reporting
# Lightweight HTTP server exposing REST endpoints
# Project setup & "Bug Fixes & What Was Changed" documentation
# Makes tests a discoverable Python package
# Core baseline tests (order flow, basic pricing, reports)
# The 6 targeted regression & concurrency tests
2. Step-by-Step Build Guide
Step 1: Database Layer (db.py)
Set up SQLite with WAL (Write-Ahead Logging) mode so concurrent workers don't lock each other out unnecessarily, and include the overpayment column in the payments schema.
Tables to define in init_db(db_path):
products: sku TEXT PRIMARY KEY, name TEXT, price_cents INTEGER, stock INTEGER
orders: id TEXT PRIMARY KEY, status TEXT, subtotal_cents INTEGER, discount_cents INTEGER, tax_cents INTEGER, total_cents INTEGER, created_at TEXT
order_items: order_id TEXT, sku TEXT, qty INTEGER
payments: event_id TEXT PRIMARY KEY, order_id TEXT, amount_cents INTEGER, status TEXT, overpayment INTEGER NOT NULL DEFAULT 0, created_at TEXT

Helper: Provide a get_conn(db_path) function with timeout=10.0 and conn.row_factory = sqlite3.Row.
Step 2: Inventory & Atomic Reservations (catalog.py)
Implement stock lookups, additions, and thread/process-safe reservations.
Custom Exceptions: Define OutOfStock(Exception).
reserve(conn, sku, qty) (Bug 5 Fix): Execute a single atomic SQL update:
```
UPDATE products SET stock = stock - ? WHERE sku = ? AND stock >= ?
```
Check cursor.rowcount == 0. If 0, raise OutOfStock.
release(conn, sku, qty): Run UPDATE products SET stock = stock + ? WHERE sku = ? to return stock when orders are cancelled.
Step 3: Pricing Engine (pricing.py)
Calculate order totals in integer cents to avoid floating-point drift.
price_order(items, catalog_map, coupon=None, region="DEFAULT") (Bug 3 Fix):

Sum price_cents * qty to get sub.

Calculate discount based on coupon (clamped so discount <= sub).

Compute taxable_amount = sub - discount.

Call tax = tax_for(taxable_amount, region).

Return {"subtotal": sub, "discount": discount, "tax": tax, "total": taxable_amount + tax}.
Step 4: Order Lifecycle (orders.py)
Connect catalog.py and pricing.py to manage order states (pending, paid, shipped, cancelled).
create_order(conn, order_id, items, coupon, region, created_at):
Inside a transaction: call catalog.reserve() for each item, compute totals via pricing.price_order(), and insert into orders and order_items with status = "pending".
cancel(conn, order_id) (Bug 2 Fix):
Fetch the order.
Guard with if order["status"] in ("pending", "paid"): — loop through order_items and call catalog.release(conn, item["sku"], item["qty"]), then update status = "cancelled".
If already "cancelled" or "shipped", reject or return without restocking.
Step 5: Payment Webhooks (payments.py)
Handle incoming payment events safely against network retries and duplicate charges.
Custom Exception: Define PaymentError(Exception).
handle_event(conn, event) (Bugs 1 & 6 Fixes):

Idempotency Guard (Bug 1): Query SELECT 1 FROM payments WHERE event_id = ?. If a row exists, return {"status": "already_processed"} immediately (HTTP 200).

Insert & Overpayment Check (Bug 6): Fetch the target order. Insert the payment row into payments (overpayment = 0).

If order["status"] in ("paid", "shipped"):
Run UPDATE payments SET overpayment = 1 WHERE event_id = ?.
Commit the transaction so the audit record persists, then raise PaymentError("duplicate payment") (which server.py maps to HTTP 409).

Otherwise, update orders SET status = 'paid' WHERE id = ? and commit.
Step 6: Timezone-Aware Reporting (reports.py)
Aggregate daily revenue accurately for non-UTC regions like India (IST = UTC+5:30 / +330 minutes).
day_bounds_utc(date_str, utc_offset_minutes) (Bug 4 Fix):
Parse date_str (e.g., "2024-01-02") at 00:00:00 UTC.
Subtract the offset to find the true UTC start timestamp:

```
start = datetime.fromisoformat(f"{date_str}T00:00:00+00:00")
start -= timedelta(minutes=utc_offset_minutes)
end = start + timedelta(days=1)
```
* `daily_sales(conn, date_str, utc_offset_minutes=0)`: Query `orders` where `status IN ('paid', 'shipped')` and
#### Step 7: HTTP Server (`server.py`)
Use Python's built-in `http.server.ThreadingHTTPServer` (so multi-worker concurrency tests work out of the box) acce
* Routes:
* `POST /orders` → calls `orders.create_order()` (returns `201`, or `409` on `OutOfStock`).
* `POST /orders/<id>/cancel` → calls `orders.cancel()` (returns `200`).
* `POST /webhooks/payment` → calls `payments.handle_event()` (returns `200`, or `409` on `PaymentError`).
* `GET /reports/daily?date=YYYY-MM-DD&offset=330` → calls `reports.daily_sales()` (returns `200`).
#### Step 8: Test Suite & Documentation (`tests/` & `README.md`)

Create `tests/test_orders.py` covering happy-path order creation, payment, and reporting. 2. Create `tests/test_fixes.py` using `unittest.TestCase` and `concurrent.futures.ThreadPoolExecutor` (for Bug 5) to

Write `README.md` with setup instructions and the Bug Fixes & What Was Changed section detailing each fix.
---
### 3. Verification Commands
Run these from the `tillpoint/` root directory once the files are in place:
```bash

```
# 1. Run the full test suite (baseline + 6 bug fix tests)
python3 -m unittest discover -s tests -v
2. Start the server and verify clean boot python3 server.py tillpoint.db 8000
```

User prompt: explain me the functionalities that need to be made into the application and also suggest me the code to make the application

## Response: 1. Functionalities to Build into Tillpoint

Think of Tillpoint as a lightweight point-of-sale and order-processing backend built with Python's standard library (sqlite3, http.server, json, unittest) so there are zero external dependencies to get stuck on. Each module owns a clear responsibility:

- 1. Database & Schema Initialization (db.py)

- Opens SQLite connections with a busy timeout and Row dictionary-like access so queries are clean and less prone to transient lock errors.

- Creates and maintains products, orders, order_items, and payments, including the overpayment flag (INTEGER NOT NULL DEFAULT 0) on payments.

- 2. Product Catalog & Atomic Stock Control (catalog.py)

- Looks up product prices and available stock by sku.

- Atomic Reservation (reserve): Decrements stock inside a single conditional SQL statement (WHERE sku = ? AND stock >= ?) and checks rowcount. If rowcount == 0, raises OutOfStock—preventing two concurrent workers from overselling the last unit.

- Stock Release (release): Adds stock back to a product when an order is cancelled.

- 3. Pricing & Tax Calculation (pricing.py)

- Computes everything in integer cents (price_cents, subtotal_cents, discount_cents, tax_cents, total_cents) to avoid floating-point rounding bugs.

- Applies coupon discounts first (never exceeding the subtotal), then calculates tax on subtotal - discount based on region.

- 4. Order Lifecycle & Cancellation (orders.py)

- Create Order (create_order): Reserves stock for every line item, calculates pricing, inserts the pending order and order_items, and commits atomically. If any item lacks stock, rolls back so partial reservations don't leak.

- Cancel Order (cancel): Restores stock for both pending and paid orders, then marks the order cancelled. Leaves shipped or already cancelled orders untouched/rejected as appropriate.

- 5. Idempotent Payment Webhooks & Overpayment Flagging (payments.py)

- Webhook Deduplication (handle_event): Checks event_id first. If the payment provider retries a webhook after a network hiccup, returns early without double-counting or failing.

- Overpayment Detection: Records the payment row, and if the order is already paid or shipped, marks overpayment = 1 on that payment record and raises PaymentError("duplicate payment") so staff can review/refund it manually while returning HTTP 409 so the provider stops retrying.


## 6. Timezone-Aware Daily Sales Reporting (reports.py)

- Converts a local calendar date (YYYY-MM-DD) and utc_offset_minutes (such as +330 for IST, UTC+5:30) into exact UTC start and end boundaries by subtracting the offset from local midnight (00:00:00).

- Sums revenue and order counts for paid and shipped orders falling inside that UTC window.

## 7. HTTP API Server (server.py)

- Runs a threaded HTTP server taking <db_path> and <port> on the command line, wiring HTTP routes (POST /orders, POST /orders/<id>/cancel, POST /webhooks/payment, GET /reports/daily) to the service modules and mapping domain exceptions (OutOfStock, PaymentError, ValueError) to proper HTTP status codes (409, 400, 404).

## 2. Suggested Code Implementation

```
db.py
import sqlite3
def get_conn(db_path: str) -> sqlite3.Connection:
conn = sqlite3.connect(db_path, timeout=10.0, isolation_level=None)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA journal_mode=WAL;")
conn.execute("PRAGMA foreign_keys=ON;")
return conn
def init_db(db_path: str) -> None:
conn = get_conn(db_path)
try:
conn.executescript(
"""
CREATE TABLE IF NOT EXISTS products (
sku TEXT PRIMARY KEY,
name TEXT NOT NULL,
price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
stock INTEGER NOT NULL CHECK (stock >= 0)
);
CREATE TABLE IF NOT EXISTS orders (
id TEXT PRIMARY KEY,
status TEXT NOT NULL,
subtotal_cents INTEGER NOT NULL,
discount_cents INTEGER NOT NULL,
tax_cents INTEGER NOT NULL,
total_cents INTEGER NOT NULL,
created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
order_id TEXT NOT NULL,
sku TEXT NOT NULL,
qty INTEGER NOT NULL CHECK (qty > 0),
FOREIGN KEY (order_id) REFERENCES orders(id),
FOREIGN KEY (sku) REFERENCES products(sku)
);
CREATE TABLE IF NOT EXISTS payments (
event_id TEXT PRIMARY KEY,
order_id TEXT NOT NULL,
amount_cents INTEGER NOT NULL,
status TEXT NOT NULL,
overpayment INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL,
FOREIGN KEY (order_id) REFERENCES orders(id)
);
"""
)
finally:
conn.close()
catalog.py
import sqlite3
class OutOfStock(Exception):
"""Raised when requested quantity exceeds available stock."""
```


```
def upsert_product(conn: sqlite3.Connection, sku: str, name: str, price_cents: int, stock: int) -> None:
conn.execute(
"""
INSERT INTO products (sku, name, price_cents, stock)
VALUES (?, ?, ?, ?)
ON CONFLICT(sku) DO UPDATE SET
name = excluded.name,
price_cents = excluded.price_cents,
stock = excluded.stock
""",
(sku, name, price_cents, stock),
)
def get_product(conn: sqlite3.Connection, sku: str) -> sqlite3.Row | None:
cur = conn.execute("SELECT sku, name, price_cents, stock FROM products WHERE sku = ?", (sku,))
return cur.fetchone()
def reserve(conn: sqlite3.Connection, sku: str, qty: int) -> None:
if qty <= 0:
raise ValueError("qty must be positive")
cur = conn.execute(
"""
UPDATE products
SET stock = stock - ?
WHERE sku = ? AND stock >= ?
""",
(qty, sku, qty),
)
if cur.rowcount == 0:
raise OutOfStock(f"Insufficient stock for sku={sku}, qty={qty}")
def release(conn: sqlite3.Connection, sku: str, qty: int) -> None:
if qty <= 0:
raise ValueError("qty must be positive")
conn.execute(
"UPDATE products SET stock = stock + ? WHERE sku = ?",
(qty, sku),
)
pricing.py
TAX_RATES = {
"DEFAULT": 0.05,
"IN": 0.18,
"US": 0.08,
}
def tax_for(amount_cents: int, region: str = "DEFAULT") -> int:
rate = TAX_RATES.get(region.upper(), TAX_RATES["DEFAULT"])
return round(amount_cents * rate)
def discount_for(subtotal_cents: int, coupon: dict | None) -> int:
if not coupon or subtotal_cents <= 0:
return 0
ctype = coupon.get("type")
if ctype == "percent":
pct = float(coupon.get("value", 0))
disc = round(subtotal_cents * (pct / 100.0))
elif ctype == "flat":
disc = int(coupon.get("value", 0))
else:
disc = 0
return max(0, min(disc, subtotal_cents))
def price_order(
items: list[dict],
catalog_map: dict[str, dict],
coupon: dict | None = None,
region: str = "DEFAULT",
) -> dict:
subtotal = 0
```


```
for item in items:
sku = item["sku"]
qty = int(item["qty"])
product = catalog_map[sku]
subtotal += int(product["price_cents"]) * qty
discount = discount_for(subtotal, coupon)
taxable_amount = subtotal - discount
tax = tax_for(taxable_amount, region)
total = taxable_amount + tax
return {
"subtotal_cents": subtotal,
"discount_cents": discount,
"tax_cents": tax,
"total_cents": total,
}
orders.py
from datetime import datetime, timezone
import sqlite3
import catalog
import pricing
def create_order(
conn: sqlite3.Connection,
order_id: str,
items: list[dict],
coupon: dict | None = None,
region: str = "DEFAULT",
created_at: str | None = None,
) -> dict:
if not items:
raise ValueError("Order must contain at least one item")
ts = created_at or datetime.now(timezone.utc).isoformat()
conn.execute("BEGIN IMMEDIATE")
try:
catalog_map: dict[str, dict] = {}
for item in items:
sku = item["sku"]
qty = int(item["qty"])
prod = catalog.get_product(conn, sku)
if prod is None:
raise KeyError(f"Unknown sku: {sku}")
catalog.reserve(conn, sku, qty)
catalog_map[sku] = dict(prod)
priced = pricing.price_order(items, catalog_map, coupon=coupon, region=region)
conn.execute(
"""
INSERT INTO orders (id, status, subtotal_cents, discount_cents, tax_cents, total_cents, created_at)
VALUES (?, 'pending', ?, ?, ?, ?, ?)
""",
(
order_id,
priced["subtotal_cents"],
priced["discount_cents"],
priced["tax_cents"],
priced["total_cents"],
ts,
),
)
for item in items:
conn.execute(
"INSERT INTO order_items (order_id, sku, qty) VALUES (?, ?, ?)",
(order_id, item["sku"], int(item["qty"])),
)
conn.execute("COMMIT")
return {
"id": order_id,
"status": "pending",
"created_at": ts,
**priced,
```


```
}
except Exception:
conn.execute("ROLLBACK")
raise
def cancel(conn: sqlite3.Connection, order_id: str) -> dict:
conn.execute("BEGIN IMMEDIATE")
try:
cur = conn.execute("SELECT id, status FROM orders WHERE id = ?", (order_id,))
order = cur.fetchone()
if order is None:
raise KeyError(f"Order not found: {order_id}")
if order["status"] in ("pending", "paid"):
item_rows = conn.execute(
"SELECT sku, qty FROM order_items WHERE order_id = ?",
(order_id,),
).fetchall()
for row in item_rows:
catalog.release(conn, row["sku"], row["qty"])
conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = ?", (order_id,))
new_status = "cancelled"
else:
new_status = order["status"]
conn.execute("COMMIT")
return {"id": order_id, "status": new_status}
except Exception:
conn.execute("ROLLBACK")
raise
payments.py
from datetime import datetime, timezone
import sqlite3
class PaymentError(Exception):
"""Raised when an invalid or duplicate payment occurs on a settled order."""
def handle_event(conn: sqlite3.Connection, event: dict) -> dict:
event_id = event["event_id"]
order_id = event["order_id"]
amount_cents = int(event.get("amount_cents", 0))
status = event.get("status", "succeeded")
created_at = event.get("created_at") or datetime.now(timezone.utc).isoformat()
conn.execute("BEGIN IMMEDIATE")
try:
existing = conn.execute(
"SELECT event_id FROM payments WHERE event_id = ?",
(event_id,),
).fetchone()
if existing is not None:
conn.execute("COMMIT")
return {"status": "duplicate_ignored", "event_id": event_id}
order = conn.execute(
"SELECT id, status FROM orders WHERE id = ?",
(order_id,),
).fetchone()
if order is None:
raise KeyError(f"Order not found: {order_id}")
conn.execute(
"""
INSERT INTO payments (event_id, order_id, amount_cents, status, overpayment, created_at)
VALUES (?, ?, ?, ?, 0, ?)
""",
(event_id, order_id, amount_cents, status, created_at),
)
if order["status"] in ("paid", "shipped"):
conn.execute(
"UPDATE payments SET overpayment = 1 WHERE event_id = ?",
(event_id,),
)
```


```
conn.execute("COMMIT")
raise PaymentError("duplicate payment")
if status == "succeeded":
conn.execute("UPDATE orders SET status = 'paid' WHERE id = ?", (order_id,))
conn.execute("COMMIT")
return {"status": "recorded", "event_id": event_id, "order_id": order_id}
except Exception:
if conn.in_transaction:
conn.execute("ROLLBACK")
raise
reports.py
from datetime import datetime, timedelta, timezone
import sqlite3
def day_bounds_utc(date_str: str, utc_offset_minutes: int = 0) -> tuple[datetime, datetime]:
local_midnight = datetime.fromisoformat(f"{date_str}T00:00:00+00:00")
start_utc = local_midnight - timedelta(minutes=utc_offset_minutes)
end_utc = start_utc + timedelta(days=1)
return start_utc.astimezone(timezone.utc), end_utc.astimezone(timezone.utc)
def daily_sales(conn: sqlite3.Connection, date_str: str, utc_offset_minutes: int = 0) -> dict:
start_utc, end_utc = day_bounds_utc(date_str, utc_offset_minutes)
row = conn.execute(
"""
SELECT
COUNT(*) AS order_count,
COALESCE(SUM(total_cents), 0) AS gross_cents,
COALESCE(SUM(discount_cents), 0) AS discount_cents,
COALESCE(SUM(tax_cents), 0) AS tax_cents
FROM orders
WHERE status IN ('paid', 'shipped')
AND created_at >= ?
AND created_at < ?
""",
(start_utc.isoformat(), end_utc.isoformat()),
).fetchone()
return {
"date": date_str,
"utc_offset_minutes": utc_offset_minutes,
"order_count": row["order_count"],
"gross_cents": row["gross_cents"],
"discount_cents": row["discount_cents"],
"tax_cents": row["tax_cents"],
}
server.py
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import sys
from urllib.parse import parse_qs, urlparse
import catalog
import db
import orders
import payments
import reports
def make_handler(db_path: str):
class TillpointHandler(BaseHTTPRequestHandler):
def _send_json(self, code: int, payload: dict) -> None:
body = json.dumps(payload).encode("utf-8")
self.send_response(code)
self.send_header("Content-Type", "application/json")
self.send_header("Content-Length", str(len(body)))
self.end_headers()
self.wfile.write(body)
def _read_json(self) -> dict:
length = int(self.headers.get("Content-Length", "0"))
raw = self.rfile.read(length) if length > 0 else b"{}"
```


```
return json.loads(raw.decode("utf-8"))
def do_GET(self) -> None:
parsed = urlparse(self.path)
if parsed.path == "/reports/daily":
params = parse_qs(parsed.query)
date_str = params.get("date", ["2024-01-01"])[0]
offset = int(params.get("offset", ["0"])[0])
conn = db.get_conn(db_path)
try:
data = reports.daily_sales(conn, date_str, offset)
self._send_json(200, data)
finally:
conn.close()
else:
self._send_json(404, {"error": "not found"})
def do_POST(self) -> None:
parsed = urlparse(self.path)
conn = db.get_conn(db_path)
try:
if parsed.path == "/orders":
payload = self._read_json()
created = orders.create_order(
conn,
order_id=payload["id"],
items=payload["items"],
coupon=payload.get("coupon"),
region=payload.get("region", "DEFAULT"),
created_at=payload.get("created_at"),
)
self._send_json(201, created)
elif parsed.path.startswith("/orders/") and parsed.path.endswith("/cancel"):
parts = parsed.path.strip("/").split("/")
order_id = parts[1]
result = orders.cancel(conn, order_id)
self._send_json(200, result)
elif parsed.path == "/webhooks/payment":
payload = self._read_json()
result = payments.handle_event(conn, payload)
self._send_json(200, result)
else:
self._send_json(404, {"error": "not found"})
except catalog.OutOfStock as exc:
self._send_json(409, {"error": str(exc)})
except payments.PaymentError as exc:
self._send_json(409, {"error": str(exc)})
except (KeyError, ValueError) as exc:
self._send_json(400, {"error": str(exc)})
finally:
conn.close()
def log_message(self, format: str, *args) -> None:
return
return TillpointHandler
def main() -> None:
if len(sys.argv) < 3:
print("Usage: python3 server.py <db_path> <port>")
sys.exit(1)
db_path = sys.argv[1]
port = int(sys.argv[2])
db.init_db(db_path)
server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(db_path))
print(f"Tillpoint listening on 127.0.0.1:{port} using {db_path}")
server.serve_forever()
if name == "main":
main()
tests/test_fixes.py
from concurrent.futures import ThreadPoolExecutor
import os
import tempfile
import unittest
```


```
import catalog
import db
import orders
import payments
import reports
class FixesTestCase(unittest.TestCase):
def setUp(self) -> None:
self.tmp = tempfile.NamedTemporaryFile(delete=False)
self.tmp.close()
self.db_path = self.tmp.name
db.init_db(self.db_path)
conn = db.get_conn(self.db_path)
catalog.upsert_product(conn, "SKU-1", "Coffee Beans", 1000, 5)
conn.close()
def tearDown(self) -> None:
if os.path.exists(self.db_path):
os.remove(self.db_path)
def test_duplicate_webhook_idempotent(self):
conn = db.get_conn(self.db_path)
orders.create_order(conn, "ORD-1", [{"sku": "SKU-1", "qty": 1}], created_at="2024-01-02T00:00:00+00:00")
event = {"event_id": "EVT-1", "order_id": "ORD-1", "amount_cents": 1050, "status": "succeeded"}
payments.handle_event(conn, event)
res2 = payments.handle_event(conn, event)
self.assertEqual(res2["status"], "duplicate_ignored")
count = conn.execute("SELECT COUNT(*) AS c FROM payments WHERE order_id = 'ORD-1'").fetchone()["c"]
self.assertEqual(count, 1)
conn.close()
def test_cancel_pending_restocks(self):
conn = db.get_conn(self.db_path)
orders.create_order(conn, "ORD-2", [{"sku": "SKU-1", "qty": 2}])
self.assertEqual(catalog.get_product(conn, "SKU-1")["stock"], 3)
orders.cancel(conn, "ORD-2")
self.assertEqual(catalog.get_product(conn, "SKU-1")["stock"], 5)
conn.close()
def test_tax_calculated_after_discount(self):
conn = db.get_conn(self.db_path)
priced = orders.create_order(
conn,
"ORD-3",
[{"sku": "SKU-1", "qty": 2}], # subtotal = 2000
coupon={"type": "flat", "value": 500}, # discount = 500 -> taxable = 1500
region="DEFAULT", # 5% of 1500 = 75, not 100
)
self.assertEqual(priced["subtotal_cents"], 2000)
self.assertEqual(priced["discount_cents"], 500)
self.assertEqual(priced["tax_cents"], 75)
self.assertEqual(priced["total_cents"], 1575)
conn.close()
def test_india_offset_day_bounds(self):
conn = db.get_conn(self.db_path)
2024-01-02 03:30 UTC == 2024-01-02 09:00 IST (UTC+5:30 = +330 min)
orders.create_order(conn, "ORD-IN-1", [{"sku": "SKU-1", "qty": 1}], created_at="2024-01-02T03:30:00+00:00")
payments.handle_event(conn, {"event_id": "EVT-IN-1", "order_id": "ORD-IN-1", "amount_cents": 1050})
report = reports.daily_sales(conn, "2024-01-02", utc_offset_minutes=330)
self.assertEqual(report["order_count"], 1)
conn.close()
def test_concurrent_reserve_no_oversell(self):
conn = db.get_conn(self.db_path)
catalog.upsert_product(conn, "RARE-1", "Limited Mug", 2000, 1)
conn.close()
def try_reserve():
c = db.get_conn(self.db_path)
try:
c.execute("BEGIN IMMEDIATE")
catalog.reserve(c, "RARE-1", 1)
c.execute("COMMIT")
return "ok"
except catalog.OutOfStock:
if c.in_transaction:
```


```
c.execute("ROLLBACK")
return "out_of_stock"
finally:
c.close()
with ThreadPoolExecutor(max_workers=2) as pool:
results = list(pool.map(lambda _: try_reserve(), range(2)))
self.assertEqual(sorted(results), ["ok", "out_of_stock"])
def test_duplicate_payment_flagged(self):
conn = db.get_conn(self.db_path)
orders.create_order(conn, "ORD-DUP", [{"sku": "SKU-1", "qty": 1}])
payments.handle_event(conn, {"event_id": "EVT-A", "order_id": "ORD-DUP", "amount_cents": 1050})
with self.assertRaises(payments.PaymentError):
payments.handle_event(conn, {"event_id": "EVT-B", "order_id": "ORD-DUP", "amount_cents": 1050})
flagged = conn.execute("SELECT overpayment FROM payments WHERE event_id = 'EVT-B'").fetchone()
self.assertEqual(flagged["overpayment"], 1)
conn.close()
if name == "main":
unittest.main()
```

User prompt: i need to handle 6 bugs in the application so can u guide to correct them

Response: To fix all 6 bugs cleanly without rewriting working code from scratch, apply each targeted change below in order. Each fix addresses a specific root cause so your order flow, inventory, pricing, reporting, and webhooks behave reliably under retries and concurrency.

## Bug 1: Revenue Overcounting on Webhook Retries (payments.py)

- What goes wrong: Payment gateways retry webhooks until they get a 2xx response. If handle_event() inserts a new payment row every time a request arrives, a single paid order can be counted multiple times.

- How to fix it: Check event_id at the very start of handle_event(). If that event_id already exists in payments, return early (200 / idempotent status) before inserting or updating anything.

```
existing = conn.execute(
"SELECT event_id FROM payments WHERE event_id = ?",
(event_id,),
).fetchone()
if existing is not None:
return {"status": "duplicate_ignored", "event_id": event_id}
```

## Bug 2: Stock Not Returned When Cancelling Pending Orders (orders.py)

- What goes wrong: Stock is reserved when an order is created (pending), but cancel() only releases stock when order["status"] == "paid". Cancelling an unpaid (pending) order leaves inventory locked forever.

- How to fix it: Broaden the cancellation condition in cancel() to if order["status"] in ("pending", "paid"): so stock is restored for both pending and paid orders (while skipping already "cancelled" or "shipped" orders).

```
if order["status"] in ("pending", "paid"):
items = conn.execute(
"SELECT sku, qty FROM order_items WHERE order_id = ?",
(order_id,),
).fetchall()
for row in items:
catalog.release(conn, row["sku"], row["qty"])
conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = ?", (order_id,))
```

## Bug 3: Tax Calculated Before Subtracting Coupon Discount (pricing.py)

- What goes wrong: price_order() passes the raw subtotal into tax_for(), charging tax on the discounted portion of the order.

- How to fix it: Calculate discount first, subtract it from subtotal to get the taxable amount (sub - discount), and pass that discounted amount into tax_for().

```
discount = discount_for(subtotal, coupon)
taxable_amount = subtotal - discount
tax = tax_for(taxable_amount, region)
total = taxable_amount + tax
```

## Bug 4: Wrong Day Boundaries for Positive UTC Offsets Like India (reports.py)

- What goes wrong: day_bounds_utc() adds utc_offset_minutes to UTC midnight (00:00:00). For India (UTC+5:30, +330 minutes), 2024-01-02 00:00 IST is 2024-01-01 18:30 UTC—adding 330 minutes pushes the window to 05:30 UTC and shifts morning IST sales onto the wrong day.


- How to fix it: Subtract utc_offset_minutes from local midnight to get the true UTC start timestamp, then add 24 hours for the end bound.

```
local_midnight = datetime.fromisoformat(f"{date_str}T00:00:00+00:00")
start_utc = local_midnight - timedelta(minutes=utc_offset_minutes)
end_utc = start_utc + timedelta(days=1)
```

## Bug 5: Race Condition / Overselling Across Concurrent Workers (catalog.py)

- What goes wrong: Checking stock < qty in Python and then running a separate UPDATE creates a time-of-check-to-time-of-use (TOCTOU) gap. Two workers can both see stock == 1 and both decrement it.

- How to fix it: Make the check and decrement atomic inside a single SQL statement using WHERE sku = ? AND stock >= ?, and check cursor.rowcount. If rowcount == 0, raise OutOfStock.

```
cur = conn.execute(
"""
UPDATE products
SET stock = stock - ?
WHERE sku = ? AND stock >= ?
""",
(qty, sku, qty),
)
if cur.rowcount == 0:
raise OutOfStock(f"Insufficient stock for sku={sku}, qty={qty}")
```

## Bug 6: Second Real Payment on an Already Paid Order (db.py + payments.py)

- What goes wrong: A new event_id arrives for an order that is already "paid" or "shipped". Silently succeeding hides double-charges, while dropping the record loses the audit trail.

- How to fix it:

- 1. In db.py, add overpayment INTEGER NOT NULL DEFAULT 0 to the payments table.

- 2. In payments.py, insert the payment row for audit purposes, then check if order["status"] in ("paid", "shipped"). If so, set overpayment = 1 on that payment row, commit the audit record, and raise PaymentError("duplicate payment") (mapped to HTTP 409 in server.py so the provider stops retrying while staff can review/refund manually).

```
conn.execute(
"""
INSERT INTO payments (event_id, order_id, amount_cents, status, overpayment, created_at)
VALUES (?, ?, ?, ?, 0, ?)
""",
(event_id, order_id, amount_cents, status, created_at),
)
if order["status"] in ("paid", "shipped"):
conn.execute(
"UPDATE payments SET overpayment = 1 WHERE event_id = ?",
(event_id,),
)
conn.execute("COMMIT")
raise PaymentError("duplicate payment")
```

## Quick Verification Checklist

## After applying the 6 fixes:

- 1. Run python3 -m unittest discover -s tests -v and confirm all existing tests plus the 6 fix tests pass.

- 2. Start python3 server.py tillpoint.db 8000 and verify it boots cleanly with zero startup errors.

User prompt: help me in writing the unit tests in test_fixes.py for the bugs

Response: Here is a complete tests/test_fixes.py using Python's unittest module that isolates each test with a fresh temporary SQLite database and verifies all 6 fixes.

## tests/test_fixes.py

```
from concurrent.futures import ThreadPoolExecutor
import os
import tempfile
import unittest
import catalog
import db
import orders
import payments
```


```
import reports
class TillpointFixesTestCase(unittest.TestCase):
def setUp(self) -> None:
self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
self.tmp.close()
self.db_path = self.tmp.name
db.init_db(self.db_path)
conn = db.get_conn(self.db_path)
catalog.upsert_product(conn, "ITEM-1", "Espresso Pack", 1000, 10)
conn.close()
def tearDown(self) -> None:
if os.path.exists(self.db_path):
os.remove(self.db_path)
def test_duplicate_webhook_idempotent(self):
"""Bug 1: Replaying the same event_id does not double-count payments."""
conn = db.get_conn(self.db_path)
orders.create_order(
conn,
"ORD-1",
[{"sku": "ITEM-1", "qty": 1}],
created_at="2024-01-02T10:00:00+00:00",
)
event = {
"event_id": "EVT-DUP-1",
"order_id": "ORD-1",
"amount_cents": 1050,
"status": "succeeded",
"created_at": "2024-01-02T10:01:00+00:00",
}
first_res = payments.handle_event(conn, event)
second_res = payments.handle_event(conn, event)
self.assertEqual(first_res["status"], "recorded")
self.assertEqual(second_res["status"], "duplicate_ignored")
row = conn.execute(
"SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE order_id = ?",
("ORD-1",),
).fetchone()
self.assertEqual(row["cnt"], 1)
self.assertEqual(row["total"], 1050)
conn.close()
def test_cancel_pending_restocks(self):
"""Bug 2: Cancelling a pending order restores reserved stock."""
conn = db.get_conn(self.db_path)
orders.create_order(conn, "ORD-2", [{"sku": "ITEM-1", "qty": 4}])
self.assertEqual(catalog.get_product(conn, "ITEM-1")["stock"], 6)
cancelled = orders.cancel(conn, "ORD-2")
self.assertEqual(cancelled["status"], "cancelled")
self.assertEqual(catalog.get_product(conn, "ITEM-1")["stock"], 10)
conn.close()
def test_tax_calculated_after_discount(self):
"""Bug 3: Tax is calculated on (subtotal - discount), not raw subtotal."""
conn = db.get_conn(self.db_path)
2 * 1000 = 2000 subtotal; 400 flat coupon => 1600 taxable; 5% default tax = 80
created = orders.create_order(
conn,
"ORD-3",
[{"sku": "ITEM-1", "qty": 2}],
coupon={"type": "flat", "value": 400},
region="DEFAULT",
)
self.assertEqual(created["subtotal_cents"], 2000)
self.assertEqual(created["discount_cents"], 400)
self.assertEqual(created["tax_cents"], 80)
self.assertEqual(created["total_cents"], 1680)
conn.close()
def test_india_offset_day_bounds(self):

"""Bug 4: Sales at 03:30 UTC (09:00 IST, +330 min) belong to that IST calendar day."""
```


```
conn = db.get_conn(self.db_path)
orders.create_order(
conn,
"ORD-IN-1",
[{"sku": "ITEM-1", "qty": 1}],
created_at="2024-01-02T03:30:00+00:00",
)
payments.handle_event(
conn,
{
"event_id": "EVT-IN-1",
"order_id": "ORD-IN-1",
"amount_cents": 1050,
"status": "succeeded",
},
)
ist_report = reports.daily_sales(conn, "2024-01-02", utc_offset_minutes=330)
prev_day_ist_report = reports.daily_sales(conn, "2024-01-01", utc_offset_minutes=330)
self.assertEqual(ist_report["order_count"], 1)
self.assertEqual(prev_day_ist_report["order_count"], 0)
conn.close()
def test_concurrent_reserve_no_oversell(self):

"""Bug 5: Concurrent reservations for the last unit succeed once and fail once."""
conn = db.get_conn(self.db_path)
catalog.upsert_product(conn, "SOLO-1", "Last Mug", 1500, 1)
conn.close()
def attempt_reserve() -> str:
worker_conn = db.get_conn(self.db_path)
try:
worker_conn.execute("BEGIN IMMEDIATE")
catalog.reserve(worker_conn, "SOLO-1", 1)
worker_conn.execute("COMMIT")
return "reserved"
except catalog.OutOfStock:
if worker_conn.in_transaction:
worker_conn.execute("ROLLBACK")
return "out_of_stock"
finally:
worker_conn.close()
with ThreadPoolExecutor(max_workers=2) as executor:
outcomes = list(executor.map(lambda _: attempt_reserve(), range(2)))
self.assertEqual(sorted(outcomes), ["out_of_stock", "reserved"])
verify_conn = db.get_conn(self.db_path)
self.assertEqual(catalog.get_product(verify_conn, "SOLO-1")["stock"], 0)
verify_conn.close()
def test_duplicate_payment_flagged(self):

"""Bug 6: A second distinct payment event on a paid order flags overpayment and raises PaymentError."""
conn = db.get_conn(self.db_path)
orders.create_order(conn, "ORD-PAID-1", [{"sku": "ITEM-1", "qty": 1}])
payments.handle_event(
conn,
{
"event_id": "EVT-FIRST",
"order_id": "ORD-PAID-1",
"amount_cents": 1050,
"status": "succeeded",
},
)
with self.assertRaises(payments.PaymentError):
payments.handle_event(
conn,
{
"event_id": "EVT-SECOND",
"order_id": "ORD-PAID-1",
"amount_cents": 1050,
"status": "succeeded",
},
)
rows = conn.execute(
```


```
"SELECT event_id, overpayment FROM payments WHERE order_id = ? ORDER BY event_id",
("ORD-PAID-1",),
).fetchall()
self.assertEqual(len(rows), 2)
self.assertEqual(rows[0]["overpayment"], 0)
self.assertEqual(rows[1]["overpayment"], 1)
conn.close()
if name == "main":
unittest.main()
```

## Running the Tests

python3 -m unittest discover -s tests -v

## Why the Tests Are Structured This Way

- Temporary SQLite files (tempfile.NamedTemporaryFile): Every test starts with a clean database and deletes it in tearDown(), avoiding cross-test state pollution.

- ThreadPoolExecutor for Bug 5: Simulates two workers racing for a single remaining item (stock = 1) and verifies that SQL's WHERE stock >= ? check prevents overselling.

- Explicit ISO timestamps for Bug 4: 2024-01-02T03:30:00+00:00 equals 2024-01-02 09:00:00 IST, directly proving that utc_offset_minutes=330 maps it to 2024-01-02 rather than 2024-01-01.

User prompt: explain me how to add http endpoint tests for server.py

Response: To test server.py end-to-end over real HTTP requests without needing a running background server or third-party test libraries, use Python's standard library ThreadingHTTPServer on port 0 (which lets the OS pick a free ephemeral port) paired with urllib.request.

Here is how to structure and write those HTTP tests cleanly.

## 1. How the HTTP Test Pattern Works

- 1. Bind to port 0 in setUpClass or setUp: Starting ThreadingHTTPServer(("127.0.0.1", 0), make_handler(db_path)) gives you a real local address ([http://127.0.0.1](http://127.0.0.1):<server.server_address[1]>) with zero port collisions across test runs.

- 2. Run the server on a daemon thread: Start threading.Thread(target=self.server.serve_forever, daemon=True) so it handles concurrent/sequential requests in the background and shuts down cleanly in tearDown via self.server.shutdown() and self.server.server_close().

- 3. Send JSON requests with urllib.request.urlopen:

- For 2xx responses, read resp.status and json.loads(resp.read().decode("utf-8")).

- For expected 4xx responses (like 409 Conflict when stock runs out or a duplicate payment arrives), catch urllib.error.HTTPError and inspect exc.code and json.loads(exc.read().decode("utf-8")).

## 2. Example HTTP Test Suite (tests/test_http.py)

```
from http.server import ThreadingHTTPServer
import json
import os
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import catalog
import db
import server
class TillpointHttpTestCase(unittest.TestCase):
def setUp(self) -> None:
self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
self.tmp.close()
self.db_path = self.tmp.name
db.init_db(self.db_path)
conn = db.get_conn(self.db_path)
catalog.upsert_product(conn, "SKU-TEA", "Masala Chai Tin", 1000, 3)
conn.close()
```


```
self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(self.db_path))
port = self.httpd.server_address[1]
self.base_url = f"http://127.0.0.1:{port}"
self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
self.thread.start()
def tearDown(self) -> None:
self.httpd.shutdown()
self.httpd.server_close()
self.thread.join(timeout=2)
if os.path.exists(self.db_path):
os.remove(self.db_path)
def _post_json(self, path: str, payload: dict | None = None) -> tuple[int, dict]:
data = json.dumps(payload).encode("utf-8") if payload is not None else b""
req = Request(
f"{self.base_url}{path}",
data=data,
headers={"Content-Type": "application/json"},
method="POST",
)
try:
with urlopen(req, timeout=5) as resp:
return resp.status, json.loads(resp.read().decode("utf-8"))
except HTTPError as exc:
body = exc.read().decode("utf-8")
return exc.code, json.loads(body) if body else {}
def _get_json(self, path: str) -> tuple[int, dict]:
with urlopen(f"{self.base_url}{path}", timeout=5) as resp:
return resp.status, json.loads(resp.read().decode("utf-8"))
def test_order_payment_and_daily_report_flow(self):
status, created = self._post_json(
"/orders",
{
"id": "HTTP-ORD-1",
"items": [{"sku": "SKU-TEA", "qty": 2}],
"coupon": {"type": "flat", "value": 200},
"region": "DEFAULT",
"created_at": "2024-01-02T03:30:00+00:00",
},
)
self.assertEqual(status, 201)
Subtotal 2000 - discount 200 = 1800; 5% tax = 90 => total 1890
self.assertEqual(created["total_cents"], 1890)
pay_status, _ = self._post_json(
"/webhooks/payment",
{
"event_id": "HTTP-EVT-1",
"order_id": "HTTP-ORD-1",
"amount_cents": 1890,
"status": "succeeded",
},
)
self.assertEqual(pay_status, 200)
rep_status, report = self._get_json("/reports/daily?date=2024-01-02&offset=330")
self.assertEqual(rep_status, 200)
self.assertEqual(report["order_count"], 1)
self.assertEqual(report["gross_cents"], 1890)
def test_cancel_order_returns_404_or_200_and_conflict_on_duplicate_payment(self):
self._post_json(
"/orders",
{"id": "HTTP-ORD-2", "items": [{"sku": "SKU-TEA", "qty": 1}]},
)
self._post_json(
"/webhooks/payment",
{
"event_id": "HTTP-EVT-2A",
"order_id": "HTTP-ORD-2",
"amount_cents": 1050,
"status": "succeeded",
},
)
```


```
dup_status, dup_body = self._post_json(
"/webhooks/payment",
{
"event_id": "HTTP-EVT-2B",
"order_id": "HTTP-ORD-2",
"amount_cents": 1050,
"status": "succeeded",
},
)
self.assertEqual(dup_status, 409)
self.assertIn("duplicate payment", dup_body.get("error", ""))
cancel_status, cancel_body = self._post_json("/orders/HTTP-ORD-2/cancel")
self.assertEqual(cancel_status, 200)
self.assertEqual(cancel_body["status"], "cancelled")
if name == "main":
unittest.main()
```

## 3. Edge Cases Worth Checking in server.py

When writing HTTP tests, you may notice small details in server.py to harden:

- Unknown order IDs: In orders.py and payments.py, raising KeyError("Order not found...") currently maps to 400 in server.py. If you want missing orders to return 404, either raise a dedicated NotFoundError or handle missing lookups explicitly before calling orders.cancel() / payments.handle_event().

- Invalid JSON or missing fields: _read_json() raises json.JSONDecodeError if a client sends malformed JSON; catching json.JSONDecodeError alongside (KeyError, ValueError) ensures a clean 400 JSON response instead of a 500 traceback.

- Closing database connections cleanly: Make sure every request opens and closes its connection in a try ... finally block (as shown in server.py) so SQLite file handles aren't left open during tearDown() on Windows or busy filesystems.

Run all tests together with:

```
python3 -m unittest discover -s tests -v
```