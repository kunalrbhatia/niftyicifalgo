import { SafetyRails, AdjustmentAction, ActionTier } from './safety.js';
import { TelegramNotifier } from './telegram.js';

export interface ExecutionResult {
  success: boolean;
  mode: 'PAPER' | 'LIVE';
  orderIds: string[];
  fills: Array<{ symbol?: string; price: number; qty: number; side: 'BUY' | 'SELL' }>;
  error?: string;
  rollbackTriggered?: boolean;
}

export class OrderExecutor {
  private safety: SafetyRails;
  private telegram: TelegramNotifier;

  constructor(safety = new SafetyRails(), telegram = new TelegramNotifier()) {
    this.safety = safety;
    this.telegram = telegram;
  }

  /**
   * Executes an adjustment action within safety rails.
   */
  public async execute(
    strategy: string,
    action: AdjustmentAction,
    strategyStats: { todayAdjustmentCount: number; weekAdjustmentCount: number; isExpiryDay?: boolean }
  ): Promise<ExecutionResult> {
    const isPaper = this.safety.isPaperMode();
    const mode = isPaper ? 'PAPER' : 'LIVE';

    // 1. Evaluate safety rails
    const evaluation = this.safety.evaluateAction(action, strategyStats);
    if (!evaluation.allowed && evaluation.tier === ActionTier.TIER_3) {
      const errorMsg = `Safety Rails Blocked Execution: ${evaluation.reason}`;
      console.warn(`[Executor] ${errorMsg}`);
      await this.telegram.alertHardStop(strategy, errorMsg);
      return { success: false, mode, orderIds: [], fills: [], error: errorMsg };
    }

    // 2. Tier 2 handling (human confirm)
    if (evaluation.tier === ActionTier.TIER_2) {
      console.log(`[Executor] Action requires Tier 2 human confirmation. Alerting Telegram.`);
      await this.telegram.alertHumanConfirmRequired(strategy, action, 75, evaluation.violations);
      return {
        success: false,
        mode,
        orderIds: [],
        fills: [],
        error: 'Awaiting Tier 2 human confirmation via Telegram.'
      };
    }

    // 3. Execution (Paper or Live)
    if (isPaper) {
      console.log(`[Executor:PAPER] Executing paper adjustment for ${strategy}: ${action.name}`);
      const fills: ExecutionResult['fills'] = [];
      const orderIds: string[] = [];

      for (const leg of action.legsToClose || []) {
        const id = `PAPER_CLOSE_${Date.now()}_${leg.strike}${leg.optionType}`;
        orderIds.push(id);
        fills.push({
          price: leg.estimatedPrice || 25.0,
          qty: leg.qty,
          side: 'BUY' // closing short
        });
      }

      for (const leg of action.legsToAdd || []) {
        const id = `PAPER_ADD_${Date.now()}_${leg.strike}${leg.optionType}`;
        orderIds.push(id);
        fills.push({
          price: leg.estimatedPrice || 15.0,
          qty: leg.qty,
          side: leg.side
        });
      }

      return {
        success: true,
        mode: 'PAPER',
        orderIds,
        fills
      };
    } else {
      // Live execution safety assertion
      if (!this.safety.isPaperMode() && !action.legsToAdd && !action.legsToClose) {
        return { success: false, mode: 'LIVE', orderIds: [], fills: [], error: 'Empty legs spec' };
      }

      // Live order mapping would invoke placeMarketOrder
      console.log(`[Executor:LIVE] Live execution pathway engaged for ${strategy}`);
      return {
        success: true,
        mode: 'LIVE',
        orderIds: [`LIVE_ORD_${Date.now()}`],
        fills: []
      };
    }
  }
}
