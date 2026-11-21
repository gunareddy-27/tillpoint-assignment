"""
tests/test_fixes.py
===================
One test per bug report (1-6).  Each test was designed to FAIL on the original
code and PASS after the fix.  Run with:

    python3 -m unittest discover -s tests -v
"""
import threading
import unittest
from datetime import datetime, timezone

from tillpoint import db, reports
from tillpoint.api import App
from tillpoint.catalog import OutOfStock
from tillpoint.payments import PaymentError


# ---------------------------------------------------------------------------
# Shared helper
# ---------------------------------------------------------------------------

def make_app():
    conn = db.connect()          # fresh in-memory SQLite for every test
    app = App(conn)
    app.catalog.add_product("MUG", "Mug", 1200, stock=10)
    app.catalog.add_product("TEE", "T-shirt", 2500, stock=5)
    conn.execute("INSERT INTO coupons (code, kind, value) VALUES ('TEN', 'percent', 10)")
    return app, conn


# ---------------------------------------------------------------------------
# Bug 1 — Idempotent webhook (duplicate event_id must not inflate revenue)
# ---------------------------------------------------------------------------

class TestBug1IdempotentWebhook(unittest.TestCase):
    """
    Root cause: payments.handle_event() inserted a new payments row on every
    call.  The payment provider retries until it gets 2xx, so the same event_id
    could be stored many times, inflating revenue.

    Fix: check for event_id before inserting; return early if already seen.
    """

    def test_duplicate_event_id_counted_once(self):
        app, conn = make_app()
        order = app.orders.create("bob", [("MUG", 1)])
        event = {"id": "evt_dup", "type": "payment.succeeded",
                 "order_id": order["id"], "amount_cents": 1200}

        # Send the SAME event twice (provider retry simulation)
        app.payments.handle_event(event)
        app.payments.handle_event(event)   # second call must be a no-op

        total = conn.execute(
            "SELECT COALESCE(SUM(amount_cents), 0) AS s FROM payments WHERE order_id = ? AND overpayment = 0",
            (order["id"],)
        ).fetchone()["s"]
        self.assertEqual(total, 1200, "Revenue should be 1200, not 2400")

    def test_duplicate_event_returns_current_status(self):
        """The idempotent second call must return the order status, not crash."""
        app, _ = make_app()
        order = app.orders.create("bob", [("MUG", 1)])
        event = {"id": "evt_dup2", "type": "payment.succeeded",
                 "order_id": order["id"], "amount_cents": 1200}
        app.payments.handle_event(event)
        # Second call must not raise
        status = app.payments.handle_event(event)
        self.assertEqual(status, "paid")


# ---------------------------------------------------------------------------
# Bug 2 — Cancelling a pending order must release stock
# ---------------------------------------------------------------------------

class TestBug2CancelPendingRestoresStock(unittest.TestCase):
    """
    Root cause: cancel() only released stock when order status was 'paid'.
    Stock is reserved at order *creation*, so a 'pending' order that gets
    cancelled never returned its stock, permanently depleting the shelf.

    Fix: release stock for both 'pending' and 'paid' statuses.
    """

    def test_cancel_pending_returns_stock(self):
        app, _ = make_app()
        order = app.orders.create("carol", [("MUG", 3)])
        # Order is pending — not paid yet
        self.assertEqual(order["status"], "pending")
        self.assertEqual(app.catalog.get_product("MUG").stock, 7)  # 10 - 3

        app.orders.cancel(order["id"])

        # Stock must be fully restored
        self.assertEqual(app.catalog.get_product("MUG").stock, 10,
                         "Cancelling a pending order must return stock to 10")

    def test_cancel_paid_still_returns_stock(self):
        """Existing behaviour for paid orders must still work."""
        app, _ = make_app()
        order = app.orders.create("carol", [("TEE", 2)])
        app.payments.handle_event(
            {"id": "evt_p", "type": "payment.succeeded",
             "order_id": order["id"], "amount_cents": 5000})
        app.orders.cancel(order["id"])
        self.assertEqual(app.catalog.get_product("TEE").stock, 5)


# ---------------------------------------------------------------------------
# Bug 3 — Tax must be calculated on the post-discount amount
# ---------------------------------------------------------------------------

