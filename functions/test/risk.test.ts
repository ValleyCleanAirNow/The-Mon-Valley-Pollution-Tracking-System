import { computeRisk, riskLevelFor, toxicityAtDistance, toxicityWeight, vulnerabilityFactor, windWeight } from '../src/lib/risk';

describe('VCAN Weighted Risk Index', () => {
  it('equals corrected PM2.5 when all weights are 1 and levels follow EPA 2024 edges', () => {
    expect(computeRisk({ pm_cal: 8, w_tox: 1, w_wind: 1, odor_score: 0, v_user: 1 })).toMatchObject({ score: 8, level: 'low' });
    expect(riskLevelFor(9.1)).toBe('elevated');
    expect(riskLevelFor(35.5)).toBe('high');
    expect(riskLevelFor(55.5)).toBe('severe');
    expect(riskLevelFor(125.5)).toBe('toxic');
    expect(riskLevelFor(null)).toBeNull();
  });
  it('applies the formula [(PM × Wtox × Wwind) + (Odor × Wodor)] × Vuser', () => {
    const r = computeRisk({ pm_cal: 20, w_tox: 1.3, w_wind: 1.3, odor_score: 3, v_user: 1.8 });
    // (20*1.3*1.3 + 3*4) * 1.8 = (33.8 + 12) * 1.8 = 82.44
    expect(r.score).toBe(82.4);
    expect(r.level).toBe('severe');
    expect(computeRisk({ pm_cal: null, w_tox: 1, w_wind: 1, odor_score: 0, v_user: 1 }).level).toBeNull();
  });
  it('wind: stagnant air raises risk, wind lowers it, within bounds', () => {
    expect(windWeight(0)).toBe(1.3);
    expect(windWeight(10)).toBe(1);
    expect(windWeight(20)).toBe(0.7);
    expect(windWeight(40)).toBe(0.7);
    expect(windWeight(null)).toBe(1);
  });
  it('toxicity from permitted pollutants, capped, with distance fade and override', () => {
    const clairton = [{ pollutant: 'PM2.5' }, { pollutant: 'SO2' }, { pollutant: 'NOx' }, { pollutant: 'VOCs' }];
    expect(toxicityWeight(clairton)).toBe(1.3);
    expect(toxicityWeight([{ pollutant: 'PM2.5' }])).toBe(1);
    expect(toxicityWeight(Array(9).fill({ pollutant: 'X' }))).toBe(1.5);
    expect(toxicityWeight(clairton, 1.45)).toBe(1.45);
    expect(toxicityAtDistance(1.3, 0)).toBe(1.3);
    expect(toxicityAtDistance(1.3, 2.5)).toBe(1.15);
    expect(toxicityAtDistance(1.3, 6)).toBe(1);
  });
  it('vulnerability sums health factors and caps at 2', () => {
    expect(vulnerabilityFactor(null)).toBe(1);
    expect(vulnerabilityFactor({ asthma: true })).toBe(1.4);
    expect(vulnerabilityFactor({ asthma: true, copd: true, heartDisease: true, ageSensitive: true, previousHighExposure: true })).toBe(2);
  });
});
