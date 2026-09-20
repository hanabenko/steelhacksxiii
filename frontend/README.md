# Interlock — Pittsburgh intersection sandbox

A Three.js frontend for exploring the **University of Pittsburgh campus between Forbes and Fifth avenues**, with one shared design spanning **Forbes/Bigelow, Fifth/Bigelow, and Forbes/Bouquet**. All app code, data, dependencies, and tests live in `frontend`. Development branch: `main`.

## Run

Node.js 20.19+ or 22.12+ is required by Vite (developed with Node 24).

```sh
cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5173. `npm run build` produces `frontend/dist`; `npm run preview` serves that build. No API key or backend is required for the local prototype. The app has no runtime map service dependency. Google Fonts are optional; system fonts are the fallback.

## What works

- **Orbit / Pan / Street** navigation: Pan is the default: left-drag to translate the view, right-drag to orbit, scroll to zoom. Street starts at the current camera target; left-drag to look, right-drag to move, wheel to walk smoothly, WASD to move, Q/E to descend/rise, and Shift to move faster. Movement is independent of traffic pause and stays enabled when the UI is hidden. The on-screen direction/elevation pad supports touch and keyboard activation. Camera movement is not clamped to the map crop; only the downloaded campus has geometry.
- There is no editing-site selector: select a tool and click or drop on any of the twelve exact blue footprints across all three intersections. Mouse navigation keeps the tool selected. Named approach groups in Design provide keyboard placement. All placements persist together, with a shared $100,000 budget. **Run all 3** uses the entire design, and the results selector compares all sites or each intersection separately.

- Full-screen 3D workspace with a blue, coral, and yellow Interlock identity. The bottom dock opens Design, Simulate, and Impact panels only when needed; the canvas never shrinks. Close a panel with its X, its dock button, or Escape. Keyboard focus returns to the opener.
- Larger Cantarell typography, stronger contrast, and infrastructure cards with a description, benefit, tradeoff, and per-approach price.
- A five-step **Walkthrough** opens the relevant panels and waits for a real placement and simulation before moving on. Replay it from the header; Skip/Escape closes it without resetting your design.
- Larger animated traffic lights and a signal display with countdown that follows the intersection nearest the center of the current view. Amber lasts three seconds and each transition has a one-second all-red clearance. Pause/speed controls affect both lights and traffic.
- A collapsed-by-default Build panel opens from Design. Build, Simulate and Impact use matching navy panels on the right; campus navigation stays visible at the left. Design and Settings toggle their panels closed on a second click. Number keys 1–5 select tools; cards support mouse/touch dragging, and the keyboard-placement disclosure contains approach buttons.
- Blue upgrade silhouettes use the exact same meshes and transforms as built infrastructure. Raycasting hits those meshes directly, with no offset circular targets. Invalid silhouettes turn red; Escape cancels. Approach buttons remain available for keyboard placement.
- Placement receipts and a removable-upgrades list make spending and refunds explicit. The comparison table explains its baseline and shows signed changes, with improvement/tradeoff colors.
- Stylized facade windows, shopfronts, striped awnings, roof parapets, ventilation equipment, and solar panels. Repeated architectural details use instanced meshes. Cars include glazed side windows, mirrors, round wheels, hubs, bumpers, and tail lights.
- Orbitable/zoomable 3D intersection with real OSM road/path centerlines, building footprints and 3D building parts, shadows, moving cars, walking pedestrians, traffic signal phases, and short-following-gap TTC markers.
- Drag an upgrade onto a highlighted approach, or select a tool and press an approach button. Escape deselects. Approach names refer to the scene's local axes.
- Raised crosswalks, bike lanes, curb extensions, bus stop shelters, and road diets; signals are baseline infrastructure at all three sites, rendered placements, duplicate prevention, $100,000 budget, undo, reset, and original/design comparison.
- Adjustable traffic demand, signal split, AV adoption, and Monte Carlo trial count. AVs get a teal roof marker in the preview. Crosswalks, curbs, and road diets reduce approach speed in the illustrative preview; lane rerouting remains a backend concern.
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

`osm-campus-source.xml` is a public OpenStreetMap API extract retrieved on 2026-09-19 from bbox `-79.9600,40.4405,-79.9490,40.4470`. `scripts/extract-campus.mjs` generates `src/data/intersection.json` using Forbes/Bigelow intersection node [105013345](https://www.openstreetmap.org/node/105013345) at **40.4431909, -79.9535474**. Coordinates are projected locally in meters and rotated to align Forbes with the scene x-axis. The displayed crop spans the Forbes–Fifth campus corridor from the Towers and Forbes shops to the Cathedral and Heinz Chapel, with edge context. Run `node scripts/extract-map.mjs` (or `extract-campus.mjs`) to regenerate from the checked-in campus extract.

© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution and source links are in the normal interface and data dialog. Source database geometry remains under ODbL.

The Cathedral uses its OSM building-part polygons and heights up to 163 m; its enclosing footprint is not extruded into an oversized solid tower. All three Litchfield Towers retain their circular OSM polygons and tagged heights. Closed building multipolygon shells and courtyard holes are retained, including the retail footprint containing El Jefe’s OSM POI at 3807 Forbes Avenue ([restaurant source](https://eljefestaqueria.com/)). Nodes provide tree and business positions; trees within six meters of existing or possible upgrade signals are suppressed. Roads and footpaths have distinct surfaces; illustrative actors follow the local road polylines.

Missing heights, facade windows, storefront decoration, awnings, roofs, road widths, signal hardware, costs and behavior remain illustrative. This is an OSM-based stylized model, not photogrammetry or a surveyed as-built model. All three editable intersections use OSM junction-node coordinates. Upgrade geometry stays attached to its intersection, and tree clearance includes all three sets of signal locations. The local comparison aggregates independent intersection responses under shared demand samples; it does not simulate coupled routing or queue spillback.

**No measured crash counts or traffic counts are loaded. No SUMO backend is included.** The default combined engine is `local-network-surrogate-v1` (per-site estimates use `local-surrogate-v1`), a transparent uncalibrated frontend model. It is not a crash predictor or evidence of a real infrastructure treatment effect.

### Local Monte Carlo model

`src/model.js` uses seed 42, paired samples, uniform demand variation (±15%), assumed baseline speed variation, and explicit intervention coefficients. Each pair shares baseline randomness. Each site receives the same paired random demand/noise draws, so combined confidence intervals are calculated from the combined trial values rather than assuming independent sites. Combined risk, speed, delay, and access are equal-demand averages; throughput is the sum of intersection passages and must not be read as unique campus vehicles. The before case uses original infrastructure, a 35-second Forbes green phase, and zero AV adoption; demand is shared with the proposed case. The after case applies selected upgrades, AV share, and signal split. Without interventions or setting changes, before and after match exactly.

- Conflict proxy is a synthetic index per 1,000 vehicles, **not a measured TTC-event rate or predicted crash count**.
- Pedestrian access and street score are game indices, not official planning measures.
- `ci` is the 95% normal-approximation half-width for the sampled mean, excluding structural/model uncertainty. It is not a real-world confidence bound.
- Visual traffic is separate from the Monte Carlo model. Its TTC overlay uses `(following separation - vehicle length) / closing speed` for same-lane actors, marking positive TTC below 1.5 s. It is an illustrative following conflict, not a validated collision detector. Pedestrians are decorative walking actors; turning movements and vehicle–pedestrian interaction physics are future backend work.

## Connect Python / SUMO

Copy `.env.example` to `.env.local`, set `VITE_SIMULATION_API_URL=http://127.0.0.1:8000/simulate`, and restart Vite. Enable CORS for the frontend origin in your Python service. `VITE_*` values are public browser configuration; do not place secrets there.

