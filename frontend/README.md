# Interlock — Pittsburgh intersection sandbox

A Three.js frontend for designing and comparing changes at **Penn Avenue × 21st Street** in Pittsburgh’s Strip District. All app code, data, dependencies, and tests live in `frontend`. Development branch: `three_js_frontend`.

## Run

Node.js 20.19+ or 22.12+ is required by Vite (developed with Node 24).

```sh
cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5173. `npm run build` produces `frontend/dist`; `npm run preview` serves that build. No API key or backend is required for the local prototype. The app has no runtime map service dependency. Google Fonts are optional; system fonts are the fallback.

## What works

- Full-screen 3D workspace with a blue, coral, and yellow Interlock identity. The bottom dock opens Design, Simulate, and Impact panels only when needed; the canvas never shrinks. Close a panel with its X, its dock button, or Escape. Keyboard focus returns to the opener.
- Larger Cantarell typography, stronger contrast, and infrastructure cards with a description, benefit, tradeoff, and per-approach price.
- A five-step **Walkthrough** opens the relevant panels and waits for a real placement and simulation before moving on. Replay it from the header; Skip/Escape closes it without resetting your design.
- Larger animated traffic lights and a live two-street signal display with countdown. Amber lasts three seconds and each transition has a one-second all-red clearance. Pause/speed controls affect both lights and traffic.
- Pointer-based drag editing with labeled approach targets, a placement preview, invalid-placement feedback, and Escape cancellation. Touch users can drag using the card’s grip or select a tool and use the approach buttons.
- Placement receipts and a removable-upgrades list make spending and refunds explicit. The comparison table explains its baseline and shows signed changes, with improvement/tradeoff colors.
- Stylized facade windows, shopfronts, striped awnings, roof parapets, ventilation equipment, and solar panels. Repeated architectural details use instanced meshes. Cars include glazed side windows, mirrors, round wheels, hubs, bumpers, and tail lights.
- Orbitable/zoomable 3D intersection with real OSM centerlines and 44 building footprints, shadows, moving cars, walking pedestrians, traffic signal phases, and short-following-gap TTC markers.
- Drag an upgrade onto a highlighted approach, or select a tool and press an approach button. Escape deselects. Approach names refer to the scene's local axes.
- Raised crosswalks, bike lanes, curb extensions, smart signals, and road diets; rendered placements, duplicate prevention, $100,000 budget, undo, reset, and original/design comparison.
- Adjustable traffic demand, signal split, AV adoption, and Monte Carlo trial count. AVs get a teal roof marker in the preview. Road diets consolidate preview cars into one lane.
- Before/after speed, delay, throughput, conflict proxy, pedestrian-access index, street score, and three objectives. Changing the design invalidates old results.
- Export a JSON scenario with settings, placements, budget, seed, engine, and results.
- Keyboard placement, responsive layouts, reduced-motion support, and a non-WebGL fallback that retains editing and simulation controls.

## Tests

```sh
npm test                   # deterministic model, budget, geometry, and adapter tests
npm run build             # production compilation
npx playwright install chromium
npm run test:e2e           # browser workflows; launches its own local server
```

To use an installed Chrome instead of downloading Chromium:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
```

Run `npm test` after each major change, and browser tests after interaction/layout changes. These are behavioral tests, not brittle screenshots or exact catalog-size assertions. They must fail on real regressions: a test suite that passes regardless of code correctness would not protect the app. `AGENTS.md` preserves this working agreement for future updates.

Optional: with the dev server running, `node scripts/capture.mjs` saves desktop/mobile screenshots under ignored `artifacts/`.

## Data provenance and limits

