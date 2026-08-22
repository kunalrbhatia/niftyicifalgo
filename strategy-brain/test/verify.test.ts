import { describe, it, expect } from 'vitest';
import { ExecutionVerifier } from '../src/verify.js';
import { AdjustmentAction } from '../src/safety.js';
import { SituationReport, LegPosition } from '../src/sitrep.js';
import { ExecutionResult } from '../src/executor.js';

describe('ExecutionVerifier', () => {
  const sampleLegs: LegPosition[] = [
    { symbol: 'NIFTY26AUG24500CE', side: 'SELL', strike: 24500, optionType: 'CE', expiry: '2026-08-28', qty: 65, ltp: 45.0, status: 'OPEN' }
  ];

  const preSitrep: SituationReport = {
    timestamp: new Date().toISOString(),
    strategy: 'test-strategy',
    status: 'FULL_ENTRY',
    combinedPosition: {
      strategy: 'test-strategy',
      status: 'FULL_ENTRY',
      legs: sampleLegs,
      netDelta: -0.25,
      netGamma: 0,
      netTheta: 0,
      netVega: 0,
      combinedMtm: -1000,
      realizedPnl: 0,
      daysToT0: 3
    },
    marginUtilized: 500000,
    exitThreshold: 10000,
    dangerThreshold: 5000,
    spot: 24480,
    shortStrikeProximity: {
      closestShort: 24500,
      optionType: 'CE',
      distance: 20,
      distancePct: 0.08,
      isBreachingWall: true
    },
    marketContext: { niftySpot: 24480, isExpiryDay: false, daysToMonthlyExpiry: 3 },
    openOrders: [],
    triggerFired: 'WALL_PROXIMITY'
  };

  const action: AdjustmentAction = {
    name: 'Roll Short CE',
    type: 'ROLL_SHORT',
    description: 'Roll 24500 to 24800',
    legsToClose: [{ strike: 24500, optionType: 'CE', expiry: '2026-08-28', qty: 65 }],
    legsToAdd: [{ side: 'SELL', strike: 24800, optionType: 'CE', expiry: '2026-08-28', qty: 65 }],
    netDebitEstimate: 1500,
    netDeltaImpact: -0.10,
    changesStructureType: false,
    increasesNetRisk: false,
    rationale: 'Roll tested short wing'
  };

  it('should verify true when fills match action legs', () => {
    const execResult: ExecutionResult = {
      success: true,
      mode: 'PAPER',
      orderIds: ['ORD_1', 'ORD_2'],
      fills: [
        { strike: 24500, optionType: 'CE', price: 40, qty: 65, side: 'BUY' },
        { strike: 24800, optionType: 'CE', price: 20, qty: 65, side: 'SELL' }
      ]
    };

    const res = ExecutionVerifier.verifyAdjustment(preSitrep, action, execResult);
    expect(res.verified).toBe(true);
    expect(res.source).toBe('PAPER_FILLS');
    expect(res.violations.length).toBe(0);
  });

  it('should fail verification when expected add fill is missing', () => {
    const execResult: ExecutionResult = {
      success: true,
      mode: 'PAPER',
      orderIds: ['ORD_1'],
      fills: [
        { strike: 24500, optionType: 'CE', price: 40, qty: 65, side: 'BUY' }
      ]
    };

    const res = ExecutionVerifier.verifyAdjustment(preSitrep, action, execResult);
    expect(res.verified).toBe(false);
    expect(res.violations.some(v => v.includes('Expected add fill missing'))).toBe(true);
  });

  it('should fail verification when expected close fill is missing', () => {
    const execResult: ExecutionResult = {
      success: true,
      mode: 'PAPER',
      orderIds: ['ORD_2'],
      fills: [
        { strike: 24800, optionType: 'CE', price: 20, qty: 65, side: 'SELL' }
      ]
    };

    const res = ExecutionVerifier.verifyAdjustment(preSitrep, action, execResult);
    expect(res.verified).toBe(false);
    expect(res.violations.some(v => v.includes('Expected close fill missing'))).toBe(true);
  });
});
