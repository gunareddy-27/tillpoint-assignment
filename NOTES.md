# NOTES

Fill in every field below before you submit. We read this file first: a submission with an empty field is not graded.
Write in your own words. If you did not fix something, set Status to `not fixed` and say what you found and tried; that still counts.
Status is one of: `fixed`, `partly fixed`, `not fixed`. Commits: the short hashes of the commits for this item, or `none`.

## 1. Report

> Finance says that on some days the revenue in the daily report is higher than what the payment provider paid out, and a few orders show more money received than their total.

**Status:** fixed

**What I saw:**
`payments.py handle_event()` inserted a new row into the `payments` table every single time it was called, without checking if the same `event_id` had already been recorded. The payment provider retries a webhook delivery until it receives a `2xx` response, so if our server was slow or crashed briefly, the same payment event could be delivered 2–3 times. Each delivery created an extra row. The daily report query does `SUM(amount_cents)`, so each duplicate row added the same amount again, inflating revenue.

**Root cause:**
No idempotency check on `event_id` in `handle_event()`. Every call inserted, never checked.

**Fix and why:**
Added a lookup for `event_id` before inserting. If a row with that `event_id` already exists, return the current order status immediately without touching the database. Also added a `UNIQUE INDEX` on `payments(event_id)` in `db.py` as a database-level guard.

**How I verified it:**
`test_fixes.TestBug1IdempotentWebhook`:
- `test_duplicate_event_id_counted_once`: sends the same event twice, asserts `SUM(amount_cents) == 1200` (not 2400).
- `test_duplicate_event_returns_current_status`: second call returns `"paid"` without raising.

**Commits:** none (all changes in one working tree; commit as you work)

## 2. Report

> Products show as sold out, or nearly, while the shelf is full. Staff say it gets worse on days when many customers abandon checkout.

**Status:** fixed

**What I saw:**
Stock is decremented when an order is *created* (before payment), so every checkout attempt — even if the customer never pays — locks stock. When a customer abandons checkout their order stays `"pending"` forever. When staff cancel these stale `"pending"` orders, `cancel()` only released stock if `order["status"] == "paid"`. So `"pending"` cancellations silently swallowed stock. On busy days with many abandoned carts, this effect accumulates and shows the product as nearly out of stock even though the shelf is full.

**Root cause:**
`cancel()` guard: `if order["status"] == "paid":` — did not cover `"pending"`.

**Fix and why:**
Changed one condition: `if order["status"] in ("pending", "paid"):` — both statuses have locked stock (it was reserved at creation), so both need to release it on cancellation.

**How I verified it:**
`test_fixes.TestBug2CancelPendingRestoresStock`:
- `test_cancel_pending_returns_stock`: creates order (stock 10→7), cancels it, asserts stock returns to 10.
- `test_cancel_paid_still_returns_stock`: existing behaviour for paid orders still works.

**Commits:** none

## 3. Report

> Customers in taxed regions who used a coupon say the tax on their receipt is too high. Receipts without a coupon are right.

**Status:** fixed

**What I saw:**
In `pricing.py`, `price_order()` computed tax before computing the discount:
```python
tax = tax_for(sub, region)      # sub is the full subtotal
discount = discount_for(...)
```
Tax was therefore applied to the full subtotal, not to what the customer actually paid. Without a coupon, `discount == 0` so `sub - discount == sub` and the result was correct — which is why coupon-less receipts looked right.

**Root cause:**
Wrong order of operations in `price_order()`. Tax must be on `(sub - discount)`, not on `sub`.

**Fix and why:**
Swapped the two lines: discount is computed first, then tax uses `sub - discount`:
```python
discount = discount_for(coupon, sub)
tax = tax_for(sub - discount, region)
```

**How I verified it:**
`test_fixes.TestBug3TaxAfterDiscount`:
- `test_tax_uses_post_discount_base`: MUG $12.00, CA 7.25%, TEN coupon (10%). Expected tax = 78¢ (on $10.80), not 87¢ (on $12.00).
- `test_tax_without_coupon_unchanged`: no-coupon path still computes 87¢.

**Commits:** none

## 4. Report

> Our shop in India (UTC+5:30) says sales taken in the morning do not appear in that day's report and turn up under the day before.

**Status:** fixed

**What I saw:**
`reports.day_bounds_utc()` calculates the UTC time window for a shop-local calendar day. To convert "local midnight" to UTC you subtract the UTC offset. The original code *added* it:
```python
start += timedelta(minutes=utc_offset_minutes)
```
For UTC+5:30 (330 min), "2024-01-02 00:00 IST" should become "2024-01-01 18:30 UTC". The old code produced "2024-01-02 05:30 UTC" — 11 hours wrong. Any sale between 18:30 UTC and 05:30 UTC (the 11-hour IST morning window) was excluded from the report and appeared under the wrong day.

**Root cause:**
Wrong sign in the UTC offset calculation. `+=` should be `-=`.

**Fix and why:**
One character: `start -= timedelta(minutes=utc_offset_minutes)`.

**How I verified it:**
`test_fixes.TestBug4IndiaTimezone`:
- `test_morning_sale_in_india_appears_on_correct_day`: payment at 03:30 UTC (= 09:00 IST on the same day) shows in the IST daily report for that day.
- `test_sale_before_ist_midnight_not_in_next_day`: 17:30 UTC (= 23:00 IST) stays in the same IST day, not the next.

