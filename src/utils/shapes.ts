import * as THREE from 'three'
import * as polygonClipping from 'polygon-clipping'
import ClipperLib from 'clipper-lib'
import { FontLoader, type Font, type FontData } from 'three/examples/jsm/loaders/FontLoader.js'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'

import helvetikerRegular from '@/assets/fonts/helvetiker-regular.js'
import helvetikerBold from '@/assets/fonts/helvetiker-bold.js'
import droidSansRegular from '@/assets/fonts/droid-sans-regular.js'
import optimerRegular from '@/assets/fonts/optimer-regular.js'
import type {
  ArtworkFontFamily,
  ArtworkFontWeight,
  Bounds,
  MultiPolygon,
  Point,
  Ring,
  SvgParseResult,
} from '@/types'

export const MIN_WALL = 1.5
export const MAX_SVG_SIZE = 40
export const MAX_SVG_BYTES = 2 * 1024 * 1024

const CLIPPER_SCALE = 1000
const CIRCLE_SEGMENTS = 96
const SVG_CURVE_SEGMENTS = 40
const POINT_EPSILON = 1e-4
const AREA_EPSILON = 0.01
const TAU = Math.PI * 2
const ITALIC_SKEW_ANGLE = Math.PI / 10
const TEXT_CURVE_SEGMENTS = 16
const SYNTHETIC_BOLD_OFFSET = 0.14

const SVG_ERRORS = {
  tooLarge: 'The SVG is too large. The maximum size is 2 MB.',
  unparsable: 'The SVG could not be parsed. Make sure the file is a valid SVG.',
  noPaths: 'This SVG has no drawable paths. Convert text to outlines before exporting.',
  strokesOnly:
    'This SVG only contains strokes. Convert strokes to filled outlines in your editor and try again.',
  disconnected:
    'This SVG contains disconnected shapes. A keychain needs one connected silhouette.',
  selfIntersecting:
    'The SVG contains self-intersecting paths that could not be resolved.',
} as const

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0))
}

/* -------------------------------------------------------------------------- */
/* Ring and polygon helpers                                                   */
/* -------------------------------------------------------------------------- */

