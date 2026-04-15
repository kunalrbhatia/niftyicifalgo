# 📘 BLUEPRINT: Nifty 50 Monthly Expiry Iron Condor → Iron Butterfly Algo
> **Version:** 1.1  
> **Language:** Node.js  
> **Broker:** Angel One SmartAPI  
> **Exchange:** NSE (National Stock Exchange of India)  
> **Instrument:** NIFTY 50 Monthly Options  

---

## 🧠 Strategy Overview

This is an **intraday options strategy** that runs **only on Nifty 50 monthly expiry day**.

### Entry
- Sell **25 Delta PUT** (Short PUT) — this is the **PUT WALL**
- Sell **25 Delta CALL** (Short CALL) — this is the **CALL WALL**
- Buy **17 Delta PUT** (Long PUT wing — protection)
- Buy **17 Delta CALL** (Long CALL wing — protection)

This creates an **Iron Condor** at entry.

### Adjustment Rule (Once Only)
- If **Nifty Spot price touches or crosses the SELL PUT strike** → Roll the **CALL side** to ATM (buy back 17Δ CALL, sell new ATM CALL) → becomes **Iron Butterfly**
- If **Nifty Spot price touches or crosses the SELL CALL strike** → Roll the **PUT side** to ATM (buy back 17Δ PUT, sell new ATM PUT) → becomes **Iron Butterfly**
- **Only one adjustment ever.** After adjustment → algo stops monitoring → holds position.
- The 17Δ wings provide natural loss protection. No manual stop loss needed.

### Exit Rule
- **NO exit at 2:55 PM or any fixed time during the day.**
- At **3:25 PM** → check all open legs:
  - **ITM legs** → Exit immediately via MARKET order
  - **OTM legs** → Leave them. They will expire worthless at 3:30 PM settlement.
- Algo ends after 3:25 PM check.

---

## 📅 When Does the Algo Run?

### Expiry Day Logic
- Nifty 50 monthly options expire on the **last Tuesday of the month** on NSE.
- If the **last Tuesday is an NSE trading holiday**, expiry shifts to the **preceding trading day** (Monday, or Friday if Monday is also a holiday).
- The algo must:
  1. Check if today is a **valid NSE trading day**.
  2. Check if today is the **Nifty monthly expiry day**.
  3. If YES → proceed. If NO → do nothing, exit gracefully.

---

## 🛠️ Tech Stack

| Component         | Technology                          |
|-------------------|-------------------------------------|
| Language          | Node.js (v18+)                      |
| Broker API        | Angel One SmartAPI (REST + WebSocket)|
| Authentication    | SmartAPI JWT + TOTP via `otplib`    |
| Holiday Check     | `nse-market-holidays` npm package   |
| Option Chain Data | SmartAPI REST API                   |
| Order Placement   | SmartAPI REST API (MARKET orders)   |
| Logging           | winston (file + console)            |
| Scheduler (local) | node-cron OR pm2 cron               |
| Scheduler (cloud) | GCP Cloud Scheduler OR Oracle Scheduler |
| Env Management    | dotenv                              |

---

## 📦 NPM Dependencies

```json
{
  "dependencies": {
    "axios": "^1.6.0",
    "otplib": "^12.0.1",
    "nse-market-holidays": "latest",
    "dotenv": "^16.0.0",
    "winston": "^3.11.0",
    "node-cron": "^3.0.3",
    "ws": "^8.16.0"
  }
}
```

---

## 🔐 Environment Variables (.env)

```env
# Angel One SmartAPI Credentials
ANGEL_API_KEY=your_api_key_here
ANGEL_CLIENT_ID=your_client_id_here
ANGEL_PASSWORD=your_angel_password_here
ANGEL_TOTP_SECRET=your_totp_secret_key_here

# Strategy Config (can override config.js)
LOTS=2
SELL_DELTA=25
BUY_DELTA=17
ENTRY_TIME=09:30
EXIT_CHECK_TIME=15:25
```

> ⚠️ **NEVER commit `.env` to git. Always add it to `.gitignore`.**

---

## 📁 Project Structure

