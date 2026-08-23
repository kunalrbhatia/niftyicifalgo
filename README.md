# 🦅 Nifty Monthly Iron Condor Algo (Positional)

An automated, positional trading strategy for Nifty 50 monthly options using Angel One's SmartAPI. This algo manages an Iron Condor from entry (early in the month) through a single risk-adjustment phase, finally exiting on expiry day.

## 🧠 Strategy Overview

- **Instrument:** NIFTY 50 Monthly Options.
- **Product Type:** `CARRYFORWARD` (NRML) — positions are held across days.
- **Entry Logic:** 
  - If today's date is **on or before the 15th** of the month, a trade is initiated for the **current** month's monthly expiry.
  - If today's date is **after the 20th** of the month, a trade is initiated for the **next** month's monthly expiry.
  - If today's date is between the 16th and 20th, no new entries are taken.
  - Automatically detects if positions for the target monthly expiry already exist.
  - Sells **25Δ (Delta)** Call and Put; Buys **17Δ** Call and Put for protection.
  - **100-Point Strike Intervals:** All selected strikes are strictly multiples of 100. If the closest delta is a 50-multiple, the algo pushes further OTM (Puts round down, Calls round up).
- **Adjustment Logic (The "Wall" Rule):**
  - Performs a daily "Wall Check" at startup.
  - If Spot price $\le$ Short Put strike OR Spot price $\ge$ Short Call strike:
    - The opposite side is rolled to ATM (At-The-Money).
    - The Iron Condor is converted into an **Iron Butterfly**.
    - This adjustment happens **exactly once** per expiry cycle.
- **Exit Logic:**
  - On Expiry Day at **03:25 PM IST**.
  - Automatically exits **ITM (In-The-Money) legs** via Market orders.
  - OTM legs are left to expire worthless to save on brokerage.

## 🛠️ Key Features

- **Dynamic IP Detection:** Automatically detects your server's public IPv4 address for every request to Angel One's SmartAPI, preventing "Unregistered IP" errors without manual configuration.
- **State Reconstruction:** No database required. Every morning, the algo queries your Angel One account, identifies open Nifty legs, and reconstructs its internal state (strikes, tokens, adjustment status).
- **Auto-Scrip Management:** Downloads and filters the latest Angel One Scrip Master daily at 09:00 AM to ensure symbol tokens and expiry dates are always accurate.
- **Telegram Integration:** Sends a detailed daily summary including scrip updates, entry details, wall check results, and current month's realized P&L.
- **PnL Tracking:** Maintains a local record of realized P&L to track performance over time.
- **Rate-Limit Aware:** Implements necessary delays between API calls to stay within SmartAPI's rate limits.
- **2026 Ready:** Includes a hardcoded NSE holiday list for 2026 for reliable execution.

## 📂 Project Structure

- `index.js`: Main orchestrator — handles the daily lifecycle.
- `config.js`: Central configuration for deltas, lot sizes, and timings.
- `filter_scrips.js`: Downloads and prepares the `scrip_master.json`.
- `modules/`:
    - `auth.js`: Handles SmartAPI login and TOTP.
    - `positionTracker.js`: Reconstructs the strategy state from live positions.
    - `wallMonitor.js`: Logic for monitoring price levels against short strikes.
    - `adjustEngine.js`: Executes the "Roll to ATM" adjustment orders.
    - `exitManager.js`: Manages the 3:25 PM ITM exit check on expiry.
    - `optionChain.js`: Fetches LTPs, Greeks, and finds expiry dates.
- `strategy-brain/`: **Strategy Brain (LLM-Driven Self-Healing Options Strategy Manager)**
  - `src/orchestrator.ts`: Autonomous self-healing loop (Trigger $\rightarrow$ SITREP $\rightarrow$ Research $\rightarrow$ Backtest $\rightarrow$ Score $\rightarrow$ Decide $\rightarrow$ Execute $\rightarrow$ Verify $\rightarrow$ Ledger). Supports `--live-sitrep` to watch live SmartAPI broker positions.
  - `src/broker.ts`: Read-only SmartAPI broker adapter fetching live positions, RMS margin, and per-underlying spot.
  - `src/scripMasterResolver.ts`: Resolves equity spot instrument tokens from `scrip_master.json` for per-underlying spot lookup (e.g., ABB, RELIANCE, NIFTY 50).
  - `src/positionMapper.ts`: Translates broker positions into Strategy Brain `LegPosition` objects and infers strategy names.
  - `src/safety.ts`: Safety rails, hard panic (`.panic`), soft pause (`.kill`), execution caps, and tier resolution.
  - `src/sitrep.ts`: Portfolio state collector, combined Greeks, short strike wall proximity monitoring, and `buildFromBroker()`.
  - `src/scorer.ts`: Multi-factor candidate scoring and ranking engine.
  - `src/ledger.ts`: Append-only JSONL decision ledger and weekly performance reviewer.
  - `src/research.ts` & `src/backtest.ts`: Playbook markdown parser, web search cache, and data-lake analogue backtester.
  - `src/executor.ts` & `src/verify.ts`: Paper execution (live hard-blocked), safety gates, and post-execution fill verification.
  - `playbook/`: Curated adjustment playbooks for Iron Condor, Calendar Ratio Strangle, Straddle, and Ratio Spreads.
- `utils/`: Logging (`winston`), Telegram notifications, and mathematical helpers.

## 🚀 Setup & Installation

1. **Clone & Install:**
   ```bash
   git clone <repo-url>
   npm install
   ```

2. **Environment Variables:**
   Create a `.env` file based on `.env.example`:
   ```env
   ANGEL_API_KEY=your_api_key
   ANGEL_CLIENT_ID=your_client_id
   ANGEL_PASSWORD=your_password
   ANGEL_TOTP_SECRET=your_totp_secret
   ANGEL_PUBLIC_IP=your_ip (Optional: Auto-detected by default)

   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_CHAT_ID=your_chat_id
   ```

3. **Run the Algo:**
   ```bash
   node index.js
   ```

## 🧪 Backtesting & Testing

- **Backtest:** `node backtest.js <jwtToken>`
  - Simulates the strategy over the last 6 months using historical Nifty data and Black-Scholes premium estimation.
- **Test Greeks:** `node test_greeks.js <jwtToken>`
  - Verifies that Angel One's Greek API is returning data for the specified expiries.

## ⚖️ Disclaimer

Trading in options involves significant risk. This software is provided "as is" for educational and research purposes. Always test thoroughly in a paper trading environment before deploying real capital.
