/**
 * Hexagon tessellation of a lat/lng polygon, for drawing risk zones as
 * "dynamic hexagon zones". Pure geometry; sizes in km.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

const KM_PER_DEG_LAT = 111.32;

function kmPerDegLng(lat: number): number {
  return KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

export function pointInPolygon(p: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat, xj = polygon[j].lng, yj = polygon[j].lat;
    const intersects = (yi > p.lat) !== (yj > p.lat) && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Six corners of a flat-top hexagon centred at c with circumradius rKm. */
export function hexagon(c: LatLng, rKm: number): LatLng[] {
  const dLat = rKm / KM_PER_DEG_LAT;
  const dLng = rKm / kmPerDegLng(c.lat);
  const pts: LatLng[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts.push({ lat: c.lat + dLat * Math.sin(a), lng: c.lng + dLng * Math.cos(a) });
  }
  return pts;
}

/**
 * Hexagons (flat-top, circumradius rKm) whose centres lie inside `polygon`.
 * Returns each cell as its six corners. Empty for degenerate input.
 */
export function hexCellsInPolygon(polygon: LatLng[], rKm: number): LatLng[][] {
  if (polygon.length < 3 || rKm <= 0) return [];
  const lats = polygon.map((p) => p.lat), lngs = polygon.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const w = 1.5 * rKm; // horizontal step, km
  const h = Math.sqrt(3) * rKm; // vertical step, km
  const dLatRow = h / KM_PER_DEG_LAT;
  const dLngCol = w / kmPerDegLng(midLat);
  const cells: LatLng[][] = [];
  let col = 0;
  for (let lng = minLng; lng <= maxLng + dLngCol; lng += dLngCol, col++) {
    const offset = col % 2 === 0 ? 0 : dLatRow / 2;
    for (let lat = minLat - dLatRow; lat <= maxLat + dLatRow; lat += dLatRow) {
      const c = { lat: lat + offset, lng };
      if (pointInPolygon(c, polygon)) cells.push(hexagon(c, rKm));
    }
  }
  return cells;
}