```
nifty-expiry-algo/
│
├── .env                    # 🔒 Secrets — GITIGNORED
├── .gitignore
├── package.json
├── README.md
│
├── config.js               # Central strategy configuration
├── index.js                # Main entry point — orchestrates everything
│
├── modules/
│   ├── auth.js             # SmartAPI login + TOTP generation
│   ├── holidayCheck.js     # Is today NSE expiry day?
│   ├── optionChain.js      # Fetch live Nifty option chain + Greeks
│   ├── deltaFinder.js      # Identify 25Δ and 17Δ strikes
│   ├── orderManager.js     # Place / exit MARKET orders
│   ├── positionTracker.js  # Track all open legs + live P&L
│   ├── wallMonitor.js      # Monitor if Nifty spot hits wall (1-min loop)
│   ├── adjustEngine.js     # Roll opposite side to ATM on wall hit
│   └── exitManager.js      # 3:25 PM ITM check and exit
│
├── utils/
│   ├── logger.js           # Winston logger (file + console)
│   └── helpers.js          # Utility functions (time check, rounding, etc.)
│
└── logs/
    └── .gitkeep
```

---

## ⚙️ config.js — Full Configuration

```javascript
// config.js
module.exports = {
  // Strategy
  sellDelta: parseInt(process.env.SELL_DELTA) || 25,   // Short strike delta
  buyDelta: parseInt(process.env.BUY_DELTA) || 17,     // Wing delta
  lots: parseInt(process.env.LOTS) || 2,               // 1 lot = 50 qty, so 2 lots = 100 qty
  lotSize: 50,                                          // Nifty lot size — VERIFY BEFORE USE

  // Timing (IST — 24hr format)
  entryTime: process.env.ENTRY_TIME || '09:30',         // Place orders at
  monitorIntervalMs: 60 * 1000,                         // Check every 1 minute
  finalExitTime: process.env.EXIT_CHECK_TIME || '15:25',// ITM exit check time

  // Orders
  orderType: 'MARKET',                                  // Always market orders
  exchange: 'NFO',                                      // NSE F&O segment
  productType: 'INTRADAY',                              // Intraday product

  // Instrument
  symbol: 'NIFTY',
  expiryType: 'weekly',

  // SmartAPI endpoints
  baseURL: 'https://apiconnect.angelone.in',

  // Logging
  logDir: './logs',
};
```

---

## 📋 Module Specifications

---

### 1. `modules/holidayCheck.js`

**Purpose:** Determine if today is the correct day to run the algo.

**Logic:**
1. Use `nse-market-holidays` to check if today is a trading day.
2. Get today's day of week.
3. If today is **Tuesday** AND it's a trading day → **it's expiry day → return true**.
4. If today is **Monday** AND it's a trading day AND **next Tuesday is NOT a trading day** (Tuesday is holiday) → **it's expiry day → return true**.
5. All other cases → return false.

**Exports:**
```javascript
async function isTodayExpiryDay() → returns Boolean
```

---

### 2. `modules/auth.js`

**Purpose:** Authenticate with Angel One SmartAPI and return a valid session token.

**Logic:**
1. Import `otplib` → use `authenticator.generate(process.env.ANGEL_TOTP_SECRET)` to generate live TOTP.
2. POST to SmartAPI login endpoint: `POST /rest/auth/angelbroking/user/v1/loginByPassword`
3. Payload: `{ clientcode, password, totp }`
4. On success: store `jwtToken`, `refreshToken`, `feedToken` in memory.
5. Return session object.

**SmartAPI Login Endpoint:**
```
POST https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword
Headers: { "X-ClientLocalIP", "X-ClientPublicIP", "X-MACAddress", "X-PrivateKey": ANGEL_API_KEY }
Body: { "clientcode": ANGEL_CLIENT_ID, "password": ANGEL_PASSWORD, "totp": <otplib generated> }
```

**Exports:**
```javascript
async function login() → returns { jwtToken, feedToken, refreshToken }
```

---

### 3. `modules/optionChain.js`

**Purpose:** Fetch live Nifty 50 option chain with Greeks (Delta, IV, etc.)

**Logic:**
1. Use SmartAPI option chain endpoint OR scrape via `GET /rest/secure/angelbroking/marketData/v1/optionChain`
2. Fetch for symbol `NIFTY`, expiry = nearest Tuesday (or Monday if holiday).
3. Return array of strikes with: `{ strikePrice, optionType, delta, iv, ltp, tradingSymbol, token }`

**Important Notes:**
- Greeks (Delta) must be available from SmartAPI. If not directly available, calculate Delta using Black-Scholes formula with live LTP, spot, strike, expiry time, risk-free rate, and IV.
- Always fetch **current week's expiry** date dynamically — never hardcode it.

