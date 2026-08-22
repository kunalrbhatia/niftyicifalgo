import fs from 'fs';
import path from 'path';
import moment from 'moment-timezone';
import { config } from './config.js';

export enum ActionTier {
  TIER_0 = 0, // Auto: Monitoring, research, backtest, analysis, recommendation
  TIER_1 = 1, // Auto-execute: Adjustments within caps for pre-approved actions (paper mode default)
  TIER_2 = 2, // Human confirm: Structure changes, increased net risk, or cap breaches (wait for Telegram confirmation)
  TIER_3 = 3  // Hard stop: Daily/weekly cap hit, margin threshold breach, or verification failure
}

export interface AdjustmentAction {
  name: string;
  type: 'ROLL_SHORT' | 'ROLL_LONG' | 'CONVERT_STRUCTURE' | 'HEDGE_DELTA' | 'CLOSE_LEG' | 'CLOSE_ALL' | 'HOLD';
  description: string;
  legsToAdd: Array<{
    side: 'BUY' | 'SELL';
    strike: number;
    optionType: 'CE' | 'PE';
    expiry: string;
    qty: number;
    estimatedPrice?: number;
  }>;
  legsToClose: Array<{
    symbol?: string;
    strike: number;
    optionType: 'CE' | 'PE';
    expiry: string;
    qty: number;
    estimatedPrice?: number;
  }>;
  netDebitEstimate: number;
  netDeltaImpact: number;
  changesStructureType: boolean;
  increasesNetRisk: boolean;
  rationale: string;
}

export interface SafetyCheckResult {
  allowed: boolean;
  tier: ActionTier;
  reason?: string;
  violations: string[];
}

export class SafetyRails {
  private baseDir: string;

  constructor(baseDir = process.cwd()) {
    this.baseDir = baseDir;
  }

  /**
   * Hard Kill switch: .panic file
   * Halts all brain activity immediately.
   */
  public isPanicActive(): boolean {
    const panicFile = path.resolve(this.baseDir, '.panic');
    const rootPanicFile = path.resolve(this.baseDir, '../.panic');
    return fs.existsSync(panicFile) || fs.existsSync(rootPanicFile);
  }

  /**
   * Soft Pause: .kill file
   * Allows current evaluation to complete but blocks any execution actions.
   */
  public isSoftKillActive(): boolean {
    const killFile = path.resolve(this.baseDir, '.kill');
    const rootKillFile = path.resolve(this.baseDir, '../.kill');
    return fs.existsSync(killFile) || fs.existsSync(rootKillFile);
  }

  /**
   * Checks if paper mode is enforced.
   * Defaults to ON unless .paper is removed AND LIVE_ENABLED is explicitly true.
   */
  public isPaperMode(): boolean {
    const paperFile = path.resolve(this.baseDir, '.paper');
    const rootPaperFile = path.resolve(this.baseDir, '../.paper');
    if (fs.existsSync(paperFile) || fs.existsSync(rootPaperFile)) {
      return true;
    }
    return config.PAPER_MODE || !config.LIVE_ENABLED;
  }

  /**
   * Validates if current time is within acceptable trading windows.
   * Never adjust within 5 min of open (09:15-09:20) or close (15:25-15:30).
   * Expiry day after 15:00: only CLOSE ALL permitted.
   */
  public validateTradingWindow(isExpiryDay: boolean, actionType: string): { valid: boolean; reason?: string } {
    const now = moment().tz('Asia/Kolkata');
    const currentMinutes = now.hours() * 60 + now.minutes();

    const marketOpenMinutes = 9 * 60 + 15;
    const marketCloseMinutes = 15 * 60 + 30;

    if (currentMinutes < marketOpenMinutes || currentMinutes > marketCloseMinutes) {
      return { valid: false, reason: 'Market is closed' };
    }

    // First 5 minutes window
    if (currentMinutes < marketOpenMinutes + 5) {
      return { valid: false, reason: 'Within 5 minutes of market open (09:15 - 09:20 IST)' };
    }

    // Last 5 minutes window
    if (currentMinutes > marketCloseMinutes - 5) {
      return { valid: false, reason: 'Within 5 minutes of market close (15:25 - 15:30 IST)' };
    }

    // Expiry day after 15:00 window
    if (isExpiryDay && currentMinutes >= 15 * 60) {
      if (actionType !== 'CLOSE_ALL') {
        return { valid: false, reason: 'Expiry day after 15:00 IST: Only CLOSE_ALL allowed' };
      }
    }

    return { valid: true };
  }

