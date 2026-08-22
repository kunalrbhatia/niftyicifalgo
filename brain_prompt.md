Strategy Brain — LLM-Driven Self-Healing Options Strategy Manager
For Anti Gravity CLI to implement
1. Vision
Build a strategy brain: an LLM-orchestrated agent that monitors a portfolio of options strategies (calendar ratio strangle, ratio spread, straddle, iron condor/iron fly, etc.), and whenever the combined position of any strategy comes under pressure (negative MTM approaching a danger threshold, structure reaching a "wall", regime change), it autonomously researches → backtests → analyzes → decides → executes → verifies the corrective action — the way a skilled human options trader would, but at machine speed, and with full transparency.

The brain must NOT be a rule engine. Rules are discovered per situation: it searches the internet for how traders handle the current structure/condition, validates candidates against the historical data lake, scores them, picks the best, executes within safety rails, and records the outcome in a decision ledger it learns from.

Core principle — the brain decides WHAT to do. The human decides the RAILS (limits, safety, approval gates).

2. Non-Negotiable Safety Architecture (design FIRST, code LAST)
The brain can autonomously decide — it must NEVER autonomously gamble.

Kill switch (hard) — .panic file / Telegram command: immediately halts ALL brain activity (no research, no orders), cancels pending orders, alerts. Highest priority, checked at every loop iteration.
Soft pause (.kill) — completes current decision but takes no execution action.
Execution caps (hard) — per strategy, per day, per week:
Max orders per adjustment cycle (default 4)
Max net premium paid per cycle (config, default ₹25,000)
Max position delta change per adjustment (config, default 0.3)
Max adjustments per strategy per day (default 1) and per week (default 3)
Hard "do not trade" windows: never adjust within 5 min of market open/close; never on the expiry day after 15:00 IST unless the action is CLOSE ALL.
Mode gates — .paper mode (default ON at build time): brain researches, backtests, decides, and SIMULATES the order (writes paper fills) but places nothing live. Live mode requires an explicit config flag + user confirmation at startup.
Order flow audit — every order (paper or live) goes through the existing placeMarketOrder helper with full logging; every decision is written to the decision ledger BEFORE execution (so a crash mid-adjustment leaves a recoverable trail).
Human-in-the-loop tiers:
Tier 0 (auto): monitoring, research, backtest, analysis, recommendation.
Tier 1 (auto-execute): adjustments within caps for pre-approved action types (e.g., roll a tested structure, close a leg that breached its risk limit) — only in paper mode initially.
Tier 2 (human confirm): any action that changes structure type (e.g., iron condor → iron fly), increases net risk, or breaches caps → send Telegram message with the analysis + candidate actions, WAIT for reply.
Tier 3 (hard stop): any action on a strategy that hit its daily/weekly adjustment cap, or any action that would add margin usage beyond config.
3. Architecture
┌─────────────────────────────────────────────────────────────┐
│  BRAIN ORCHESTRATOR (Node.js process, PM2, "strategy-brain") │
│  Loop: trigger → SITREP → RESEARCH → CANDIDATES → BACKTEST    │
│        → SCORE → DECIDE → EXECUTE → VERIFY → LEDGER          │
└──────────────────┬──────────────────────────────────────────┘
                   │
   ┌───────────────┼───────────────────┐
   ▼               ▼                   ▼
┌──────────┐  ┌───────────┐      ┌──────────────┐
│ SITREP   │  │ RESEARCH  │      │ BACKTEST     │
│ (state + │  │ (web +    │      │ (data lake + │
│  market) │  │  playbook)│      │  engine)     │
└──────────┘  └───────────┘      └──────────────┘
   ┌───────────────┼───────────────────┐
   ▼               ▼                   ▼
