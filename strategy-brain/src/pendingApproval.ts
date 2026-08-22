import fs from 'fs';
import path from 'path';
import { AdjustmentAction } from './safety.js';

export interface PendingApproval {
  id: string;
  strategy: string;
  action: AdjustmentAction;
  strategyStats: {
    todayAdjustmentCount: number;
    weekAdjustmentCount: number;
    isExpiryDay?: boolean;
    currentMargin?: number;
    maxAllowedMargin?: number;
  };
  createdAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  resolvedAt?: string;
}

export class PendingApprovalStore {
  private storePath: string;
  private memoryMap: Map<string, PendingApproval> = new Map();

  constructor(baseDir = process.cwd()) {
    const dataDir = path.resolve(baseDir, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.storePath = path.join(dataDir, 'pending-approvals.jsonl');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.storePath)) {
      return;
    }
    try {
      const content = fs.readFileSync(this.storePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);
      for (const line of lines) {
        try {
          const item: PendingApproval = JSON.parse(line);
          this.memoryMap.set(item.id, item);
        } catch (err) {
          // ignore corrupted lines
        }
      }
    } catch (err) {
      console.warn(`[PendingApprovalStore] Could not read ${this.storePath}:`, err);
    }
  }

  private async appendToDisk(item: PendingApproval): Promise<void> {
    const line = JSON.stringify(item) + '\n';
    await fs.promises.appendFile(this.storePath, line, 'utf8');
  }

  public async create(
    strategy: string,
    action: AdjustmentAction,
    strategyStats: PendingApproval['strategyStats']
  ): Promise<PendingApproval> {
    const id = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const pending: PendingApproval = {
      id,
      strategy,
      action,
      strategyStats,
      createdAt: new Date().toISOString(),
      status: 'PENDING'
    };

    this.memoryMap.set(id, pending);
    await this.appendToDisk(pending);
    return pending;
  }

  public get(id: string): PendingApproval | undefined {
    const item = this.memoryMap.get(id);
    if (!item) return undefined;

    // Check 30-minute expiry
    if (item.status === 'PENDING') {
      const createdTime = new Date(item.createdAt).getTime();
      const ageMs = Date.now() - createdTime;
      if (ageMs > 30 * 60 * 1000) {
        item.status = 'EXPIRED';
        item.resolvedAt = new Date().toISOString();
        this.appendToDisk(item).catch(() => {});
      }
    }

    return item;
  }

  public async updateStatus(id: string, status: 'APPROVED' | 'REJECTED' | 'EXPIRED'): Promise<PendingApproval | null> {
    const item = this.get(id);
    if (!item) return null;

    item.status = status;
    item.resolvedAt = new Date().toISOString();
    this.memoryMap.set(id, item);
    await this.appendToDisk(item);
    return item;
  }
}
