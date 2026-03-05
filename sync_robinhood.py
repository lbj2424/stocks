#!/usr/bin/env python3
"""
sync_robinhood.py - Sync Robinhood transactions to portfolio.csv

Setup (one-time):
  1. pip install -r requirements.txt
  2. Copy .env.example to .env and fill in your Robinhood email + password
  3. python sync_robinhood.py

Your .env file is listed in .gitignore and is never uploaded to GitHub.
Credentials go directly to Robinhood's servers, same as logging in via the app.

The script will prompt you for your 2FA code on first run, then saves the session
token locally so future runs don't require 2FA again.
"""

import os
import csv
from collections import defaultdict
from dotenv import load_dotenv
import robin_stocks.robinhood as rh

_here = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_here, ".env"))

USERNAME = os.getenv("ROBINHOOD_USERNAME")
PASSWORD = os.getenv("ROBINHOOD_PASSWORD")
CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "portfolio.csv")


# ── Instrument URL → ticker symbol (cached to avoid repeat API calls) ──────────

_symbol_cache = {}

def get_symbol(url):
    if not url:
        return ""
    if url not in _symbol_cache:
        data = rh.stocks.get_instrument_by_url(url)
        _symbol_cache[url] = data.get("symbol", "").upper() if data else ""
    return _symbol_cache[url]


# ── Fetch trades ───────────────────────────────────────────────────────────────

def fetch_trades():
    """Pull all filled buy/sell stock orders from Robinhood."""
    rows = []
    print("  Fetching stock orders (this may take a moment)...")
    orders = rh.orders.get_all_stock_orders()

    for order in orders:
        if order.get("state") != "filled":
            continue
        side = order.get("side", "")
        if side not in ("buy", "sell"):
            continue

        symbol = get_symbol(order.get("instrument", ""))
        if not symbol:
            continue

        # created_at looks like "2025-01-15T10:30:00.000000Z"
        created_at = order.get("created_at", "")
        month = created_at[:7] if len(created_at) >= 7 else ""

        for ex in order.get("executions", []):
            shares = float(ex.get("quantity", 0) or 0)
            price  = float(ex.get("price",    0) or 0)
            if shares <= 0 or price <= 0:
                continue
            rows.append({
                "ticker":        symbol,
                "shares":        round(shares, 6),
                "total_cost":    round(shares * price, 2),
                "month":         month,
                "type":          side,
                "realized_gain": "",
            })

    return rows


# ── Fetch dividends ────────────────────────────────────────────────────────────

def fetch_dividends():
    """Pull all paid dividends from Robinhood."""
    rows = []
    print("  Fetching dividends...")
    dividends = rh.account.get_dividends()

    for div in dividends:
        if div.get("state") != "paid":
            continue

        symbol = get_symbol(div.get("instrument", ""))
        if not symbol:
            continue

        paid_date = div.get("paid_date") or div.get("payable_date", "")
        month  = paid_date[:7] if paid_date and len(paid_date) >= 7 else ""
        amount = float(div.get("amount", 0) or 0)
        if amount <= 0:
            continue

        rows.append({
            "ticker":        symbol,
            "shares":        0,
            "total_cost":    round(amount, 2),
            "month":         month,
            "type":          "dividend",
            "realized_gain": "",
        })

    return rows


# ── FIFO realized gain calculation ─────────────────────────────────────────────

def apply_fifo_realized_gains(rows):
    """
    Walk through all transactions in chronological order and compute the
    realized gain for each sell row using FIFO cost basis.

    For sells:  realized_gain = proceeds - cost_basis_of_shares_sold
    """
    # Sort: buys before sells within same month so buys are always queued first
    rows.sort(key=lambda r: (r["month"], 0 if r["type"] == "buy" else 1))

    # FIFO queue per ticker: list of [remaining_shares, cost_per_share]
    fifo = defaultdict(list)

    for row in rows:
        t = row["ticker"]

        if row["type"] == "buy":
            shares = float(row["shares"])
            cps    = float(row["total_cost"]) / shares if shares else 0
            fifo[t].append([shares, cps])

        elif row["type"] == "sell":
            shares_to_sell = float(row["shares"])
            proceeds       = float(row["total_cost"])
            cost_basis     = 0.0
            remaining      = shares_to_sell

            while remaining > 1e-9 and fifo[t]:
                lot_shares, lot_cps = fifo[t][0]
                taken       = min(lot_shares, remaining)
                cost_basis += taken * lot_cps
                remaining  -= taken
                fifo[t][0][0] -= taken
                if fifo[t][0][0] < 1e-9:
                    fifo[t].pop(0)

            row["realized_gain"] = round(proceeds - cost_basis, 2)

    return rows


# ── Save CSV ───────────────────────────────────────────────────────────────────

def save_csv(rows):
    fieldnames = ["ticker", "shares", "total_cost", "month", "type", "realized_gain"]
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nSaved {len(rows)} rows to portfolio.csv")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    if not USERNAME or not PASSWORD:
        print("ERROR: ROBINHOOD_USERNAME and ROBINHOOD_PASSWORD not set.")
        print("  Copy .env.example to .env and fill in your credentials.")
        return

    print("Logging into Robinhood...")
    print("(You may be prompted to enter your 2FA code.)\n")
    rh.login(USERNAME, PASSWORD, store_session=True)
    print("Logged in successfully.\n")

    trade_rows = fetch_trades()
    print(f"  Found {len(trade_rows)} trade executions\n")

    div_rows = fetch_dividends()
    print(f"  Found {len(div_rows)} dividend payments\n")

    all_rows = trade_rows + div_rows

    print("Calculating realized gains (FIFO cost basis)...")
    all_rows = apply_fifo_realized_gains(all_rows)

    sells           = [r for r in all_rows if r["type"] == "sell"]
    total_realized  = sum(float(r["realized_gain"]) for r in sells if r["realized_gain"] != "")
    total_dividends = sum(float(r["total_cost"])    for r in all_rows if r["type"] == "dividend")

    print(f"  Realized gains:  ${total_realized:,.2f}")
    print(f"  Dividends:       ${total_dividends:,.2f}")

    save_csv(all_rows)

    rh.logout()
    print("\nDone! Refresh your dashboard to see the updated data.")


if __name__ == "__main__":
    main()
