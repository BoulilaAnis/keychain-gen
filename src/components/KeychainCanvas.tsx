import { Component, Suspense, useLayoutEffect } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import type * as THREE from 'three'

import KeychainModel from '@/components/KeychainModel'
import type { KeychainState, ModelInfo, MultiPolygon } from '@/types'

interface KeychainCanvasProps {
  state: KeychainState
  svgBody: MultiPolygon | null
  artwork: MultiPolygon | null
  flipped: boolean
  modelInfo: ModelInfo | null
  modelRef: RefObject<THREE.Group | null>
  onModelInfo: (info: ModelInfo | null) => void
  onError: (error: string | null) => void
}

/**
 * drei's Environment fetches an HDR from a CDN. If the network is unavailable
 * the studio lights still light the scene, so swallow the failure.
 */
class EnvironmentBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

function CameraRig() {
  const camera = useThree((state) => state.camera)

  useLayoutEffect(() => {
    camera.up.set(0, 0, 1)
    camera.lookAt(0, 0, 2)
    camera.updateProjectionMatrix()
  }, [camera])

  return null
}

export default function KeychainCanvas({
  state,
  svgBody,
  artwork,
  flipped,
  modelInfo,
  modelRef,
  onModelInfo,
  onError,
}: KeychainCanvasProps) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
      camera={{
        position: [0, -92, 68],
        up: [0, 0, 1],
        fov: 35,
        near: 0.1,
        far: 500,
      }}
      className="size-full"
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[-18, -22, 34]}
          intensity={2.4}
          color="#fff3fb"
        />
        <directionalLight
          position={[22, 16, 18]}
          intensity={0.9}
          color="#cfd8ff"
        />
        <directionalLight
          position={[0, 22, -16]}
          intensity={0.5}
          color="#ffd9c8"
        />

        <EnvironmentBoundary>
          <Environment preset="city" />
        </EnvironmentBoundary>

        <group rotation={[0, flipped ? Math.PI : 0, 0]}>
          <KeychainModel
            state={state}
            svgBody={svgBody}
            artwork={artwork}
            groupRef={modelRef}
            onModelInfo={onModelInfo}
            onError={onError}
          />
        </group>

        <ContactShadows
          key={modelInfo?.revision ?? 'empty'}
          rotation={[Math.PI / 2, 0, 0]}
          position={[0, 0, -0.18]}
          opacity={0.26}
          scale={130}
          blur={2.8}
          far={40}
          frames={1}
          color="#8d4a70"
        />
      </Suspense>

      <CameraRig />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={28}
        maxDistance={240}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI / 2 - 0.04}
        target={[0, 0, 2]}
      />
    </Canvas>
  )
}