**Exports:**
```javascript
async function getOptionChain(jwtToken) → returns Array of option objects
async function getNiftySpotPrice(jwtToken) → returns Number (spot price)
async function getExpiryDate() → returns String (DDMMMYYYY format for SmartAPI)
```

---

### 4. `modules/deltaFinder.js`

**Purpose:** From the option chain, identify the correct strikes for 25Δ and 17Δ.

**Logic:**
1. Filter PUT options → find strike whose delta is closest to **-0.25** → this is SELL PUT (PUT WALL)
2. Filter PUT options → find strike whose delta is closest to **-0.17** → this is BUY PUT (wing), must be **below** SELL PUT strike
3. Filter CALL options → find strike whose delta is closest to **+0.25** → this is SELL CALL (CALL WALL)
4. Filter CALL options → find strike whose delta is closest to **+0.17** → this is BUY CALL (wing), must be **above** SELL CALL strike
5. Return all 4 strikes with their trading symbols and tokens.

**Exports:**
```javascript
function findStrikes(optionChain) → returns {
  sellPut:  { strike, tradingSymbol, token, delta, ltp },
  buyPut:   { strike, tradingSymbol, token, delta, ltp },
  sellCall: { strike, tradingSymbol, token, delta, ltp },
  buyCall:  { strike, tradingSymbol, token, delta, ltp }
}
```

---

### 5. `modules/orderManager.js`

**Purpose:** Place, track, and exit orders via SmartAPI.

**SmartAPI Order Endpoint:**
```
POST https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/placeOrder
Headers: { Authorization: "Bearer <jwtToken>", "X-PrivateKey": ANGEL_API_KEY }
Body: {
  "variety": "NORMAL",
  "tradingsymbol": "NIFTY...",
  "symboltoken": "...",
  "transactiontype": "BUY" | "SELL",
  "exchange": "NFO",
  "ordertype": "MARKET",
  "producttype": "INTRADAY",
  "duration": "DAY",
  "price": "0",
  "quantity": "100"   // 2 lots × 50 = 100
}
```

**Functions:**

```javascript
// Place a single leg order
async function placeOrder(jwtToken, { tradingSymbol, token, transactionType, quantity }) → returns orderId

// Place all 4 legs of Iron Condor entry
async function placeIronCondorEntry(jwtToken, strikes) → returns { orderIds }

// Exit a specific leg (used at 3:25 PM for ITM legs)
async function exitLeg(jwtToken, { tradingSymbol, token, transactionType, quantity }) → returns orderId

// Get order status
async function getOrderStatus(jwtToken, orderId) → returns orderStatus
```

**Exports:** All above functions.

---

### 6. `modules/positionTracker.js`

**Purpose:** Maintain in-memory state of all open positions and their current status.

**State Object:**
```javascript
{
  entryTime: Date,
  expiryDate: String,
  adjusted: false,          // has wall been hit and adjustment done?
  wallHitSide: null,        // 'PUT' or 'CALL' or null
  legs: {
    sellPut:  { ...strikeInfo, entryPrice, orderId, status: 'OPEN'|'CLOSED' },
    buyPut:   { ...strikeInfo, entryPrice, orderId, status: 'OPEN'|'CLOSED' },
    sellCall: { ...strikeInfo, entryPrice, orderId, status: 'OPEN'|'CLOSED' },
    buyCall:  { ...strikeInfo, entryPrice, orderId, status: 'OPEN'|'CLOSED' },
  },
  netPremiumCollected: Number,
}
```

**Exports:**
```javascript
function initPosition(strikes, orderIds) → void
function markAdjusted(side, newLeg) → void
function getPosition() → state object
function updateLegStatus(legName, status) → void
```

---

### 7. `modules/wallMonitor.js`

**Purpose:** Every 1 minute, check if Nifty spot has hit either wall. Trigger adjustment if yes.

**Logic:**
1. Start a `setInterval` loop every 60 seconds.
2. Fetch live Nifty spot price via `optionChain.getNiftySpotPrice()`.
3. Get position state from `positionTracker.getPosition()`.
4. Check:
   - If `spot <= sellPut.strike` → wall hit on PUT side → call `adjustEngine.adjustCallSide()`
   - If `spot >= sellCall.strike` → wall hit on CALL side → call `adjustEngine.adjustPutSide()`