export function signedArea(ring: Ring): number {
  let area = 0
  for (let i = 0, n = ring.length; i < n; i += 1) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

export function cleanRing(ring: Ring): Ring {
  const cleaned: Ring = []
  for (const point of ring) {
    const x = Number(point[0])
    const y = Number(point[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const last = cleaned[cleaned.length - 1]
    if (!last || Math.hypot(x - last[0], y - last[1]) > POINT_EPSILON) {
      cleaned.push([x, y])
    }
  }
  if (cleaned.length > 1) {
    const first = cleaned[0]
    const last = cleaned[cleaned.length - 1]
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= POINT_EPSILON) {
      cleaned.pop()
    }
  }
  return cleaned
}

export function closeRing(ring: Ring): Ring {
  const cleaned = cleanRing(ring)
  if (cleaned.length < 3) return []
  return [...cleaned, [...cleaned[0]]]
}

export function normalizeRing(ring: Ring, ccw = true): Ring {
  const closed = closeRing(ring)
  if (closed.length < 4) return []
  const area = signedArea(closed)
  if ((area > 0) !== ccw) closed.reverse()
  return closed
}

export function multiPolygonArea(multiPolygon: MultiPolygon): number {
  if (!multiPolygon?.length) return 0
  let total = 0
  for (const polygon of multiPolygon) {
    if (!polygon?.length) continue
    total += Math.abs(signedArea(polygon[0]))
    for (let i = 1; i < polygon.length; i += 1) {
      total -= Math.abs(signedArea(polygon[i]))
    }
  }
  return total
}

export function getBounds(multiPolygon: MultiPolygon): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const polygon of multiPolygon) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (!Number.isFinite(minX)) {
    throw new Error('The shape is empty.')
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

export function transformMultiPolygon(
  multiPolygon: MultiPolygon,
  transform: (x: number, y: number) => Point,
): MultiPolygon {
  return multiPolygon.map((polygon) =>
    polygon.map((ring) => ring.map(([x, y]) => transform(x, y))),
  )
}

export function dropTinyPolygons(
  multiPolygon: MultiPolygon,
  minArea = AREA_EPSILON,
): MultiPolygon {
  if (!multiPolygon?.length) return []
  return multiPolygon.filter(
    (polygon) => polygon?.length > 0 && multiPolygonArea([polygon]) > minArea,
  )
}

/* -------------------------------------------------------------------------- */
/* Clipper offsetting                                                         */
/* -------------------------------------------------------------------------- */

function toClipperPath(ring: Ring): { X: number; Y: number }[] {
  const points =
    ring.length > 1 &&
    Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) <
      POINT_EPSILON
      ? ring.slice(0, -1)
      : ring
  return points.map(([x, y]) => ({
    X: Math.round(x * CLIPPER_SCALE),
    Y: Math.round(y * CLIPPER_SCALE),
  }))
}

function fromClipperPath(path: { X: number; Y: number }[]): Ring {
  return closeRing(path.map((point) => [point.X / CLIPPER_SCALE, point.Y / CLIPPER_SCALE]))
}

function offsetRingBy(ring: Ring, signedDistance: number): Ring[] {
  const normalized = normalizeRing(ring, true)
  if (normalized.length < 4) return []
  const magnitude = Math.abs(signedDistance)
  if (magnitude <= 1e-6) return [normalized]

  const originalArea = Math.abs(signedArea(normalized))
  const run = (delta: number): Ring[] => {
    const offsetter = new ClipperLib.ClipperOffset(2, 0.25)
    offsetter.AddPath(
      toClipperPath(normalized),
      ClipperLib.JoinType.jtRound,
      ClipperLib.EndType.etClosedPolygon,
    )
    const solution = new ClipperLib.Paths()
    offsetter.Execute(solution, delta)
    return solution.map(fromClipperPath).filter((result: Ring) => result.length >= 4)
  }

  const direction = signedDistance > 0 ? 1 : -1
  let result = run(direction * magnitude * CLIPPER_SCALE)
  const resultArea = result.reduce((sum, item) => sum + Math.abs(signedArea(item)), 0)
  const grew = resultArea > originalArea + 1e-6
  const shrank = resultArea < originalArea - 1e-6
  if ((direction > 0 && !grew) || (direction < 0 && !shrank)) {
    result = run(-direction * magnitude * CLIPPER_SCALE)
  }
  return result
}

export function offsetOuterRingsInward(outerRings: Ring[], distance: number): Ring[] {
  if (distance <= 0) return outerRings.map(closeRing)
  const result: Ring[] = []
  for (const ring of outerRings) {
    result.push(...offsetRingBy(ring, -distance))
  }
  return result
}

/**
 * Grows a filled MultiPolygon by `distance`, shrinking any counter holes. Used
 * to synthesize a bold weight for fonts that do not ship a bold face.
 */
export function offsetMultiPolygonOutward(
  multiPolygon: MultiPolygon,
  distance: number,
): MultiPolygon {
  if (distance <= 0 || !multiPolygon.length) return multiPolygon

  const paths: { X: number; Y: number }[][] = []
  for (const polygon of multiPolygon) {
    if (!polygon?.length) continue
    const outer = normalizeRing(polygon[0], true)
    if (outer.length >= 4) paths.push(toClipperPath(outer))
    for (let i = 1; i < polygon.length; i += 1) {
      const hole = normalizeRing(polygon[i], false)
      if (hole.length >= 4) paths.push(toClipperPath(hole))
    }
  }
  if (!paths.length) return multiPolygon

  try {
    const offsetter = new ClipperLib.ClipperOffset(2, 0.25)
    offsetter.AddPaths(
      paths,
      ClipperLib.JoinType.jtRound,
      ClipperLib.EndType.etClosedPolygon,
    )
    const tree = new ClipperLib.PolyTree()
    offsetter.Execute(tree, distance * CLIPPER_SCALE)

    const polygons: MultiPolygon = []
    const walk = (node: any) => {
      const contour = node.Contour()
      if (contour && contour.length >= 3) {
        const ring = fromClipperPath(contour)
        if (ring.length >= 4) {
          if (node.IsHole()) {
            if (polygons.length) polygons[polygons.length - 1].push(ring)
          } else {
            polygons.push([ring])
          }
        }
      }
      for (const child of node.Childs()) walk(child)
    }

    for (const child of tree.Childs()) walk(child)

    return polygons.length ? polygons : multiPolygon
  } catch {
    return multiPolygon
  }
}

function clipperBoolean(
  subjectPaths: { X: number; Y: number }[][],
  clipPaths: { X: number; Y: number }[][],
  clipType: number,
): { X: number; Y: number }[][] {
  const clipper = new ClipperLib.Clipper()
  if (subjectPaths.length) {
    clipper.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true)
  }
  if (clipPaths.length) {
    clipper.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true)
  }
  const solution = new ClipperLib.Paths()
  const ok = clipper.Execute(
    clipType,
    solution,
    ClipperLib.PolyFillType.pftEvenOdd,
    ClipperLib.PolyFillType.pftEvenOdd,
  )
  if (!ok) return []
  return solution.filter((path: { X: number; Y: number }[]) => path.length >= 3)
}

