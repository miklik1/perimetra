/**
 * SolidModeler — the geometry spine (CORE_SPEC §5). Expands each derived
 * PartPiece (a profile extruded along a posed, mitred axis) into an idealized
 * PieceSolid: role-tagged 3D edges + the section outline both views project from.
 * Pure (I1) and I4-clean — it expands already-baked pieces (profile + pose), the
 * same posture as the R3F walker; it never opens the catalog.
 *
 * Convention (shared.ts): a piece's origin `at` is the START of its axis (local
 * +X); the cross-section is centred on the axis (local Y = `wMm`, local Z = `dMm`).
 * A depth-less profile (flat, h-channel) becomes a planar front face — the front
 * elevation is exact (depth is out-of-plane); side/section know depth is unknown.
 */
import type { DerivationResult, PieceProfile } from "@repo/engine";

import { add, rotate, type Vec3 } from "../shared.js";
import { profileEnvelope, sectionOutline } from "./profile-library.js";
import type { Edge3D, EdgeRole, PieceSolid } from "./types.js";

/** Local box corners in axis space: x∈{0,len}, y∈±halfW, z∈±halfD. Planar
 *  (halfD 0) collapses front/back — only the front loop is emitted. */
function cornerRing(len: number, halfW: number, z: number): Vec3[] {
  return [
    [0, -halfW, z],
    [len, -halfW, z],
    [len, halfW, z],
    [0, halfW, z],
  ];
}

/** The four edges of a corner ring, tagged. Edges 0→1 and 2→3 run ALONG the axis
 *  (swept profile corners = contour); 1→2 and 3→0 are the transverse end faces
 *  (contour, or `mitre` when that end is cut off-square). Keys are canonical
 *  ordinals (I9-stable). */
function ringEdges(
  pieceId: string,
  ring: Vec3[],
  prefix: string,
  hasMitre: { start: boolean; end: boolean },
): Edge3D[] {
  const roleFor = (i: number): EdgeRole => {
    if (i === 1) return hasMitre.end ? "mitre" : "contour"; // far end (x=len)
    if (i === 3) return hasMitre.start ? "mitre" : "contour"; // start end (x=0)
    return "contour"; // 0 and 2 run along the axis
  };
  return ring.map((a, i) => ({
    id: `${pieceId}#${prefix}${i}`,
    role: roleFor(i),
    a,
    b: ring[(i + 1) % 4]!,
  }));
}

/** Build the idealized solids for one derived instance (workshop scope — the
 *  standalone drawing of a leaf). Site sharing/consumed-parts is a site concern. */
export function buildSolids(result: DerivationResult): PieceSolid[] {
  const solids: PieceSolid[] = [];
  for (const part of result.parts) {
    if (part.geometry === undefined) continue;
    const profile: PieceProfile | undefined = part.geometry.profile;
    const { halfW, halfD } = profileEnvelope(profile);
    const deviated = part.deviations !== undefined && part.deviations.length > 0;

    for (const piece of part.geometry.pieces) {
      const pieceId = `${part.path}/${piece.id}`;
      const place = (local: Vec3): Vec3 => add(rotate(local, piece.rotationArcMin), piece.at);
      const hasMitre = {
        start: piece.cutArcMin?.left !== undefined && piece.cutArcMin.left !== 5400,
        end: piece.cutArcMin?.right !== undefined && piece.cutArcMin.right !== 5400,
      };

      const front = cornerRing(piece.lengthMm, halfW, halfD).map(place);
      const edges: Edge3D[] = ringEdges(pieceId, front, "F", hasMitre);

      if (halfD > 0) {
        const back = cornerRing(piece.lengthMm, halfW, -halfD).map(place);
        edges.push(...ringEdges(pieceId, back, "B", hasMitre));
        // Depth ribs connect matching corners — the extrusion length in Z.
        for (let i = 0; i < 4; i++) {
          edges.push({ id: `${pieceId}#R${i}`, role: "longitudinal", a: front[i]!, b: back[i]! });
        }
      }

      solids.push({
        id: pieceId,
        componentCode: part.componentCode,
        name: part.name,
        edges,
        axis: { a: place([0, 0, 0]), b: place([piece.lengthMm, 0, 0]) },
        ...(profile !== undefined && { profile }),
        section: sectionOutline(profile),
        ...(deviated && { deviated: true }),
      });
    }
  }
  return solids;
}
