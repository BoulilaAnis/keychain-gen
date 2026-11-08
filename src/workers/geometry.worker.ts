import * as THREE from 'three'

import type {
  GeometryWorkerRequest,
  GeometryWorkerResponse,
  SerializedLayer,
} from '@/types'
import { buildKeychainLayers } from '@/utils/geometry'

/**
 * Runs the expensive 2D boolean + extrusion work off the main thread. The
 * result is plain typed arrays so the UI thread can rebuild BufferGeometries
 * without doing any geometry math.
 */
self.onmessage = (event: MessageEvent<GeometryWorkerRequest>) => {
  const { id, state, svgBody, artwork } = event.data

  try {
    const result = buildKeychainLayers(state, svgBody, artwork)

    const layers: SerializedLayer[] = result.layers.map((layer) => {
      const position = layer.geometry.getAttribute('position')
      const normal = layer.geometry.getAttribute('normal')
      const index = layer.geometry.index

      const positions = new Float32Array(position.array as ArrayLike<number>)
      const normals = normal
        ? new Float32Array(normal.array as ArrayLike<number>)
        : new Float32Array(0)
      const indices = index
        ? new Uint32Array(index.array as ArrayLike<number>)
        : null

      layer.geometry.dispose()

      return {
        id: layer.id,
        name: layer.name,
        z: layer.z,
        depth: layer.depth,
        positions,
        normals,
        indices,
      }
    })

    const center = new THREE.Vector3()
    result.bounds.getCenter(center)

    const response: GeometryWorkerResponse = {
      id,
      ok: true,
      layers,
      summary: {
        triangleCount: result.triangleCount,
        bodySize: result.bodySize,
        totalThickness: result.totalThickness,
        layerCount: layers.length,
        artworkApplied: result.artworkApplied,
        center: { x: center.x, y: center.y },
      },
    }

    const transfer = layers.flatMap((layer) => {
      const buffers: ArrayBuffer[] = [
        layer.positions.buffer as ArrayBuffer,
        layer.normals.buffer as ArrayBuffer,
      ]
      if (layer.indices) buffers.push(layer.indices.buffer as ArrayBuffer)
      return buffers
    })

    ;(
      self as unknown as {
        postMessage: (message: unknown, transfer?: Transferable[]) => void
      }
    ).postMessage(response, transfer)
  } catch (error) {
    const response: GeometryWorkerResponse = {
      id,
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'The geometry could not be generated.',
    }
    self.postMessage(response)
  }
}