function clipperPathsToMultiPolygon(paths: { X: number; Y: number }[][]): MultiPolygon {
  const multiPolygon: MultiPolygon = []
  for (const path of paths) {
    const ring = fromClipperPath(path)
    if (ring.length < 4) continue
    const polygon = [ring]
    if (multiPolygonArea([polygon]) > 0.02) {
      multiPolygon.push(polygon)
    }
  }
  return multiPolygon
}

/**
 * Morphological closing (grow then shrink) rounds the concave corners where
 * the lug meets the body. Only material added inside a small box around the
 * lug base is kept, so the rest of the silhouette is untouched.
 */
export function smoothTabJunction({
  silhouette,
  tabAnchorX,
  bodyTop,
  tabWidth,
  tabOverlap,
  blendRadius,
  bodyHoles,
}: {
  silhouette: MultiPolygon
  tabAnchorX: number
  bodyTop: number
  tabWidth: number
  tabOverlap: number
  blendRadius: number
  bodyHoles: Ring[]
}): MultiPolygon {
  if (!blendRadius || blendRadius < 0.1 || !silhouette.length) {
    return silhouette
  }

  const radius = clamp(blendRadius, 0, 6)
  const silhouettePaths = silhouette.map((polygon) => toClipperPath(polygon[0]))

  const expandedPaths: { X: number; Y: number }[][] = []
  for (const polygon of silhouette) {
    expandedPaths.push(...offsetRingBy(polygon[0], radius).map((ring) => toClipperPath(ring)))
  }
  if (!expandedPaths.length) return silhouette

  const closedPaths: { X: number; Y: number }[][] = []
  for (const path of expandedPaths) {
    closedPaths.push(
      ...offsetRingBy(fromClipperPath(path), -radius).map((ring) => toClipperPath(ring)),
    )
  }
  if (!closedPaths.length) return silhouette

  let patchPaths = clipperBoolean(closedPaths, silhouettePaths, ClipperLib.ClipType.ctDifference)
  if (!patchPaths.length) return silhouette

  const halfBox = tabWidth / 2 + radius + 2
  const bottom = bodyTop - tabOverlap - radius - 2
  const top = bodyTop + radius + 2
  const boxRing = normalizeRing(
    [
      [tabAnchorX - halfBox, bottom],
      [tabAnchorX + halfBox, bottom],
      [tabAnchorX + halfBox, top],
      [tabAnchorX - halfBox, top],
    ],
    true,
  )

  patchPaths = clipperBoolean(
    patchPaths,
    [toClipperPath(boxRing)],
    ClipperLib.ClipType.ctIntersection,
  )
  if (!patchPaths.length) return silhouette

  if (bodyHoles.length) {
    patchPaths = clipperBoolean(
      patchPaths,
      bodyHoles.map((hole) => toClipperPath(hole)),
      ClipperLib.ClipType.ctDifference,
    )
    if (!patchPaths.length) return silhouette
  }

  const resultPaths = clipperBoolean(
    silhouettePaths,
    patchPaths,
    ClipperLib.ClipType.ctUnion,
  )
  const result = clipperPathsToMultiPolygon(resultPaths)
  return result.length ? result : silhouette
}

