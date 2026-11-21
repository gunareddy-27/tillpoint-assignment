"""Payment provider webhooks. The provider retries a delivery until it gets a 2xx, so events can repeat."""
from . import db


class PaymentError(Exception):
    pass


class Payments:
    def __init__(self, conn):
        self.conn = conn

    def handle_event(self, event, now=None):
        """event: dict(id, type, order_id, amount_cents). Returns the order's status after the event.

        BUG 1 FIX: Idempotent webhook processing.
        The payment provider retries until it gets a 2xx.  If the same event_id
        arrives more than once we must NOT insert a second payment row — that
        would inflate revenue.  We check for the event_id first and return the
        current order status without touching the database.

        BUG 6 FIX: Duplicate payment detection.
        A *different* event_id for an already-paid/shipped order means the
        customer was genuinely charged twice.  We record the extra payment with
        overpayment=1 (preserving the audit trail) and raise PaymentError so the
        API returns HTTP 409 and staff are alerted.
        """
        if event.get("type") != "payment.succeeded":
            return None

        order = self.conn.execute("SELECT * FROM orders WHERE id = ?", (event["order_id"],)).fetchone()
        if order is None:
            raise PaymentError(f"payment for unknown order {event['order_id']}")
        if order["status"] == "cancelled":
            raise PaymentError(f"order {order['id']} is cancelled")

        # --- Bug 1 fix: idempotency guard ---
        # If this exact event_id was already recorded, the provider is retrying a
        # delivery we already processed.  Return the current status without
        # inserting a duplicate row.
        existing = self.conn.execute(
            "SELECT id FROM payments WHERE event_id = ?", (event["id"],)
        ).fetchone()
        if existing is not None:
            return order["status"]

        # --- Bug 6 fix: duplicate-payment detection ---
        # A brand-new event_id for an order that is already paid or shipped means
        # the customer was charged a second time.  Record it for the audit trail
        # but flag it as an overpayment and surface the error.
        if order["status"] in ("paid", "shipped"):
            self.conn.execute(
                "INSERT INTO payments (order_id, event_id, amount_cents, received_at, overpayment)"
                " VALUES (?, ?, ?, ?, 1)",
                (order["id"], event["id"], event["amount_cents"], db.to_iso(now or db.utcnow())),
            )
            raise PaymentError(
                f"order {order['id']} already paid: duplicate payment {event['id']} recorded "
                "as overpayment=1 — manual refund required"
            )

        self.conn.execute(
            "INSERT INTO payments (order_id, event_id, amount_cents, received_at, overpayment) VALUES (?, ?, ?, ?, 0)",
            (order["id"], event["id"], event["amount_cents"], db.to_iso(now or db.utcnow())),
        )
        if order["status"] == "pending" and self.paid_cents(order["id"]) >= order["total_cents"]:
            self.conn.execute("UPDATE orders SET status = 'paid' WHERE id = ?", (order["id"],))
            return "paid"
        return order["status"]

    def paid_cents(self, order_id):
        """Sum of non-overpayment amounts for an order."""
        row = self.conn.execute(
            "SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM payments"
            " WHERE order_id = ? AND overpayment = 0", (order_id,)
        ).fetchone()
        return row["paid"]
