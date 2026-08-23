import { SitrepCollector, SituationReport, LegPosition } from './sitrep.js';
import { ResearchEngine } from './research.js';
import { AnalogueBacktestEngine } from './backtest.js';
import { CandidateScorer, ScoredCandidate } from './scorer.js';
import { OrderExecutor } from './executor.js';
import { ExecutionVerifier } from './verify.js';
import { DecisionLedger } from './ledger.js';
import { SafetyRails, AdjustmentAction, ActionTier } from './safety.js';
import { TelegramNotifier } from './telegram.js';

export interface BrainCycleResult {
  sitrep: SituationReport;
  candidates: ScoredCandidate[];
  chosen: ScoredCandidate | null;
  isHold: boolean;
  executed: boolean;
  verified: boolean;
  rationale: string;
}

export function buildActionSpecFromCandidate(
  chosen: ScoredCandidate,
  sitrep?: SituationReport
): AdjustmentAction {
  return {
    name: chosen.name,
    type: chosen.type as AdjustmentAction['type'],
    description: chosen.description,
    legsToAdd: chosen.legsToAdd ?? [],
    legsToClose: chosen.legsToClose ?? [],
    netDebitEstimate: chosen.cost ?? 0,
    netDeltaImpact: chosen.netDeltaImpact ?? 0,
    changesStructureType: chosen.type === 'CONVERT_STRUCTURE',
    increasesNetRisk: chosen.increasesNetRisk ?? false,
    rationale: chosen.rationale
  };
}

export class BrainOrchestrator {
  private safety = new SafetyRails();
  private ledger = new DecisionLedger();
  private research = new ResearchEngine();
  private backtest = new AnalogueBacktestEngine();
  private executor = new OrderExecutor(this.safety);
  private telegram = new TelegramNotifier();

  /**
   * Runs the full autonomous self-healing loop for a strategy.
   */
  public async runCycle(
    sitrep: SituationReport,
    options: { dryRun?: boolean; forceEvaluate?: boolean } = {}
  ): Promise<BrainCycleResult> {
    console.log(`\n======================================================`);
    console.log(`🧠 [STRATEGY BRAIN] Starting Cycle for: ${sitrep.strategy}`);
    console.log(`Trigger: ${sitrep.triggerFired} | Spot: ${sitrep.spot} | MTM: ₹${sitrep.combinedPosition.combinedMtm}`);
    console.log(`======================================================`);

    // 1. Check Hard Panic
    if (this.safety.isPanicActive()) {
      console.warn(`[Brain] Hard panic (.panic) active. Cycle aborted.`);
      await this.telegram.alertHardStop(sitrep.strategy, '.panic file detected');
      return {
        sitrep,
        candidates: [],
        chosen: null,
        isHold: true,
        executed: false,
        verified: false,
        rationale: 'Aborted due to hard panic switch'
      };
    }

    // 2. Check if decision is warranted
    const isBenign = sitrep.triggerFired === 'NONE' && !options.forceEvaluate;
    if (isBenign) {
      console.log(`[Brain] Strategy is in benign state. No corrective action required.`);
      await this.ledger.logDecision({
        ts: new Date().toISOString(),
        trigger: 'SCHEDULED',
        strategy: sitrep.strategy,
        sitrep: { combinedMtm: sitrep.combinedPosition.combinedMtm, netDelta: sitrep.combinedPosition.netDelta },
        candidates: [],
        decision: { action: 'HOLD', score: 100, tier: ActionTier.TIER_0, rationale: 'Portfolio within normal parameters' }
      });
      return {
        sitrep,
        candidates: [],
        chosen: null,
        isHold: true,
        executed: false,
        verified: true,
        rationale: 'Portfolio within normal parameters'
      };
    }

    // 3. Research candidates (Playbook + Web)
    console.log(`[Brain:Research] Gathering adjustment plays...`);
    const rawCandidates = await this.research.generateCandidates(sitrep);

    // 4. Analogue Search & Backtest
    console.log(`[Brain:Backtest] Simulating adjustments across historical data lake...`);
    const backtestedCandidates = await this.backtest.enrichCandidatesWithBacktest(sitrep, rawCandidates);

    // 5. Score & Decide
    console.log(`[Brain:Score] Scoring candidate adjustments...`);
    const ranking = CandidateScorer.rankAndSelect(backtestedCandidates);
    console.log(`[Brain:Decision] ${ranking.decisionRationale}`);

    const chosen = ranking.chosen;
    let executed = false;
    let verified = false;

    // 6. Action Execution (if not HOLD)
    if (!ranking.isHold && chosen && !options.dryRun) {
      const todayCount = await this.ledger.getTodayAdjustmentCount(sitrep.strategy);
      const weekCount = await this.ledger.getWeeklyAdjustmentCount(sitrep.strategy);

      // Build action spec from chosen candidate's REAL legs
      const actionSpec = buildActionSpecFromCandidate(chosen, sitrep);

      const hasLegs = (actionSpec.legsToAdd && actionSpec.legsToAdd.length > 0) ||
                      (actionSpec.legsToClose && actionSpec.legsToClose.length > 0);

      if (!hasLegs && actionSpec.type !== 'HOLD') {
        console.warn(`[Brain:Execute] Chosen candidate ${chosen.name} has no concrete legs specified. Skipping execution.`);
        return {
          sitrep,
          candidates: ranking.ranked,
          chosen,
          isHold: true,
          executed: false,
          verified: true,
          rationale: `Candidate ${chosen.name} had no concrete legs to execute.`
        };
      }

      console.log(`[Brain:Execute] Executing adjustment: ${chosen.name}...`);
      const execResult = await this.executor.execute(sitrep.strategy, actionSpec, {
        todayAdjustmentCount: todayCount,
        weekAdjustmentCount: weekCount
      });

      executed = execResult.success;

      // 7. Verify Post-Execution against real execution fills
      if (executed) {
        const vResult = ExecutionVerifier.verifyAdjustment(sitrep, actionSpec, execResult);
        verified = vResult.verified;
        console.log(`[Brain:Verify] (${vResult.source}) ${vResult.message}`);
      }

      // 8. Write to Decision Ledger
      await this.ledger.logDecision({
        ts: new Date().toISOString(),
        trigger: sitrep.triggerFired && sitrep.triggerFired !== 'NONE' ? sitrep.triggerFired : 'MANUAL',
        strategy: sitrep.strategy,
        sitrep: { combinedMtm: sitrep.combinedPosition.combinedMtm, netDelta: sitrep.combinedPosition.netDelta },
        candidates: ranking.ranked,
        decision: {
          action: chosen.name,
          score: chosen.score,
          tier: chosen.type === 'CONVERT_STRUCTURE' ? ActionTier.TIER_2 : ActionTier.TIER_1,
          rationale: chosen.rationale
        },
        execution: {
          mode: this.safety.isPaperMode() ? 'PAPER' : 'LIVE',
          orders: execResult.orderIds,
          fills: execResult.fills,
          verified
        }
      });
    }

    return {
      sitrep,
      candidates: ranking.ranked,
      chosen,
      isHold: ranking.isHold,
      executed,
      verified,
      rationale: ranking.decisionRationale
    };
  }
}