┌──────────┐  ┌───────────┐      ┌──────────────┐
│ SCORER   │  │ EXECUTOR  │      │ LEDGER       │
│ (EV +    │  │ (orders + │      │ (decisions + │
│  risk)   │  │  safety)  │      │  outcomes)   │
└──────────┘  └───────────┘      └──────────────┘
Module responsibilities
Module	Responsibility	Key inputs	Key outputs
Orchestrator	The LLM loop — builds the prompt for each step, calls the LLM, parses structured JSON responses, enforces caps	SITREP, research results, backtest results, ledger history	Chosen action {type, legs[], limitType, reason}
SITREP	Snapshot of every strategy: combined position (ALL legs summed per strategy), MTM, margin, days to expiry, spot vs strikes, realized P&L, open orders	data/position-*.json stores, RMS, orderbook, spot	Structured situation object
Research	Web search for adjustment plays (e.g., "iron condor near short strike adjustment", "ratio spread negative delta hedge") + local strategy playbook (curated by user/agent)	LLM + web search tool + playbook/ markdown files	Ranked list of candidate strategies with citations
Backtest	Validate each candidate: simulate the adjustment on the SAME structure type across historical cycles in the data lake (nifty-optionchain-data, data/chains/), project outcomes	Candidate action spec, data lake, existing backtest engine	Per-candidate stats: EV, win rate, max DD impact, tail risk
Scorer	Multi-factor score: expected P&L, probability of success, risk reduction, drawdown impact, execution complexity, urgency	Backtest results + current risk state	Ranked candidate table with scores
Executor	Enforce caps/tiers, place orders via existing helpers, wait for fills	Chosen action, cap config	Order IDs + fills
Verify	After execution: re-read store/RMS, confirm structure changed as intended, log outcome	Store, orderbook	Verified result
Ledger	Append-only JSONL: situation → candidates → chosen → outcome → lesson learned (LLM-generated)	Everything	ledger/YYYY-MM-DD.jsonl + weekly self-review
4. The Brain Loop (detailed)
4.1 Triggers (what wakes the brain)
Scheduled: every 30 min during market hours (cron → PM2 app or Hermes cron calling an HTTP endpoint).
MTM danger event: any strategy's combined MTM crosses dangerThreshold (default 50% of its ±2% exit threshold) — the existing monitor already computes MTM per tick; add a hook.
Structure event: days-to-expiry hits configurable milestone (e.g., T0 = 1 day), or spot crosses within wallDistance (default 50 pts) of any short strike (the "wall").
Manual: Telegram command /brain status / /brain analyze <strategy>.
On wake, the orchestrator runs a full brain cycle (sections 4.2–4.9) only if there is a meaningful decision to make (any trigger fired AND a strategy is in a non-benign state). Otherwise it writes a one-line "no action" ledger entry and sleeps.

4.2 SITREP construction
For EACH strategy, gather:

