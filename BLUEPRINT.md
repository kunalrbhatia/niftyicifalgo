# 📘 BLUEPRINT: Nifty 50 Monthly Expiry Positional Iron Condor Algo
> **Version:** 1.2 (Positional Update)
> **Language:** Node.js  
> **Broker:** Angel One SmartAPI  
> **Exchange:** NSE (National Stock Exchange of India)  
> **Instrument:** NIFTY 50 Monthly Options  

---

## 🧠 Strategy Overview

This is a **carry-forward (positional) options strategy** that initiates an Iron Condor and holds it until the monthly expiry day. It includes a one-time adjustment rule to manage risk if the market hits a "wall" (short strike).

### Entry Rule
- **Timing:** Initiated only if today's date is **on or before the 15th of the month**.
- **Condition:** Only enters if no existing Nifty positions for the current monthly expiry are detected.
- **Strikes:**
  - Sell **25 Delta PUT** (Short PUT) — **PUT WALL**
  - Sell **25 Delta CALL** (Short CALL) — **CALL WALL**
  - Buy **17 Delta PUT** (Long PUT wing — protection)
  - Buy **17 Delta CALL** (Long CALL wing — protection)
- This creates an **Iron Condor** at entry.

### Adjustment Rule (Once Only)
The algo performs a **single wall check** daily at startup if a position exists.
- If **Nifty Spot price <= SELL PUT strike** → Roll the **CALL side** to ATM (buy back 17Δ CALL, sell new ATM CALL) → becomes **Iron Butterfly**.
- If **Nifty Spot price >= SELL CALL strike** → Roll the **PUT side** to ATM (buy back 17Δ PUT, sell new ATM PUT) → becomes **Iron Butterfly**.
- **Only one adjustment ever.** After adjustment, the algo stops further monitoring for adjustments.
- The 17Δ wings provide natural loss protection. No manual stop loss is used.

### Exit Rule
- **NO exit on normal trading days.** The position is carried forward.
- **On Expiry Day at 3:25 PM IST**:
  - **ITM legs** → Exit immediately via MARKET order.
  - **OTM legs** → Leave them to expire worthless at 3:30 PM settlement.
- Algo ends after the 3:25 PM check on expiry day.

---

## 📅 Daily Execution Flow

1. **Scrip Master Check (09:00 AM IST):** Downloads and filters the Angel One scrip master daily to ensure trading symbols and tokens are fresh.
2. **Holiday Check:** Verifies if today is a valid NSE trading day. If not, exits gracefully.
3. **Login:** Authenticates with SmartAPI using JWT and TOTP.
4. **Position Check & Reconstruction:**
   - Checks if any Nifty positions for the current monthly expiry are already open.
   - If YES: Reconstructs the internal state from live positions and performs a **Wall Check** for adjustments.
   - If NO: Checks if the current date is $\le 15$ of the month. If so, initiates a new Iron Condor.
5. **Expiry Handling:** If today is the monthly expiry day, the algo waits until 3:25 PM to run the final ITM exit check.
6. **Notification:** Sends a detailed summary of all actions (Scrip update, Entry, Adjustment, Exit) to a **Telegram channel**.

---

## 🛠️ Tech Stack

| Component         | Technology                          |
|-------------------|-------------------------------------|
| Language          | Node.js (v18+)                      |
| Broker API        | Angel One SmartAPI (REST)           |
| Time Management   | `moment-timezone` (Asia/Kolkata)    |
| Notifications     | Telegram Bot API                    |
| Logging           | winston (file + console)            |
| Env Management    | dotenv                              |

---

## 📦 Project Structure

```
niftyicifalgo/
│
├── .env                    # 🔒 Secrets (API Keys, Telegram Token, etc.)
├── index.js                # Main entry point — orchestrates the daily run
├── config.js               # Central strategy configuration
├── filter_scrips.js        # Script to download and filter Nifty options
│
├── modules/
│   ├── auth.js             # SmartAPI login + TOTP
│   ├── holidayCheck.js     # Expiry day and trading day logic (Manual 2026 list)
│   ├── optionChain.js      # Fetch live Nifty spot and option Greeks
│   ├── deltaFinder.js      # Identify 25Δ and 17Δ strikes
│   ├── orderManager.js     # Place / exit MARKET orders
│   ├── positionTracker.js  # Reconstruct state from live positions
│   ├── wallMonitor.js      # Perform single-shot wall check for adjustments
│   ├── adjustEngine.js     # Roll opposite side to ATM on wall hit
│   └── exitManager.js      # 3:25 PM ITM check and exit (Expiry day only)
│
└── utils/
    ├── logger.js           # Winston logger
    ├── helpers.js          # Time and rounding utilities
    └── notifier.js         # Telegram notification sender
```

---

## 📋 Module Specifications (Key Updates)

### 1. `modules/holidayCheck.js`
Uses a hardcoded list of NSE holidays for 2026.
- `isTodayExpiryDay()`: Returns `{ isTodayTrading, isExpiry }`.
- Logic for expiry: Last Tuesday of the month, adjusted backwards if it's a holiday.

### 2. `modules/positionTracker.js`
- `hasOpenPositions()`: Queries SmartAPI to see if any NIFTY positions exist for the current expiry.
- `reconstructState()`: Parses live positions to identify which legs are open and whether an adjustment has already occurred.

### 3. `modules/wallMonitor.js`
- `performSingleWallCheck()`: A non-looping check used in the positional version. It compares the current Nifty spot against the short strikes stored in the (reconstructed) state.

### 4. `modules/exitManager.js`
- Only executes on Expiry Day.
- Loops through all `OPEN` legs in the state and closes only those that are ITM based on the 3:25 PM spot price.

---

## 🔐 Environment Variables (.env)

```env
ANGEL_API_KEY=...
ANGEL_CLIENT_ID=...
ANGEL_PASSWORD=...
ANGEL_TOTP_SECRET=...
ANGEL_PUBLIC_IP=...

TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

EXIT_CHECK_TIME=15:25
```

---

## 🧪 Operational Notes

- **Lot Size:** Updated to **65** for Nifty (Jan 2026 revision).
- **Product Type:** Always use `CARRYFORWARD` (NRML) to ensure positions are not auto-squared off by the broker.
- **Persistence:** The algo does not need a database; it "learns" its state every morning by querying the broker's live positions.
- **Rate Limits:** Includes `sleep(1200)` between API calls where necessary to stay within SmartAPI limits.