/* -------------------------------------------------------------------------- */
/* Boolean wrappers                                                           */
/* -------------------------------------------------------------------------- */

export function safeUnion(...geometries: MultiPolygon[]): MultiPolygon {
  const valid = geometries.filter((geometry) => geometry?.length)
  if (!valid.length) return []
  try {
    return polygonClipping.union(valid[0], ...valid.slice(1)) as MultiPolygon
  } catch {
    throw new Error('The shape could not be merged. Try a simpler SVG or different dimensions.')
  }
}

export function safeDifference(subject: MultiPolygon, ...clippers: MultiPolygon[]): MultiPolygon {
  const valid = clippers.filter((geometry) => geometry?.length)
  if (!valid.length) return subject
  try {
    return polygonClipping.difference(subject, ...valid) as MultiPolygon
  } catch {
    throw new Error('The shape could not be cut. Try a simpler SVG or different dimensions.')
  }
}

export function safeIntersection(subject: MultiPolygon, ...geometries: MultiPolygon[]): MultiPolygon {
  const valid = geometries.filter((geometry) => geometry?.length)
  if (!valid.length) return []
  try {
    return polygonClipping.intersection(subject, ...valid) as MultiPolygon
  } catch {
    return []
  }
}

/* -------------------------------------------------------------------------- */
/* THREE.Shape <-> MultiPolygon                                                */
/* -------------------------------------------------------------------------- */

export function shapeToMultiPolygon(
  shape: THREE.Shape,
  curveSegments = SVG_CURVE_SEGMENTS,
): MultiPolygon {
  const points = shape.extractPoints(curveSegments)
  const outer = closeRing(points.shape.map((point) => [point.x, point.y]))
  if (outer.length < 4) throw new Error('The base shape is degenerate.')
  const holes = points.holes
    .map((hole) => closeRing(hole.map((point) => [point.x, point.y])))
    .filter((hole) => hole.length >= 4)
  return [[outer, ...holes]]
}

export function multiPolygonToShapes(multiPolygon: MultiPolygon): THREE.Shape[] {
  const shapes: THREE.Shape[] = []
  for (const polygon of multiPolygon) {
    if (!polygon?.length) continue
    const outer = normalizeRing(polygon[0], true)
    if (outer.length < 4) continue

    const shape = new THREE.Shape(
      outer.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y)),
    )

    for (let i = 1; i < polygon.length; i += 1) {
      const hole = normalizeRing(polygon[i], false)
      if (hole.length < 4) continue
      shape.holes.push(
        new THREE.Path(hole.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y))),
      )
    }

    shapes.push(shape)
  }
  return shapes
}

/* -------------------------------------------------------------------------- */
/* Primitive shapes                                                           */
/* -------------------------------------------------------------------------- */

export function createCircleShape(diameter: number): THREE.Shape {
  const radius = Math.max(0.1, diameter / 2)
  const shape = new THREE.Shape()
  shape.absarc(0, 0, radius, 0, TAU, false)
  return shape
}

export function createSquareShape(
  width: number,
  height: number,
  cornerRadius: number,
): THREE.Shape {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const radius = clamp(cornerRadius, 0, Math.min(w, h) / 2 - 0.001)
  const halfWidth = w / 2
  const halfHeight = h / 2
  const shape = new THREE.Shape()

  shape.moveTo(-halfWidth + radius, -halfHeight)
  shape.lineTo(halfWidth - radius, -halfHeight)
  if (radius > 0) {
    shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + radius)
  }
  shape.lineTo(halfWidth, halfHeight - radius)
  if (radius > 0) {
    shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radius, halfHeight)
  }
  shape.lineTo(-halfWidth + radius, halfHeight)
  if (radius > 0) {
    shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - radius)
  }
  shape.lineTo(-halfWidth, -halfHeight + radius)
  if (radius > 0) {
    shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + radius, -halfHeight)
  }

  return shape
}

