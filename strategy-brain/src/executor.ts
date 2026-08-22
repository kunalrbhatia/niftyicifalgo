import { SafetyRails, AdjustmentAction, ActionTier } from './safety.js';
import { TelegramNotifier } from './telegram.js';
import { PendingApprovalStore } from './pendingApproval.js';
import { config } from './config.js';

export interface ExecutionResult {
  success: boolean;
  mode: 'PAPER' | 'LIVE';
  orderIds: string[];
  fills: Array<{ symbol?: string; price: number; qty: number; side: 'BUY' | 'SELL'; strike?: number; optionType?: 'CE' | 'PE' }>;
  error?: string;
  rollbackTriggered?: boolean;
}

export class OrderExecutor {
  private safety: SafetyRails;
  private telegram: TelegramNotifier;
  private pendingStore: PendingApprovalStore;

  constructor(
    safety = new SafetyRails(),
    telegram = new TelegramNotifier(),
    pendingStore = new PendingApprovalStore()
  ) {
    this.safety = safety;
    this.telegram = telegram;
    this.pendingStore = pendingStore;
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
      console.log(`[Executor] Action requires Tier 2 human confirmation. Storing pending approval and alerting Telegram.`);
      const pending = await this.pendingStore.create(strategy, action, strategyStats);
      await this.telegram.alertHumanConfirmRequired(strategy, action, 75, evaluation.violations, pending.id);
      return {
        success: false,
        mode,
        orderIds: [],
        fills: [],
        error: `Awaiting Tier 2 human confirmation via Telegram (approval id: ${pending.id})`
      };
    }

    // 3. Execution (Paper or Live)
    if (isPaper) {
      return this.executePaperFills(strategy, action);
    } else {
      // LIVE trading is NOT yet implemented. Hard-block — never fabricate fills.
      const errorMsg = 'LIVE execution not implemented — refusing to fake order fills. Run in PAPER mode.';
      console.error(`[Executor] ${errorMsg}`);
      await this.telegram.alertHardStop(strategy, errorMsg);
      return { success: false, mode: 'LIVE', orderIds: [], fills: [], error: errorMsg };
    }
  }

  /**
   * Helper to execute simulated paper fills
   */
  private executePaperFills(strategy: string, action: AdjustmentAction): ExecutionResult {
    console.log(`[Executor:PAPER] Executing paper adjustment for ${strategy}: ${action.name}`);
    const fills: ExecutionResult['fills'] = [];
    const orderIds: string[] = [];

    for (const leg of action.legsToClose || []) {
      const id = `PAPER_CLOSE_${Date.now()}_${leg.strike}${leg.optionType}`;
      orderIds.push(id);
      fills.push({
        symbol: leg.symbol || `NIFTY_${leg.strike}_${leg.optionType}`,
        strike: leg.strike,
        optionType: leg.optionType,
        price: leg.estimatedPrice || 25.0,
        qty: leg.qty,
        side: 'BUY' // closing short
      });
    }

    for (const leg of action.legsToAdd || []) {
      const id = `PAPER_ADD_${Date.now()}_${leg.strike}${leg.optionType}`;
      orderIds.push(id);
      fills.push({
        strike: leg.strike,
        optionType: leg.optionType,
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
  }

  /**
   * Approves a pending Tier 2 human confirmation.
   */
  public async approve(id: string): Promise<ExecutionResult> {
    const pending = this.pendingStore.get(id);
    if (!pending) {
      return { success: false, mode: 'PAPER', orderIds: [], fills: [], error: `Approval ID ${id} not found.` };
    }

    if (pending.status === 'EXPIRED') {
      return { success: false, mode: 'PAPER', orderIds: [], fills: [], error: `Approval ID ${id} has EXPIRED (>30 minutes old).` };
    }

    if (pending.status !== 'PENDING') {
      return { success: false, mode: 'PAPER', orderIds: [], fills: [], error: `Approval ID ${id} is already ${pending.status}.` };
    }

    // Re-evaluate safety conditions at time of approval
    const evaluation = this.safety.evaluateAction(pending.action, pending.strategyStats);
    if (this.safety.isPanicActive() || this.safety.isSoftKillActive()) {
      return {
        success: false,
        mode: this.safety.isPaperMode() ? 'PAPER' : 'LIVE',
        orderIds: [],
        fills: [],
        error: `Execution aborted: Kill/Panic switch active at time of approval.`
      };
    }

    const isPaper = this.safety.isPaperMode();
    let result: ExecutionResult;

    if (isPaper) {
      result = this.executePaperFills(pending.strategy, pending.action);
    } else {
      const errorMsg = 'LIVE execution not implemented — refusing to fake order fills. Run in PAPER mode.';
      await this.telegram.alertHardStop(pending.strategy, errorMsg);
      result = { success: false, mode: 'LIVE', orderIds: [], fills: [], error: errorMsg };
    }

    if (result.success) {
      await this.pendingStore.updateStatus(id, 'APPROVED');
    }

    return result;
  }

  /**
   * Rejects a pending Tier 2 confirmation.
   */
  public async reject(id: string): Promise<{ success: boolean; message: string }> {
    const pending = this.pendingStore.get(id);
    if (!pending) {
      return { success: false, message: `Approval ID ${id} not found.` };
    }

    await this.pendingStore.updateStatus(id, 'REJECTED');
    console.log(`[Executor] Rejected pending approval ${id} for ${pending.strategy}`);
    return { success: true, message: `Approval ${id} marked as REJECTED.` };
  }
}
