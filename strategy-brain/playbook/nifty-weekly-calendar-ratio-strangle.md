# nifty-weekly-calendar-ratio-strangle Playbook

## Strategy Overview
- **Structure**: Mode 2 Calendar Ratio Strangle
- **Entry**: Wednesdays, Longs $\pm 500$ T1 expiry, Shorts same-strike T0 expiry $\times 2$.
- **Exit Target**: Tuesdays 15:20 full exit, or $\pm 2\%$ threshold of margin.
- **Danger Threshold**: $50\%$ of exit threshold (e.g. combined MTM $< -1\%$).

---

## Adjustment Plays

| Condition | Play | Legs To Adjust | Cost Cap | When It Works | When It Fails |
|---|---|---|---|---|---|
| Short strike within 150 pts & MTM < -50% threshold | Roll threatened short wing out/up | Close SELL tested T0 strike $\times 2$, open SELL new OTM strike $\times 2$ (T0) | $\le$ ₹5,000 debit | Range-bound recovery, slowdown in momentum | Relentless unidirectional trend |
| Spot moved far from center | Roll whole calendar forward | Close entire tested side (T0 + T1), re-center at new strikes | $\le$ ₹12,000 debit | Extended trend establishes new range | Immediate sharp reversal / whipsaw |
| T0 expiry day, long T1 still has value & combined MTM positive | Close shorts early & hold longs | Close T0 short legs, leave T1 long legs open | 0 debit (Credit collected) | Momentum continuation on expiry day | Range freezes, T1 bleeds theta |
| MTM breach threshold reached ($> -2\%$) | Emergency Stop / Full Exit | Close ALL open legs immediately (T0 & T1) | 0 debit | Prevents catastrophic tail risk | Premature exit before mean reversion |
