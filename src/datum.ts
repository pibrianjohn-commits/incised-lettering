// Datum line: the outline set in towards the middle of each stroke by the
// datum offset. The carver's first chisel cut starts here.
// Offsetting uses the Clipper library, which handles corners and the inner
// edges of counters (the hole in O) correctly.

import ClipperLib from 'clipper-lib';
import { signedArea, simplify, type Contour } from './geometry';

const SCALE = 10000; // Clipper works in integers: 1 unit = 0.1 µm

/**
 * Where a stroke is narrower than twice the offset there is no room for a
 * datum line, and the line simply stops (the carver's rule). Crumbs smaller
 * than this area, left where a stroke only just pinches, are dropped. mm².
 */
const MIN_PIECE_AREA = 0.05;

export function datumLines(contours: Contour[], offsetMm: number): Contour[] {
  // Thin out the outline's points first (to within 2 µm): the offset is much quicker
  // and the result is the same to well under the width of a scribed line.
  const paths = contours.map((c) =>
    simplify([...c, c[0]], 0.002)
      .slice(0, -1)
      .map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })),
  );

  // Tidy the outline first so outer edges and counters have consistent winding.
  const clean: ClipperLib.Paths = [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    clean,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );

  // Inward offset. Round joins give the true offset where the outline turns
  // inwards (e.g. into a serif bracket); outward-pointing corners stay sharp.
  const off = new ClipperLib.ClipperOffset(2, 0.002 * SCALE);
  off.AddPaths(clean, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const result: ClipperLib.Paths = [];
  off.Execute(result, -offsetMm * SCALE);

  return result
    .map((path) => path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE })))
    .filter((c) => Math.abs(signedArea(c)) >= MIN_PIECE_AREA);
}