/**
 * Heart curve with the exact parametric formula requested by the design spec:
 *
 *   x = 16 sin^3(t)
 *   y = -(13 cos(t) - 5 cos(2t) - 2 cos(3t) - cos(4t))
 *
 * The raw curve is scaled by `size * 0.075` and then centred on the origin.
 */
export function createHeartShape(size: number): THREE.Shape {
  const scale = Math.max(0.1, size) * 0.075
  const points: THREE.Vector2[] = []
  for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
    const t = (TAU * i) / CIRCLE_SEGMENTS
    const x = 16 * Math.sin(t) ** 3
    const y = -(
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t)
    )
    points.push(new THREE.Vector2(x * scale, y * scale))
  }

  const box = new THREE.Box2().setFromPoints(points)
  const center = box.getCenter(new THREE.Vector2())
  for (const point of points) point.sub(center)

  return new THREE.Shape(points)
}

export function createStarRing(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius = outerRadius * 0.45,
  points = 5,
): Ring {
  const ring: Ring = []
  const total = points * 2
  for (let i = 0; i < total; i += 1) {
    const angle = (TAU * i) / total - Math.PI / 2
    const radius = i % 2 === 0 ? outerRadius : innerRadius
    ring.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius])
  }
  return normalizeRing(ring, true)
}

export function createStarShape(size: number): THREE.Shape {
  const ring = createStarRing(0, 0, Math.max(0.1, size) / 2, Math.max(0.1, size) * 0.225, 5)
  return new THREE.Shape(ring.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y)))
}

/* -------------------------------------------------------------------------- */
/* Text artwork                                                               */
/* -------------------------------------------------------------------------- */

const FONT_SOURCES: Record<ArtworkFontFamily, unknown> = {
  helvetiker: helvetikerRegular,
  'droid-sans': droidSansRegular,
  optimer: optimerRegular,
}

const fontCache = new Map<string, Font>()

function getFont(family: ArtworkFontFamily, weight: ArtworkFontWeight): Font {
  const key = `${family}:${weight}`
  const cached = fontCache.get(key)
  if (cached) return cached

  const source =
    family === 'helvetiker' && weight === 'bold'
      ? helvetikerBold
      : FONT_SOURCES[family]
  const font = new FontLoader().parse(source as FontData)
  fontCache.set(key, font)
  return font
}

/**
 * Converts text to a 2D MultiPolygon. Italic is a fake oblique shear:
 *
 *   x' = x + y * tan(PI / 10)
 *
 * Bold uses the bundled Helvetiker Bold face when available and a synthetic
 * outline offset for the other families.
 */
export function createTextArtwork(
  text: string,
  size: number,
  {
    fontFamily = 'helvetiker',
    fontWeight = 'regular',
    isItalic = false,
  }: {
    fontFamily?: ArtworkFontFamily
    fontWeight?: ArtworkFontWeight
    isItalic?: boolean
  } = {},
): MultiPolygon | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  let shapes: THREE.Shape[]
  try {
    shapes = getFont(fontFamily, fontWeight).generateShapes(
      trimmed,
      Math.max(1, size),
    )
  } catch {
    throw new Error('The back text could not be converted to outlines.')
  }

  const polygons: MultiPolygon[] = []
  for (const shape of shapes) {
    try {
      polygons.push(shapeToMultiPolygon(shape, TEXT_CURVE_SEGMENTS))
    } catch {
      // Spaces and empty glyphs produce no usable outline.
    }
  }
  if (!polygons.length) return null

  let artwork = safeUnion(...polygons)

  if (fontWeight === 'bold' && fontFamily !== 'helvetiker') {
    artwork = offsetMultiPolygonOutward(artwork, SYNTHETIC_BOLD_OFFSET)
  }

  if (isItalic) {
    const shear = Math.tan(ITALIC_SKEW_ANGLE)
    artwork = transformMultiPolygon(artwork, (x, y) => [x + y * shear, y])
  }
  return dropTinyPolygons(artwork)
}

/* -------------------------------------------------------------------------- */
/* SVG parsing                                                                */
/* -------------------------------------------------------------------------- */

