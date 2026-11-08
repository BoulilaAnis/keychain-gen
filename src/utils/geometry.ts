import * as THREE from 'three'

import type {
  Bounds,
  HoleShape,
  KeychainBuildResult,
  KeychainLayer,
  KeychainState,
  MultiPolygon,
  PocketShape,
  Point,
  Ring,
} from '@/types'
import {
  MIN_WALL,
  clamp,
  createCircleShape,
  createHeartShape,
  createSquareShape,
  createStarShape,
  dropTinyPolygons,
  getBounds,
  multiPolygonToShapes,
  normalizeRing,
  offsetOuterRingsInward,
  safeDifference,
  safeIntersection,
  safeUnion,
  shapeToMultiPolygon,
  smoothTabJunction,
} from './shapes'

const POCKET_MARGIN = 1.2
const MIN_FLOOR = 0.8
const LUG_OVERLAP_MAX = 2.5
const TAB_CAP_SEGMENTS = 40
const CIRCLE_SEGMENTS = 96

interface LugGeometry {
  outer: Ring
  hole: MultiPolygon
  anchorX: number
  capCenterY: number
}

interface LugOptions {
  anchorX: number
  bodyTop: number
  lugWidth: number
  tabLength: number
  tabOverlap: number
  holeDiameter: number
  holeShape: HoleShape
  holeCustomShape: MultiPolygon | null
}

function findTopAnchor(body: MultiPolygon): Point {
  let maxY = -Infinity
  for (const polygon of body) {
    for (const ring of polygon) {
      for (const [, y] of ring) {
        if (y > maxY) maxY = y
      }
    }
  }

  let sumX = 0
  let count = 0
  for (const polygon of body) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (y >= maxY - 0.75) {
          sumX += x
          count += 1
        }
      }
    }
  }

  return [count > 0 ? sumX / count : 0, maxY]
}

function buildLug({
  anchorX,
  bodyTop,
  lugWidth,
  tabLength,
  tabOverlap,
  holeDiameter,
  holeShape,
  holeCustomShape,
}: LugOptions): LugGeometry {
  const halfWidth = lugWidth / 2
  const capCenterY = bodyTop + tabLength - halfWidth
  const bottomY = bodyTop - tabOverlap

  const tabPoints: Ring = [
    [anchorX - halfWidth, bottomY],
    [anchorX - halfWidth, capCenterY],
  ]

  for (let i = 0; i <= TAB_CAP_SEGMENTS; i += 1) {
    const angle = Math.PI - (Math.PI * i) / TAB_CAP_SEGMENTS
    tabPoints.push([
      anchorX + Math.cos(angle) * halfWidth,
      capCenterY + Math.sin(angle) * halfWidth,
    ])
  }

  tabPoints.push([anchorX + halfWidth, bottomY])

  // Every hole shape is fitted inside the cap's inscribed circle so the
  // minimum wall is preserved all the way around the lug. A custom SVG shape
  // is scaled to the requested hole size and centred on the cap.
  const hole = createShapeCutout(
    holeShape,
    holeDiameter,
    anchorX,
    capCenterY,
    holeDiameter / 2,
    undefined,
    holeCustomShape,
  )

  return {
    outer: normalizeRing(tabPoints, true),
    hole,
    anchorX,
    capCenterY,
  }
}

function fitToSize(multiPolygon: MultiPolygon, targetSize: number): MultiPolygon {
  const bounds = getBounds(multiPolygon)
  const scale = targetSize / Math.max(bounds.width, bounds.height, 0.001)
  return multiPolygon.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y]) => [x * scale, y * scale] as Point),
    ),
  )
}

/** Scales a centred cutout so its furthest point sits on `radius`. */
function fitToRadius(multiPolygon: MultiPolygon, radius: number): MultiPolygon {
  let maxRadius = 0
  for (const polygon of multiPolygon) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        maxRadius = Math.max(maxRadius, Math.hypot(x, y))
      }
    }
  }
  if (maxRadius < 0.001) return multiPolygon
  const scale = radius / maxRadius
  return multiPolygon.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y]) => [x * scale, y * scale] as Point),
    ),
  )
}

