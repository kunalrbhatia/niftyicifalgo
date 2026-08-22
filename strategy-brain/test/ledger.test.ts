import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DecisionLedger, LedgerEntry } from '../src/ledger.js';
import { ActionTier } from '../src/safety.js';

describe('DecisionLedger', () => {
  const testLedgerDir = './test-ledger';
  let ledger: DecisionLedger;

  beforeEach(() => {
    ledger = new DecisionLedger(testLedgerDir);
  });

  afterEach(async () => {
    const fullPath = path.resolve(process.cwd(), testLedgerDir);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  });

  const sampleEntry: LedgerEntry = {
    ts: new Date().toISOString(),
    trigger: 'MTM_DANGER',
    strategy: 'nifty-weekly-calendar-ratio-strangle',
    sitrep: { combinedMtm: -8500, netDelta: 0.15 },
    candidates: [{ name: 'Roll short CE', score: 78 }],
    decision: {
      action: 'ROLL_SHORT_CE',
      score: 78,
      tier: ActionTier.TIER_1,
      rationale: 'Mitigate upward momentum by rolling short strike 300 pts higher.'
    },
    execution: {
      mode: 'PAPER',
      orders: ['ORD_123', 'ORD_124'],
      fills: [{ price: 45.2 }, { price: 15.1 }],
      verified: true
    }
  };

  it('should log decisions and read them back accurately', async () => {
    await ledger.logDecision(sampleEntry);
    const entries = await ledger.getEntries();

    expect(entries.length).toBe(1);
    expect(entries[0].strategy).toBe('nifty-weekly-calendar-ratio-strangle');
    expect(entries[0].decision.action).toBe('ROLL_SHORT_CE');
    expect(entries[0].decision.score).toBe(78);
    expect(entries[0].execution?.verified).toBe(true);
  });

  it('should track daily adjustment count correctly', async () => {
    await ledger.logDecision(sampleEntry);
    
    // Hold entry should not increment adjustment count
    await ledger.logDecision({
      ...sampleEntry,
      decision: { ...sampleEntry.decision, action: 'HOLD' }
    });

    const count = await ledger.getTodayAdjustmentCount('nifty-weekly-calendar-ratio-strangle');
    expect(count).toBe(1);
  });
});
