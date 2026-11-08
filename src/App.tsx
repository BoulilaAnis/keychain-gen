import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  FlipHorizontal2,
  Layers3,
  Sparkles,
  UploadCloud,
} from 'lucide-react'
import type * as THREE from 'three'

import KeychainCanvas from '@/components/KeychainCanvas'

// The sidebar pulls in the full radix/shadcn control kit; keep it out of the
// critical path so first paint is faster.
const Controls = lazy(() => import('@/components/Controls'))
import { Button } from '@/components/ui/button'
import { exportSTL } from '@/utils/ExportSTL'
import {
  createTextArtwork,
  parseSvgToArtwork,
  parseSvgToBody,
} from '@/utils/shapes'
import type {
  KeychainState,
  ModelInfo,
  MultiPolygon,
  SvgTarget,
} from '@/types'

type ExportStatus = 'idle' | 'exporting' | 'done' | 'error'

const DEFAULT_STATE: KeychainState = {
  shapeType: 'circle',
  sizeDiameter: 48,
  sizeWidth: 48,
  sizeHeight: 48,
  cornerRadius: 10,
  baseThickness: 3.2,
  holeShape: 'circle',
  holeDiameter: 4.5,
  lugWidth: 14,
  holeCustomShape: null,
  pocketShape: 'circle',
  pocketSize: 26,
  pocketDepth: 1.2,
  pocketCornerRadius: 6,
  pocketCustomShape: null,
  backArtworkEnabled: true,
  artworkType: 'text',
  artworkText: 'STUDIO',
  artworkSize: 14,
  artworkDepth: 0.6,
  artworkOffsetX: 0,
  artworkOffsetY: 0,
  artworkFontFamily: 'helvetiker',
  artworkFontWeight: 'regular',
  isItalic: false,
}

const FALLBACK_PARSE_ERROR =
  'The SVG could not be parsed. Make sure the file is a valid SVG.'

function readError(error: unknown): string {
  return error instanceof Error ? error.message : FALLBACK_PARSE_ERROR
}