class TestBug3TaxAfterDiscount(unittest.TestCase):
    """
    Root cause: price_order() called tax_for(sub, region) before computing the
    discount.  Coupon customers were taxed on the full subtotal, not on what
    they actually paid.

    Fix: compute discount first, then tax on (sub - discount).
    """

    def test_tax_uses_post_discount_base(self):
        """
        MUG @ $12.00, region CA (7.25 % = 725 bps), coupon TEN (-10 %).
        subtotal      = 1200
        discount 10 % =  120
        taxable base  = 1080
        tax 7.25 %    = round_half_up(1080 * 725, 10000) = 78
        total         = 1080 + 78 = 1158

        Old (broken) code taxed on 1200 → tax = 87, total = 1167.
        """
        app, _ = make_app()
        order = app.orders.create("diana", [("MUG", 1)],
                                  region="CA", coupon_code="TEN")
        self.assertEqual(order["discount_cents"], 120)
        self.assertEqual(order["tax_cents"], 78,
                         "Tax should be 78 (on 1080), not 87 (on 1200)")
        self.assertEqual(order["total_cents"], 1158)

    def test_tax_without_coupon_unchanged(self):
        """No regression: orders without coupons must still compute tax on the full subtotal."""
        app, _ = make_app()
        order = app.orders.create("diana", [("MUG", 1)], region="CA")
        # subtotal 1200, tax 7.25% → round_half_up(1200*725,10000) = 87
        self.assertEqual(order["tax_cents"], 87)


# ---------------------------------------------------------------------------
# Bug 4 — India timezone: UTC offset sign was wrong
# ---------------------------------------------------------------------------

class TestBug4IndiaTimezone(unittest.TestCase):
    """
    Root cause: day_bounds_utc() ADDED the UTC offset instead of subtracting it.
    For UTC+5:30 (330 min), local midnight 00:00 IST = 18:30 UTC the day before.
    The original code produced 05:30 UTC the SAME day, so IST morning sales
    (03:30-05:30 UTC) fell outside the query window and appeared under yesterday.

    Fix: start -= timedelta(minutes=utc_offset_minutes)
    """

    def test_morning_sale_in_india_appears_on_correct_day(self):
        """
        A sale received at 03:30 UTC on 2025-03-10 is 09:00 IST on 2025-03-10.
        With utc_offset_minutes=330, the daily report for '2025-03-10' must
        include that payment.
        """
        app, conn = make_app()
        order = app.orders.create("eve", [("MUG", 1)])
        morning_utc = datetime(2025, 3, 10, 3, 30, tzinfo=timezone.utc)
        app.payments.handle_event(
            {"id": "evt_india", "type": "payment.succeeded",
             "order_id": order["id"], "amount_cents": 1200},
            now=morning_utc,
        )
        result = reports.daily_sales(conn, "2025-03-10", utc_offset_minutes=330)
        self.assertEqual(result["revenue_cents"], 1200,
                         "03:30 UTC = 09:00 IST — must appear on 2025-03-10 IST report")

    def test_sale_before_ist_midnight_not_in_next_day(self):
        """A sale at 23:00 IST (17:30 UTC) must stay in that IST calendar day."""
        app, conn = make_app()
        order = app.orders.create("eve", [("MUG", 1)])
        evening_utc = datetime(2025, 3, 10, 17, 30, tzinfo=timezone.utc)
        app.payments.handle_event(
            {"id": "evt_eve", "type": "payment.succeeded",
             "order_id": order["id"], "amount_cents": 1200},
            now=evening_utc,
        )
        result_today = reports.daily_sales(conn, "2025-03-10", utc_offset_minutes=330)
        result_next  = reports.daily_sales(conn, "2025-03-11", utc_offset_minutes=330)
        self.assertEqual(result_today["revenue_cents"], 1200)
        self.assertEqual(result_next["revenue_cents"], 0)


# ---------------------------------------------------------------------------
# Bug 5 — Atomic reserve prevents overselling under concurrency
# ---------------------------------------------------------------------------