5. After adjustment → `clearInterval` → stop monitoring.
6. If `position.adjusted === true` on startup (shouldn't happen but safety check) → don't start loop.

**Exports:**
```javascript
function startMonitoring(jwtToken) → void
function stopMonitoring() → void
```

---

### 8. `modules/adjustEngine.js`

**Purpose:** When a wall is hit, roll the **opposite** side to ATM to convert Iron Condor → Iron Butterfly.

**Adjustment Logic — CALL wall hit (Nifty went up):**
1. Nifty has reached SELL CALL strike.
2. The PUT side (Sell PUT + Buy PUT) is now far OTM.
3. Action:
   - **Buy back** the existing 17Δ BUY PUT (close the wing).
   - **Sell new ATM PUT** (strike = nearest ATM put to current Nifty spot).
   - This tightens the PUT side to ATM → Iron Butterfly formed.

**Adjustment Logic — PUT wall hit (Nifty went down):**
1. Nifty has reached SELL PUT strike.
2. The CALL side (Sell CALL + Buy CALL) is now far OTM.
3. Action:
   - **Buy back** the existing 17Δ BUY CALL (close the wing).
   - **Sell new ATM CALL** (strike = nearest ATM call to current Nifty spot).
   - This tightens the CALL side to ATM → Iron Butterfly formed.

**ATM Strike Selection:**
- Fetch fresh option chain at time of adjustment.
- ATM = strike closest to current Nifty spot price.
- Use Nifty's standard strike intervals (50-point intervals).

**Exports:**
```javascript
async function adjustCallSide(jwtToken) → void  // Called when PUT wall is hit
async function adjustPutSide(jwtToken) → void   // Called when CALL wall is hit
```

---

### 9. `modules/exitManager.js`

**Purpose:** At 3:25 PM, check each open leg. Exit ITM legs only. Leave OTM legs to expire.

**Logic:**
1. Triggered at exactly 3:25 PM IST via `node-cron` or `setTimeout` from `index.js`.
2. Fetch current Nifty spot price.
3. For each open leg in position:
   - **CALL leg:** If `spot > strike` → ITM → EXIT (sell to close if bought, buy to close if sold)
   - **PUT leg:** If `spot < strike` → ITM → EXIT (sell to close if bought, buy to close if sold)
   - **OTM?** → Do nothing. Let it expire.
4. Log final P&L summary.
5. Algo ends.

**ITM Exit Transaction Direction:**
| Leg | Original Action | Exit Action |
|-----|----------------|-------------|
| Sell PUT (ITM) | SELL | BUY to close |
| Buy PUT (ITM) | BUY | SELL to close |
| Sell CALL (ITM) | SELL | BUY to close |
| Buy CALL (ITM) | BUY | SELL to close |

**Exports:**
```javascript
async function runFinalExitCheck(jwtToken) → void
```

---

### 10. `utils/logger.js`

**Purpose:** Centralized logging using Winston.

**Configuration:**
- Log to **console** (info level).
- Log to **file** `./logs/algo-YYYY-MM-DD.log` (debug level).
- Each log entry includes: timestamp, level, message, and optional metadata.

**Exports:**
```javascript
const logger = winston.createLogger(...)
module.exports = logger;
```

---

### 11. `utils/helpers.js`

**Purpose:** Utility functions used across modules.

**Functions:**
```javascript
// Check if current IST time >= target time string "HH:MM"
function isTimeReached(timeStr) → Boolean

// Get current IST time as "HH:MM" string
function getCurrentISTTime() → String

// Round to nearest Nifty strike (multiples of 50)
function roundToNearestStrike(price) → Number

// Calculate time to expiry in years (for Black-Scholes if needed)
function timeToExpiry(expiryDate) → Number

// Sleep utility
function sleep(ms) → Promise
```

---

### 12. `index.js` — Main Orchestrator

**Full execution flow:**

```javascript
const { isTodayExpiryDay } = require('./modules/holidayCheck');
const { login } = require('./modules/auth');
const { getOptionChain, getNiftySpotPrice, getExpiryDate } = require('./modules/optionChain');
const { findStrikes } = require('./modules/deltaFinder');
const { placeIronCondorEntry } = require('./modules/orderManager');
const { initPosition } = require('./modules/positionTracker');
const { startMonitoring } = require('./modules/wallMonitor');
const { runFinalExitCheck } = require('./modules/exitManager');
const { isTimeReached, sleep } = require('./utils/helpers');
const logger = require('./utils/logger');

async function main() {
  logger.info('=== Nifty Expiry Algo Started ===');

  // STEP 1: Check if today is expiry day
  const isExpiry = await isTodayExpiryDay();
  if (!isExpiry) {
    logger.info('Today is NOT Nifty expiry day. Algo exits.');
    process.exit(0);
  }
  logger.info('Today IS Nifty expiry day. Proceeding...');

  // STEP 2: Wait until entry time (09:30 AM IST)
  while (!isTimeReached('09:30')) {
    logger.info('Waiting for entry time 09:30...');
    await sleep(30 * 1000); // check every 30 sec
  }

  // STEP 3: Login
  logger.info('Logging into SmartAPI...');
  const session = await login();
  const { jwtToken } = session;
  logger.info('Login successful.');

  // STEP 4: Fetch option chain + find strikes
  logger.info('Fetching option chain...');
  const chain = await getOptionChain(jwtToken);
  const strikes = findStrikes(chain);
  logger.info('Strikes identified:', strikes);

  // STEP 5: Place Iron Condor entry (4 legs, 2 lots each)
  logger.info('Placing Iron Condor orders...');
  const orderIds = await placeIronCondorEntry(jwtToken, strikes);
  initPosition(strikes, orderIds);
  logger.info('Orders placed. Position initiated.');

  // STEP 6: Start wall monitoring loop
  logger.info('Starting wall monitor...');
  startMonitoring(jwtToken);

  // STEP 7: Wait until 3:25 PM
  while (!isTimeReached('15:25')) {
    await sleep(60 * 1000); // wait 1 min
  }

  // STEP 8: Stop monitor (if still running) and run final exit check
  const { stopMonitoring } = require('./modules/wallMonitor');
  stopMonitoring();
  logger.info('Running final ITM exit check at 3:25 PM...');
  await runFinalExitCheck(jwtToken);

  logger.info('=== Algo Completed for Today ===');
  process.exit(0);
}

main().catch((err) => {
  logger.error('Fatal error in main:', err);
  process.exit(1);
});
```

---

## 🔁 Execution Flow Diagram

```
[index.js starts]
       │
       ▼
[holidayCheck.js] → Not expiry day? → EXIT
       │ Yes, it's expiry day
       ▼
[Wait until 09:30 AM IST]
       │
       ▼
[auth.js] → SmartAPI login with TOTP (otplib)
       │
       ▼
[optionChain.js] → Fetch live Nifty option chain
       │
       ▼
[deltaFinder.js] → Identify 25Δ PUT, 25Δ CALL, 17Δ PUT, 17Δ CALL
       │
       ▼
[orderManager.js] → Place 4 MARKET orders (2 lots = 100 qty each)
       │
       ▼
[positionTracker.js] → Record entry, store position state
       │
       ▼
[wallMonitor.js] → Every 1 min: check Nifty spot vs walls
       │
       ├── PUT wall hit? → [adjustEngine.adjustCallSide()] → Iron Butterfly → STOP LOOP
       ├── CALL wall hit? → [adjustEngine.adjustPutSide()] → Iron Butterfly → STOP LOOP
       └── No hit? → Keep monitoring...
       │
       ▼
[3:25 PM IST]
       │
       ▼
[exitManager.js] → Check each leg → Exit ITM only → Leave OTM
       │
       ▼
[logger.js] → Log final P&L summary
       │
       ▼
[process.exit(0)] → DONE ✅
```

---

## 🌐 SmartAPI Key Endpoints Reference

| Action | Method | Endpoint |
|--------|--------|----------|
| Login | POST | `/rest/auth/angelbroking/user/v1/loginByPassword` |
| Place Order | POST | `/rest/secure/angelbroking/order/v1/placeOrder` |
| Get Order Status | GET | `/rest/secure/angelbroking/order/v1/details/{orderId}` |
| Get Positions | GET | `/rest/secure/angelbroking/order/v1/getPosition` |
| Option Chain | GET | `/rest/secure/angelbroking/marketData/v1/optionChain` |
| LTP Data | POST | `/rest/secure/angelbroking/marketData/v1/getLTPData` |
| Cancel Order | POST | `/rest/secure/angelbroking/order/v1/cancelOrder` |

**Base URL:** `https://apiconnect.angelone.in`

**Required Headers for all authenticated requests:**
```javascript
{
  'Authorization': `Bearer ${jwtToken}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'X-UserType': 'USER',
  'X-SourceID': 'WEB',
  'X-ClientLocalIP': '127.0.0.1',
  'X-ClientPublicIP': '<your-server-public-ip>',
  'X-MACAddress': '<your-mac-address>',
  'X-PrivateKey': process.env.ANGEL_API_KEY
}
```

---

## ☁️ Cloud Deployment Notes

### Running on Local Machine
- Use `node-cron` inside `index.js` to schedule at **9:20 AM every Tuesday and Monday**
- Or use `pm2` with a cron restart rule

### Migrating to GCP (Google Cloud Platform)
- Use **GCP Cloud Scheduler** to trigger a **Cloud Run** job or **Cloud Function** at 9:20 AM IST (UTC+5:30) every Tuesday
- Cloud Scheduler cron: `20 3 * * 2` (3:50 AM UTC = 9:20 AM IST, Tuesday)
- Also add Monday trigger for holiday fallback: `20 3 * * 1`
- Store secrets in **GCP Secret Manager** instead of `.env`
- Containerize using **Docker** (Dockerfile included below)

### Migrating to Oracle Cloud
- Use **Oracle Cloud Scheduler** (Functions + Events)
- Or use a **Compute Instance** (always-on VM) with `node-cron`
- Store secrets in **Oracle Vault**

### Dockerfile (Cloud Ready)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["node", "index.js"]
```

