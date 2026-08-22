import { describe, it, expect } from 'vitest';
import { CandidateScorer, CandidateAdjustment } from '../src/scorer.js';

describe('CandidateScorer', () => {
  const strongCandidate: CandidateAdjustment = {
    name: 'Roll Short Call Up',
    type: 'ROLL_SHORT',
    description: 'Roll 24500 CE to 24800 CE',
    rationale: 'Relieves gamma pressure',
    evImprovement: 12000,
    pImprovement: 0.75,
    tailRisk: 5000,
    cost: 2000,
    historicalAnalogueCount: 5, // No penalty
    urgencyFired: true // +5 bonus
  };

  const weakCandidate: CandidateAdjustment = {
    name: 'Exotic Multi-Wing Conversion',
    type: 'CONVERT_STRUCTURE',
    description: 'Complex hedge',
    rationale: 'Uncertain hedge',
    evImprovement: 1000,
    pImprovement: 0.30,
    tailRisk: 40000,
    cost: 22000,
    historicalAnalogueCount: 0, // -5 penalty
    urgencyFired: false
  };

  it('should score high for strong candidates with high EV and evidence', () => {
    const res = CandidateScorer.scoreCandidate(strongCandidate);
    expect(res.score).toBeGreaterThan(60);
    expect(res.scoreBreakdown.evidencePenalty).toBe(0);
    expect(res.scoreBreakdown.urgencyBonus).toBe(5);
  });

  it('should penalize zero-evidence candidates', () => {
    const res = CandidateScorer.scoreCandidate(weakCandidate);
    expect(res.scoreBreakdown.evidencePenalty).toBe(5);
    expect(res.score).toBeLessThan(40);
  });

  it('should trigger HOLD if all candidate scores are below 40', () => {
    const decision = CandidateScorer.rankAndSelect([weakCandidate]);
    expect(decision.isHold).toBe(true);
    expect(decision.chosen).toBeNull();
    expect(decision.decisionRationale).toContain('below the threshold of 40');
  });

  it('should rank and select the best candidate above 40', () => {
    const decision = CandidateScorer.rankAndSelect([weakCandidate, strongCandidate]);
    expect(decision.isHold).toBe(false);
    expect(decision.chosen?.name).toBe('Roll Short Call Up');
    expect(decision.ranked[0].score).toBeGreaterThan(decision.ranked[1].score);
  });
});
