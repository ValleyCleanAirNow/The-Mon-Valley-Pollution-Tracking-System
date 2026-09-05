import { correctPm25, correctPm25Barkjohn, CORRECTION_MODEL } from '../src/lib/correction';

describe('Barkjohn 2021 correction', () => {
  it('applies 0.524*cf1 - 0.0862*RH + 5.75', () => {
    // 0.524*50 - 0.0862*40 + 5.75 = 26.2 - 3.448 + 5.75 = 28.502
    expect(correctPm25Barkjohn(50, 40)).toBeCloseTo(28.502, 3);
  });

  it('floors negative results at zero', () => {
    // 0.524*0 - 0.0862*100 + 5.75 = -2.87
    expect(correctPm25Barkjohn(0, 100)).toBe(0);
  });

  it('returns null when inputs are missing', () => {
    expect(correctPm25Barkjohn(null, 40)).toBeNull();
    expect(correctPm25Barkjohn(10, undefined)).toBeNull();
    expect(correctPm25Barkjohn(NaN, 40)).toBeNull();
  });

  it('dispatches to the base model by default', () => {
    expect(CORRECTION_MODEL).toBe('barkjohn_2021');
    expect(correctPm25(50, 40)).toBeCloseTo(28.502, 3);
  });
});
