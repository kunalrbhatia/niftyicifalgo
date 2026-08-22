import { SituationReport, LegPosition } from './sitrep.js';
import { AdjustmentAction } from './safety.js';

export interface VerificationResult {
  verified: boolean;
  message: string;
  violations: string[];
}

export class ExecutionVerifier {
  /**
   * Verifies that post-execution state matches the intended adjustment.
   */
  public static verifyAdjustment(
    preSitrep: SituationReport,
    postLegs: LegPosition[],
    action: AdjustmentAction
  ): VerificationResult {
    const violations: string[] = [];

    if (action.type === 'HOLD') {
      return { verified: true, message: 'HOLD verified - no leg modifications expected.', violations: [] };
    }

    // Verify closed legs are no longer active in open legs
    for (const leg of action.legsToClose || []) {
      const stillOpen = postLegs.find(
        l => l.status === 'OPEN' && l.strike === leg.strike && l.optionType === leg.optionType
      );
      if (stillOpen) {
        violations.push(`Leg to close is still open: ${leg.strike} ${leg.optionType}`);
      }
    }

    // Verify added legs are present in open legs
    for (const leg of action.legsToAdd || []) {
      const added = postLegs.find(
        l => l.status === 'OPEN' && l.strike === leg.strike && l.optionType === leg.optionType
      );
      if (!added) {
        violations.push(`Expected added leg not found in post-execution state: ${leg.strike} ${leg.optionType}`);
      }
    }

    const verified = violations.length === 0;
    return {
      verified,
      message: verified ? 'Post-execution state successfully verified.' : violations.join('; '),
      violations
    };
  }
}
