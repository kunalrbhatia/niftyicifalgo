# Short Straddle (smart-api) & Ratio Spread Playbook

## 1. Short Straddle (NIFTY / SENSEX)
- **Structure**: ATM Short Straddle (Sell ATM Call + Sell ATM Put).
- **Existing SL**: Entry $\times 2.25$.

### Adjustment Plays

| Condition | Play | Legs To Adjust | Cost Cap | When It Works | When It Fails |
|---|---|---|---|---|---|
| One side breached factor | Roll tested strike away / Re-center | Close breached wing, re-sell at new ATM strike | $\le$ ₹6,000 debit | High intraday volatility with subsequent consolidation | Strong unidirectional momentum |
| Spot trending strongly | Convert Straddle to Strangle | Shift untested wing further OTM to collect extra margin cushion | ₹0 (Credit) | Trending day without sharp whipsaw | Quick V-shape recovery |
| Late session theta exhausted | Early Exit / Wind-down | Close both legs | 0 | Locks remaining intraday premium | Post-exit quiet consolidation |

---

## 2. Ratio Spread Playbook
- **Structure**: Front Ratio Spread (Buy 1 ATM/NTM, Sell 2 OTM).

### Adjustment Plays

| Condition | Play | Legs To Adjust | Cost Cap | When It Works | When It Fails |
|---|---|---|---|---|---|
| Spot approaches short strikes | Roll naked short leg further OTM | Close 1 naked short strike, open 1 further OTM strike | $\le$ ₹3,000 debit | Mild overshoot before consolidation | Explosive breakout through all strikes |
| Reversal back into long debit territory | Convert into Butterfly / Close 1 Short | Close 1 short leg to neutralize delta | $\le$ ₹2,000 debit | Sharp mean-reversion | Choppy sideways grind |
