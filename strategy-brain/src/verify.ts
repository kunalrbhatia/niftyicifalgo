import { SituationReport, LegPosition } from './sitrep.js';
import { AdjustmentAction } from './safety.js';
import { ExecutionResult } from './executor.js';

export interface VerificationResult {
  verified: boolean;
  source: 'PAPER_FILLS' | 'BROKER_STATE' | 'MOCK';
  message: string;
  violations: string[];
}

export class ExecutionVerifier {
  /**
   * Verifies adjustment execution against returned fills or broker state.
   */
  public static verifyAdjustment(
    preSitrep: SituationReport,
    action: AdjustmentAction,
    execResult: ExecutionResult
  ): VerificationResult {
    const violations: string[] = [];
    const source = execResult.mode === 'PAPER' ? 'PAPER_FILLS' : 'BROKER_STATE';

    if (action.type === 'HOLD') {
      return { verified: true, source, message: 'HOLD verified - no leg modifications expected.', violations: [] };
    }

    if (!execResult.success || !execResult.fills || execResult.fills.length === 0) {
      return {
        verified: false,
        source,
        message: 'Verification failed: No execution fills found.',
        violations: ['NO_FILLS_RECORDED']
      };
    }

    // Verify all legsToClose were executed in fills
    for (const leg of action.legsToClose || []) {
      const closedFill = execResult.fills.find(
        f => f.strike === leg.strike && f.optionType === leg.optionType && (f.side === 'BUY' || f.side === 'SELL')
      );
      if (!closedFill) {
        violations.push(`Expected close fill missing for strike ${leg.strike} ${leg.optionType}`);
      }
    }

    // Verify all legsToAdd were executed in fills
    for (const leg of action.legsToAdd || []) {
      const addFill = execResult.fills.find(
        f => f.strike === leg.strike && f.optionType === leg.optionType && f.side === leg.side
      );
      if (!addFill) {
        violations.push(`Expected add fill missing for strike ${leg.strike} ${leg.optionType} (${leg.side})`);
      }
    }

    const verified = violations.length === 0;
    return {
      verified,
      source,
      message: verified ? `Adjustment successfully verified via ${source}.` : violations.join('; '),
      violations
    };
  }
}