{
  "strategy": "nifty-weekly-calendar-ratio-strangle",
  "status": "FULL_ENTRY",
  "combinedPosition": {
    "legs": [ {"side":"BUY","symbol":"...","strike":25100,"expiry":"2026-08-18","qty":65,"ltp":7.2,"status":"OPEN"} ],
    "netDelta": 0.12,
    "netGamma": -0.004,
    "netTheta": 312.5,
    "netVega": 88.1,
    "combinedMtm": -8450,
    "daysToT0": 4,
    "daysToT1": 11
  },
  "marginUtilized": 542212,
  "exitThreshold": 10844,
  "dangerThreshold": 5422,
  "spot": 24150.3,
  "shortStrikeProximity": { "closestShort": 24500, "distance": 349.7, "pct": 1.45 },
  "openOrders": [],
  "realizedPnl": -2120
}
Position = SUM of all legs of that strategy (user requirement #2) — never analyze a single leg in isolation.
Greeks: compute from data-lake chains if available (OptionPerks backfill has them) or Black-Scholes approximation (existing code).
SITREP must also include market context: NIFTY trend (5-day return, 20-day vol from index candles), VIX if available, time of day, days to monthly expiry, and the strategy's recent ledger performance (last 10 decisions + outcomes).
4.3 RESEARCH (the "brain explores the internet")
Prompt the LLM with:

Situation: {SITREP JSON}
Structure: {structure description}
Condition: {trigger that fired, e.g. "combined MTM = -8,450, short CE 24500 is 350 pts away, T0 in 4 days"}

Task: Research how experienced options traders adjust THIS structure in THIS condition.
1. Search the web for adjustment plays (roll, hedge, convert, close, invert, ratio change).
2. Consult the local playbook in playbook/ for curated plays for this structure.
3. For each candidate play, give: name, exact legs to add/close, rationale, when it works, when it fails, reference URL.
Return JSON: {"candidates": [{"name","description","legsDelta","cost","rationale","riskNotes","sources":["url"]}]}
Limit to 3-5 candidates.
The playbook (playbook/) is a set of markdown files, one per structure, containing the user's curated plays (e.g., iron condor → iron fly conversion when a short wing is threatened; ratio strangle → roll the threatened short up/down; straddle → gamma scalping rule of thumb). The brain uses the playbook as PRIOR knowledge and web search as NOVEL knowledge; both feed the same candidate list.
Web search: use a search API the project already has access to (or a simple fetch of a search endpoint); cache results per (structure, condition-hash) for 24h to save tokens.
4.4 CANDIDATES → BACKTEST
For each candidate, the orchestrator:

Translates the candidate into an explicit leg-change spec: {add: [{side, strike, expiry, qty}], close: [{legRef}], costCap}.
Finds historical analogues: scan the data lake for prior cycles of the SAME strategy where the SAME condition occurred (e.g., "combined MTM < -50% threshold with closest short < 400 pts away").
Simulates: apply the candidate adjustment to those historical cycles (use the existing backtest engine, extended to support mid-cycle adjustments), and compute:
P(improvement): % of cycles where adjusted outcome > unadjusted outcome
Expected P&L delta: mean(adjusted) − mean(unadjusted)
Tail risk: 5th percentile of adjusted outcomes
Cost of the adjustment (premium outlay from chain data at the analogue time)
If < 3 historical analogues exist, mark the candidate as "low evidence" and rely on the LLM's reasoning + playbook + first-principles; the scorer must penalize low-evidence candidates.
4.5 SCORE & DECIDE
Score each candidate (0–100):

score = 0.35 × EV_improvement_normalized
      + 0.25 × P(improvement)
      - 0.20 × tail_risk_normalized
      - 0.10 × cost_normalized
      - 0.05 × evidence_penalty (0 if ≥3 analogues, 0.5 if 1-2, 1.0 if none)
      + 0.05 × urgency_bonus (if danger threshold already crossed)
If top candidate score < 40 → take NO action; log "hold" with reasoning. Doing nothing is a valid decision.
If top candidate is Tier 2 (structure change / risk increase) → send Telegram summary with the ranked table, WAIT.
If Tier 1 → execute (paper mode by default).
The DECISION must include a written rationale (LLM-generated, 2-3 sentences) stored in the ledger — the user must be able to read WHY later.
4.6 EXECUTE
Paper: write simulated fills to the store, log clearly [PAPER].
Live (only if enabled): use existing placeMarketOrder (CARRYFORWARD, NFO/BFO, session-refresh retry already built). Enforce caps from §2.3. Every order logged with orderId.
Atomicity: if a multi-leg adjustment fails midway (one leg rejected), DO NOT place the remaining legs; attempt a rollback (re-close what was opened) within caps; alert human.
4.7 VERIFY
Re-read store + RMS + orderbook. Confirm: intended legs closed/opened, combined MTM delta direction matches intent, margin still within caps.
If verification fails → alert + mark ledger entry verification: FAILED + escalate to Tier 3 (stop adjusting this strategy today).
4.8 LEDGER & LEARNING
Every cycle appends to ledger/YYYY-MM-DD.jsonl:

{
  "ts": "...", "trigger": "MTM_DANGER", "strategy": "...",
  "sitrep": {...minimal...}, "candidates": [...scored...],
  "decision": {"action": "ROLL_SHORT_CE", "score": 72, "tier": 1, "rationale": "..."},
  "execution": {"orders": [...], "fills": [...], "verified": true},
  "outcome": null,  // filled in by the weekly review
  "lesson": null
}
Weekly self-review (Sunday, or via cron): the brain reads the last 7 days of ledger, joins outcomes (using next-day MTM or final cycle P&L), and writes a review/YYYY-WW.md with:

Which decision types worked / failed (win rate per action type)
Which conditions predicted failure (so the playbook can be updated)
Suggested playbook edits (the brain drafts them; user approves before the brain applies them to playbook/)
5. The Playbook (curated knowledge — user provides initial content, brain extends)
Structure: playbook/<strategy-slug>.md with a table of adjustment plays:

# nifty-weekly-calendar-ratio-strangle playbook

| Condition | Play | Legs | Cost | When it works | When it fails |
|---|---|---|---|---|---|
| Short strike within 150 pts & MTM < -50% thr | Roll short up 500 pts (CE) | Close SELL 24500CE×2, open SELL 25000CE×2 | ~+₹X debit | Range-bound recovery | Strong trend continues |
| T0 expiry day, long T1 still has value | Close longs early if combined MTM positive | SELL both T1 longs | 0 | Lock profit | Small gain foregone |
| ... | ... | ... | ... | ... | ... |
The brain's weekly review proposes additions; user merges via PR (never auto-merge).

🎯 INITIAL PLAYBOOK CONTENT — seeded from the actual strategies (discovered Aug 2026)
The user runs these LIVE strategies; seed the playbook with their REAL adjustment rules and the classic plays:

5.1 niftyicifalgo — Monthly Iron Condor (THE reference for "wall" logic)
THE WALL RULE (already coded in the algo — make it a playbook entry): daily check; if spot ≤ short put strike OR spot ≥ short call strike → roll the OPPOSITE side to ATM → convert Iron Condor → Iron Butterfly. Exactly once per cycle.
Entry deltas: sell 25Δ / buy 17Δ; 100-multiple strikes.
Exit: expiry day 15:25 — ITM legs market-exit, OTM legs expire.
Brain value-add beyond the code: decide roll DISTANCE (ATM vs 50% of width), decide whether to roll the tested side too, decide when NOT to convert (e.g., convert only if remaining time value > cost).
5.2 smart-api — Short Straddle (NIFTY Tue / SENSEX Thu)
Existing auto-SL: trigger = entry × 2.25, limit = trigger × 1.05 ("125% factor").
Classic adjustments the brain should evaluate when a straddle is tested:
Gamma scalping: buy/sell futures to neutralize delta as spot moves (requires futures access).
Roll up/down the tested wing to re-center the straddle (collect additional credit, stay ATM).
Convert to strangle: widen one wing when volatility expands.
Exit early: if theta decay no longer compensates gamma risk (days-to-expiry threshold).
5.3 ratio-double-calendar-daemon — Double Calendar (NIFTY Wed→Tue / SENSEX Fri→Thu)
Existing gates (brain should treat as prior knowledge): VIX entry filter 10–13.5; liquidity screen (8% spread rule); SL 2% / PT 1.5% of margin.
Classic adjustments when one wing is tested:
Roll the tested short wing to the next strike (T0 → new T0) to re-collect credit.
Add a third calendar on the tested side (double → triple calendar) if VIX still low.
Early exit of the tested calendar if the T1 long has bled past its LTP-match value.
5.4 nifty-weekly-calendar-ratio-strangle — Calendar Ratio Strangle (live, Mode 2)
Current mechanics: Mode 2 same-strike (longs ±500 T1, shorts same-strike T0 ×2), Wed entry / Tue 15:20 full exit, ±2% threshold.
Classic adjustments when short strikes are threatened:
Roll the threatened short (T0) out to the next strike — keep the ratio, re-collect credit.
Roll the whole calendar forward if spot moved far (T0 + T1 both re-centered).
Close shorts only, keep longs if MTM is positive and T0 is near expiry (lock credit, keep upside).
Close everything at the wind-down (current behavior — the baseline to beat).
Backtest assets available: 11 months of chains in the data lake + the existing engine — the brain's analogue search has real data to work with.
5.5 rubber-band-strategy (rsi-algo) — RSI Credit Spreads
Intraday mean-reversion; adjustments are minimal by design (close at ±1.5% or 15:25).
Brain value: regime filter — skip RSI-20/80 signals in strong trends (whipsaw); the backtest can quantify whether trend-filtered RSI entries beat raw RSI entries.
5.6 nifty-supertrend (ST-ETF) — ETF Momentum Accumulation
SuperTrend(10,3) on spot index; buy every red→green flip (₹10K tranche); exit only when ≥1% profit on the whole position.
Brain value: adapt the tranche size and profit-exit threshold to realized win rate/volatility; decide "pause accumulation" during high-vol regimes.
6. Tech Stack & Integration
Node.js + TypeScript (ESM), same patterns as nifty-weekly-calendar-ratio-strangle.
LLM access: OpenAI-compatible chat completions API (config: base URL, key, model, max tokens, temperature 0.2 for decisions, 0.6 for research). Structured output via JSON-mode or response-format where supported.
Web search: whichever endpoint is available (configurable); cache results.
Data lake: read from /home/ubuntu/nifty-optionchain-data/data/chains/ (NIFTY) and data/sensex-chains/ (SENSEX) — same schema the backtest uses.
Broker: reuse the SmartAPI helper patterns (login, session-refresh retry, marketData chunking, placeMarketOrder CARRYFORWARD, getOrderBook, RMS utiliseddebits).
Telegram: reuse the notifier pattern for alerts + the /brain command handler.
PM2: new app strategy-brain; graceful stop on .panic.
7. Repo Layout (new repo strategy-brain)
strategy-brain/
  src/
    orchestrator.ts      # the LLM loop
    sitrep.ts            # state collection + greeks
    research.ts          # web + playbook candidate gathering
    backtest.ts          # analogue search + adjustment simulation (wraps existing engine)
    scorer.ts            # §4.5 scoring
    executor.ts          # caps/tiers/orders/rollback
    verify.ts            # post-execution checks
    ledger.ts            # JSONL append + weekly review
    safety.ts            # kill switch, caps, tier resolution
    telegram.ts          # alerts + /brain commands
    config.ts            # all thresholds, caps, API keys
  playbook/
    nifty-weekly-calendar-ratio-strangle.md
    iron-condor.md
    straddle.md
    ratio-spread.md
  ledger/                # gitignored except .gitkeep
  review/
  test/                  # unit tests for scorer, safety, ledger
  .env.example
  ecosystem.config.cjs   # PM2 app
  package.json
8. Milestones (build in this order)
M0 — Safety skeleton: config, kill switch, caps, tiers, .paper default ON, Telegram wiring, ledger write. Everything after this runs inside the rails.
M1 — SITREP + monitor hook: state collection per strategy (combined position, MTM, greeks, proximity), danger-threshold hook into existing MTM monitor, scheduled trigger.
M2 — Brain loop v0 (paper, single strategy): full cycle with research (playbook-only first, then web), candidate generation, backtest on the data lake, scoring, decision, paper execution, verify, ledger. Start with nifty-weekly-calendar-ratio-strangle (we have 11 months of data + a validated backtest engine).
M3 — Playbook bootstrap: user + agent write the initial playbook for the strangle (from the fidelity audit + incident history: whipsaw, breach, wind-down).
M4 — Web research + evidence weights: connect web search, cache, evidence penalty in scorer.
M5 — Multi-strategy + weekly review: onboard the user's other live strategies (each gets a playbook + SITREP adapter): niftyicifalgo (monthly iron condor — wall rule already coded, brain generalizes it), smart-api (short straddle NIFTY/SENSEX weekly), ratio-double-calendar-daemon (double calendar), rubber-band-strategy (RSI credit spreads), and nifty-supertrend (ST-ETF momentum). Strategy details, hosts, and mechanics: see /home/ubuntu/.hermes/knowledge/strategy-inventory.md on the gateway (or the strategy-inventory section of the angel-one-algo-ops skill). Weekly self-review + playbook proposals.
M6 — Live mode (only after 4+ weeks of paper): enable Tier-1 auto-execute with the user's explicit sign-off; keep Tier 2 human-confirm for structure changes forever.
9. Verification & Quality Gates
pnpm verify passes (format, lint, typecheck, tests, build).
Unit tests: scorer math (fixed inputs → expected scores), safety caps (exceed cap → blocked), tier resolution (structure change → Tier 2), ledger append (crash mid-write → no corruption), rollback logic.
Dry-run harness: a --sitrep-only flag that prints the SITREP without any LLM call (validates data plumbing); a --paper-cycle flag that runs a full cycle in paper mode with a canned SITREP (validates the loop without live data).
Every decision in paper mode must produce a ledger entry with a non-null rationale.
No live order can be placed unless: config live.enabled=true AND .paper absent AND caps validated AND tier ≤ 1.
10. Git Workflow (repo rules — MUST follow)
Branch per milestone (feat/brain-m0-safety, etc.). NEVER push to master.
git pull before branching. Conventional commits.
Run pnpm verify before pushing.
PR body: backtick every file path and command (repo has .agents/skills/pr-description-check — run it until it passes).
Squash-merge (user merges). Run .agents/skills/git-cleanup-sync after merge.
11. Constraints & Pitfalls
Do not modify the live algos (nifty-weekly-calendar-ratio-strangle etc.) to add brain hooks in a way that breaks them — the hook should be an additive event (e.g., an HTTP endpoint the brain polls, or a file the monitor writes). Prefer: the brain polls /health + reads store files + a new lightweight "brain hook" endpoint added to each algo repo via its own PR.
LLM token budget: SITREP must be compact (trim leg lists to open legs + nearest strikes); research results truncated to top candidates; ledger entries minimal.
Never let the LLM free-form an order — all order placement goes through executor.ts with typed, validated leg specs. The LLM only outputs {actionType, legRefs, limitType} JSON which the executor maps to concrete orders.
Timezones: everything in IST; use the same ist.js helpers.
Rate limits: web search + LLM calls are not broker API calls — but still cache and throttle; broker calls go through the existing chunked/sleep patterns.
The brain must handle "no decision needed" gracefully (most cycles will end in a HOLD with a one-line ledger entry — do not spam Telegram for non-decisions; only alert on Tier 2/3, verification failures, or executions).
12. Deliverables Checklist
[ ] M0 safety skeleton (caps, tiers, kill switch, .paper default)
[ ] M1 SITREP + triggers (danger threshold, wall proximity, scheduled)
[ ] M2 full brain loop in paper mode on the strangle (research → backtest → score → decide → paper-execute → verify → ledger)
[ ] Initial strangle playbook (from audit + incidents)
[ ] M4 web research with evidence weighting
[ ] M5 multi-strategy adapters + weekly self-review
[ ] M6 live mode gated behind user sign-off
[ ] Tests, dry-run harness, pnpm verify green, PRs per milestone