> ⚠️ When running on cloud, ensure the server timezone is set to **Asia/Kolkata (IST)** or adjust all time comparisons to use IST offset (UTC+5:30).

---

## 🧪 Pre-Live Checklist

Before going live, verify the following manually:

- [ ] SmartAPI login works with TOTP generated by `otplib`
- [ ] Option chain API returns Greeks (Delta values) for Nifty weekly expiry
- [ ] Delta values are correct (25Δ ≈ 0.25 for CALL, -0.25 for PUT)
- [ ] Order placement works in SmartAPI sandbox (if available)
- [ ] `nse-market-holidays` correctly identifies today as trading day
- [ ] `holidayCheck.js` correctly identifies expiry day for both Tuesday and Monday cases
- [ ] Logs are writing to `./logs/` correctly
- [ ] `.env` is in `.gitignore`
- [ ] Server time is IST or IST-adjusted

---

## ⚠️ Important Warnings

1. **Delta availability:** SmartAPI may not always return Greeks directly. If Delta is not in the API response, implement Black-Scholes Delta calculation in `deltaFinder.js` using: spot price, strike, time to expiry, risk-free rate (~6.5% for India), and Implied Volatility (IV) from the option chain.

2. **Market orders on entry:** Since we use MARKET orders, always verify fills via `getOrderStatus()` before proceeding to monitoring.

