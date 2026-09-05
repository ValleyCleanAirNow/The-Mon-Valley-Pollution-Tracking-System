import { pm25ToAqi, truncateToTenth, categoryRank, AQI_COLORS } from '../src/lib/aqi';

describe('pm25ToAqi (2024 breakpoints)', () => {
  it.each([
    [0, 0, 'Good'],
    [4.5, 25, 'Good'],
    [9.0, 50, 'Good'],
    [9.1, 51, 'Moderate'],
    [12.0, 56, 'Moderate'],
    [35.4, 100, 'Moderate'],
    [35.5, 101, 'USG'],
    [42.0, 117, 'USG'],
    [55.4, 150, 'USG'],
    [55.5, 151, 'Unhealthy'],
    [125.4, 200, 'Unhealthy'],
    [125.5, 201, 'Very Unhealthy'],
    [225.4, 300, 'Very Unhealthy'],
    [225.5, 301, 'Hazardous'],
    [325.4, 500, 'Hazardous'],
  ])('maps %s ug/m3 to AQI %s', (conc, aqi, cat) => {
    const r = pm25ToAqi(conc);
    expect(r).not.toBeNull();
    expect(r!.aqi).toBe(aqi);
    const expected = cat === 'USG' ? 'Unhealthy for Sensitive Groups' : cat;
    expect(r!.category).toBe(expected);
  });

  it('truncates rather than rounds before lookup', () => {
    expect(truncateToTenth(9.09)).toBe(9.0);
    expect(pm25ToAqi(9.09)!.category).toBe('Good');
    expect(pm25ToAqi(9.1)!.category).toBe('Moderate');
  });

  it('caps at 500 above the table', () => {
    expect(pm25ToAqi(600)).toEqual({ aqi: 500, category: 'Hazardous' });
  });

  it('rejects negative and non-finite input', () => {
    expect(pm25ToAqi(-1)).toBeNull();
    expect(pm25ToAqi(NaN)).toBeNull();
    expect(pm25ToAqi(Infinity)).toBeNull();
  });

  it('orders categories and has a color for each', () => {
    expect(categoryRank('Good')).toBeLessThan(categoryRank('Unhealthy for Sensitive Groups'));
    expect(categoryRank('Unhealthy for Sensitive Groups')).toBeLessThan(categoryRank('Unhealthy'));
    expect(Object.keys(AQI_COLORS)).toHaveLength(6);
  });
});