function createShapeCutout(
  shape: Exclude<PocketShape, 'none'>,
  size: number,
  centerX: number,
  centerY: number,
  maxRadius?: number,
  radius?: number,
  customPolygon?: MultiPolygon | null,
): MultiPolygon {
  let cutout: MultiPolygon
  switch (shape) {
    case 'circle':
      cutout = shapeToMultiPolygon(createCircleShape(size), CIRCLE_SEGMENTS)
      break
    case 'square':
      cutout = shapeToMultiPolygon(
        createSquareShape(size, size, radius ?? size * 0.14),
        64,
      )
      break
    case 'heart':
      cutout = fitToSize(shapeToMultiPolygon(createHeartShape(size), 64), size)
      break
    case 'star':
      cutout = fitToSize(shapeToMultiPolygon(createStarShape(size), 48), size)
      break
    case 'custom':
      cutout = customPolygon?.length
        ? customPolygon
        : shapeToMultiPolygon(createCircleShape(size), CIRCLE_SEGMENTS)
      break
  }

  if (shape === 'custom') {
    cutout = fitToSize(cutout, size)
  } else if (maxRadius && maxRadius > 0) {
    cutout = fitToRadius(cutout, maxRadius)
  }

  return cutout.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y]) => [x + centerX, y + centerY] as Point),
    ),
  )
}

/**
 * Places artwork on the back face. The X axis is mirrored so the engraving
 * reads correctly when the keychain is turned over.
 */
function placeArtwork(
  artwork: MultiPolygon,
  body: MultiPolygon,
  bodyBounds: Bounds,
  targetSize: number,
  offsetX = 0,
  offsetY = 0,
): MultiPolygon | null {
  const artworkBounds = getBounds(artwork)
  if (artworkBounds.width < 0.01 || artworkBounds.height < 0.01) return null

  const maxWidth = Math.max(8, bodyBounds.width * 0.85)
  const maxHeight = Math.max(8, bodyBounds.height * 0.85)
  const desired = clamp(targetSize, 2, Math.min(maxWidth, maxHeight))
  const scale = Math.min(
    desired / Math.max(artworkBounds.width, artworkBounds.height),
    maxWidth / artworkBounds.width,
    maxHeight / artworkBounds.height,
  )
  if (!Number.isFinite(scale) || scale <= 0.001) return null

  const sourceCenterX = (artworkBounds.minX + artworkBounds.maxX) / 2
  const sourceCenterY = (artworkBounds.minY + artworkBounds.maxY) / 2
  const targetX = (bodyBounds.minX + bodyBounds.maxX) / 2
  const targetY = (bodyBounds.minY + bodyBounds.maxY) / 2

  // Offsets are expressed in the back view: +X moves the engraving to the
  // viewer's right once the keychain is flipped, +Y moves it up. The artwork
  // itself is mirrored on X, so the horizontal offset is subtracted.
  const maxOffsetX = Math.max(0, bodyBounds.width / 2 - 2)
  const maxOffsetY = Math.max(0, bodyBounds.height / 2 - 2)
  const shiftX = clamp(offsetX, -maxOffsetX, maxOffsetX)
  const shiftY = clamp(offsetY, -maxOffsetY, maxOffsetY)

  const placed = artwork.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y]) => {
        const mirroredX = targetX - (x - sourceCenterX) * scale - shiftX
        const placedY = targetY + (y - sourceCenterY) * scale + shiftY
        return [mirroredX, placedY] as Point
      }),
    ),
  )

  const outerRings = body.map((polygon) => polygon[0])
  const insetRings = offsetOuterRingsInward(outerRings, 1)
  let safeRegion: MultiPolygon = insetRings.length
    ? insetRings.map((ring) => [ring])
    : body

  const holes = body.flatMap((polygon) => polygon.slice(1))
  if (holes.length) {
    safeRegion = safeDifference(
      safeRegion,
      ...holes.map((hole) => [[hole]] as MultiPolygon),
    )
  }

  const clipped = dropTinyPolygons(safeIntersection(placed, safeRegion), 0.02)
  return clipped.length ? clipped : null
}