// CLI Execution Handler
if (process.argv[1] && (process.argv[1].endsWith('orchestrator.ts') || process.argv[1]?.endsWith('orchestrator.js'))) {
  const isSitrepOnly = process.argv.includes('--sitrep-only');
  const isPaperCycle = process.argv.includes('--paper-cycle');
  const isLiveSitrep = process.argv.includes('--live-sitrep') || process.argv.includes('--real');

  (async () => {
    let sitrep: SituationReport;

    if (isLiveSitrep) {
      console.log(`[Brain] Fetching REAL broker SITREP from SmartAPI...`);
      sitrep = await SitrepCollector.buildFromBroker();
    } else {
      console.log(`[Brain] NOTE: using DEMO sitrep (hardcoded legs). Use --live-sitrep for real broker data.`);
      // Sample Strangle under pressure
      const sampleLegs: LegPosition[] = [
        { symbol: 'NIFTY26AUG24500CE', side: 'SELL', strike: 24500, optionType: 'CE', expiry: '2026-08-28', qty: 65, ltp: 65.0, pnl: -4200, status: 'OPEN' },
        { symbol: 'NIFTY26AUG23800PE', side: 'SELL', strike: 23800, optionType: 'PE', expiry: '2026-08-28', qty: 65, ltp: 12.0, pnl: 1800, status: 'OPEN' },
        { symbol: 'NIFTY26SEP24800CE', side: 'BUY', strike: 24800, optionType: 'CE', expiry: '2026-09-04', qty: 65, ltp: 80.0, pnl: 1200, status: 'OPEN' },
        { symbol: 'NIFTY26SEP23500PE', side: 'BUY', strike: 23500, optionType: 'PE', expiry: '2026-09-04', qty: 65, ltp: 18.0, pnl: -600, status: 'OPEN' }
      ];

      sitrep = SitrepCollector.buildSitrep({
        strategy: 'nifty-weekly-calendar-ratio-strangle',
        legs: sampleLegs,
        spot: 24460, // Close to 24500 CE wall (40 pts away)
        daysToT0: 3,
        marginUtilized: 500000,
        exitThreshold: 10000
      });
    }

    if (isSitrepOnly) {
      console.log(JSON.stringify(sitrep, null, 2));
    } else {
      const brain = new BrainOrchestrator();
      const res = await brain.runCycle(sitrep, { forceEvaluate: true });
      console.log(`\nCycle Complete. Chosen Action: ${res.chosen?.name || 'HOLD'} (Score: ${res.chosen?.score || 0})`);
    }
  })();
}
