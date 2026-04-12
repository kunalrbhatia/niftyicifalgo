# Nifty 50 Weekly Expiry Iron Condor → Iron Butterfly Algo

An automated trading strategy for Nifty 50 weekly expiry days using Angel One SmartAPI.

## Strategy Overview
- **Entry:** Iron Condor (25Δ Short Legs, 17Δ Long Legs) at 09:30 AM.
- **Adjustment:** If spot touches a short strike, roll the opposite side to ATM (convert to Iron Butterfly).
- **Exit:** At 03:25 PM, check all open legs. Exit ITM legs only; leave OTM legs to expire.

## Setup
1. Clone the repository.
2. Run `npm install`.
3. Create a `.env` file based on `.env.example` with your Angel One credentials.
4. Start the algo: `node index.js`.

## Dependencies
- `axios`
- `otplib`
- `nse-market-holidays`
- `moment-timezone`
- `dotenv`
- `winston`
- `node-cron`
- `ws`

## Project Structure
- `modules/`: Core strategy logic (auth, option chain, orders, etc.)
- `utils/`: Helpers and logging.
- `config.js`: Strategy configuration.
- `index.js`: Main orchestrator.

## Disclaimer
Automated trading carries risks. Ensure you have tested the strategy thoroughly in a paper trading environment before going live.
