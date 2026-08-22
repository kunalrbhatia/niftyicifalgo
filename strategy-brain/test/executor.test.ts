import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { OrderExecutor } from '../src/executor.js';
import { SafetyRails, AdjustmentAction } from '../src/safety.js';
import { TelegramNotifier } from '../src/telegram.js';
import { PendingApprovalStore } from '../src/pendingApproval.js';

describe('OrderExecutor Safety, Live Hard-Block & Approvals', () => {
  const testDir = path.resolve(process.cwd(), './test-scratch-executor');
  let safety: SafetyRails;
  let telegram: TelegramNotifier;
  let pendingStore: PendingApprovalStore;
  let executor: OrderExecutor;

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    safety = new SafetyRails(testDir);
    safety.validateTradingWindow = () => ({ valid: true });
    telegram = new TelegramNotifier();
    pendingStore = new PendingApprovalStore(testDir);
    executor = new OrderExecutor(safety, telegram, pendingStore);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const sampleAction: AdjustmentAction = {
    name: 'Roll short call',
    type: 'ROLL_SHORT',
    description: 'Roll 24500 CE to 24800 CE',
    legsToAdd: [{ side: 'SELL', strike: 24800, optionType: 'CE', expiry: '2026-08-28', qty: 65 }],
    legsToClose: [{ strike: 24500, optionType: 'CE', expiry: '2026-08-28', qty: 65 }],
    netDebitEstimate: 2000,
    netDeltaImpact: -0.10,
    changesStructureType: false,
    increasesNetRisk: false,
    rationale: 'Reduce delta risk'
  };

  it('should hard-block LIVE execution and NEVER fabricate order fills', async () => {
    // Mock safety.isPaperMode to false
    safety.isPaperMode = () => false;

    const res = await executor.execute('test-strategy', sampleAction, {
      todayAdjustmentCount: 0,
      weekAdjustmentCount: 0
    });

    expect(res.success).toBe(false);
    expect(res.mode).toBe('LIVE');
    expect(res.error).toContain('not implemented');
    expect(res.orderIds.length).toBe(0);
    expect(res.fills.length).toBe(0);
  });

  it('should generate paper fills properly in paper mode', async () => {
    safety.isPaperMode = () => true;

    const res = await executor.execute('test-strategy', sampleAction, {
      todayAdjustmentCount: 0,
      weekAdjustmentCount: 0
    });

    expect(res.success).toBe(true);
    expect(res.mode).toBe('PAPER');
    expect(res.orderIds.length).toBe(2);
    expect(res.fills.length).toBe(2);
  });

  it('should handle Tier 2 confirmation lifecycle (create -> approve/reject)', async () => {
    safety.isPaperMode = () => true;

    const tier2Action: AdjustmentAction = {
      ...sampleAction,
      changesStructureType: true,
      type: 'CONVERT_STRUCTURE'
    };

    const res = await executor.execute('test-strategy', tier2Action, {
      todayAdjustmentCount: 0,
      weekAdjustmentCount: 0
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Awaiting Tier 2 human confirmation');
    
    // Extract approval ID
    const match = res.error?.match(/approval id: ([a-zA-Z0-9_-]+)/);
    expect(match).not.toBeNull();
    const approvalId = match![1];

    // Approve
    const approveRes = await executor.approve(approvalId);
    expect(approveRes.success).toBe(true);
    expect(approveRes.mode).toBe('PAPER');
    expect(approveRes.fills.length).toBe(2);

    // Rejecting already approved should fail
    const pendingItem = pendingStore.get(approvalId);
    expect(pendingItem?.status).toBe('APPROVED');
  });

  it('should reject pending approvals', async () => {
    const pending = await pendingStore.create('test-strategy', sampleAction, {
      todayAdjustmentCount: 0,
      weekAdjustmentCount: 0
    });

    const rejectRes = await executor.reject(pending.id);
    expect(rejectRes.success).toBe(true);
    expect(pendingStore.get(pending.id)?.status).toBe('REJECTED');

    // Attempting to approve rejected should fail
    const approveRes = await executor.approve(pending.id);
    expect(approveRes.success).toBe(false);
    expect(approveRes.error).toContain('already REJECTED');
  });
});
