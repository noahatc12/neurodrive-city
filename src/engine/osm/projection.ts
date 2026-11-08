/**
 * Latitude/longitude → world coordinates with an equirectangular projection centred on
 * the data's bounding box.
 *
 * ```
 *   x =  (lon - lon0) · cos(lat0) · M · k
 *   y = -(lat - lat0) · M · k            (y grows downward, so north is up)
 * ```
 *
 * M = metres per degree of latitude on the WGS84 equator (2πR / 360, R = 6 378 137 m),
 * k = world units per metre (default 10, since 1 unit = 0.1 m). Over a few kilometres
 * the distortion is far below 1%, which the tests verify against the haversine formula.
 *
 * @module engine/osm/projection
 */

export const EARTH_RADIUS_M = 6378137;
export const METERS_PER_DEGREE = (2 * Math.PI * EARTH_RADIUS_M) / 360;
/** World units per metre (1 unit = 0.1 m). */
export const UNITS_PER_METER = 10;

export interface Projection {
  lat0: number;
  lon0: number;
  unitsPerMeter: number;
  project(lat: number, lon: number): { x: number; y: number };
  unproject(x: number, y: number): { lat: number; lon: number };
}

/** Creates a projection centred on (lat0, lon0). */
export function makeProjection(
  lat0: number,
  lon0: number,
  unitsPerMeter = UNITS_PER_METER,
): Projection {
  const cos0 = Math.cos((lat0 * Math.PI) / 180);
  const k = METERS_PER_DEGREE * unitsPerMeter;
  return {
    lat0,
    lon0,
    unitsPerMeter,
    project: (lat, lon) => ({ x: (lon - lon0) * cos0 * k, y: -(lat - lat0) * k }),
    unproject: (x, y) => ({ lat: lat0 - y / k, lon: lon0 + x / (cos0 * k) }),
  };
}

/** Great-circle distance in metres (haversine), used to validate the projection. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number): number => (d * Math.PI) / 180;
  const dLat = r(lat2 - lat1);
  const dLon = r(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}
