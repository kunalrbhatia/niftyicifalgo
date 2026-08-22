export interface CandidateAdjustment {
  name: string;
  type: string;
  description: string;
  rationale: string;
  evImprovement: number;      // Expected P&L delta in INR
  pImprovement: number;       // Probability of improvement [0, 1]
  tailRisk: number;           // Max loss / 5th percentile adverse outcome in INR
  cost: number;               // Cost of adjustment / net debit in INR
  historicalAnalogueCount: number; // Number of analogues found in data lake
  urgencyFired: boolean;      // True if danger threshold or wall breached
  sources?: string[];
}

export interface ScoredCandidate extends CandidateAdjustment {
  score: number;
  scoreBreakdown: {
    evComponent: number;
    pWinComponent: number;
    tailRiskComponent: number;
    costComponent: number;
    evidencePenalty: number;
    urgencyBonus: number;
  };
}

export class CandidateScorer {
  /**
   * Scores a candidate according to Section 4.5:
   * score = 0.35 * EV_improvement_normalized
   *       + 0.25 * P(improvement) * 100
   *       - 0.20 * tail_risk_normalized
   *       - 0.10 * cost_normalized
   *       - 0.05 * evidence_penalty_points
   *       + 0.05 * urgency_bonus_points
   */
  public static scoreCandidate(
    candidate: CandidateAdjustment,
    benchmarks: {
      maxEvRef?: number;
      maxTailRiskRef?: number;
      maxCostRef?: number;
    } = {}
  ): ScoredCandidate {
    const maxEv = benchmarks.maxEvRef || 20000;
    const maxTailRisk = benchmarks.maxTailRiskRef || 50000;
    const maxCost = benchmarks.maxCostRef || 25000;

    // Normalizations to [0, 100]
    const evNormalized = Math.min(100, Math.max(0, (candidate.evImprovement / maxEv) * 100));
    const pWinNormalized = Math.min(100, Math.max(0, candidate.pImprovement * 100));
    const tailRiskNormalized = Math.min(100, Math.max(0, (candidate.tailRisk / maxTailRisk) * 100));
    const costNormalized = Math.min(100, Math.max(0, (candidate.cost / maxCost) * 100));

    // Evidence penalty: 0 if >=3 analogues, 50 if 1-2, 100 if none
    let evidencePenalty = 0;
    if (candidate.historicalAnalogueCount === 0) {
      evidencePenalty = 100;
    } else if (candidate.historicalAnalogueCount < 3) {
      evidencePenalty = 50;
    }

    const urgencyBonus = candidate.urgencyFired ? 100 : 0;

    const evComponent = 0.35 * evNormalized;
    const pWinComponent = 0.25 * pWinNormalized;
    const tailRiskComponent = 0.20 * tailRiskNormalized;
    const costComponent = 0.10 * costNormalized;
    const evidencePenaltyComponent = 0.05 * evidencePenalty;
    const urgencyBonusComponent = 0.05 * urgencyBonus;

    // Base score is 50 for evaluating adjustments
    let rawScore = 
      50 +
      evComponent +
      pWinComponent -
      tailRiskComponent -
      costComponent -
      evidencePenaltyComponent +
      urgencyBonusComponent;

    const finalScore = parseFloat(Math.min(100, Math.max(0, rawScore)).toFixed(2));

    return {
      ...candidate,
      score: finalScore,
      scoreBreakdown: {
        evComponent: parseFloat(evComponent.toFixed(2)),
        pWinComponent: parseFloat(pWinComponent.toFixed(2)),
        tailRiskComponent: parseFloat(tailRiskComponent.toFixed(2)),
        costComponent: parseFloat(costComponent.toFixed(2)),
        evidencePenalty: parseFloat(evidencePenaltyComponent.toFixed(2)),
        urgencyBonus: parseFloat(urgencyBonusComponent.toFixed(2))
      }
    };
  }

  /**
   * Ranks candidates and decides if top candidate qualifies or results in HOLD.
   */
  public static rankAndSelect(
    candidates: CandidateAdjustment[],
    benchmarks?: { maxEvRef?: number; maxTailRiskRef?: number; maxCostRef?: number }
  ): {
    ranked: ScoredCandidate[];
    chosen: ScoredCandidate | null;
    isHold: boolean;
    decisionRationale: string;
  } {
    if (candidates.length === 0) {
      return {
        ranked: [],
        chosen: null,
        isHold: true,
        decisionRationale: 'No candidate adjustment plays generated; holding position.'
      };
    }

    const scored = candidates.map(c => this.scoreCandidate(c, benchmarks));
    scored.sort((a, b) => b.score - a.score);

    const top = scored[0];
    if (top.score < 40) {
      return {
        ranked: scored,
        chosen: null,
        isHold: true,
        decisionRationale: `Top candidate score (${top.score}/100) is below the threshold of 40. Taking no action / HOLD.`
      };
    }

    return {
      ranked: scored,
      chosen: top,
      isHold: false,
      decisionRationale: `Selected candidate "${top.name}" with top score ${top.score}/100. ${top.rationale}`
    };
  }
}
