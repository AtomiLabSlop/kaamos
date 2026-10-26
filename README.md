# Kaamos

Kaamos is a 3D product rendering studio that runs in the browser. Import a
model, give its parts materials, light it, and render a high-resolution image.

**Try it:** https://atomilab.fi/kaamos/ (desktop browser; Chrome recommended)

## Your models stay on your computer

Kaamos has no server side. Models, environment maps and images are read by
the browser and are never uploaded. Projects are saved as files on your own
computer, and an automatic backup is kept in the browser's own storage
(IndexedDB) on the same machine.

The hosted site adds one page-view counter (self-hosted Umami, no cookies) at
deploy time. It counts visits; it never sees your files. This repository is
otherwise the code the site runs, so you can check this for yourself, or run
Kaamos locally with no network access at all.

## What it does

- **Import** GLB and glTF, OBJ, STEP and IGES (STEP/IGES are meshed in the
  browser with OpenCascade compiled to WebAssembly).
- **Materials:** a library of plastics, metals, glass, paint, ceramic,
  translucent, fabric and emissive presets, and an editor for colour,
  metallic, roughness, clearcoat, transmission, sheen, emission and
  subsurface scattering. Click to apply, or drag onto a part.
- **Lighting:** studio presets, area lights, and your own HDRI (.hdr, .exr).
- **Camera:** perspective and orthographic, field of view, exposure, tone
  mapping, depth of field, saved viewpoints.
- **Two renderers, labelled as such:** a real-time raster view, and a path
  tracer (light bounces, refraction, soft shadows) for final images, with
  optional denoising. PNG output, with a transparent background if wanted.
- **Projects** are single files that embed the original models.

## Run it locally

Needs a current Node.js (20.19 or newer).

```bash
npm start
```

installs the dependencies, starts the development server and opens the app.

| Command | Does |
|---|---|
| `npm start` | install, dev server, open browser |
| `npm run dev` | dev server only |
| `npm run build` | type check and production build into `dist/` |
| `npm run build:web` | production build for hosting under `/kaamos/` |
| `npm run preview` | build, then serve the build |
| `npm run check` | build, then the end-to-end smoke test (Playwright) |

The smoke test drives a real Chromium; fetch it once with
`npx playwright install chromium`.

## How it is built

React 19, TypeScript, Three.js with React Three Fiber and drei, Zustand for
state, Tailwind CSS, Vite. The interface is built on Adobe's
[Spectrum 2](https://react-spectrum.adobe.com/) components, set in Source Sans 3
and recoloured to Kaamos amber at build time (`vite.config.ts`). Path tracing is
[three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) on
[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh); STEP and IGES
come through [occt-import-js](https://github.com/kovacsv/occt-import-js).

A few decisions that shape the code:

- **Two stores, both plain data.** `src/store/project.ts` is the project
  document (with undo and redo), `src/store/ui.ts` is interface state. No
  Three.js object enters either; those live in a registry
  (`src/scene/registry.ts`) and are disposed when history no longer needs them.
- **Material sliders bypass React.** Dragging a slider changes the shared
  `MeshPhysicalMaterial` directly (`src/materials/materialInstances.ts`) and
  asks for one redraw; the viewport only draws on demand.
- **The path tracer is patched, not forked.** Subsurface scattering and a NaN
  guard for Safari are added by rewriting the library's shader at run time
  (`src/render/subsurface.ts`); each patch checks that its anchors are still
  there and warns if a library update has moved them.
- **Large projects are a binary container** (`src/io/projectFile.ts`), since
  a model of several hundred megabytes cannot be held as one base64 string.

## Known limitations

- Desktop browsers only. Tested mostly in Chrome and Safari on macOS.
- Path traced renders depend on the graphics chip; on integrated graphics a
  large scene or output can lose the graphics context.
- Models over about a million triangles make the view slow.
- Subsurface scattering, glass seen through glass and light from glowing
  materials show only in path traced views.
- Textures that come with an imported file are kept but cannot be edited.

## Contributing

Kaamos is a side project. Bug reports and ideas are welcome as issues; pull
requests are read, but may not be reviewed quickly.

## Licence

Copyright (c) 2026 AtomiLab.

Kaamos is free software under the GNU Affero General Public License, version 3
only (AGPL-3.0-only); see [LICENSE](LICENSE). In short: you may use, study,
change and share it, and if you run a changed version for others over a
network, you must offer them its source under the same licence.

The name **Kaamos** and the Kaamos logo identify this project. The licence
covers the code and its files, not the use of the name or logo as the name or
branding of another product or service.

Third-party libraries keep their own licences, listed by their packages.