interface SvgPathStyle {
  fill?: string
  stroke?: string
  visibility?: string
  display?: string
}

function extractSvgPolygons(svgText: string): MultiPolygon {
  // SVGLoader is lenient: it happily returns zero paths for arbitrary text.
  // Validate the document first so non-SVG uploads report the parse error.
  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    if (
      doc.getElementsByTagName('parsererror').length > 0 ||
      doc.documentElement?.nodeName.toLowerCase() !== 'svg'
    ) {
      throw new Error(SVG_ERRORS.unparsable)
    }
  } catch {
    throw new Error(SVG_ERRORS.unparsable)
  }

  let data: ReturnType<SVGLoader['parse']>
  try {
    data = new SVGLoader().parse(svgText)
  } catch {
    throw new Error(SVG_ERRORS.unparsable)
  }

  if (!data.paths?.length) {
    throw new Error(SVG_ERRORS.noPaths)
  }

  const polygons: MultiPolygon[] = []
  let strokeOnlyPaths = 0

  for (const path of data.paths) {
    const style = (path.userData.style ?? {}) as SvgPathStyle
    if (style.visibility === 'hidden' || style.display === 'none') continue
    if (style.fill === 'none') {
      strokeOnlyPaths += 1
      continue
    }

    let shapes: THREE.Shape[]
    try {
      shapes = path.toShapes()
    } catch {
      continue
    }

    for (const shape of shapes) {
      try {
        const points = shape.extractPoints(SVG_CURVE_SEGMENTS)
        const outer = closeRing(points.shape.map((point) => [point.x, -point.y]))
        if (outer.length < 4) continue
        const holes = points.holes
          .map((hole) => closeRing(hole.map((point) => [point.x, -point.y])))
          .filter((hole) => hole.length >= 4)
        polygons.push([[outer, ...holes]])
      } catch {
        continue
      }
    }
  }

  if (!polygons.length) {
    if (strokeOnlyPaths > 0) throw new Error(SVG_ERRORS.strokesOnly)
    throw new Error(SVG_ERRORS.noPaths)
  }

  let combined: MultiPolygon
  try {
    combined = polygonClipping.union(polygons[0], ...polygons.slice(1)) as MultiPolygon
  } catch {
    throw new Error(SVG_ERRORS.selfIntersecting)
  }

  if (!combined?.length) throw new Error(SVG_ERRORS.noPaths)
  return combined
}

function fitMultiPolygon(multiPolygon: MultiPolygon, maxSize: number): SvgParseResult {
  const bounds = getBounds(multiPolygon)
  if (bounds.width < 0.01 || bounds.height < 0.01) {
    throw new Error('The SVG is too small to generate geometry.')
  }

  const scale = Math.min(maxSize / bounds.width, maxSize / bounds.height)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2

  const fitted = transformMultiPolygon(multiPolygon, (x, y) => [
    (x - centerX) * scale,
    (y - centerY) * scale,
  ])
  const fittedBounds = getBounds(fitted)

  return {
    artwork: fitted,
    size: { width: fittedBounds.width, height: fittedBounds.height },
    source: { width: bounds.width, height: bounds.height, scale },
  }
}

/**
 * Parses a filled SVG into a Y-up, millimetre-scale MultiPolygon centred on the
 * origin. Disconnected artwork pieces are allowed (for logos).
 */
export function parseSvgToArtwork(svgText: string, maxSize = MAX_SVG_SIZE): SvgParseResult {
  if (new TextEncoder().encode(svgText).length > MAX_SVG_BYTES) {
    throw new Error(SVG_ERRORS.tooLarge)
  }
  return fitMultiPolygon(extractSvgPolygons(svgText), maxSize)
}

/**
 * Parses a filled SVG that must be a single connected silhouette. Used for the
 * custom keychain body.
 */
export function parseSvgToBody(svgText: string, maxSize = MAX_SVG_SIZE): SvgParseResult {
  const result = parseSvgToArtwork(svgText, maxSize)
  if (result.artwork.length > 1) {
    throw new Error(SVG_ERRORS.disconnected)
  }
  return result
}
