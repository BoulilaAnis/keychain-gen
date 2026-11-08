export type ShapeType = 'circle' | 'square' | 'svg'
export type PocketShape = 'none' | 'circle' | 'square' | 'heart' | 'star' | 'custom'
export type HoleShape = 'circle' | 'square' | 'heart' | 'star' | 'custom'
export type ArtworkType = 'text' | 'logo'
export type ArtworkFontFamily = 'helvetiker' | 'droid-sans' | 'optimer'
export type ArtworkFontWeight = 'regular' | 'bold'
export type SvgTarget = 'body' | 'artwork' | 'pocket' | 'hole'

/** A single 2D point in millimetres. */
export type Point = [number, number]
/** A closed ring: the first and last points are identical. */
export type Ring = Point[]
/** Outer ring first, followed by any hole rings. */
export type Polygon = Ring[]
export type MultiPolygon = Polygon[]

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export interface KeychainState {
  shapeType: ShapeType
  sizeDiameter: number
  sizeWidth: number
  sizeHeight: number
  cornerRadius: number
  baseThickness: number
  holeShape: HoleShape
  holeDiameter: number
  lugWidth: number
  holeCustomShape: MultiPolygon | null
  pocketShape: PocketShape
  pocketSize: number
  pocketDepth: number
  pocketCornerRadius: number
  pocketCustomShape: MultiPolygon | null
  backArtworkEnabled: boolean
  artworkType: ArtworkType
  artworkText: string
  artworkSize: number
  artworkDepth: number
  artworkOffsetX: number
  artworkOffsetY: number
  artworkFontFamily: ArtworkFontFamily
  artworkFontWeight: ArtworkFontWeight
  isItalic: boolean
}

export interface SvgParseResult {
  artwork: MultiPolygon
  size: { width: number; height: number }
  source: { width: number; height: number; scale: number }
}

export interface ModelInfo {
  triangleCount: number
  bodySize: { width: number; height: number }
  totalThickness: number
  layerCount: number
  artworkApplied: boolean
  /** Increments on every completed build so the viewport can react to changes. */
  revision: number
}

export interface KeychainLayer {
  id: string
  name: string
  geometry: import('three').ExtrudeGeometry
  z: number
  depth: number
}

export interface KeychainBuildResult {
  layers: KeychainLayer[]
  bounds: import('three').Box3
  bodySize: { width: number; height: number }
  totalThickness: number
  triangleCount: number
  artworkApplied: boolean
  empty?: boolean
  error?: string
}

/* -------------------------------------------------------------------------- */
/* Geometry worker protocol                                                   */
/* -------------------------------------------------------------------------- */

export interface SerializedLayer {
  id: string
  name: string
  z: number
  depth: number
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array | null
}

export interface KeychainSummary {
  triangleCount: number
  bodySize: { width: number; height: number }
  totalThickness: number
  layerCount: number
  artworkApplied: boolean
  center: { x: number; y: number }
}

export interface GeometryWorkerRequest {
  id: number
  state: KeychainState
  svgBody: MultiPolygon | null
  artwork: MultiPolygon | null
}

export interface GeometryWorkerResponse {
  id: number
  ok: boolean
  layers?: SerializedLayer[]
  summary?: KeychainSummary
  error?: string
}
