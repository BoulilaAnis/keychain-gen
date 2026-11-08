import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
} from 'react'
import {
  AlertTriangle,
  Box,
  Check,
  Circle,
  CircleDot,
  Download,
  FileImage,
  Heart,
  Image as ImageIcon,
  Italic,
  KeyRound,
  Layers,
  Loader2,
  Ruler,
  Square,
  Star,
  Type,
  UploadCloud,
  X,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import type {
  ArtworkFontFamily,
  ArtworkFontWeight,
  HoleShape,
  KeychainState,
  ModelInfo,
  PocketShape,
  ShapeType,
  SvgTarget,
} from '@/types'

const MAX_SVG_BYTES = 2 * 1024 * 1024

type ExportStatus = 'idle' | 'exporting' | 'done' | 'error'

interface ControlsProps {
  state: KeychainState
  onChange: (patch: Partial<KeychainState>) => void
  onSvgFile: (file: File, target: SvgTarget) => void
  onClearSvg: (target: SvgTarget) => void
  svgBodyName: string | null
  svgArtworkName: string | null
  svgBodyError: string | null
  svgArtworkError: string | null
  pocketSvgName: string | null
  pocketSvgError: string | null
  holeSvgName: string | null
  holeSvgError: string | null
  artworkError: string | null
  geometryError: string | null
  modelInfo: ModelInfo | null
  onExport: () => void
  exportStatus: ExportStatus
  exportError: string | null
}

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                      */
/* -------------------------------------------------------------------------- */

interface SliderFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  hint?: string
  disabled?: boolean
  onChange: (value: number) => void
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit = 'mm',
  hint,
  disabled,
  onChange,
}: SliderFieldProps) {
  const safeMax = Math.max(min, max)
  const safeValue = Math.min(safeMax, Math.max(min, value))
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
        <span className="font-mono text-xs tabular-nums text-foreground">
          {safeValue.toFixed(decimals)}
          <span className="ml-0.5 text-muted-foreground">{unit}</span>
        </span>
      </div>
      <Slider
        value={[safeValue]}
        min={min}
        max={safeMax}
        step={step}
        disabled={disabled}
        aria-label={label}
        onValueChange={(values) => {
          const next = values[0]
          if (typeof next === 'number') onChange(next)
        }}
      />
      {hint ? <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

interface SvgDropzoneProps {
  title: string
  description: string
  fileName: string | null
  error: string | null
  onFile: (file: File) => void
  onClear: () => void
}

function SvgDropzone({
  title,
  description,
  fileName,
  error,
  onFile,
  onClear,
}: SvgDropzoneProps) {
  const inputId = useId()
  const [dragging, setDragging] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const dragDepth = useRef(0)

  const acceptFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return
      const isSvg =
        file.name.toLowerCase().endsWith('.svg') ||
        file.type === 'image/svg+xml'
      if (!isSvg) {
        setLocalError('Please upload an .svg file.')
        return
      }
      if (file.size > MAX_SVG_BYTES) {
        setLocalError('The SVG is too large. The maximum size is 2 MB.')
        return
      }
      setLocalError(null)
      onFile(file)
    },
    [onFile],
  )

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      acceptFile(event.target.files?.[0])
      event.target.value = ''
    },
    [acceptFile],
  )

  const handleDragEnter = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }, [])

  const handleDragOver = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      acceptFile(event.dataTransfer.files?.[0])
    },
    [acceptFile],
  )

  const handleClear = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      // Keep the click from bubbling up and opening the file picker.
      event.preventDefault()
      event.stopPropagation()
      setLocalError(null)
      onClear()
    },
    [onClear],
  )

  const visibleError = localError ?? error

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'group relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/25 px-4 py-5 text-center transition-colors hover:border-primary/40 hover:bg-primary/5',
          dragging && 'dropzone-active',
        )}
      >
        <input
          id={inputId}
          type="file"
          accept=".svg,image/svg+xml"
          className="sr-only"
          onChange={handleChange}
        />
        <div className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
          <UploadCloud className="size-4" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-foreground">{title}</span>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
          SVG · max 2 MB
        </p>

        {fileName ? (
          <div className="mt-1 flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background/80 px-2 py-1 text-[11px] text-foreground">
            <FileImage className="size-3 shrink-0 text-primary" />
            <span className="max-w-44 truncate">{fileName}</span>
            <button
              type="button"
              onClick={handleClear}
              className="grid size-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
              aria-label="Remove SVG"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : null}
      </label>

      {visibleError ? (
        <Alert variant="destructive">
          <AlertTriangle className="mt-0.5 size-4" />
          <AlertTitle>SVG problem</AlertTitle>
          <AlertDescription>{visibleError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                   */
/* -------------------------------------------------------------------------- */

export default function Controls({
  state,
  onChange,
  onSvgFile,
  onClearSvg,
  svgBodyName,
  svgArtworkName,
  svgBodyError,
  svgArtworkError,
  pocketSvgName,
  pocketSvgError,
  holeSvgName,
  holeSvgError,
  artworkError,
  geometryError,
  modelInfo,
  onExport,
  exportStatus,
  exportError,
}: ControlsProps) {
  const handleShapeChange = useCallback(
    (value: string) => {
      if (!value) return
      onChange({ shapeType: value as ShapeType })
    },
    [onChange],
  )

  const handlePocketToggle = useCallback(
    (checked: boolean) => {
      onChange({ pocketShape: checked ? 'circle' : 'none' })
    },
    [onChange],
  )

  const handlePocketShapeChange = useCallback(
    (value: string) => {
      if (!value) return
      onChange({ pocketShape: value as PocketShape })
    },
    [onChange],
  )

  const handleHoleShapeChange = useCallback(
    (value: string) => {
      if (!value) return
      onChange({ holeShape: value as HoleShape })
    },
    [onChange],
  )

  const handleFontFamilyChange = useCallback(
    (value: string) => {
      if (!value) return
      onChange({ artworkFontFamily: value as ArtworkFontFamily })
    },
    [onChange],
  )

  const handleFontWeightChange = useCallback(
    (value: string) => {
      if (!value) return
      onChange({ artworkFontWeight: value as ArtworkFontWeight })
    },
    [onChange],
  )

  const handleArtworkTypeChange = useCallback(
    (value: string) => {
      if (!value) return
      onChange({ artworkType: value === 'logo' ? 'logo' : 'text' })
    },
    [onChange],
  )

  const handleBodyFile = useCallback(
    (file: File) => onSvgFile(file, 'body'),
    [onSvgFile],
  )
  const handleArtworkFile = useCallback(
    (file: File) => onSvgFile(file, 'artwork'),
    [onSvgFile],
  )
  const handleClearBody = useCallback(() => onClearSvg('body'), [onClearSvg])
  const handleClearArtwork = useCallback(() => onClearSvg('artwork'), [onClearSvg])
  const handlePocketFile = useCallback(
    (file: File) => onSvgFile(file, 'pocket'),
    [onSvgFile],
  )
  const handleHoleFile = useCallback(
    (file: File) => onSvgFile(file, 'hole'),
    [onSvgFile],
  )
  const handleClearPocket = useCallback(() => onClearSvg('pocket'), [onClearSvg])
  const handleClearHole = useCallback(() => onClearSvg('hole'), [onClearSvg])

  const bodySize = useMemo(() => {
    if (modelInfo) return modelInfo.bodySize
    if (state.shapeType === 'circle') {
      return { width: state.sizeDiameter, height: state.sizeDiameter }
    }
    return { width: state.sizeWidth, height: state.sizeHeight }
  }, [modelInfo, state.shapeType, state.sizeDiameter, state.sizeWidth, state.sizeHeight])

  const maxPocketSize = Math.max(
    8,
    Math.min(bodySize.width || 48, bodySize.height || 48) * 0.78,
  )
  const maxArtworkOffsetX = Math.max(4, (bodySize.width || 48) * 0.3)
  const maxArtworkOffsetY = Math.max(4, (bodySize.height || 48) * 0.3)
  const maxHoleDiameter = Math.max(2, state.lugWidth - 3)
  const pocketEnabled = state.pocketShape !== 'none'
  const artworkEnabled = state.backArtworkEnabled
  const exportDisabled =
    !modelInfo || Boolean(geometryError) || exportStatus === 'exporting'

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/40">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
            <KeyRound className="size-5" />
          </div>
          <div className="flex flex-col gap-0.5">
            <h1 className="text-sm font-semibold tracking-tight text-foreground">
              Keychain Studio
            </h1>
            <p className="text-xs text-muted-foreground">
              Parametric key fobs, print-ready.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="font-mono">
          1.0
        </Badge>
      </header>

      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {geometryError ? (
          <Alert variant="destructive">
            <AlertTriangle className="mt-0.5 size-4" />
            <AlertTitle>Geometry needs attention</AlertTitle>
            <AlertDescription>{geometryError}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Box className="size-3.5 text-primary" />
                Shape
              </CardTitle>
              <Badge variant="outline">
                {state.shapeType === 'svg'
                  ? 'Custom'
                  : state.shapeType === 'circle'
                    ? 'Round'
                    : 'Rect'}
              </Badge>
            </div>
            <CardDescription>Choose the silhouette of the plate.</CardDescription>
          </CardHeader>
          <CardContent>
            <ToggleGroup
              type="single"
              value={state.shapeType}
              onValueChange={handleShapeChange}
              aria-label="Keychain shape"
            >
              <ToggleGroupItem value="circle">
                <Circle />
                Circle
              </ToggleGroupItem>
              <ToggleGroupItem value="square">
                <Square />
                Square
              </ToggleGroupItem>
              <ToggleGroupItem value="svg">
                <FileImage />
                SVG
              </ToggleGroupItem>
            </ToggleGroup>

            {state.shapeType === 'circle' ? (
              <SliderField
                label="Diameter"
                value={state.sizeDiameter}
                min={20}
                max={90}
                step={1}
                onChange={(value) => onChange({ sizeDiameter: value })}
              />
            ) : null}

            {state.shapeType === 'square' ? (
              <>
                <SliderField
                  label="Width"
                  value={state.sizeWidth}
                  min={20}
                  max={90}
                  step={1}
                  onChange={(value) => onChange({ sizeWidth: value })}
                />
                <SliderField
                  label="Height"
                  value={state.sizeHeight}
                  min={20}
                  max={90}
                  step={1}
                  onChange={(value) => onChange({ sizeHeight: value })}
                />
                <SliderField
                  label="Corner radius"
                  value={state.cornerRadius}
                  min={0}
                  max={Math.min(state.sizeWidth, state.sizeHeight) / 2}
                  step={0.5}
                  onChange={(value) => onChange({ cornerRadius: value })}
                />
              </>
            ) : null}

            {state.shapeType === 'svg' ? (
              <SvgDropzone
                title="Upload a silhouette"
                description="One connected, filled SVG shape. Drag and drop or click to browse."
                fileName={svgBodyName}
                error={svgBodyError}
                onFile={handleBodyFile}
                onClear={handleClearBody}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-3.5 text-primary" />
              Plate
            </CardTitle>
            <CardDescription>Thickness of the printed plate.</CardDescription>
          </CardHeader>
          <CardContent>
            <SliderField
              label="Base thickness"
              value={state.baseThickness}
              min={1.5}
              max={6}
              step={0.1}
              hint="A flat plate with no raised rim. Thicker plates feel more substantial."
              onChange={(value) => onChange({ baseThickness: value })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ruler className="size-3.5 text-primary" />
              Keyring hole
            </CardTitle>
            <CardDescription>The lug and the hole for your split ring.</CardDescription>
          </CardHeader>
          <CardContent>
            <SliderField
              label="Lug width"
              value={state.lugWidth}
              min={8}
              max={26}
              step={0.5}
              onChange={(value) => onChange({ lugWidth: value })}
            />
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Hole shape
              </Label>
              <ToggleGroup
                type="single"
                value={state.holeShape}
                onValueChange={handleHoleShapeChange}
                aria-label="Keyring hole shape"
              >
                <ToggleGroupItem value="circle">
                  <Circle />
                  Circle
                </ToggleGroupItem>
                <ToggleGroupItem value="square">
                  <Square />
                  Square
                </ToggleGroupItem>
                <ToggleGroupItem value="heart">
                  <Heart />
                  Heart
                </ToggleGroupItem>
                <ToggleGroupItem value="star">
                  <Star />
                  Star
                </ToggleGroupItem>
                <ToggleGroupItem value="custom">
                  <FileImage />
                  Custom
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {state.holeShape === 'custom' ? (
              <SvgDropzone
                title="Upload a keyring hole shape"
                description="Any filled SVG used as the keyring hole."
                fileName={holeSvgName}
                error={holeSvgError}
                onFile={handleHoleFile}
                onClear={handleClearHole}
              />
            ) : (
              <SliderField
                label="Hole size"
                value={state.holeDiameter}
                min={2}
                max={maxHoleDiameter}
                step={0.5}
                hint="Every shape is scaled to fit with at least 1.5 mm of material around it."
                onChange={(value) => onChange({ holeDiameter: value })}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle className="flex items-center gap-2">
                  <CircleDot className="size-3.5 text-primary" />
                  Pocket
                </CardTitle>
                <CardDescription>
                  A blind recess milled into the front face.
                </CardDescription>
              </div>
              <Switch
                checked={pocketEnabled}
                onCheckedChange={handlePocketToggle}
                aria-label="Enable pocket"
              />
            </div>
          </CardHeader>
          <CardContent>
            <ToggleGroup
              type="single"
              value={pocketEnabled ? state.pocketShape : 'circle'}
              onValueChange={handlePocketShapeChange}
              disabled={!pocketEnabled}
              aria-label="Pocket shape"
            >
              <ToggleGroupItem value="circle">
                <Circle />
                Circle
              </ToggleGroupItem>
              <ToggleGroupItem value="square">
                <Square />
                Square
              </ToggleGroupItem>
              <ToggleGroupItem value="heart">
                <Heart />
                Heart
              </ToggleGroupItem>
              <ToggleGroupItem value="star">
                <Star />
                Star
              </ToggleGroupItem>
              <ToggleGroupItem value="custom">
                <FileImage />
                Custom
              </ToggleGroupItem>
            </ToggleGroup>

            {pocketEnabled ? (
              <>
                {state.pocketShape === 'custom' ? (
                  <SvgDropzone
                    title="Upload a pocket shape"
                    description="Any filled SVG used as the pocket recess."
                    fileName={pocketSvgName}
                    error={pocketSvgError}
                    onFile={handlePocketFile}
                    onClear={handleClearPocket}
                  />
                ) : null}
                {state.pocketShape === 'square' ? (
                  <SliderField
                    label="Pocket corner radius"
                    value={state.pocketCornerRadius}
                    min={0}
                    max={Math.min(8, maxPocketSize * 0.5)}
                    step={0.25}
                    hint="Rounds the square pocket's border."
                    onChange={(value) => onChange({ pocketCornerRadius: value })}
                  />
                ) : null}
                <SliderField
                  label="Pocket size"
                  value={state.pocketSize}
                  min={5}
                  max={maxPocketSize}
                  step={0.5}
                  onChange={(value) => onChange({ pocketSize: value })}
                />
                <SliderField
                  label="Pocket depth"
                  value={state.pocketDepth}
                  min={0.2}
                  max={Math.max(0.2, state.baseThickness - 1)}
                  step={0.1}
                  hint="Leaves a solid floor above the back engraving."
                  onChange={(value) => onChange({ pocketDepth: value })}
                />
              </>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Enable the pocket to recess a shape into the front face.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle className="flex items-center gap-2">
                  <Type className="size-3.5 text-primary" />
                  Back artwork
                </CardTitle>
                <CardDescription>
                  Engraved on the back and mirrored to read correctly when turned over.
                </CardDescription>
              </div>
              <Switch
                checked={artworkEnabled}
                onCheckedChange={(checked) =>
                  onChange({ backArtworkEnabled: checked })
                }
                aria-label="Enable back artwork"
              />
            </div>
          </CardHeader>

          {artworkEnabled ? (
            <CardContent>
              <ToggleGroup
                type="single"
                value={state.artworkType}
                onValueChange={handleArtworkTypeChange}
                aria-label="Artwork type"
              >
                <ToggleGroupItem value="text">
                  <Type />
                  Text
                </ToggleGroupItem>
                <ToggleGroupItem value="logo">
                  <ImageIcon />
                  Logo
                </ToggleGroupItem>
              </ToggleGroup>

              {state.artworkType === 'text' ? (
                <>
                  <div className="flex flex-col gap-2">
                    <Label
                      htmlFor="artwork-text"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Text
                    </Label>
                    <Input
                      id="artwork-text"
                      value={state.artworkText}
                      maxLength={24}
                      placeholder="STUDIO"
                      onChange={(event) =>
                        onChange({ artworkText: event.target.value })
                      }
                    />
                  </div>
                  <SliderField
                    label="Artwork size"
                    value={state.artworkSize}
                    min={4}
                    max={40}
                    step={0.5}
                    onChange={(value) => onChange({ artworkSize: value })}
                  />
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Font family
                    </Label>
                    <ToggleGroup
                      type="single"
                      value={state.artworkFontFamily}
                      onValueChange={handleFontFamilyChange}
                      aria-label="Artwork font family"
                    >
                      <ToggleGroupItem value="helvetiker">
                        Helvetiker
                      </ToggleGroupItem>
                      <ToggleGroupItem value="droid-sans">
                        Droid Sans
                      </ToggleGroupItem>
                      <ToggleGroupItem value="optimer">Optimer</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Font weight
                    </Label>
                    <ToggleGroup
                      type="single"
                      value={state.artworkFontWeight}
                      onValueChange={handleFontWeightChange}
                      aria-label="Artwork font weight"
                    >
                      <ToggleGroupItem value="regular">Regular</ToggleGroupItem>
                      <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/25 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Italic className="size-3.5 text-muted-foreground" />
                      <Label
                        htmlFor="artwork-italic"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Italic shear
                      </Label>
                    </div>
                    <Switch
                      id="artwork-italic"
                      checked={state.isItalic}
                      onCheckedChange={(checked) =>
                        onChange({ isItalic: checked })
                      }
                    />
                  </div>
                </>
              ) : (
                <SvgDropzone
                  title="Upload a logo"
                  description="Filled SVG paths. Multiple pieces are allowed for logos."
                  fileName={svgArtworkName}
                  error={svgArtworkError}
                  onFile={handleArtworkFile}
                  onClear={handleClearArtwork}
                />
              )}

              <SliderField
                label="Engraving depth"
                value={state.artworkDepth}
                min={0.1}
                max={Math.max(0.1, state.baseThickness - 0.8)}
                step={0.1}
                hint="How deep the back artwork is recessed into the plate."
                onChange={(value) => onChange({ artworkDepth: value })}
              />
              <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/25 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Position on the back
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() =>
                      onChange({ artworkOffsetX: 0, artworkOffsetY: 0 })
                    }
                    disabled={
                      state.artworkOffsetX === 0 && state.artworkOffsetY === 0
                    }
                  >
                    Center
                  </Button>
                </div>
                <SliderField
                  label="Horizontal"
                  value={state.artworkOffsetX}
                  min={-maxArtworkOffsetX}
                  max={maxArtworkOffsetX}
                  step={0.5}
                  hint="Move the engraving left or right."
                  onChange={(value) => onChange({ artworkOffsetX: value })}
                />
                <SliderField
                  label="Vertical"
                  value={state.artworkOffsetY}
                  min={-maxArtworkOffsetY}
                  max={maxArtworkOffsetY}
                  step={0.5}
                  hint="Move the engraving up or down."
                  onChange={(value) => onChange({ artworkOffsetY: value })}
                />
              </div>

              {artworkError && artworkError !== svgArtworkError ? (
                <Alert variant="destructive">
                  <AlertTriangle className="mt-0.5 size-4" />
                  <AlertTitle>Artwork problem</AlertTitle>
                  <AlertDescription>{artworkError}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          ) : null}
        </Card>
      </div>

      <footer className="flex shrink-0 flex-col gap-3 border-t border-border/60 bg-card/60 px-4 py-4">
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-3 text-emerald-500" />
            {modelInfo
              ? `${modelInfo.triangleCount.toLocaleString()} triangles`
              : 'Waiting for geometry'}
          </span>
          <span className="font-mono tabular-nums">
            {modelInfo
              ? `${modelInfo.bodySize.width.toFixed(0)} × ${modelInfo.bodySize.height.toFixed(0)} × ${modelInfo.totalThickness.toFixed(1)} mm`
              : '—'}
          </span>
        </div>

        {exportError ? (
          <Alert variant="destructive">
            <AlertTriangle className="mt-0.5 size-4" />
            <AlertTitle>Export failed</AlertTitle>
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
        ) : null}

        <Button
          size="lg"
          className="w-full gap-2"
          onClick={onExport}
          disabled={exportDisabled}
        >
          {exportStatus === 'exporting' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Download />
          )}
          {exportStatus === 'exporting'
            ? 'Exporting…'
            : exportStatus === 'done'
              ? 'Downloaded — export again'
              : 'Export STL'}
        </Button>
      </footer>
    </div>
  )
}