export default function App() {
  const [state, setState] = useState<KeychainState>(DEFAULT_STATE)
  const [flipped, setFlipped] = useState(false)

  const [svgBodyText, setSvgBodyText] = useState<string | null>(null)
  const [svgBodyName, setSvgBodyName] = useState<string | null>(null)
  const [svgArtworkText, setSvgArtworkText] = useState<string | null>(null)
  const [svgArtworkName, setSvgArtworkName] = useState<string | null>(null)
  const [svgBody, setSvgBody] = useState<MultiPolygon | null>(null)
  const [svgArtwork, setSvgArtwork] = useState<MultiPolygon | null>(null)
  const [svgBodyError, setSvgBodyError] = useState<string | null>(null)
  const [svgArtworkError, setSvgArtworkError] = useState<string | null>(null)
  const [pocketSvgName, setPocketSvgName] = useState<string | null>(null)
  const [pocketSvgError, setPocketSvgError] = useState<string | null>(null)
  const [holeSvgName, setHoleSvgName] = useState<string | null>(null)
  const [holeSvgError, setHoleSvgError] = useState<string | null>(null)

  const [artwork, setArtwork] = useState<MultiPolygon | null>(null)
  const [artworkError, setArtworkError] = useState<string | null>(null)
  const [geometryError, setGeometryError] = useState<string | null>(null)
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)

  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle')
  const [exportError, setExportError] = useState<string | null>(null)

  const modelRef = useRef<THREE.Group>(null)

  const handleChange = useCallback((patch: Partial<KeychainState>) => {
    setState((current) => ({ ...current, ...patch }))
  }, [])

  const handleSvgFile = useCallback(async (file: File, target: SvgTarget) => {
    try {
      const text = await file.text()
      if (target === 'body') {
        setSvgBodyText(text)
        setSvgBodyName(file.name)
        setSvgBodyError(null)
      } else if (target === 'artwork') {
        setSvgArtworkText(text)
        setSvgArtworkName(file.name)
        setSvgArtworkError(null)
        setState((current) => ({
          ...current,
          backArtworkEnabled: true,
          artworkType: 'logo',
        }))
      } else if (target === 'pocket') {
        const parsed = parseSvgToBody(text)
        setPocketSvgName(file.name)
        setPocketSvgError(null)
        setState((current) => ({ ...current, pocketCustomShape: parsed.artwork }))
      } else if (target === 'hole') {
        const parsed = parseSvgToBody(text)
        setHoleSvgName(file.name)
        setHoleSvgError(null)
        setState((current) => ({ ...current, holeCustomShape: parsed.artwork }))
      }
    } catch (error) {
      const message = readError(error)
      if (target === 'body') {
        setSvgBodyError(message)
      } else {
        setSvgArtworkError(message)
      }
    }
  }, [])

  const handleClearSvg = useCallback((target: SvgTarget) => {
    if (target === 'body') {
      setSvgBodyText(null)
      setSvgBodyName(null)
      setSvgBody(null)
      setSvgBodyError(null)
    } else if (target === 'artwork') {
      setSvgArtworkText(null)
      setSvgArtworkName(null)
      setSvgArtwork(null)
      setSvgArtworkError(null)
    } else if (target === 'pocket') {
      setState((current) => ({ ...current, pocketCustomShape: null }))
      setPocketSvgName(null)
      setPocketSvgError(null)
    } else if (target === 'hole') {
      setState((current) => ({ ...current, holeCustomShape: null }))
      setHoleSvgName(null)
      setHoleSvgError(null)
    }
  }, [])

  // Parse the uploaded silhouette off the render path.
  useEffect(() => {
    if (!svgBodyText) {
      setSvgBody(null)
      setSvgBodyError(null)
      return
    }

    let cancelled = false
    const run = async () => {
      try {
        await Promise.resolve()
        const parsed = parseSvgToBody(svgBodyText)
        if (!cancelled) {
          setSvgBody(parsed.artwork)
          setSvgBodyError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setSvgBody(null)
          setSvgBodyError(readError(error))
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [svgBodyText])

  // Parse the uploaded logo off the render path.
  useEffect(() => {
    if (!svgArtworkText) {
      setSvgArtwork(null)
      setSvgArtworkError(null)
      return
    }

    let cancelled = false
    const run = async () => {
      try {
        await Promise.resolve()
        const parsed = parseSvgToArtwork(svgArtworkText)
        if (!cancelled) {
          setSvgArtwork(parsed.artwork)
          setSvgArtworkError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setSvgArtwork(null)
          setSvgArtworkError(readError(error))
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [svgArtworkText])

  // Generate the active artwork (text outlines or the parsed logo).
  useEffect(() => {
    let cancelled = false

    if (!state.backArtworkEnabled) {
      setArtwork(null)
      setArtworkError(null)
      return
    }

    if (state.artworkType === 'logo') {
      setArtwork(svgArtwork)
      setArtworkError(svgArtworkError)
      return
    }

    const text = state.artworkText.trim()
    if (!text) {
      setArtwork(null)
      setArtworkError(null)
      return
    }

    // Debounce the text outline work so fast typing never blocks a keystroke.
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = createTextArtwork(text, 10, {
            fontFamily: state.artworkFontFamily,
            fontWeight: state.artworkFontWeight,
            isItalic: state.isItalic,
          })
          if (!cancelled) {
            setArtwork(result)
            setArtworkError(null)
          }
        } catch (error) {
          if (!cancelled) {
            setArtwork(null)
            setArtworkError(readError(error))
          }
        }
      })()
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    state.backArtworkEnabled,
    state.artworkType,
    state.artworkText,
    state.artworkFontFamily,
    state.artworkFontWeight,
    state.isItalic,
    svgArtwork,
    svgArtworkError,
  ])

  const handleModelInfo = useCallback((info: ModelInfo | null) => {
    setModelInfo(info)
  }, [])

  const handleGeometryError = useCallback((error: string | null) => {
    setGeometryError(error)
  }, [])

  const handleExport = useCallback(() => {
    const group = modelRef.current
    if (!group) {
      setExportStatus('error')
      setExportError('The model is not ready yet.')
      return
    }

    setExportStatus('exporting')
    setExportError(null)

    // Yield once so the button can render its pending state before the
    // synchronous STL traversal runs.
    window.setTimeout(() => {
      try {
        const width = modelInfo?.bodySize.width
        const height = modelInfo?.bodySize.height
        const filename = `keychain-${state.shapeType}-${
          width ? width.toFixed(0) : 'shape'
        }x${height ? height.toFixed(0) : 'shape'}mm.stl`
        exportSTL(group, filename)
        setExportStatus('done')
      } catch (error) {
        setExportStatus('error')
        setExportError(
          error instanceof Error
            ? error.message
            : 'The STL could not be exported.',
        )
      }
    }, 30)
  }, [modelInfo, state.shapeType])

  const showEmptyState =
    state.shapeType === 'svg' && !svgBody && !svgBodyError

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background lg:flex-row">
      <aside className="h-[46vh] w-full shrink-0 border-b border-border/60 lg:h-full lg:w-[392px] lg:border-b-0 lg:border-r">
        <Suspense
          fallback={
            <div className="p-4 text-xs text-muted-foreground">Loading controls…</div>
          }
        >
          <Controls
            state={state}
            onChange={handleChange}
            onSvgFile={handleSvgFile}
            onClearSvg={handleClearSvg}
            svgBodyName={svgBodyName}
            svgArtworkName={svgArtworkName}
            svgBodyError={svgBodyError}
            svgArtworkError={svgArtworkError}
            pocketSvgName={pocketSvgName}
            pocketSvgError={pocketSvgError}
            holeSvgName={holeSvgName}
            holeSvgError={holeSvgError}
            artworkError={artworkError}
            geometryError={geometryError}
            modelInfo={modelInfo}
            onExport={handleExport}
            exportStatus={exportStatus}
            exportError={exportError}
          />
        </Suspense>
      </aside>

      <main className="studio-stage relative min-h-0 flex-1 overflow-hidden">
        <div className="studio-grid pointer-events-none absolute inset-0 opacity-70" />
        <KeychainCanvas
          state={state}
          svgBody={svgBody}
          artwork={artwork}
          flipped={flipped}
          modelInfo={modelInfo}
          modelRef={modelRef}
          onModelInfo={handleModelInfo}
          onError={handleGeometryError}
        />

        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-4 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="pointer-events-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFlipped((current) => !current)}
                className="border-border/60 bg-background/75 text-foreground/80 shadow-sm backdrop-blur hover:bg-background hover:text-foreground"
              >
                <FlipHorizontal2 />
                {flipped ? 'View front' : 'View back'}
              </Button>
            </div>
          </div>

          <div className="flex items-end justify-between gap-3">
            <p className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
              <Sparkles className="size-3" />
              Drag to orbit · scroll to zoom · flip to inspect the engraving
            </p>

            <div className="ml-auto rounded-xl border border-border/60 bg-background/75 px-3 py-2 text-right shadow-sm backdrop-blur">
              <p className="font-mono text-[11px] tabular-nums text-foreground/80">
                {modelInfo
                  ? `${modelInfo.bodySize.width.toFixed(0)} × ${modelInfo.bodySize.height.toFixed(0)} × ${modelInfo.totalThickness.toFixed(1)} mm`
                  : 'No geometry'}
              </p>
              <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                <Layers3 className="size-2.5" />
                {modelInfo
                  ? `${modelInfo.layerCount} layers · ${modelInfo.triangleCount.toLocaleString()} tris`
                  : 'Upload or adjust to begin'}
                {modelInfo?.artworkApplied ? (
                  <Check className="ml-1 size-2.5 text-emerald-400" />
                ) : null}
              </p>
            </div>
          </div>
        </div>

        {showEmptyState ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
            <div className="pointer-events-auto flex max-w-xs flex-col items-center gap-3 rounded-2xl border border-border/60 bg-background/85 p-6 text-center shadow-xl backdrop-blur-md">
              <div className="grid size-12 place-items-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/25">
                <UploadCloud className="size-5" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold text-foreground">Upload a silhouette</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Drop a filled, connected SVG into the Shape panel to start
                  designing your custom plate.
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}