`src/simulation.js` sends:

```json
{
  "schemaVersion": 2,
  "intersection": "pitt-campus-network",
  "intersections": [
    {"id":"pitt-forbes-bigelow","origin":[0,0],"sourceUrl":"https://www.openstreetmap.org/node/105013345"},
    {"id":"pitt-fifth-bigelow","origin":[-24.6,-170.48],"sourceUrl":"https://www.openstreetmap.org/node/105097584"},
    {"id":"pitt-forbes-bouquet","origin":[-280.56,0],"sourceUrl":"https://www.openstreetmap.org/node/105013320"}
  ],
  "upgrades": [{"type":"crosswalk","zone":"north","intersection":"pitt-fifth-bigelow"}],
  "settings": { "demand": 800, "green": 35, "av": 0, "runs": 100 },
  "seed": 42
}
```

The endpoint must return an aggregate metric block plus an `intersections` array with exactly one result per requested ID. Each per-site entry has its `id`, `name`, and the same metric/provenance block below. Missing or duplicate sites are rejected; older single-intersection responses are not silently accepted. Schema version 2 exports also retain the intersection on every upgrade.

Common metric/provenance block (illustrative values; used at the top level and within every site entry):

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

Units: risk proxy / 1,000 vehicles; speed mph; delay seconds/vehicle; per-site throughput vehicles/hour, aggregate throughput intersection passages/hour; access 0–100. `reduction` and `retained` are percentages, `score` is 0–100. The backend owns calibration, network construction, rerouting, SUMO runs, SSM extraction, objective aggregation, and return of matching metrics. The current frontend supports one synchronous response with a 60-second timeout; long-running SUMO jobs should gain a job/polling adapter before production use. Backend errors or malformed results are surfaced and never silently replaced by local results.

## Files

- `src/main.js` — UI state, interactions, results, dialogs, export.
- `src/scene.js` — Three.js scene and illustrative actors at all three sites.
- `src/navigation.js` — orbit, pan, street perspective, keyboard/touch movement.
- `src/intersections.js` — OSM junction identifiers and projected positions.
- `src/architecture.js` — batched, footprint-aligned facade details.
- `src/model.js` — catalog, budget rules, local Monte Carlo model.
- `src/simulation.js` — network adapter and response validation.
- `src/data/intersection.json` — attributed geometry extract.
- `tests/*.test.js` — offline Node tests.
- `tests/browser/workbench.spec.js` — Playwright interaction tests.

