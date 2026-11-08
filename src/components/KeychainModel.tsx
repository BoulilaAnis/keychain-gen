import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'

import type {
  GeometryWorkerRequest,
  GeometryWorkerResponse,
  KeychainState,
  KeychainSummary,
  ModelInfo,
  MultiPolygon,
  SerializedLayer,
} from '@/types'

interface KeychainModelProps {
  state: KeychainState
  svgBody: MultiPolygon | null
  artwork: MultiPolygon | null
  groupRef: RefObject<THREE.Group | null>
  onModelInfo: (info: ModelInfo | null) => void
  onError: (error: string | null) => void
}

interface BuiltLayer {
  id: string
  name: string
  z: number
  depth: number
  geometry: THREE.BufferGeometry
}

interface BuiltModel {
  layers: BuiltLayer[]
  center: { x: number; y: number }
  summary: KeychainSummary
  revision: number
}

function createGeometry(layer: SerializedLayer): BuiltLayer {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(layer.positions, 3),
  )

  if (layer.normals.length === layer.positions.length) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(layer.normals, 3))
  } else {
    geometry.computeVertexNormals()
  }

  if (layer.indices) {
    geometry.setIndex(new THREE.BufferAttribute(layer.indices, 1))
  }

  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return {
    id: layer.id,
    name: layer.name,
    z: layer.z,
    depth: layer.depth,
    geometry,
  }
}

export default function KeychainModel({
  state,
  svgBody,
  artwork,
  groupRef,
  onModelInfo,
  onError,
}: KeychainModelProps) {
  const [built, setBuilt] = useState<BuiltModel | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#a87ca0',
        roughness: 0.4,
        metalness: 0.1,
        envMapIntensity: 0.65,
      }),
    [],
  )

  const workerRef = useRef<Worker | null>(null)
  const busyRef = useRef(false)
  const pendingRef = useRef<GeometryWorkerRequest | null>(null)
  const requestIdRef = useRef(0)
  const revisionRef = useRef(0)

  // The worker is created once per mount. StrictMode's immediate remount
  // terminates the first worker before it can deliver a stale build.
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/geometry.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker
    busyRef.current = false
    pendingRef.current = null

    const send = (request: GeometryWorkerRequest) => {
      busyRef.current = true
      worker.postMessage(request)
    }

    worker.onmessage = (event: MessageEvent<GeometryWorkerResponse>) => {
      busyRef.current = false
      const data = event.data

      if (data.ok && data.layers && data.summary) {
        const layers = data.layers.map(createGeometry)
        revisionRef.current += 1
        setBuilt({
          layers,
          center: data.summary.center,
          summary: data.summary,
          revision: revisionRef.current,
        })
        setBuildError(null)
      } else {
        setBuildError(
          data.error ?? 'The geometry could not be generated.',
        )
      }

      const pending = pendingRef.current
      if (pending) {
        pendingRef.current = null
        send(pending)
      }
    }

    worker.onerror = () => {
      busyRef.current = false
      setBuildError('The geometry worker stopped unexpectedly.')
    }

    return () => {
      worker.terminate()
      workerRef.current = null
      busyRef.current = false
      pendingRef.current = null
    }
  }, [])

  // Coalesce builds: while the worker is busy only the newest request is kept.
  useEffect(() => {
    if (state.shapeType === 'svg' && !svgBody) {
      setBuilt(null)
      setBuildError(null)
      return
    }

    const worker = workerRef.current
    if (!worker) return

    const request: GeometryWorkerRequest = {
      id: requestIdRef.current + 1,
      state,
      svgBody,
      artwork,
    }
    requestIdRef.current = request.id

    if (busyRef.current) {
      pendingRef.current = request
      return
    }

    busyRef.current = true
    worker.postMessage(request)
  }, [state, svgBody, artwork])

  // Dispose geometries from the previous build once a new one is committed.
  const previousLayersRef = useRef<BuiltLayer[]>([])
  useEffect(() => {
    const previous = previousLayersRef.current
    const current = built?.layers ?? []
    if (previous !== current) {
      for (const layer of previous) layer.geometry.dispose()
    }
    previousLayersRef.current = current
  }, [built])

  // Dispose the material and the last geometry set on real unmount. The
  // microtask lets StrictMode's immediate remount cancel the disposal.
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const layers = previousLayersRef.current
      const materialToDispose = material
      queueMicrotask(() => {
        if (mountedRef.current) return
        for (const layer of layers) layer.geometry.dispose()
        materialToDispose.dispose()
      })
    }
  }, [material])

  useEffect(() => {
    if (buildError) {
      onError(buildError)
      onModelInfo(null)
      return
    }
    if (!built || !built.layers.length) {
      onError(null)
      onModelInfo(null)
      return
    }

    onError(null)
    onModelInfo({
      triangleCount: built.summary.triangleCount,
      bodySize: built.summary.bodySize,
      totalThickness: built.summary.totalThickness,
      layerCount: built.summary.layerCount,
      artworkApplied: built.summary.artworkApplied,
      revision: built.revision,
    })
  }, [built, buildError, onError, onModelInfo])

  const displayOffset = useMemo(
    () =>
      new THREE.Vector3(
        -(built?.center.x ?? 0),
        -(built?.center.y ?? 0),
        0,
      ),
    [built],
  )

  if (buildError || !built || !built.layers.length) return null

  return (
    <group ref={groupRef}>
      <group position={displayOffset}>
        {built.layers.map((layer) => (
          <mesh
            key={layer.id}
            geometry={layer.geometry}
            material={material}
            position={[0, 0, layer.z]}
          />
        ))}
      </group>
    </group>
  )
}