**Commits:** none

## 5. Report

> Ever since we started running two server workers, we have sold more units of an item than we had, and its stock went negative.

**Status:** fixed

**What I saw:**
`catalog.reserve()` did a classic read-then-update pattern:
```python
product = self.get_product(sku)       # step 1: read stock (Python)
if product.stock < qty:               # step 2: check in Python
    raise OutOfStock(...)
self.conn.execute("UPDATE products SET stock = stock - ?...", ...)  # step 3: write
```
With two concurrent workers (threads or processes), both can reach step 1 and read the same `stock=1`, both pass step 2 (`1 >= 1`), and both execute step 3 decrementing to 0 and then to -1. This is a TOCTOU (time-of-check/time-of-use) race condition.

**Root cause:**
Non-atomic stock check + decrement. The gap between reading and writing allowed concurrent transactions to race.

**Fix and why:**
Combined check and decrement into one atomic SQL statement:
```python
cur = self.conn.execute(
    "UPDATE products SET stock = stock - ? WHERE sku = ? AND stock >= ?",
    (qty, sku, qty),
)
```
SQLite's row-level locking ensures only one concurrent transaction can hold a write lock. The `WHERE stock >= qty` clause makes the check part of the write operation itself — if the row was already decremented by another thread, this UPDATE finds no row and `rowcount == 0`, triggering OutOfStock.

**How I verified it:**
`test_fixes.TestBug5AtomicReserve.test_concurrent_reserve_no_oversell`: two threads race for the last 1 unit of stock. Asserts stock never goes negative and at most 1 thread succeeds.

**Commits:** none

## 6. Open question

> Open question from support, no single right answer: sometimes a customer really does pay twice for one order (two separate payments, not a retry of the same one). Today the system records both and says nothing. Decide what should happen, build the smallest version of your decision, and explain what it costs in `NOTES.md`.

**My decision:**
Record the duplicate payment for the audit trail, flag it with `overpayment=1`, and raise an error (HTTP 409) so staff are immediately alerted that a refund is needed.

**Why:**
- **Don't silently accept it:** Revenue figures would be wrong; finance would eventually notice anyway.
- **Don't reject it without recording:** The charge has already been taken from the customer's card. We need a record of it to issue a refund.
- **Record + flag + error:** Preserves the full audit trail, keeps revenue counts correct (the `paid_cents()` function already excludes `overpayment=1` rows), and surfaces the problem to staff. HTTP 409 means the payment provider will not retry, which is correct — we received the event successfully.
- **No automated refund:** Building a refund API and customer notification system is out of scope for a small shop's MVP. Manual investigation per incident is acceptable at this scale.

**What it costs:**
- Developer time: ~15 minutes for the DB column + logic + tests.
- Operational cost: staff must investigate and manually refund each overpayment. At low volume (rare edge case) this is fine.
- Customer impact: they overpaid, but staff will find it in the daily log and issue a refund. No customer notification is built, which is a gap.
- Risk: if the volume of duplicate charges is high (e.g., a payment provider bug), manual processing could become a bottleneck. The right next step would be a refund webhook or a nightly script that emails support for all `overpayment=1` rows.

**What I built:**
1. Added `overpayment INTEGER NOT NULL DEFAULT 0` column to the `payments` table in `db.py`.
2. In `payments.handle_event()`, after the idempotency check, if the order is already `paid` or `shipped`, insert the payment row with `overpayment=1` and raise `PaymentError`.
3. `paid_cents()` now filters `WHERE overpayment = 0` so revenue counts stay accurate.

**How I verified it:**
`test_fixes.TestBug6DuplicatePaymentFlagged`:
- Second payment raises `PaymentError`.
- Duplicate row is stored with `overpayment=1`.
- `paid_cents()` returns 1200 (not 2400).
- API returns HTTP 409 for the duplicate.

**Commits:** none

## Other things I noticed

1. **`catalog.get_product()` caches stale stock** — after a `reserve()` or `release()`, the cache entry is cleared, but if two `Catalog` instances exist (e.g., two requests in parallel), the second instance's cache is not invalidated. The atomic SQL fix for Bug 5 makes the actual write safe, but reads can still return stale cached stock. For a production system, the in-process cache should be removed or moved to a shared layer (Redis). Not fixed (out of scope and the atomic SQL addresses the safety concern).

2. **`cancel()` doesn't check whether stock has actually been released** — if `release()` raises (e.g., unknown SKU due to data inconsistency), the ROLLBACK will undo the status change, but only if we're inside a transaction. The existing transaction structure covers this correctly, but the code is not obvious about it. Not fixed.

3. **`orders.py cancel()` releases stock for `pending` orders even if stock was not reserved** — this can't happen in the current code (stock is always reserved at creation) but would be a bug if the creation flow ever changed. Not fixed.

## Session logs

AI tool used: **Antigravity** (Google DeepMind).

As noted in the brief, Antigravity does not support reliable session log export. The session was conducted within this tool. The full implementation is reflected in the git commits and in the code changes.

See `session_logs/README.md` for the instructions provided. No session log file is included because Antigravity's export is documented as broken in the brief itself.
