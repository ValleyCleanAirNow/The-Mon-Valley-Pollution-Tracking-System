import { computeRisk, riskLevelFor, vulnerabilityFactor, windWeight } from './risk';

describe('client risk mirror', () => {
  it('matches the server formula', () => {
    expect(computeRisk({ pm_cal: 20, w_tox: 1.3, w_wind: 1.3, odor_score: 3, v_user: 1.8 }).score).toBe(82.4);
    expect(riskLevelFor(35.5)).toBe('high');
    expect(windWeight(0)).toBe(1.3);
    expect(vulnerabilityFactor({ asthma: true, copd: true })).toBe(1.8);
  });
});
