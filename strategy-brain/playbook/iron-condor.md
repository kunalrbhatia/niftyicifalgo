# Monthly Iron Condor (niftyicifalgo) Playbook

## Strategy Overview
- **Structure**: Monthly Positional Iron Condor (NIFTY 50 Options)
- **Entry**: Sell 25Δ Put & Call, Buy 17Δ Put & Call (prior to the 15th of the month).
- **Exit**: Expiry Day at 15:25 IST (ITM legs market-exit, OTM legs expire).

---

## Adjustment Plays

| Condition | Play | Legs To Adjust | Cost Cap | When It Works | When It Fails |
|---|---|---|---|---|---|
| Wall Hit: Spot $\le$ Short PUT strike | Iron Butterfly Conversion (Roll Call Wing to ATM) | Buy back 17Δ Long Call, Close 25Δ Short Call, Sell new ATM Short Call, Buy ATM+wing Long Call | $\le$ ₹8,000 debit | Index stabilizes near the tested put wall or rebounds moderately | Sharp continuing market crash through all put strikes |
| Wall Hit: Spot $\ge$ Short CALL strike | Iron Butterfly Conversion (Roll Put Wing to ATM) | Buy back 17Δ Long Put, Close 25Δ Short Put, Sell new ATM Short Put, Buy ATM-wing Long Put | $\le$ ₹8,000 debit | Index stabilizes near the tested call wall or pulls back | Sharp gap-up rally continuing through upside |
| Days to Expiry $\le 1$ with wide safe margin | Hold to Expiry | No adjustments | 0 | Theta decay to zero on OTM wings | Surprise overnight gap |
