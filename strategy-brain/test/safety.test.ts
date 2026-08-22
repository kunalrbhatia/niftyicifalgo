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

  it('should enforce daily adjustment limit cap (Tier 3, allowed false)', () => {
    // Mock trading window to valid
    safety.validateTradingWindow = () => ({ valid: true });

    const res = safety.evaluateAction(baseAction, { todayAdjustmentCount: 1, weekAdjustmentCount: 0 });
    expect(res.allowed).toBe(false);
    expect(res.tier).toBe(ActionTier.TIER_3);
    expect(res.violations.some(v => v.includes('Daily adjustment cap reached'))).toBe(true);
  });

  it('should enforce weekly adjustment limit cap (Tier 3, allowed false)', () => {
    safety.validateTradingWindow = () => ({ valid: true });

    const res = safety.evaluateAction(baseAction, { todayAdjustmentCount: 0, weekAdjustmentCount: 3 });
    expect(res.allowed).toBe(false);
    expect(res.tier).toBe(ActionTier.TIER_3);
    expect(res.violations.some(v => v.includes('Weekly adjustment cap reached'))).toBe(true);
  });

  it('should route net debit exceeding cap to Tier 2 (human override possible), allowed false', () => {
    safety.validateTradingWindow = () => ({ valid: true });

    const expensiveAction: AdjustmentAction = {
      ...baseAction,
      netDebitEstimate: 35000 // exceeds default 25000
    };

    const res = safety.evaluateAction(expensiveAction, { todayAdjustmentCount: 0, weekAdjustmentCount: 0 });
    expect(res.allowed).toBe(false);
    expect(res.tier).toBe(ActionTier.TIER_2);
    expect(res.violations.some(v => v.includes('Net debit estimate'))).toBe(true);
  });

  it('should route structure conversions with no cap violations to Tier 2, allowed true', () => {
    safety.validateTradingWindow = () => ({ valid: true });

    const conversionAction: AdjustmentAction = {
      ...baseAction,
      type: 'CONVERT_STRUCTURE',
      changesStructureType: true
    };

    const res = safety.evaluateAction(conversionAction, { todayAdjustmentCount: 0, weekAdjustmentCount: 0 });
    expect(res.allowed).toBe(true);
    expect(res.tier).toBe(ActionTier.TIER_2);
    expect(res.violations.length).toBe(0);
  });
});
