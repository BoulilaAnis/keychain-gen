# Keychain Studio

A parametric 3D keychain designer that runs entirely in the browser. Shape a plate, add a
keyring lug, recess a pocket, engrave artwork on the back, and download a print-ready STL.

The UI is themed with the [tweakcn](https://tweakcn.com/) **bubblegum** style (dark variant), with
Poppins for UI text, Lora and Fira Code for artwork, and the pink keychain material `#a87ca0`.

## Stack

- React 19 + strict TypeScript, Vite
- Tailwind CSS v4 with shadcn/ui primitives
- Three.js, `@react-three/fiber` v9, `@react-three/drei`
- 2D booleans with `polygon-clipping` + `clipper-lib` (no 3D CSG)
- Binary STL export via `three-stdlib`

## Scripts

```bash
npm install
npm run dev        # dev server
npm run build      # type-check + production build
npm run preview    # serve the production build
npm run typecheck  # tsc project build without emitting
```

## How it works

All geometry is millimetres, Z-up, with the back face at `z = 0`.

1. The silhouette is generated as a `THREE.Shape` (circle, rounded square, or an uploaded
   SVG). The keyring lug is unioned onto the top edge and the junction is blended.
2. The lug hole, pocket cutout, and engraved artwork are built as 2D polygons and applied
   with boolean operations.
3. The plate is assembled from stacked `ExtrudeGeometry` layers:
   - `back-engrave` — bottom layer with the mirrored artwork cut out
   - `body` — main plate
   - `pocket-shell` — top skin with the pocket cut out, forming a blind recess
4. The R3F group is exported directly with `STLExporter`, so the downloaded file matches the
   preview exactly.

Back artwork is mirrored in X before extrusion so it reads correctly when the keychain is
turned over. Text is generated from bundled fonts (Helvetiker, Droid Sans, Optimer) and may be
italic (fake oblique shear of `x' = x + y·tan(π/10)`) and bold (bundled face, or a synthetic
outline offset).

## Controls

- **Shape** — circle, square, or custom SVG silhouette with the plate diameter / dimensions.
- **Plate** — base thickness of the flat plate (the raised rim has been removed).
- **Keyring hole** — lug width, hole shape (`circle`, `square`, `heart`, `star`, or a custom
  uploaded SVG), and hole size. Every shape is fitted with at least 1.5 mm of material around it.
- **Pocket** — enabled by default with a circular blind recess; choose `circle`, `square`,
  `heart`, `star`, or upload a **custom** SVG as the recess shape, plus size / depth / corner
  radius when the shape is square.
- **Back artwork** — enable the engraving, pick text or a filled SVG logo, set the text, font
  family (`Helvetiker`, `Droid Sans`, `Optimer`), font weight (regular/bold), italic shear, the
  engraving depth, and the horizontal / vertical position of the text on the back.

## Performance

Heavy 2D boolean + extrusion work runs in a Web Worker (`src/workers/geometry.worker.ts`) and is
coalesced, so dragging a slider keeps the viewport smooth at 60 fps while the latest build
always wins.

## SVG uploads

Uploads are limited to 2 MB. The body must be a single filled, connected silhouette. Back
artwork may contain multiple disconnected pieces. Stroke-only and self-intersecting files are
rejected with an explanatory message.

## Layout

| File | Responsibility |
| --- | --- |
| `src/types/index.ts` | Shared state, polygon, and model types |
| `src/utils/shapes.ts` | Primitives, booleans, offsets, text + SVG parsing |
| `src/utils/geometry.ts` | Layer stack, lug, pocket, artwork placement |
| `src/utils/ExportSTL.ts` | Binary STL export + browser download |
| `src/components/KeychainModel.tsx` | R3F meshes and geometry disposal |
| `src/components/KeychainCanvas.tsx` | Canvas, lights, environment, orbit controls |
| `src/components/Controls.tsx` | Sidebar parameter controls |
| `src/App.tsx` | State, async artwork parsing, export flow |
