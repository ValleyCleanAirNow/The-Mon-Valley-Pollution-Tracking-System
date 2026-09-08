import { hexCellsInPolygon, hexagon, pointInPolygon } from './hexgrid';

describe('hexgrid', () => {
  const square = [{ lat: 40.0, lng: -80.0 }, { lat: 40.0, lng: -79.95 }, { lat: 40.04, lng: -79.95 }, { lat: 40.04, lng: -80.0 }, { lat: 40.0, lng: -80.0 }];
  it('point in polygon', () => {
    expect(pointInPolygon({ lat: 40.02, lng: -79.97 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 40.1, lng: -79.97 }, square)).toBe(false);
  });
  it('hexagon has six corners around the centre', () => {
    const h = hexagon({ lat: 40, lng: -80 }, 0.3);
    expect(h).toHaveLength(6);
    expect(Math.max(...h.map((p) => p.lat))).toBeGreaterThan(40);
    expect(Math.min(...h.map((p) => p.lng))).toBeLessThan(-80);
  });
  it('fills a ~4 km square with cells and none outside', () => {
    const cells = hexCellsInPolygon(square, 0.25);
    expect(cells.length).toBeGreaterThan(20);
    for (const c of cells) {
      const centre = { lat: (c[0].lat + c[3].lat) / 2, lng: (c[0].lng + c[3].lng) / 2 };
      expect(pointInPolygon(centre, square)).toBe(true);
    }
    expect(hexCellsInPolygon([], 0.25)).toEqual([]);
  });
});