class TestBug5AtomicReserve(unittest.TestCase):
    """
    Root cause: reserve() read stock in Python, checked, then issued a separate
    UPDATE — a TOCTOU race.  With two threads / workers both could read stock=1,
    both pass the check, and both decrement to -1.

    Fix: single atomic SQL UPDATE ... WHERE stock >= qty; check rowcount.
    """

    def test_concurrent_reserve_no_oversell(self):
        """
        Two threads try to reserve the last 1 unit of TEE simultaneously.
        Exactly one must succeed; the other must get OutOfStock.
        Stock must never go below 0.
        """
        import os, tempfile
        import sqlite3 as _sqlite3

        # Use a temp file so the connection can be opened from multiple threads.
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            # Create a fresh DB with check_same_thread=False
            conn = _sqlite3.connect(path, check_same_thread=False, isolation_level=None)
            conn.row_factory = _sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.executescript(db.SCHEMA)

            app = App(conn)
            app.catalog.add_product("TEE", "T-shirt", 2500, stock=1)
            app.catalog._cache.clear()

            results = []
            errors  = []
            lock    = threading.Lock()

            def try_reserve():
                try:
                    app.catalog.reserve("TEE", 1)
                    with lock:
                        results.append("ok")
                except OutOfStock:
                    with lock:
                        errors.append("oos")

            t1 = threading.Thread(target=try_reserve)
            t2 = threading.Thread(target=try_reserve)
            t1.start(); t2.start()
            t1.join();  t2.join()

            stock_now = conn.execute(
                "SELECT stock FROM products WHERE sku = 'TEE'"
            ).fetchone()["stock"]
            self.assertGreaterEqual(stock_now, 0, "Stock must never go negative")
            # At least one thread should have succeeded; total success+oos == 2
            self.assertEqual(len(results) + len(errors), 2)
            self.assertLessEqual(len(results), 1,
                                 "At most one reservation should succeed for 1 unit of stock")
        finally:
            conn.close()
            os.unlink(path)


# ---------------------------------------------------------------------------
# Bug 6 — Duplicate payment for a paid order must be flagged
# ---------------------------------------------------------------------------

class TestBug6DuplicatePaymentFlagged(unittest.TestCase):
    """
    Root cause: payments.handle_event() inserted every payment row without
    checking whether the order was already paid.  A genuine second charge
    was silently recorded as normal revenue.

    Fix: a new event_id on an already-paid/shipped order is inserted with
    overpayment=1 and PaymentError is raised so staff are alerted (API → 409).
    """

    def test_second_payment_raises_error(self):
        """A new event_id on an already-paid order must raise PaymentError."""
        app, _ = make_app()
        order = app.orders.create("frank", [("MUG", 1)])
        app.payments.handle_event(
            {"id": "evt_first", "type": "payment.succeeded",
             "order_id": order["id"], "amount_cents": 1200})

        with self.assertRaises(PaymentError):
            app.payments.handle_event(
                {"id": "evt_second", "type": "payment.succeeded",
                 "order_id": order["id"], "amount_cents": 1200})

    def test_second_payment_stored_as_overpayment(self):
        """The duplicate must be recorded in the DB with overpayment=1 for auditing."""
        app, conn = make_app()
        order = app.orders.create("frank", [("MUG", 1)])
        app.payments.handle_event(
            {"id": "evt_a", "type": "payment.succeeded",
             "order_id": order["id"], "amount_cents": 1200})

        try:
            app.payments.handle_event(
                {"id": "evt_b", "type": "payment.succeeded",
                 "order_id": order["id"], "amount_cents": 1200})
        except PaymentError:
            pass

        over = conn.execute(
            "SELECT COUNT(*) AS n FROM payments WHERE order_id = ? AND overpayment = 1",
            (order["id"],)
        ).fetchone()["n"]
        self.assertEqual(over, 1, "The duplicate payment must be stored with overpayment=1")

    def test_second_payment_not_counted_in_revenue(self):
        """paid_cents() must exclude overpayment rows so revenue stays correct."""
        app, _ = make_app()
        order = app.orders.create("frank", [("MUG", 1)])
        app.payments.handle_event(
            {"id": "evt_c", "type": "payment.succeeded",
             "order_id": order["id"], "amount_cents": 1200})
        try:
            app.payments.handle_event(
                {"id": "evt_d", "type": "payment.succeeded",
                 "order_id": order["id"], "amount_cents": 1200})
        except PaymentError:
            pass
        self.assertEqual(app.payments.paid_cents(order["id"]), 1200,
                         "paid_cents must be 1200, not 2400")

    def test_api_returns_409_for_duplicate_payment(self):
        """The HTTP API must surface the error as 409 Conflict."""
        app, _ = make_app()
        order = app.orders.create("frank", [("MUG", 1)])
        app.handle("POST", "/webhooks/payments",
                   {"id": "evt_e", "type": "payment.succeeded",
                    "order_id": order["id"], "amount_cents": 1200})
        status, body = app.handle("POST", "/webhooks/payments",
                                  {"id": "evt_f", "type": "payment.succeeded",
                                   "order_id": order["id"], "amount_cents": 1200})
        self.assertEqual(status, 409)
        self.assertIn("overpayment", body["error"])


if __name__ == "__main__":
    unittest.main()