function createLayer(
  name: string,
  multiPolygon: MultiPolygon,
  depth: number,
  z: number,
): KeychainLayer | null {
  const shapes = multiPolygonToShapes(multiPolygon)
  if (!shapes.length) return null

  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 32,
  })
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return {
    id: `${name}-${z.toFixed(3)}-${depth.toFixed(3)}`,
    name,
    geometry,
    z,
    depth,
  }
}

export function buildKeychainLayers(
  state: KeychainState,
  svgBody: MultiPolygon | null,
  artwork: MultiPolygon | null,
): KeychainBuildResult {
  const shapeType = state.shapeType
  let body: MultiPolygon

  if (shapeType === 'circle') {
    const diameter = clamp(state.sizeDiameter, 15, 100)
    body = shapeToMultiPolygon(createCircleShape(diameter), CIRCLE_SEGMENTS)
  } else if (shapeType === 'square') {
    const width = clamp(state.sizeWidth, 15, 100)
    const height = clamp(state.sizeHeight, 15, 100)
    body = shapeToMultiPolygon(
      createSquareShape(width, height, state.cornerRadius),
      96,
    )
  } else {
    if (!svgBody?.length) {
      throw new Error('Upload an SVG file to generate a custom keychain.')
    }
    body = svgBody
  }

  if (body.length !== 1) {
    throw new Error('The base shape must be a single connected silhouette.')
  }

  const bodyBounds = getBounds(body)
  const outerRings = body.map((polygon) => polygon[0])
  const bodyHoles = body.flatMap((polygon) => polygon.slice(1))

  const baseThickness = clamp(state.baseThickness, 1.2, 8)
  const lugWidth = clamp(state.lugWidth, 8, 30)
  const holeDiameter = clamp(
    state.holeDiameter,
    2,
    Math.max(2, lugWidth - 2 * MIN_WALL),
  )
  const halfLug = lugWidth / 2
  const holeRadius = holeDiameter / 2
  const tabLength = halfLug + holeRadius + MIN_WALL + 1.5
  const tabOverlap = Math.min(
    LUG_OVERLAP_MAX,
    Math.max(1, bodyBounds.height * 0.12),
  )
  const [anchorX, bodyTop] = findTopAnchor(body)

  const lug = buildLug({
    anchorX,
    bodyTop,
    lugWidth,
    tabLength,
    tabOverlap,
    holeDiameter,
    holeShape: state.holeShape,
    holeCustomShape: state.holeCustomShape,
  })

  const blendRadius = Math.min(3, Math.max(1, lugWidth * 0.16))
  const outerSilhouette = safeUnion(
    outerRings.map((ring) => [ring]),
    [[lug.outer]],
  )

  if (outerSilhouette.length !== 1) {
    throw new Error(
      'The keyring lug could not connect to this silhouette. Try a wider lug or a different SVG.',
    )
  }

  const smoothed = smoothTabJunction({
    silhouette: outerSilhouette,
    tabAnchorX: lug.anchorX,
    bodyTop,
    tabWidth: lugWidth,
    tabOverlap,
    blendRadius,
    bodyHoles,
  })

  let baseRegion = safeDifference(
    smoothed,
    lug.hole,
    ...bodyHoles.map((hole) => [[hole]] as MultiPolygon),
  )
  if (!baseRegion.length) {
    baseRegion = safeDifference(
      outerSilhouette,
      lug.hole,
      ...bodyHoles.map((hole) => [[hole]] as MultiPolygon),
    )
  }
  if (!baseRegion.length) {
    throw new Error('The base shape is empty.')
  }

  const artworkRegion = artwork?.length
    ? placeArtwork(
        artwork,
        body,
        bodyBounds,
        state.artworkSize,
        state.artworkOffsetX,
        state.artworkOffsetY,
      )
    : null

  const maxEngraveDepth = Math.max(0.1, baseThickness - MIN_FLOOR)
  const engraveDepth = artworkRegion
    ? clamp(state.artworkDepth, 0.1, maxEngraveDepth)
    : 0

  const maxPocketDepth = Math.max(0, baseThickness - engraveDepth - MIN_FLOOR)
  const pocketRequested =
    state.pocketShape !== 'none' &&
    state.pocketSize > 1 &&
    state.pocketDepth > 0.05
  const pocketDepth = pocketRequested
    ? clamp(state.pocketDepth, 0.1, maxPocketDepth)
    : 0

  let pocketArea: MultiPolygon | null = null
  if (pocketRequested && pocketDepth > 0.05 && state.pocketShape !== 'none') {
    const centerX = (bodyBounds.minX + bodyBounds.maxX) / 2
    const centerY = (bodyBounds.minY + bodyBounds.maxY) / 2
    const maxPocketSize = Math.min(bodyBounds.width, bodyBounds.height) * 0.8
    const pocketSize = clamp(state.pocketSize, 2, maxPocketSize)
    const cutout = createShapeCutout(
      state.pocketShape,
      pocketSize,
      centerX,
      centerY,
      undefined,
      state.pocketShape === 'square'
        ? Math.min(Math.max(0, state.pocketCornerRadius), pocketSize * 0.25)
        : undefined,
      state.pocketCustomShape,
    )

    if (cutout?.length) {
      const insetRings = offsetOuterRingsInward(outerRings, POCKET_MARGIN)
      let safeRegion: MultiPolygon = insetRings.length
        ? insetRings.map((ring) => [ring])
        : body
      if (bodyHoles.length) {
        safeRegion = safeDifference(
          safeRegion,
          ...bodyHoles.map((hole) => [[hole]] as MultiPolygon),
        )
      }
      const clipped = dropTinyPolygons(safeIntersection(cutout, safeRegion), 0.05)
      pocketArea = clipped.length ? clipped : null
    }
  }

  const layers: KeychainLayer[] = []
  const midDepth = baseThickness - pocketDepth - engraveDepth

  if (engraveDepth > 0.05 && artworkRegion) {
    const bottomRegion = safeDifference(baseRegion, artworkRegion)
    if (bottomRegion.length) {
      const layer = createLayer('back-engrave', bottomRegion, engraveDepth, 0)
      if (layer) layers.push(layer)
    }
  }

  if (midDepth > 0.05) {
    const layer = createLayer('body', baseRegion, midDepth, engraveDepth)
    if (layer) layers.push(layer)
  }

  if (pocketArea && pocketDepth > 0.05) {
    const shell = safeDifference(baseRegion, pocketArea)
    if (shell.length) {
      const layer = createLayer(
        'pocket-shell',
        shell,
        pocketDepth,
        baseThickness - pocketDepth,
      )
      if (layer) layers.push(layer)
    }
  }

  if (!layers.length) {
    const fallback = createLayer('body', baseRegion, baseThickness, 0)
    if (!fallback) throw new Error('The base shape is empty.')
    layers.push(fallback)
  }

  const bounds = new THREE.Box3()
  let triangleCount = 0

  for (const layer of layers) {
    const box = layer.geometry.boundingBox?.clone() ?? new THREE.Box3()
    box.min.z += layer.z
    box.max.z += layer.z
    bounds.union(box)

    const position = layer.geometry.getAttribute('position')
    triangleCount += layer.geometry.index
      ? layer.geometry.index.count / 3
      : (position?.count ?? 0) / 3
  }

  return {
    layers,
    bounds,
    bodySize: { width: bodyBounds.width, height: bodyBounds.height },
    totalThickness: Math.max(0, bounds.max.z),
    triangleCount,
    artworkApplied: Boolean(artworkRegion?.length),
  }
}