## Traffic preview and collision replay

Campus traffic follows longer OSM-centerline routes: eastbound Forbes, westbound Fifth, both Bigelow directions, southbound Bouquet, and a curved turn onto Forbes. Bounded acceleration/braking, speed-dependent following gaps, red/amber stopping, turn slowdown and brake lights replace abrupt stop/start loops. This is an illustrative frontend model, not measured driving behavior or calibrated SUMO.

**Navigate campus > Preview collision + fire** stages two demonstration vehicles approaching, impacting, sliding, and emitting animated flames/smoke. The replay clears after 12 simulation seconds; pause, speed and the Events layer apply. It never changes budget, score or risk estimates and does not imply that ordinary crashes cause fires.

Collision replays now create a temporary obstruction: approaching cars brake and queue even on green, with hazard lights; distant traffic continues. Nearby pedestrians turn toward the incident, back away along the sidewalk if too close, or wait. Once the replay clears, cars accelerate and pedestrians resume after staggered waits. These responses are illustrative, not calibrated crash behavior. The navigation panel lives at the upper left; location shortcuts and the Live Preview badge have been removed. Invalid placement hovers show the exact duplicate or insufficient-budget message.


## Road alignment, transit and local costs

Markings and avenue-name meshes follow OSM centerlines, including curves. Crosswalks use the local tangent's perpendicular and the same road width as the renderer, reaching onto both sidewalks. Long bike lanes and road diets deform along the centerline; previews and installed objects share these meshes. Road geometry is clipped to the entire 900 × 800 meter ground field, covering all vehicle routes. Lane widths and sign hardware remain illustrative where not surveyed.

The checked-in OSM XML supplies bench, bicycle-parking, bin and PRT-stop coordinates. Shelter and bench tags determine existing stop amenities; absent shelter tags are not treated as confirmed shelters. Additional buildable shelters are proposed design interventions. Vehicle types include cars, bicycles and stylized PRT buses, with type-specific lengths and speeds. Buses brake and dwell at nearby mapped stops; fleet mix and dwell times are assumptions, not a GTFS timetable.

`src/data/oakland-costs.json` records Oakland, Pittsburgh sources, review date, published cost bands and the reported $110,000 Terrace/DeSoto project total. The public sources found do **not** publish unit bid prices for the five tools. Individual amounts remain labeled planning allowances, not local contractor quotations; the project total is a contextual benchmark, not divided into invented unit rates. The cost-source dialog and scenario export retain this distinction. Construction estimates require project-specific scope, drainage, utility, accessibility and procurement information.

## Pedestrian safety in the live preview

Bicycle wheels roll around fixed axles using actual traveled distance, with spokes, a triangular frame and articulated pedaling. Pedestrians swing limbs from their joints, watch traffic, and wait for a clear vehicle corridor before continuing. Drivers brake for people in their path. These gap and braking rules are illustrative.

Swept vehicle/pedestrian contact records one preview accident per injured pedestrian, stops the involved vehicle, animates a fall and leaves a small blood mark that fades. Injured pedestrians and marks clear after 14 preview seconds; pause and playback speed apply. The navigation panel shows the session's pedestrian accident count. This observed preview counter is separate from Monte Carlo risk proxies and does not alter their score or forecasts.

## Play challenges and free simulation

The app opens in free simulation. The yellow **Run simulation** button opens settings without executing trials or changing values. Set demand, green time, AV share, weather, closed approach, pothole location, starting hour, day/night cycling, and a custom budget. **Edit streets** opens infrastructure tools; the panel's Run simulation button executes paired trials.

**Play** replaces the bottom button with Design / Simulate / Impact and reveals campus navigation. A random rainy commute, thunderstorm, construction closure, or pothole challenge fixes the environment, demand, timing, AV share and a $60k/$80k/$100k budget. New challenge resets that challenge's design. Exit game restores the prior free-simulation design and settings. Fixed scenario hazards cannot be removed with Undo; matching pothole repairs resolve the pothole.

Construction barriers ($4,000 planning allowance) and pothole repairs ($8,000 planning allowance) can be placed like other infrastructure. Closures stop and queue approaching preview vehicles; they do not compute alternative routes. Weather reduces preview speed and surrogate capacity and increases the assumed conflict proxy. A pothole slows nearby vehicles; matching repairs remove that penalty. Weather and road hazards affect both baseline and redesigned trials; placed barriers affect the redesign. These coefficients and prices are illustrative assumptions, not observed Pittsburgh weather, engineering estimates or calibrated SUMO results.

Running starts a looping lighting clock (30 simulated seconds per hour). Pause freezes it; 1× / 10× / 100× accelerates the preview and clock. Weather particles and storm lighting show the selected weather. The day/night cycle is visual; it does not claim a calibrated nighttime crash-risk model. Preview motion uses bounded traffic substeps; the network surrogate still does not model rerouting or cross-intersection queue spillback.
