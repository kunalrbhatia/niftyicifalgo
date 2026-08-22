import fs from 'fs';
import path from 'path';
import moment from 'moment-timezone';
import { config } from './config.js';
import { ActionTier } from './safety.js';

export interface LedgerEntry {
  ts: string;
  trigger: 'SCHEDULED' | 'MTM_DANGER' | 'WALL_PROXIMITY' | 'STRUCTURE_EVENT' | 'MANUAL';
  strategy: string;
  sitrep: any;
  candidates: any[];
  decision: {
    action: string;
    score: number;
    tier: ActionTier;
    rationale: string;
    approvedBy?: 'AUTO' | 'HUMAN_CONFIRM';
  };
  execution?: {
    mode: 'PAPER' | 'LIVE';
    orders: any[];
    fills: any[];
    verified: boolean;
    verificationError?: string;
  };
  outcome?: {
    pnlDelta?: number;
    finalPnl?: number;
    cycleSuccess?: boolean;
  } | null;
  lesson?: string | null;
}

export class DecisionLedger {
  private ledgerDir: string;

  constructor(ledgerDir = config.LEDGER_DIR) {
    this.ledgerDir = path.resolve(process.cwd(), ledgerDir);
    if (!fs.existsSync(this.ledgerDir)) {
      fs.mkdirSync(this.ledgerDir, { recursive: true });
    }
  }

  private getDailyLedgerPath(dateStr?: string): string {
    const d = dateStr || moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
    return path.join(this.ledgerDir, `${d}.jsonl`);
  }

  /**
   * Appends an entry to the JSONL ledger atomically.
   */
  public async logDecision(entry: LedgerEntry): Promise<void> {
    const filePath = this.getDailyLedgerPath();
    const line = JSON.stringify(entry) + '\n';

    try {
      await fs.promises.appendFile(filePath, line, { encoding: 'utf8' });
    } catch (err) {
      console.error(`[Ledger] Error appending to ledger at ${filePath}:`, err);
      throw err;
    }
  }

  /**
   * Reads ledger entries for a given date or range.
   */
  public async getEntries(dateStr?: string): Promise<LedgerEntry[]> {
    const filePath = this.getDailyLedgerPath(dateStr);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = await fs.promises.readFile(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const entries: LedgerEntry[] = [];

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch (err) {
        console.warn(`[Ledger] Corrupted line in ${filePath}:`, line);
      }
    }

    return entries;
  }

  /**
   * Counts adjustments made for a given strategy today.
   */
  public async getTodayAdjustmentCount(strategy: string): Promise<number> {
    const entries = await this.getEntries();
    return entries.filter(
      e => e.strategy === strategy && 
      e.decision.action !== 'HOLD' && 
      e.execution?.verified === true
    ).length;
  }

  /**
   * Counts adjustments made for a given strategy in the last 7 days.
   */
  public async getWeeklyAdjustmentCount(strategy: string): Promise<number> {
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const d = moment().tz('Asia/Kolkata').subtract(i, 'days').format('YYYY-MM-DD');
      const entries = await this.getEntries(d);
      count += entries.filter(
        e => e.strategy === strategy && 
        e.decision.action !== 'HOLD' && 
        e.execution?.verified === true
      ).length;
    }
    return count;
  }
}
