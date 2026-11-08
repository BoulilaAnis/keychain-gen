import type * as THREE from 'three'
import { STLExporter } from 'three-stdlib'

export interface StlExportResult {
  filename: string
  bytes: number
  triangleCount: number
}

/**
 * Exports a live R3F group (or a single mesh) as a binary STL and triggers a
 * browser download. The group is expected to be print-oriented: Z-up, base at
 * z = 0. Display-only wrappers should not be included in the exported group.
 */
export function exportSTL(
  object: THREE.Group | THREE.Mesh,
  filename = 'keychain.stl',
): StlExportResult {
  object.updateMatrixWorld(true)

  // A fresh exporter is required: three-stdlib keeps triangle counters on the
  // exporter instance between parse() calls.
  const exporter = new STLExporter()
  const data = exporter.parse(object, { binary: true }) as unknown as DataView

  if (!data || data.byteLength <= 84) {
    throw new Error('The model does not contain any printable triangles.')
  }

  const triangleCount = Math.floor((data.byteLength - 84) / 50)
  const buffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer
  const blob = new Blob([buffer], { type: 'model/stl' })

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)

  return { filename, bytes: blob.size, triangleCount }
}