  /**
   * Evaluates safety caps, tier classification, and execution constraints.
   */
  public evaluateAction(
    action: AdjustmentAction,
    strategyStats: {
      todayAdjustmentCount: number;
      weekAdjustmentCount: number;
      isExpiryDay?: boolean;
      currentMargin?: number;
      maxAllowedMargin?: number;
    }
  ): SafetyCheckResult {
    const violations: string[] = [];

    // 1. Check Panic
    if (this.isPanicActive()) {
      return {
        allowed: false,
        tier: ActionTier.TIER_3,
        reason: 'Hard kill-switch (.panic) active',
        violations: ['HARD_PANIC_ACTIVE']
      };
    }

    // 2. Check Soft Kill
    if (this.isSoftKillActive() && action.type !== 'HOLD') {
      return {
        allowed: false,
        tier: ActionTier.TIER_3,
        reason: 'Soft pause (.kill) active - execution blocked',
        violations: ['SOFT_KILL_ACTIVE']
      };
    }

    // 3. Trading Window check
    const windowCheck = this.validateTradingWindow(
      !!strategyStats.isExpiryDay,
      action.type
    );
    if (!windowCheck.valid) {
      return {
        allowed: false,
        tier: ActionTier.TIER_3,
        reason: windowCheck.reason,
        violations: ['TRADING_WINDOW_VIOLATION']
      };
    }

    // 4. Daily / Weekly adjustment caps (Tier 3 Hard Stop)
    if (strategyStats.todayAdjustmentCount >= config.MAX_ADJUSTMENTS_PER_STRATEGY_DAY && action.type !== 'HOLD' && action.type !== 'CLOSE_ALL') {
      violations.push(`Daily adjustment cap reached (${strategyStats.todayAdjustmentCount}/${config.MAX_ADJUSTMENTS_PER_STRATEGY_DAY})`);
    }

    if (strategyStats.weekAdjustmentCount >= config.MAX_ADJUSTMENTS_PER_STRATEGY_WEEK && action.type !== 'HOLD' && action.type !== 'CLOSE_ALL') {
      violations.push(`Weekly adjustment cap reached (${strategyStats.weekAdjustmentCount}/${config.MAX_ADJUSTMENTS_PER_STRATEGY_WEEK})`);
    }

    if (violations.length > 0) {
      return {
        allowed: false,
        tier: ActionTier.TIER_3,
        reason: violations.join('; '),
        violations
      };
    }

    // 5. Orders per cycle cap
    const totalOrders = (action.legsToAdd?.length || 0) + (action.legsToClose?.length || 0);
    if (totalOrders > config.MAX_ORDERS_PER_CYCLE) {
      violations.push(`Orders in cycle (${totalOrders}) exceeds max allowed (${config.MAX_ORDERS_PER_CYCLE})`);
    }

    // 6. Net Premium Debit Cap
    if (action.netDebitEstimate > config.MAX_NET_PREMIUM_DEBIT) {
      violations.push(`Net debit estimate (₹${action.netDebitEstimate}) exceeds cap (₹${config.MAX_NET_PREMIUM_DEBIT})`);
    }

    // 7. Net Delta Change Cap
    if (Math.abs(action.netDeltaImpact) > config.MAX_DELTA_CHANGE_PER_ADJUSTMENT) {
      violations.push(`Delta impact (${action.netDeltaImpact}) exceeds cap (${config.MAX_DELTA_CHANGE_PER_ADJUSTMENT})`);
    }

    // Determine Tier
    let tier = ActionTier.TIER_1;
    if (action.type === 'HOLD') {
      tier = ActionTier.TIER_0;
    } else if (action.changesStructureType || action.increasesNetRisk || violations.length > 0) {
      tier = ActionTier.TIER_2; // Requires Human confirmation
    }

    return {
      allowed: violations.length === 0,
      tier,
      reason: violations.length > 0 ? violations.join('; ') : undefined,
      violations
    };
  }
}