3. **Token expiry:** SmartAPI JWT tokens expire. If the algo runs for more than a few hours, implement token refresh logic in `auth.js` using the `refreshToken`.

4. **Holiday list accuracy:** `nse-market-holidays` package may not always be up to date for newly declared holidays. Cross-verify with NSE website at the start of each month.

5. **Lot size changes:** NSE occasionally revises Nifty lot sizes. Always verify current lot size before deploying. As of 2025–2026, Nifty lot size = **25** (verify this — it was revised from 50 to 25 in late 2024).

6. **Strike intervals:** Nifty strikes are in **50-point intervals**. ATM selection must round to nearest 50.

7. **Rate limits:** SmartAPI has rate limits. Do not poll option chain more than once per minute.

---

## 📊 Sample Trade Example

| Leg | Strike | Delta | Action | Lots | Qty |
|-----|--------|-------|--------|------|-----|
| Sell PUT | 23,000 | -0.25 | SELL | 2 | 100 |
| Buy PUT | 22,700 | -0.17 | BUY | 2 | 100 |
| Sell CALL | 23,500 | +0.25 | SELL | 2 | 100 |
| Buy CALL | 23,750 | +0.17 | BUY | 2 | 100 |

**If Nifty drops to 23,000 (PUT WALL hit):**
- Buy back BUY CALL (17Δ wing) → close it
- Sell new ATM CALL at ~23,000 (current ATM) → Iron Butterfly formed
- Stop monitoring. Hold till 3:25 PM.

---

## 🔚 End of Blueprint

This document is self-contained. Any AI assistant or developer reading this blueprint has all the information needed to build this application from scratch without any additional explanation.

**Build order recommendation:**
1. `utils/logger.js`
2. `utils/helpers.js`
3. `modules/holidayCheck.js`
4. `modules/auth.js`
5. `modules/optionChain.js`
6. `modules/deltaFinder.js`
7. `modules/orderManager.js`
8. `modules/positionTracker.js`
9. `modules/wallMonitor.js`
10. `modules/adjustEngine.js`
11. `modules/exitManager.js`
12. `config.js`
13. `index.js`