`osm-source.xml` is an OpenStreetMap API extract retrieved on 2026-09-19 from bbox `-79.986,40.450,-79.978,40.455`. `scripts/extract-map.mjs` generates `src/data/intersection.json` using intersection node [105894148](https://www.openstreetmap.org/node/105894148) at **40.4516926, -79.983131**. Coordinates are projected locally in meters and rotated to align Penn Avenue with the scene x-axis. Run `node scripts/extract-map.mjs` to regenerate from the checked-in extract.

© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution is visible in the scene and data dialog. Source database geometry remains under ODbL.

Road centerlines and building footprints are real. Heights use tagged heights/levels when present, otherwise deterministic illustrative heights. Facade windows, storefronts, awnings, roof details, street widths, sidewalks, landscaping, traffic signal placement, construction costs, speeds, demand, and behavior are illustrative. OSM tags can lag actual street changes. The [City of Pittsburgh Penn Avenue Rightsizing project](https://engage.pittsburghpa.gov/penn-ave-rightsizing/october-2025-project-update) provides real planning context; this scene is not a surveyed as-built model.

**No measured crash counts or traffic counts are loaded. No SUMO backend is included.** The default engine is `local-surrogate-v1`, a transparent uncalibrated frontend model. It is not a crash predictor or evidence of a real infrastructure treatment effect.

### Local Monte Carlo model

`src/model.js` uses seed 42, paired samples, uniform demand variation (±15%), assumed baseline speed variation, and explicit intervention coefficients. Each pair shares baseline randomness. The before case uses original infrastructure, a 35-second Penn green phase, and zero AV adoption; demand is shared with the proposed case. The after case applies selected upgrades, AV share, and signal split. Without interventions or setting changes, before and after match exactly.

- Conflict proxy is a synthetic index per 1,000 vehicles, **not a measured TTC-event rate or predicted crash count**.
- Pedestrian access and street score are game indices, not official planning measures.
- `ci` is the 95% normal-approximation half-width for the sampled mean, excluding structural/model uncertainty. It is not a real-world confidence bound.
- Visual traffic is separate from the Monte Carlo model. Its TTC overlay uses `(following separation - vehicle length) / closing speed` for same-lane actors, marking positive TTC below 1.5 s. It is an illustrative following conflict, not a validated collision detector. Pedestrians are decorative walking actors; turning movements and vehicle–pedestrian interaction physics are future backend work.

## Connect Python / SUMO

Copy `.env.example` to `.env.local`, set `VITE_SIMULATION_API_URL=http://127.0.0.1:8000/simulate`, and restart Vite. Enable CORS for the frontend origin in your Python service. `VITE_*` values are public browser configuration; do not place secrets there.

`src/simulation.js` sends:

```json
{
  "schemaVersion": 1,
  "intersection": "penn-21st-pittsburgh",
  "upgrades": [{ "type": "crosswalk", "zone": "north" }],
  "settings": { "demand": 800, "green": 35, "av": 0, "runs": 100 },
  "seed": 42
}
```

The endpoint must return the following shape (values below are only a schema example):

```json
{
  "engine": "sumo-your-version",
  "before": {
    "risk": { "mean": 12, "ci": 1 },
    "speed": { "mean": 29, "ci": 0.5 },
    "delay": { "mean": 33, "ci": 0.8 },
    "throughput": { "mean": 800, "ci": 10 },
    "access": { "mean": 48, "ci": 0 }
  },
  "after": {
    "risk": { "mean": 9, "ci": 0.7 },
    "speed": { "mean": 26, "ci": 0.5 },
    "delay": { "mean": 35, "ci": 0.8 },
    "throughput": { "mean": 780, "ci": 10 },
    "access": { "mean": 70, "ci": 0 }
  },
  "reduction": 25,
  "retained": 97.5,
  "score": 57,
  "seed": 42,
  "runs": 100
}
```

Units: risk proxy / 1,000 vehicles; speed mph; delay seconds/vehicle; throughput vehicles/hour; access 0–100. `reduction` and `retained` are percentages, `score` is 0–100. The backend owns calibration, network construction, rerouting, SUMO runs, SSM extraction, objective aggregation, and return of matching metrics. The current frontend supports one synchronous response with a 60-second timeout; long-running SUMO jobs should gain a job/polling adapter before production use. Backend errors or malformed results are surfaced and never silently replaced by local results.

## Files

- `src/main.js` — UI state, interactions, results, dialogs, export.
- `src/scene.js` — Three.js scene and illustrative actors.
- `src/architecture.js` — batched, footprint-aligned facade details.
- `src/model.js` — catalog, budget rules, local Monte Carlo model.
- `src/simulation.js` — network adapter and response validation.
- `src/data/intersection.json` — attributed geometry extract.
- `tests/*.test.js` — offline Node tests.
- `tests/browser/workbench.spec.js` — Playwright interaction tests.
