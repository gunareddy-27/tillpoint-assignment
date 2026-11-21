"""Sales reports for the shop owner."""
from datetime import datetime, timedelta, timezone

from . import db


def day_bounds_utc(day, utc_offset_minutes=0):
    """The UTC instants at which a shop-local calendar day starts and ends. day is 'YYYY-MM-DD'.

    BUG 4 FIX: The original code ADDED the UTC offset, which is backwards.
    To convert a local midnight to UTC you must SUBTRACT the offset.
    Example: UTC+5:30 (330 min).  Local midnight 2024-01-02 00:00 IST
             = 2024-01-01 18:30 UTC.  The old code produced 2024-01-02 05:30 UTC,
             so a sale at 03:30 UTC (08:30 IST, same local day) was excluded from
             the report and appeared under the previous UTC day instead.
    """
    start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    start -= timedelta(minutes=utc_offset_minutes)   # FIX: subtract, not add
    return db.to_iso(start), db.to_iso(start + timedelta(days=1))


def daily_sales(conn, day, utc_offset_minutes=0):
    """Money received on one shop-local day, and how many orders it came from."""
    start, end = day_bounds_utc(day, utc_offset_minutes)
    row = conn.execute(
        "SELECT COALESCE(SUM(amount_cents), 0) AS revenue, COUNT(DISTINCT order_id) AS orders"
        " FROM payments WHERE received_at >= ? AND received_at < ?",
        (start, end),
    ).fetchone()
    return {"day": day, "revenue_cents": row["revenue"], "orders": row["orders"]}


def top_products(conn, limit=5):
    """Best sellers by units, counting orders that were paid or shipped."""
    rows = conn.execute(
        "SELECT i.sku, SUM(i.qty) AS units, SUM(i.qty * i.unit_price_cents) AS gross_cents"
        " FROM order_items i JOIN orders o ON o.id = i.order_id"
        " WHERE o.status IN ('paid', 'shipped') GROUP BY i.sku ORDER BY units DESC, i.sku LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]
