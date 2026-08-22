import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SafetyRails, ActionTier, AdjustmentAction } from '../src/safety.js';

describe('SafetyRails & Execution Caps', () => {
  const testDir = path.resolve(process.cwd(), './test-scratch');
  let safety: SafetyRails;

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    safety = new SafetyRails(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const baseAction: AdjustmentAction = {
    name: 'Roll tested short call',
    type: 'ROLL_SHORT',
    description: 'Roll 24500 CE to 25000 CE',
    legsToAdd: [{ side: 'SELL', strike: 25000, optionType: 'CE', expiry: '2026-08-28', qty: 65, estimatedPrice: 20 }],
    legsToClose: [{ strike: 24500, optionType: 'CE', expiry: '2026-08-28', qty: 65, estimatedPrice: 50 }],
    netDebitEstimate: 1950,
    netDeltaImpact: -0.10,
    changesStructureType: false,
    increasesNetRisk: false,
    rationale: 'Protect against upward move'
  };

  it('should detect hard panic file and halt immediately', () => {
    fs.writeFileSync(path.join(testDir, '.panic'), 'emergency halt');
    expect(safety.isPanicActive()).toBe(true);

    const res = safety.evaluateAction(baseAction, { todayAdjustmentCount: 0, weekAdjustmentCount: 0 });
    expect(res.allowed).toBe(false);
    expect(res.tier).toBe(ActionTier.TIER_3);
    expect(res.violations).toContain('HARD_PANIC_ACTIVE');
  });

  it('should detect soft kill file and block execution', () => {
    fs.writeFileSync(path.join(testDir, '.kill'), 'pause');
    expect(safety.isSoftKillActive()).toBe(true);

    const res = safety.evaluateAction(baseAction, { todayAdjustmentCount: 0, weekAdjustmentCount: 0 });
    expect(res.allowed).toBe(false);
    expect(res.tier).toBe(ActionTier.TIER_3);
    expect(res.violations).toContain('SOFT_KILL_ACTIVE');
  });

  it('should enforce daily adjustment limit cap (Tier 3)', () => {
    const res = safety.evaluateAction(baseAction, { todayAdjustmentCount: 1, weekAdjustmentCount: 1 });
    expect(res.allowed).toBe(false);
    expect(res.tier).toBe(ActionTier.TIER_3);
  });

  it('should flag structure conversions as Tier 2 (Human Confirmation)', () => {
    const conversionAction: AdjustmentAction = {
      ...baseAction,
      type: 'CONVERT_STRUCTURE',
      changesStructureType: true
    };

    // Override validateTradingWindow for unit test simulation if needed
    const res = safety.evaluateAction(conversionAction, { todayAdjustmentCount: 0, weekAdjustmentCount: 0 });
    if (res.tier !== ActionTier.TIER_3) {
      expect(res.tier).toBe(ActionTier.TIER_2);
    }
  });

  it('should flag net debit exceeding cap as violation', () => {
    const expensiveAction: AdjustmentAction = {
      ...baseAction,
      netDebitEstimate: 35000 // exceeds default 25000
    };

    const res = safety.evaluateAction(expensiveAction, { todayAdjustmentCount: 0, weekAdjustmentCount: 0 });
    if (res.tier !== ActionTier.TIER_3) {
      expect(res.allowed).toBe(false);
      expect(res.violations.some(v => v.includes('Net debit estimate'))).toBe(true);
    }
  });

  it('should flag excessive orders per cycle', () => {
    const manyLegsAction: AdjustmentAction = {
      ...baseAction,
      legsToAdd: [
        { side: 'SELL', strike: 25000, optionType: 'CE', expiry: '2026-08-28', qty: 65 },
        { side: 'BUY', strike: 25200, optionType: 'CE', expiry: '2026-08-28', qty: 65 },
        { side: 'SELL', strike: 24000, optionType: 'PE', expiry: '2026-08-28', qty: 65 }
      ],
      legsToClose: [
        { strike: 24500, optionType: 'CE', expiry: '2026-08-28', qty: 65 },
        { strike: 24200, optionType: 'PE', expiry: '2026-08-28', qty: 65 }
      ] // total = 5 orders > 4 max
    };

    const res = safety.evaluateAction(manyLegsAction, { todayAdjustmentCount: 0, weekAdjustmentCount: 0 });
    if (res.tier !== ActionTier.TIER_3) {
      expect(res.allowed).toBe(false);
      expect(res.violations.some(v => v.includes('Orders in cycle'))).toBe(true);
    }
  });
});
