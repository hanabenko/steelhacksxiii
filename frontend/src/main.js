import {gameComparison} from './game-trials.js';
import {DRIVING_DATA} from './driving-data.js';
import {historicalWeather,WEATHER_DATA} from './weather.js';
import { makeScenario, DEFAULT_CONDITIONS, WEATHER } from './scenarios.js';
import {ROAD_BLOCKS} from './road-blocks.js';
import './modes.css';
import { COST_DATA } from './model.js';
import './build-tray.css';
import {
    INTERSECTIONS,
    DEFAULT_INTERSECTION,
    intersectionById,
} from "./intersections.js";
import {
    createIcons,
    Route,
    Box,
    FolderOpen,
    CircleHelp,
    Download,
    MapPin,
    Map,
    ArrowUpRight,
    Wallet,
    Footprints,
    Bike,
    CornerDownRight,
    TrafficCone,
    GripVertical,
    MousePointer2,
    Undo2,
    RotateCcw,
    Layers,
    Plus,
    Minus,
    Scan,
    Navigation,
    TriangleAlert,
    Mouse,
    Pause,
    SlidersHorizontal,
    Shuffle,
    Play,
    Sprout,
    ShieldCheck,
    MoveRight,
    Accessibility,
    FlaskConical,
    Columns2,
    X,
    LoaderCircle,
} from "lucide";
import "./style.css";
import "./immersive.css";
import "./readability.css";
import "./guidance.css";
import "./game.css";
import "./campus.css";
import "./network.css";
import "./product-shell.css";
import { createWalkthrough } from "./walkthrough.js";
import { installInfrastructureDrag } from "./infrastructure-drag.js";
import { createIntersection } from "./scene.js";
import {
    BUDGET,
    TOOLS,
    DEFAULT_SETTINGS,
    costOf,
    addUpgrade,
    exportScenario,
} from "./model.js";
import { runSimulation } from "./simulation.js";
import {createServices,sceneContext} from './services.js';
import {installAssistant} from './assistant.js';
import {installSumoStudy} from './sumo-study.js';
import {trialPreviewPlan} from './trial-preview.js';
import map from "./data/intersection.json" with { type: "json" };

const icon = (name, cls = "") =>
    `<i data-lucide="${name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}" class="${cls}"></i>`;
const icons = {
    Route,
    Box,
    FolderOpen,
    CircleHelp,
    Download,
    MapPin,
    Map,
    ArrowUpRight,
    Wallet,
    Footprints,
    Bike,
    CornerDownRight,
    TrafficCone,
    GripVertical,
    MousePointer2,
    Undo2,
    RotateCcw,
    Layers,
    Plus,
    Minus,
    Scan,
    Navigation,
    TriangleAlert,
    Mouse,
    Pause,
    SlidersHorizontal,
    Shuffle,
    Play,
    Sprout,
    ShieldCheck,
    MoveRight,
    Accessibility,
    FlaskConical,
    Columns2,
    X,
    LoaderCircle,
};
const money = (n) =>
    new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(n);
let items = [],
    settings = { ...DEFAULT_SETTINGS, conditions:{...DEFAULT_CONDITIONS}, budget:BUDGET },
    selected = null,
    result = null,
    running = false,
    paused = matchMedia("(prefers-reduced-motion: reduce)").matches,
    topView = false,
    baselineView = false,
    revision = 0;
const simulationEndpoint = import.meta.env.VITE_SIMULATION_API_URL || "";
let scene, tutorial;
let gameBaseline=null;
let gameMode=false, activeScenario=null, freeSession=null, budgetLimit=BUDGET, hazardTool=null;
let assistant, sumoStudy;
const services=createServices({base:import.meta.env.VITE_APP_API_URL||'/api'});

const intersectionOptions = INTERSECTIONS.map(
    (site) => `<option value="${site.id}">${site.name}</option>`,
).join("");
const app = document.querySelector("#app");
app.innerHTML = `
  <header class="header"><a class="brand" href="./" aria-label="Interlock home"><span class="brand-mark">${icon("Route")}</span>Interlock<span class="brand-dot">.</span></a><nav class="mode-switcher" aria-label="Product mode"><button class="nav-button active" id="play-mode" aria-pressed="true">Play</button><button class="nav-button" id="model-mode" aria-pressed="false">Model</button></nav><div class="header-secondary"><span class="hud-budget">${icon("Wallet")}<span id="budget-hud">$100,000</span><small>AVAILABLE</small></span><button class="quiet-button icon-button" id="guide-button" aria-label="Help and walkthrough" title="Help and walkthrough">${icon("CircleHelp")}</button><button class="quiet-button" id="settings-button">${icon("SlidersHorizontal")} Settings</button></div></header>
  <main>
    <section class="page-heading"><div><div class="eyebrow"><span class="live-dot"></span> BETTER STREETS START HERE</div><h1>A small change. A safer city.</h1><p>Rethink a real intersection. Test the tradeoffs. Find a better way forward.</p></div><button class="outline-button" id="export-button">${icon("Download")} Export scenario</button></section>
    <section class="location-bar"><div class="location-icon">${icon("MapPin")}</div><div><h2>Forbes <span>↔</span> Fifth</h2><p>Pitt campus · Oakland</p></div><span class="location-tag">CAMPUS SANDBOX</span><div class="location-detail">${icon("Map")} <span>Real street geometry<small>OpenStreetMap · illustrative traffic</small></span></div><button class="text-button" id="data-button">Explore the data ${icon("ArrowUpRight")}</button></section>
    <div class="workbench">
      <aside class="tools-panel panel"><div class="section-heading"><h2>Design your street</h2><span class="step">01</span></div><p class="panel-description">Build across campus. One shared budget.</p>
        <div class="budget-card"><div><span>Available budget</span>${icon("Wallet")}</div><strong id="budget">$100,000</strong><div class="budget-track"><span id="budget-fill"></span></div><p><span id="spent">$0 invested</span><span>of $100k</span></p></div>
        <p id="network-design-status">3 intersections · shared $100,000 budget</p><p class="budget-explain">One shared budget covers all three intersections. Each placement spends the card’s price. <strong>Undo or remove an upgrade to get a full refund.</strong></p><p id="budget-receipt" role="status"></p><details class="placed-upgrades"><summary id="placed-summary">0 upgrades placed</summary><ul id="placed-list"></ul></details><div class="mini-heading">INFRASTRUCTURE <span>DRAG TO PLACE</span></div>
        <div class="tool-list">${TOOLS.map((t) => `<button class="tool-card" draggable="true" data-tool="${t.id}" data-quick-tool="${t.id}" aria-pressed="false"><span class="tool-icon">${icon(t.icon)}</span><span class="tool-copy"><strong>${t.name}</strong><small>${t.detail}</small><span class="tool-benefit">${t.benefit}</span><span class="tool-tradeoff">Tradeoff: ${t.tradeoff}</span><span class="tool-footer"><b>${money(t.cost)} est.</b><span class="tool-unit">per approach</span></span></span>${icon("GripVertical", "drag-grip")}</button>`).join("")}</div>
        <p class="placement-help">${icon("MousePointer2")} Drag onto the street, or select a tool and choose an approach.</p>
        <div id="approaches" class="approaches" hidden><span>Keyboard placement · all three sites</span>${INTERSECTIONS.map((site) => `<fieldset><legend>${site.name}</legend><div>${["north", "east", "south", "west"].map((z) => `<button data-intersection="${site.id}" data-zone="${z}">${z[0].toUpperCase() + z.slice(1)}</button>`).join("")}</div></fieldset>`).join("")}</div>
        <div class="edit-actions"><button id="undo" disabled>${icon("Undo2")} Undo</button><button id="reset" disabled>${icon("RotateCcw")} Reset design</button></div>
        <div class="design-count"><span class="live-dot"></span><span id="upgrade-count">Your canvas is ready. Make it yours.</span></div>
      </aside>
      <section class="center-panel"><div class="scene-shell"><div class="scene-topbar"><div class="view-tabs"><button class="selected" id="view-3d">${icon("Box")} 3D view</button><button id="view-top">${icon("Map")} Top down</button></div></div><div id="scene"></div>
        <section class="signal-hud" aria-label="Live traffic signals"><div class="signal-heading"><strong>Live signals</strong><span id="signal-countdown">35s to change</span></div><div class="signal-row"><span>Forbes Ave</span><span class="signal-lights" id="signal-penn" data-state="red"><i class="red"></i><i class="amber"></i><i class="green"></i></span><b id="signal-penn-text">Red</b></div><div class="signal-row"><span>Bigelow</span><span class="signal-lights" id="signal-cross" data-state="red"><i class="red"></i><i class="amber"></i><i class="green"></i></span><b id="signal-cross-text">Red</b></div><small>Synced to the 3D preview · 70s cycle</small></section><div id="placement-hint" hidden><strong id="placement-name"></strong><span>Drop on the matching blue shape. Click a shape to place, or use Design for approach buttons.</span><button id="cancel-placement">Cancel</button></div><details class="navigation-panel" open><summary>Navigate campus</summary><div class="navigation-modes"><button data-navigation="orbit" aria-pressed="true">Orbit</button><button data-navigation="pan" aria-pressed="false">Pan</button><button data-navigation="street" aria-pressed="false">Street</button></div><p id="navigation-help">Drag to orbit · WASD to move</p><div class="navigation-pad"><button data-move="forward" aria-label="Move forward">↑</button><button data-move="left" aria-label="Move left">←</button><button data-move="back" aria-label="Move backward">↓</button><button data-move="right" aria-label="Move right">→</button><button data-move="up" aria-label="Rise">Rise</button><button data-move="down" aria-label="Lower">Lower</button></div><button id="collision-demo">Preview collision + fire</button><small>Scripted visual only · not a risk prediction</small><small>Q / E elevation · Shift faster<br>Movement stays available with UI hidden.</small></details><div class="map-controls"><button id="layers-button" aria-label="Map layers" aria-expanded="false">${icon("Layers")}</button><span></span><button id="zoom-in" aria-label="Zoom in">${icon("Plus")}</button><button id="zoom-out" aria-label="Zoom out">${icon("Minus")}</button><span></span><button id="recenter" aria-label="Recenter camera">${icon("Scan")}</button></div>
        <div class="layer-menu" id="layer-menu" hidden><strong>Scene layers</strong><label><input type="checkbox" data-layer="buildings" checked> Buildings</label><label><input type="checkbox" data-layer="pedestrians" checked> Pedestrians</label><label><input type="checkbox" data-layer="events" checked> Near-miss markers</label></div>
        <div class="north-arrow"><span>N</span>${icon("Navigation")}</div>
        <div class="scene-legend"><span><i class="legend-dot vehicles"></i> Vehicles</span><span><i class="legend-dot people"></i> Pedestrians</span><span><i class="legend-dot conflicts"></i> Near misses</span></div>
        <div id="event-chip" class="event-chip" hidden>${icon("TriangleAlert")} <span></span></div>
        <div class="scene-footer"><span>${icon("Mouse")} Left drag to move <b>·</b> Right drag to orbit</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></div>
      </div>
      <div class="playback"><button id="pause" aria-label="Pause animation">${icon("Pause")}</button><div class="playback-status"><strong id="playback-title">A city in motion</strong><span>Illustrative traffic preview</span></div><div class="playback-wave">${Array.from({ length: 35 }, (_, i) => `<i style="height:${6 + ((i * 7) % 19)}px"></i>`).join("")}</div><div class="speed-control"><button data-speed="1" class="selected">1×</button><button data-speed="10">10×</button><button data-speed="100">100×</button></div></div>
      <section class="simulation-settings panel"><div class="section-heading"><h2>${icon("SlidersHorizontal")} Simulation settings</h2><span class="subtle">Make the scenario your own</span></div><div class="settings-grid"><label>Demand per intersection <output id="demand-value">800 veh/h</output><input id="demand" type="range" min="200" max="1600" step="100" value="800"><span>Quiet <span>Rush hour</span></span></label><label>Shared green phase <output id="green-value">35 sec</output><input id="green" type="range" min="20" max="60" step="5" value="35"><span>Forbes Avenue <span>70s cycle</span></span></label><label>Autonomous vehicles <output id="av-value">0%</output><input id="av" type="range" min="0" max="100" step="10" value="0"><span>All human <span>All autonomous</span></span></label></div><p id="traffic-data-note" class="network-run-note"></p><p class="network-run-note">One run tests all 3 intersections with these shared settings. Compare combined results or choose a single site afterward.</p><div class="run-row"><label for="runs">${icon("Shuffle")} Monte Carlo runs <select id="runs"><option value="100">100 runs</option><option value="500">500 runs</option><option value="1000">1,000 runs</option></select></label><span class="seed-tag">Seed 42 · paired samples</span><button id="run" class="primary-button">${icon("Play")} Run simulation</button></div></section>
      </section>
      <aside class="results-panel panel"><div class="section-heading"><h2>Your mission</h2><span class="step">02</span></div><div class="mission-art">${icon("Sprout")}<span>STREETS FOR EVERYONE</span></div><h3>People first.<br>Keep Pittsburgh moving.</h3><p class="panel-description">Create a safer crossing without bringing the neighborhood to a stop.</p><div class="objectives"><div id="objective-risk"><span class="objective-icon">${icon("ShieldCheck")}</span><div><strong>Make it safer</strong><small>Reduce conflict proxy by 20%</small></div><span class="objective-status">○</span></div><div id="objective-flow"><span class="objective-icon">${icon("MoveRight")}</span><div><strong>Keep traffic flowing</strong><small>Retain 95% of throughput</small></div><span class="objective-status">○</span></div><div id="objective-access"><span class="objective-icon">${icon("Accessibility")}</span><div><strong>Put people first</strong><small>Reach 65 pedestrian access</small></div><span class="objective-status">○</span></div></div>
      <div class="score-card"><div><span>STREET SCORE</span><strong id="score">—<small>/ 100</small></strong></div><svg viewBox="0 0 70 70" aria-hidden="true"><circle cx="35" cy="35" r="28"/><circle id="score-ring" cx="35" cy="35" r="28"/><path d="m25 35 7 7 14-15"/></svg></div>
      <div class="section-heading result-heading"><h2>The impact</h2><span class="mini-pill" id="result-status">NOT RUN YET</span></div><label class="result-scope">Compare <select id="result-scope" disabled><option value="network">All 3 intersections</option>${intersectionOptions}</select></label><p id="aggregation-note">Run all three sites together. Throughput counts intersection passages; other metrics average across sites. Local estimates exclude rerouting and queue spillback.</p><p class="comparison-explain"><strong>Before:</strong> original street, default signals, no AVs.<br><strong>After:</strong> your upgrades and settings.<br>Both use the same traffic demand and random seed.</p><div class="metric-table"><div class="metric-header"><span>METRIC</span><span>BEFORE</span><span>AFTER</span><span>CHANGE</span></div>${[
          ["risk", "Conflict proxy", "/ 1k vehicles"],
          ["speed", "Avg. speed", "mph"],
          ["delay", "Avg. delay", "sec / vehicle"],
          ["throughput", "Throughput", "vehicles / hour"],
          ["access", "Pedestrian access", "index / 100"],
      ]
          .map(
              ([key, name, unit]) =>
                  `<div class="metric-row"><div>${name}<small>${unit}</small></div><span id="before-${key}">—</span><strong id="after-${key}">—</strong><span class="metric-change" id="change-${key}">—</span></div>`,
          )
          .join(
              "",
          )}</div><p class="change-key"><span>● Improvement</span><span>● Tradeoff</span><span>— No change</span></p><button id="results-run" class="primary-button">Set up a simulation →</button><div class="result-note" id="result-note">${icon("FlaskConical")} Run your design to see what changes. Results use an uncalibrated local model.</div><button id="compare" class="compare-button" disabled>${icon("Columns2")} Compare with original</button></aside>
    </div><footer class="page-footer"><span>${icon("MapPin")} Built around Pittsburgh. Designed for possibility.</span><span>Real geometry <b>·</b> Experimental model <b>·</b> Human-centered streets</span></footer>
  </main><section class="upgrade-bar" aria-label="Quick upgrades"><div class="upgrade-bar-heading"><strong>BUILD <span id="tray-budget">$100,000</span></strong><span>Drag a card → match the blue silhouette</span></div><div class="upgrade-slots">${TOOLS.map((t, i) => `<button data-quick-tool="${t.id}" aria-label="Select ${t.name}" aria-pressed="false" title="${t.name}: ${t.detail}"><kbd>${i + 1}</kbd>${icon(t.icon)}<strong>${{ crosswalk: "Crosswalk", bike: "Bike lane", curb: "Curb extension", shelter: "Bus shelter", diet: "Road diet" }[t.id]}</strong><span>${money(t.cost)}</span>${icon("GripVertical", "drag-grip")}</button>`).join("")}</div></section><div class="quick-simulation"><button id="quick-run" aria-label="Quick run simulation">${icon("Play")} Run simulation</button><button id="quick-settings">${icon("SlidersHorizontal")} Settings · <span id="quick-runs">100</span> trials</button></div><nav class="action-dock" aria-label="Intersection tools"><button data-panel="design" aria-controls="design-panel" aria-expanded="false"><span class="dock-icon">${icon("Route")}</span><span><strong>Design</strong><small>Make your move</small></span></button><span class="dock-divider"></span><button data-panel="simulation" aria-controls="simulation-panel" aria-expanded="false"><span class="dock-icon">${icon("Play")}</span><span><strong>Simulate</strong><small>Test the possibilities</small></span></button><span class="dock-divider"></span><button data-panel="results" aria-controls="results-panel" aria-expanded="false"><span class="dock-icon">${icon("ShieldCheck")}</span><span><strong>Impact</strong><small>Find your balance</small></span></button></nav><div class="explore-hint"><span class="hint-dots"><i></i><i></i><i></i></span><button id="tour-launch">New here? Take the walkthrough →</button></div><div id="toast" role="status" aria-live="polite"></div><dialog id="dialog"><div class="dialog-heading"><h2 id="dialog-title"></h2><button id="close-dialog" aria-label="Close dialog">${icon("X")}</button></div><div id="dialog-content"></div></dialog>`;
const $ = (selector) => document.querySelector(selector);
document.body.dataset.mode='model';
const sourcesButton=$('#data-button');sourcesButton.textContent='Data sources & model limits';
$('.simulation-settings').append(sourcesButton);$('.location-bar').remove();
$('#quick-run').setAttribute('aria-label','Run simulation settings');
$('.action-dock').insertAdjacentHTML('afterend','<section class="scenario-banner" hidden aria-label="Current challenge"><div class="challenge-copy"><small>PLAY · CURRENT CHALLENGE</small><strong id="scenario-title"></strong><p id="scenario-description"></p><dl class="challenge-context"><div><dt>Location</dt><dd id="challenge-location">Pitt campus · Oakland</dd></div><div><dt>Current event</dt><dd id="challenge-constraint"></dd></div></dl></div><div class="challenge-details"></div><div class="challenge-actions"><button id="play-edit-design">Modify street</button><button id="new-challenge">New challenge</button></div></section>');
$('.playback-status span').id='environment-status';
const hazardOptions='<option value="">None</option>'+INTERSECTIONS.flatMap(site=>['north','east','south','west'].map(zone=>`<option value="${site.id}/${zone}">${site.name} · ${zone}</option>`)).join('');
$('.settings-grid').insertAdjacentHTML('afterend',`<fieldset id="condition-controls"><legend>Simulation conditions</legend><p id="mode-explanation">Free simulation: set your own conditions and budget.</p><label>Weather<select id="weather">${Object.entries(WEATHER).map(([id,w])=>`<option value="${id}">${w.label}</option>`).join('')}</select></label><label>Historical weather date<input id="weather-date" type="date" min="2019-01-01" max="2025-12-31" value="2025-01-01"></label><button type="button" id="apply-weather-date">Use historical weather</button><p id="weather-source" role="status"></p><label>Closed approach<select id="closed-road">${hazardOptions}</select></label><label>Large pothole<select id="pothole-road">${hazardOptions}</select></label><label>Starting hour <output id="hour-value">09:00</output><input id="start-hour" type="range" min="0" max="23" value="9"></label><label class="cycle-setting"><input id="day-night" type="checkbox" checked> Day / night cycle</label><label>Build budget ($)<input id="scenario-budget" type="number" min="0" max="500000" step="1000" value="100000"></label></fieldset><div class="free-actions"><button id="free-design">Edit streets</button><button id="free-results">View impact</button></div>`);
$('#av').disabled=true;
$('#av').closest('label').insertAdjacentHTML('beforeend','<small class="unsupported-note">AV behavior is not supported by the current simulation contract.</small>');
for(const id of ['closed-road','pothole-road','scenario-budget'])$('#'+id).closest('label').classList.add('game-condition');
$('#condition-controls').insertAdjacentHTML('beforeend','<section class="free-hazards"><h3>Place road conditions</h3><p>Click a blue road to place a pothole, or close a full block with barriers at both ends. Repeat to add more.</p><div class="hazard-actions"><button id="add-pothole" type="button">Add pothole</button><button id="add-closure" type="button">Add road closure</button><button id="cancel-hazard" type="button" hidden>Done placing</button></div><p id="hazard-status" role="status"></p><ul id="hazard-list"></ul><button id="clear-hazards" type="button">Clear placed conditions</button></section>');
const trialSlider=document.createElement('div');trialSlider.className='trial-slider';trialSlider.innerHTML='<button id="runs-minus" aria-label="Decrease simulation runs">−</button><input id="runs-slider" aria-label="Monte Carlo runs" type="range" min="10" max="500" step="1" value="100"><button id="runs-plus" aria-label="Increase simulation runs">+</button><output id="runs-value">100 runs</output>';
$('#runs').classList.add('game-runs');$('#runs').after(trialSlider);
const modelGroups=document.createElement('div');modelGroups.className='model-control-groups';
const controlGroup=(title,description)=>{const section=document.createElement('section');section.className='model-control-group';section.innerHTML=`<div class="control-group-heading"><h3>${title}</h3><p>${description}</p></div>`;modelGroups.append(section);return section;};
const trafficGroup=controlGroup('Traffic','Demand assumptions for each intersection.');
trafficGroup.append($('#demand').closest('label'));
trafficGroup.insertAdjacentHTML('beforeend','<p class="availability-note"><strong>Pedestrian demand</strong><span>Uses the scenario default; independent control is not exposed yet.</span></p>');
trafficGroup.append($('#traffic-data-note'));
const environmentGroup=controlGroup('Environment','Weather and time conditions applied to the scenario.');
for(const id of ['weather','weather-date','start-hour','day-night'])environmentGroup.append($('#'+id).closest('label'));
environmentGroup.append($('#apply-weather-date'),$('#weather-source'));
const infrastructureGroup=controlGroup('Infrastructure','Signal timing and existing construction controls.');
infrastructureGroup.append($('#green').closest('label'),$('#closed-road').closest('label'),$('#pothole-road').closest('label'),$('.free-hazards'));
const autonomyGroup=controlGroup('Autonomy','Adoption controls appear only when the engine supports them.');
autonomyGroup.append($('#av').closest('label'));
const simulationGroup=controlGroup('Simulation','Repeatable paired trials using seed 42.');
for(const note of document.querySelectorAll('.network-run-note'))simulationGroup.append(note);
simulationGroup.append($('.run-row'));
const hiddenLegacy=document.createElement('div');hiddenLegacy.className='legacy-condition-controls';hiddenLegacy.hidden=true;hiddenLegacy.append($('#scenario-budget').closest('label'));
const conditionControls=$('#condition-controls'),modeExplanation=$('#mode-explanation');
conditionControls.replaceChildren(modeExplanation,modelGroups,hiddenLegacy);
$('.settings-grid').remove();
// Move the existing accessible editor controls into one bottom build tray.
const oldEditor=$('.tools-panel'),buildTray=$('.upgrade-bar');
const trayBudget=$('#tray-budget');trayBudget.hidden=true;
buildTray.replaceChildren(...oldEditor.children);oldEditor.remove();buildTray.classList.add('panel','build-tray');
buildTray.querySelector('.section-heading h2').textContent='Build your campus';
buildTray.querySelector('.section-heading').append(trayBudget);
buildTray.querySelector('.tool-list').classList.add('upgrade-slots');
const summary=document.createElement('p');summary.id='build-summary';summary.textContent='Choose an upgrade, then drag it onto its blue road footprint. All three sites share your budget.';
buildTray.querySelector('.tool-list').after(summary);
const keyboard=document.createElement('details');keyboard.className='keyboard-placement';keyboard.innerHTML='<summary>Keyboard placement · choose an intersection approach</summary>';keyboard.append($('#approaches'));summary.after(keyboard);
buildTray.insertAdjacentHTML('beforeend','<button id="cost-sources" class="cost-sources">Oakland cost sources · planning estimates</button>');
$('.scenario-banner .challenge-details').append(buildTray.querySelector('.budget-card'),$('.results-panel .objectives'));
$('.metric-table').insertAdjacentHTML('afterend','<div class="model-only unavailable-metrics"><p><strong>Pedestrian wait</strong><span>Unavailable in the local campus model</span></p><p><strong>Vehicle–pedestrian TTC</strong><span>Unavailable in the local campus model</span></p></div>');
for(const panel of [buildTray,$('.results-panel')])panel.insertAdjacentHTML('beforeend','<button class="return-simulation">← Simulation settings</button>');
const panels = {
    design: buildTray,
    simulation: $(".simulation-settings"),
    results: $(".results-panel"),
};
let activePanel = null;
for (const [name, panel] of Object.entries(panels)) {
    panel.id = `${name}-panel`;
    panel.hidden = true;
    panel.setAttribute("aria-label", `${name} panel`);
    const heading = panel.querySelector(".section-heading");
    heading.insertAdjacentHTML(
        "beforeend",
        `<button class="close-panel" data-close-panel="${name}" aria-label="Close ${name} panel">${icon("X")}</button>`,
    );
}
function openPanel(name, { focus = false } = {}) {
    activePanel = name;
    for (const [key, panel] of Object.entries(panels)) {
        const modelResultsColumn=!gameMode&&name==='results'&&key==='simulation';
        panel.hidden = key !== name&&!modelResultsColumn;
    }
    document.querySelectorAll("button[data-panel]").forEach((button) => {
        const open = button.dataset.panel === name;
        button.setAttribute("aria-expanded", String(open));
        button.classList.toggle("selected", open);
    });
    document.body.dataset.panel = name || "";
    if (focus && name)
        panels[name]
            .querySelector(".close-panel")
            .focus({ preventScroll: true });
}
document
    .querySelectorAll("button[data-panel]")
    .forEach(
        (button) =>
            (button.onclick = () =>
                openPanel(
                    activePanel === button.dataset.panel
                        ? null
                        : button.dataset.panel,
                    { focus: true },
                )),
    );
document.querySelectorAll("[data-close-panel]").forEach(
    (button) =>
        (button.onclick = () => {
            const name = button.dataset.closePanel;
            openPanel(null);
            (gameMode?$("#play-edit-design"):$("#model-mode")).focus({ preventScroll: true });
        }),
);
$("#export-button").remove();
document.addEventListener("keydown", (event) => {
    if (
        event.key === "Escape" &&
        !$("#dialog").open &&
        activePanel &&
        !selected
    ) {
        const previous = activePanel;
        openPanel(null);
        (gameMode?$("#play-edit-design"):$("#model-mode")).focus({ preventScroll: true });
    }
});
function refreshIcons() {
    createIcons({ icons, attrs: { "stroke-width": 1.7 } });
}
refreshIcons();
let toastTimer, eventTimer;
function toast(message) {
    $("#toast").textContent = message;
    $("#toast").classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
        () => $("#toast").classList.remove("visible"),
        4000,
    );
}
function markDirty() {
    assistant?.invalidate();
    sumoStudy?.clear();
    if(gameMode&&gameBaseline)$('#game-score').textContent=`Baseline: ${gameBaseline.accidents} modeled accidents. Design changed — test again for your new score.`;
    revision++;
    $("#result-scope").disabled = true;
    result = null;
    baselineView = false;
    $("#compare").disabled = true;
    $("#compare").innerHTML = `${icon("Columns2")} Compare with original`;
    $("#result-status").textContent = gameMode?"DESIGN UPDATED":"SETTINGS UPDATED";
    $("#result-status").classList.remove("complete");
    $("#score").innerHTML = "—<small>/ 100</small>";
    $("#score-ring").style.strokeDashoffset = 176;
    for (const key of ["risk", "speed", "delay", "throughput", "access"]) {
        $(`#before-${key}`).textContent = "—";
        $(`#after-${key}`).textContent = "—";
        $(`#change-${key}`).textContent = "—";
        $(`#change-${key}`).className = "metric-change";
    }
    for (const key of ["risk", "flow", "access"]) {
        $(`#objective-${key}`).classList.remove("achieved");
        $(`#objective-${key} .objective-status`).textContent = "○";
    }
    $("#result-note").textContent =
        gameMode?"Test your design to refresh the comparison. Estimates are not validated safety predictions.":"Run the current settings to refresh your results. Estimates are not validated safety predictions.";
    scene?.setUpgrades(items);
    tutorial?.refresh();
    refreshIcons();
}
function updateDesign() {
    const spent = costOf(items);
    $('.budget-card p span:last-child').textContent='of '+money(budgetLimit);
    $('.budget-explain').textContent='Shared budget: '+money(budgetLimit)+'. Undo or remove upgrades for a full refund.';
    $("#budget").textContent = money(budgetLimit - spent);
    $("#budget-hud").textContent = money(budgetLimit - spent);
    $("#tray-budget").textContent = money(budgetLimit - spent);
    $("#spent").textContent = `${money(spent)} invested`;
    $("#budget-fill").style.width = `${100 - (budgetLimit ? spent / budgetLimit : 0) * 100}%`;
    $("#undo").disabled = $("#reset").disabled = items.length === 0;
    $("#upgrade-count").textContent = items.length
        ? `${items.length} upgrade${items.length === 1 ? "" : "s"} placed · ready to test`
        : "Your canvas is ready. Make it yours.";
    document.querySelectorAll("[data-tool],[data-quick-tool]").forEach((el) => {
        const t = TOOLS.find(
            (t) => t.id === (el.dataset.tool || el.dataset.quickTool),
        );
        el.classList.toggle("unaffordable", t.cost > budgetLimit - spent);
    });
    scene?.setUpgrades(items);
    $("#placed-summary").textContent =
        items.length +
        " upgrades across " +
        new Set(items.map((item) => item.intersection || DEFAULT_INTERSECTION))
            .size +
        " intersections";
    $("#network-design-status").textContent =
        items.length +
        " upgrades · " +
        new Set(items.map((item) => item.intersection || DEFAULT_INTERSECTION))
            .size +
        " of 3 sites edited · shared budget";
    $("#placed-list").innerHTML = items
        .map(
            (item, index) =>
                "<li><span>" +
                TOOLS.find((t) => t.id === item.type).name +
                " · " +
                item.zone +
                " · " +
                intersectionById(item.intersection).name +
                '</span><button data-remove="' +
                index +
                '" aria-label="Remove ' +
                TOOLS.find((t) => t.id === item.type).name +
                " from " +
                item.zone +
                " at " +
                intersectionById(item.intersection).name +
                '">Remove & refund</button></li>',
        )
        .join("");
    tutorial?.refresh();
}
function chooseTool(type) {
    selected = selected === type ? null : type;
    document.querySelectorAll("[data-tool],[data-quick-tool]").forEach((el) => {
        const active = (el.dataset.tool || el.dataset.quickTool) === selected;
        el.classList.toggle("selected", active);
        el.setAttribute("aria-pressed", active);
    });
    $("#approaches").hidden = !selected;
    $("#build-summary").textContent = selected ? TOOLS.find(t=>t.id===selected).detail : "Choose an upgrade, then drag it onto its blue road footprint.";
    scene?.setTool(selected);
    $("#placement-hint").hidden = true;
    if (selected) {
        const t = TOOLS.find((t) => t.id === selected);
        $("#placement-name").textContent =
            t.name + " · " + money(t.cost) + " per placement";
    }
}
function place(type, zone, intersection = DEFAULT_INTERSECTION) {
    document.body.classList.remove("is-dragging");
    if (running || (gameMode && !gameBaseline)) return toast("Wait for the baseline or current run to finish before editing.");
    if(type === "closure" && settings.conditions?.closure?.intersection === intersection && settings.conditions.closure.zone === zone)return toast("This approach is already closed by the scenario.");
    const r = addUpgrade(items, type, zone, intersection, budgetLimit);
    if (r.error) return toast(r.error);
    items = r.items;
    markDirty();
    updateDesign();
    $("#budget-receipt").textContent =
        money(TOOLS.find((t) => t.id === type).cost) +
        " spent · " +
        money(budgetLimit - costOf(items)) +
        " remaining";
}
try {
    scene = createIntersection($("#scene"), place, (event) => {
        if(event.type==='replay'){
            document.body.classList.toggle('replay-active',event.active);
            document.body.classList.toggle('sumo-replay',event.active);
            $('#playback-title').textContent=event.active?'SUMO · Forbes / Bigelow':'A city in motion';
            $('.signal-hud small').textContent=event.active?'Recorded SUMO signals':'Synced to the illustrative 3D preview';
            $('#event-chip').hidden=true;$('#toast').classList.remove('visible');
            $('#collision-demo').disabled=event.active;
            return;
        }
        if (event.type === "environment") {
            const status=$("#environment-status");if(status)status.textContent=event.weather+" · "+String(Math.floor(event.hour)).padStart(2,"0")+":"+String(Math.floor(event.hour%1*60)).padStart(2,"0");
            return;
        }
        if(event.type==='hazard-place'){placeCondition(event.kind,event.point);return;}
        if (event.type === "navigation") {
            document
                .querySelectorAll("button[data-navigation]")
                .forEach((button) =>
                    button.setAttribute(
                        "aria-pressed",
                        String(button.dataset.navigation === event.mode),
                    ),
                );
            $("#navigation-help").textContent =
                event.mode === "street"
                    ? "Left drag to look · right drag to move · wheel to walk"
                    : event.mode === "pan"
                      ? "Left drag to move · right drag to orbit · scroll to zoom"
                      : "Drag to orbit · WASD to move";
            return;
        }
        if (event.type === "signals") {
            const jumpName = $('#jump-intersection-name');
            if (event.site && jumpName) jumpName.textContent = event.site.name;
            if(event.site){$('.signal-heading strong').textContent=event.site.name;$('#signal-penn').parentElement.firstElementChild.textContent=event.site.primaryRoad.replace(' Avenue','');$('#signal-cross').parentElement.firstElementChild.textContent=event.site.crossRoad.replace(' Boulevard','').replace('South ','').replace(' Street','');$('.signal-hud').dataset.intersection=event.site.id;}
            for (const key of ["penn", "cross"]) {
                $("#signal-" + key).dataset.state = event[key];
                $("#signal-" + key + "-text").textContent =
                    event[key][0].toUpperCase() + event[key].slice(1);
            }
            $("#signal-countdown").textContent = event.paused
                ? "Paused"
                : event.remaining + "s to change";
            return;
        }
        if (event.type === 'view-heading') {
            const slider = $('#design-rotation');
            if (slider && document.activeElement !== slider) {
                slider.value = String(event.degrees);
                $('#design-rotation-value').textContent = event.degrees + '°';
            }
            return;
        }
        if (event.type === 'pedestrian-accident') {
            $('#pedestrian-accident-count').textContent = String(event.count);
            toast('Pedestrian collision recorded in the live preview. Simulation risk estimates are unchanged.');
            return;
        }
        if (event.type === "hint") {
            document.body.classList.remove("is-dragging");
            return toast(event.message);
        }
        if(!document.body.classList.contains('sumo-replay'))return;
        $("#event-chip span").textContent = `Replay conflict · TTC ${event.ttc}s`;
        $("#event-chip").hidden = false;
        clearTimeout(eventTimer);
        eventTimer = setTimeout(() => ($("#event-chip").hidden = true), 3000);
    });
} catch (error) {
    console.error(error);
    $("#scene").innerHTML =
        '<div class="webgl-fallback"><strong>3D view is unavailable</strong><p>Enable WebGL or hardware acceleration to explore the scene. You can still place upgrades with the approach buttons and run comparisons.</p></div>';
}
document.querySelectorAll("[data-tool]").forEach((el) => {
    el.addEventListener("click", () => chooseTool(el.dataset.tool));
    el.addEventListener("dragstart", (e) => {
        if (selected !== el.dataset.tool) chooseTool(el.dataset.tool);
        e.dataTransfer.setData("application/interlock", el.dataset.tool);
        e.dataTransfer.effectAllowed = "copy";
        document.body.classList.add("is-dragging");
    });
});
document.addEventListener("dragend", () =>
    document.body.classList.remove("is-dragging"),
);
$("#cancel-placement").onclick = () => selected && chooseTool(selected);
$("#results-run").onclick = () => openPanel("simulation");
$("#placed-list").onclick = (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button || running) return;
    const index = +button.dataset.remove;
    const refund = TOOLS.find((t) => t.id === items[index].type).cost;
    items = items.filter((_, i) => i !== index);
    markDirty();
    updateDesign();
    $("#budget-receipt").textContent =
        money(refund) +
        " refunded · " +
        money(budgetLimit - costOf(items)) +
        " remaining";
};
document
    .querySelectorAll("[data-zone]")
    .forEach((el) =>
        el.addEventListener(
            "click",
            () =>
                selected &&
                place(selected, el.dataset.zone, el.dataset.intersection),
        ),
    );
$("#undo").onclick = () => {
    if (running) return;
    items = items.slice(0, -1);
    markDirty();
    updateDesign();
    $("#budget-receipt").textContent =
        "Last upgrade refunded · " +
        money(budgetLimit - costOf(items)) +
        " remaining";
};
$("#reset").onclick = () => {
    if (running) return;
    items = [];
    markDirty();
    updateDesign();
    $("#budget-receipt").textContent = "Full budget restored: " + money(budgetLimit);
    toast("Design reset. Your full budget is restored.");
};
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selected) chooseTool(selected);
});
function setView(top) {
    topView = top;
    scene?.view(top);
    $("#view-3d").classList.toggle("selected", !top);
    $("#view-top").classList.toggle("selected", top);
}
$("#view-3d").onclick = () => setView(false);
$("#view-top").onclick = () => setView(true);
$("#recenter").onclick = () => scene?.view(topView);
$("#zoom-in").onclick = () => scene?.zoom(1.2);
$("#zoom-out").onclick = () => scene?.zoom(1 / 1.2);
$("#layers-button").onclick = () => {
    const menu = $("#layer-menu");
    menu.hidden = !menu.hidden;
    $("#layers-button").setAttribute("aria-expanded", !menu.hidden);
};
document.querySelectorAll("[data-layer]").forEach(
    (el) =>
        (el.onchange = () => {
            scene?.toggleLayer(el.dataset.layer, el.checked);
            if (el.dataset.layer === "events" && !el.checked)
                $("#event-chip").hidden = true;
        }),
);
$("#pause").onclick = () => {
    paused = !paused;
    scene?.setPaused(paused);
    $("#pause").innerHTML = icon(paused ? "Play" : "Pause");
    $("#pause").setAttribute(
        "aria-label",
        paused ? "Resume animation" : "Pause animation",
    );
    $("#playback-title").textContent = paused
        ? "A moment to rethink"
        : "A city in motion";
    $(".playback-wave").classList.toggle("paused", paused);
    refreshIcons();
};
document.querySelectorAll("[data-speed]").forEach(
    (el) =>
        (el.onclick = () => {
            scene?.setSpeed(+el.dataset.speed);
            document
                .querySelectorAll("[data-speed]")
                .forEach((b) => b.classList.toggle("selected", b === el));
        }),
);
for (const key of ["demand", "green", "av"])
    $(`#${key}`).oninput = (e) => {
        if(running||gameMode)return;
        settings[key] = +e.target.value;
        $(`#${key}-value`).textContent =
            e.target.value + { demand: " veh/h", green: " sec", av: "%" }[key];
        scene?.setSettings(settings);
        markDirty();
    };
$("#runs").onchange = (e) => {
    if(running||gameMode)return;
    settings.runs = +e.target.value;
    $("#quick-runs").textContent = settings.runs;
    markDirty();
};
function syncResultPresentation(){
    $('.result-heading h2').textContent=gameMode?'Challenge results':'Model results';
    $('.result-scope').firstChild.textContent='View ';
    const headers=$('.metric-header').children;
    headers[1].hidden=false;headers[1].textContent='BASELINE';headers[2].textContent=gameMode?'YOUR DESIGN':'SCENARIO';headers[3].hidden=false;headers[3].textContent='Δ';
    for(const key of ['risk','speed','delay','throughput','access']){
        $('#before-'+key).hidden=false;$('#change-'+key).hidden=false;
    }
    $('.score-card').hidden=!gameMode;$('#compare').hidden=!gameMode;$('.change-key').hidden=false;
    $('#before-access').closest('.metric-row').hidden=!gameMode;
    $('.model-only').hidden=gameMode;
    $('#before-risk').closest('.metric-row').querySelector('div').innerHTML=(gameMode?'Conflict surrogate':'VV conflict surrogate')+'<small>TTC events / 1k vehicles</small>';
    $('.comparison-explain').innerHTML=gameMode?'<strong>Baseline:</strong> original street under the same challenge conditions.<br><strong>Your design:</strong> upgrades tested with matched seeded trials.':'<strong>Baseline:</strong> original street under the same demand and environment.<br><strong>Scenario:</strong> current controls and infrastructure. Values are physical or explicitly labeled surrogate metrics.';
}
function displayResult(network) {
    syncResultPresentation();
    const scope = $("#result-scope").value;
    const r =
        scope === "network"
            ? network
            : network.intersections.find((site) => site.id === scope);
    $("#result-scope").disabled = false;
    $("#before-throughput")
        .closest(".metric-row")
        .querySelector("small").textContent =
        scope === "network" ? "intersection passes / hour" : "vehicles / hour";
    $("#aggregation-note").textContent =
        scope === "network"
            ? "All three sites · throughput = intersection passages/hour, not unique vehicles. Other metrics are equal-demand means. No rerouting or queue spillback."
            : "Results for " +
              intersectionById(scope).name +
              " · Same shared demand/settings; only this intersection’s upgrades affect these estimates.";
    openPanel("results");
    $("#score").innerHTML = `${gameMode?network.score:r.score}<small>/ 100</small>`;
    $("#score-ring").style.strokeDashoffset = 176 * (1 - (gameMode?network.score:r.score) / 100);
    $("#result-status").textContent = `${r.runs} RUNS`;
    $("#result-status").classList.add("complete");
    for (const key of ["risk", "speed", "delay", "throughput", "access"]) {
        const digits = key === "throughput" || key === "access" ? 0 : 1;
        $(`#before-${key}`).textContent = r.before[key].mean.toFixed(digits);
        const after = $(`#after-${key}`);
        after.textContent = r.after[key].mean.toFixed(digits);
        const difference = r.after[key].mean - r.before[key].mean;
        const changed = Math.abs(difference) >= Math.pow(10, -digits) / 2;
        const change = $("#change-" + key);
        change.textContent = changed
            ? (difference > 0 ? "+" : "") + difference.toFixed(digits)
            : "—";
        change.className =
            "metric-change " +
            (!changed
                ? "neutral"
                : (
                        ["risk", "speed", "delay"].includes(key)
                            ? difference < 0
                            : difference > 0
                    )
                  ? "improved"
                  : "worse");
        change.title =
            key === "speed"
                ? "Lower speed supports the safety objective; assess delay and throughput too."
                : "After minus before";
        after.title = `95% Monte Carlo mean interval: ±${r.after[key].ci.toFixed(2)}. Excludes model uncertainty.`;
    }
    for (const [key, done] of [
        ["risk", r.reduction >= 20],
        ["flow", r.retained >= 95],
        ["access", r.after.access.mean >= 65],
    ]) {
        $(`#objective-${key}`).classList.toggle("achieved", done);
        $(`#objective-${key} .objective-status`).textContent = done ? "✓" : "○";
    }
    $("#result-note").innerHTML =
        `${icon("FlaskConical")} <span>${gameMode?`<strong>${Math.abs(r.reduction).toFixed(0)}% ${r.reduction >= 0 ? "lower" : "higher"} conflict proxy.</strong> `:""}${r.engine.startsWith("local-") ? (gameMode?"Paired local estimates":"Local simulation estimates") : "Backend estimates"} · seed ${r.seed}. Hover metrics for sampling intervals; model uncertainty is not included.</span>`;
    $("#result-note").title = `Engine: ${r.engine}`;
    $("#compare").disabled = !gameMode;
    tutorial?.refresh();
    refreshIcons();
}
$("#run").onclick = async () => {
    if(gameMode){$('#test-design').click();return;}
    if (running) return;
    running = true;
    setHazardTool(null);
    for(const id of ['runs-slider','runs-minus','runs-plus'])$('#'+id).disabled=true;
    $('#condition-controls').disabled=true;
    startFastSimulation();
    $("#quick-run").disabled = true;
    $("#quick-run").textContent = "Running trials…";
    const version = revision;
    $("#run").disabled = true;
    $("#run").innerHTML = `${icon("LoaderCircle", "spin")} Running trials…`;
    document
        .querySelectorAll(".settings-grid input,#runs")
        .forEach((el) => (el.disabled = true));
    refreshIcons();
    try {
        const next = simulationEndpoint ? await runSimulation(items, settings, {
            endpoint: simulationEndpoint,
            signal: AbortSignal.timeout(60000),
        }) : (await gameTrials(items,settings,progress=>{
            $('#quick-run').textContent=`Running ${progress.completed}/${settings.runs} trials…`;
        })).result;
        if (version === revision) {
            result = next;
            $("#result-scope").value = "network";
            displayResult(result);
            assistant?.debrief();
            toast(
                `${result.runs} trials complete. Results for all 3 intersections are ready.`,
            );
        }
    } catch (error) {
        $("#result-status").textContent = "RUN FAILED";
        $("#result-note").textContent =
            `Simulation failed: ${error.message}. Check the backend connection and try again.`;
        toast(`Simulation failed: ${error.message}`);
    } finally {
        finishFastSimulation();
        running = false;
        $('#runs-slider').disabled=false;$('#runs-minus').disabled=settings.runs<=10;$('#runs-plus').disabled=settings.runs>=500;
        $('#condition-controls').disabled=gameMode;
        $("#quick-run").disabled = false;
        $("#quick-run").innerHTML = icon("Play") + " Run simulation";
        $("#run").disabled = false;
        $("#run").innerHTML = `${icon("Play")} Run simulation`;
        document
            .querySelectorAll(".settings-grid input,#runs")
            .forEach((el) => (el.disabled = gameMode && el.id !== "runs"));
        refreshIcons();
    }
};
$("#quick-run").onclick = () => gameMode?$("#test-design").click():openPanel("simulation");
$("#result-scope").onchange = () => result && displayResult(result);
$("#quick-settings").onclick = () => openPanel(activePanel === "simulation" ? null : "simulation");

document.addEventListener("keydown", (event) => {
    if (
        !gameMode ||
        document.body.classList.contains("observe-mode") ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing ||
        event.target.closest("input,select,textarea,[contenteditable]") ||
        $("#dialog").open ||
        document.body.classList.contains("tour-active")
    )
        return;
    const tool = TOOLS[Number(event.key) - 1];
    if (tool && gameMode && !running) {
        chooseTool(tool.id);
        openPanel("design");
    }
});
$("#compare").onclick = () => {
    baselineView = !baselineView;
    scene?.setUpgrades(baselineView ? [] : items);
    $("#compare").innerHTML =
        `${icon("Columns2")} ${baselineView ? "Return to your design" : "Compare with original"}`;
    refreshIcons();
    toast(
        baselineView
            ? "Showing original street geometry without your upgrades."
            : "Showing your proposed design.",
    );
};
function download() {
    const data = exportScenario(items, settings, result);
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "interlock-pitt-campus.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Scenario exported with settings, upgrades, and model provenance.");
}

function dialog(title, content) {
    $("#dialog-title").textContent = title;
    $("#dialog-content").innerHTML = content;
    $("#dialog").append(observeButton);
    $("#dialog").showModal();
    refreshIcons();
}
$("#close-dialog").onclick = () => $("#dialog").close();
$("#dialog").addEventListener("click", (e) => {
    if (e.target === $("#dialog")) {
        const r = $("#dialog").getBoundingClientRect();
        if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
        )
            $("#dialog").close();
    }
});
$("#data-button").onclick = () =>
    dialog(
        "Real place. Transparent assumptions.",
        `<div class="data-badge">${icon("MapPin")} ${map.center.lat.toFixed(5)}° N, ${Math.abs(map.center.lon).toFixed(5)}° W</div><h3>Street geometry</h3><p>Road centerlines and ${map.features.filter((f) => f.tags.building).length} building footprints from <a href="${map.sourceUrl}" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>, retrieved ${map.retrieved}. Licensed under <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">ODbL</a>. OSM building parts, mapped trees, paths, and businesses supplement the footprints. Missing heights, facade details, widths, and signal hardware are illustrative. Road tags may lag real street changes.</p><h3>Campus landmarks</h3><p>Cathedral of Learning and Litchfield Towers use OSM building-part footprints and tagged heights. El Jefe’s is placed at its OSM point of interest at 3807 Forbes Avenue, also listed on <a href="https://eljefestaqueria.com/" target="_blank" rel="noreferrer">the restaurant’s website</a>. Untagged heights, facade decoration, widths, and signal hardware are illustrative. Trees mapped within six meters of signals are omitted to keep them clear.</p><p>The explorable area covers the Forbes–Fifth corridor, from the Towers and Forbes shops to the Cathedral and Heinz Chapel. Upgrade placements cover <strong>Forbes/Bigelow, Fifth/Bigelow, and Forbes/Bouquet</strong> together. Paired local trials combine these three intersections; they do not model rerouting or queue spillback.</p><h3>Simulation provenance</h3><p>Paired seeded Monte Carlo samples vary assumed demand and baseline speed. Upgrade effects are explicit placeholder coefficients. Conflict proxy, access score, and costs are game assumptions. No public crash counts calibrate the game score. Car cruising speeds use a nearby WPRDC Fifth/Meyran observation (2018 median 16 mph, 85th percentile 20 mph). The selected demand remains a scenario assumption. Historical weather uses Open-Meteo ERA5 records; weather behavior adjustments are engineering assumptions.</p><div class="dialog-callout">The SUMO signal study uses the connected Python backend and recorded TraCI replay. Campus simulation and game scores use a separate, uncalibrated local model. The animated TTC marker measures short following gaps in the visual preview, separately from the Monte Carlo model.</div>`,
    );
scene?.setPlacementValidator(
    (type, zone, intersection) =>
        addUpgrade(items, type, zone, intersection, budgetLimit).error,
);
for (const [container, selector] of [
    [$(".tool-list"), "[data-tool]"],

])
    installInfrastructureDrag({
        container,
        selector,
        select: (type) => {
            if (selected !== type) chooseTool(type);
        },
        preview: (x, y) => scene?.previewPlacement(x, y),
        place: (type, x, y) => scene?.placeAt(type, x, y),
        cancel: () => {
            scene?.cancelPlacement();
            toast("Placement canceled. Nothing was charged.");
        },
    });
tutorial = createWalkthrough({
    openPanel,
    getState: () => ({ count: items.length, result, budget:budgetLimit, gameMode }),
});
$("#guide-button").onclick = () => tutorial.start();
$("#tour-launch").onclick = () => tutorial.start();
scene?.setSettings(settings);
if (paused) {
    $("#pause").innerHTML = icon("Play");
    $("#pause").setAttribute("aria-label", "Resume animation");
    $("#playback-title").textContent = "A moment to rethink";
    $(".playback-wave").classList.add("paused");
    refreshIcons();
}
window.addEventListener("pagehide", (event) => {
    if (!event.persisted) scene?.dispose();
});

// Observation mode retains only the canvas and its own always-reachable restore control.
const observeButton = document.createElement("button");
observeButton.id = "observe-toggle";
observeButton.textContent = "Hide UI";
observeButton.setAttribute("aria-label", "Hide interface");
observeButton.setAttribute("aria-pressed", "false");
observeButton.title =
    "Observe the campus · H toggles interface. WASD moves, Q/E changes elevation, Shift moves faster. Street mode: drag to look, wheel to move.";
document.body.append(observeButton);
$("#dialog").addEventListener("close", () =>
    document.body.append(observeButton),
);
function toggleObservation() {
    document.body.append(observeButton);
    const hidden = document.body.classList.toggle("observe-mode");
    if (hidden) {
    if (selected) chooseTool(selected);
    setHazardTool(null);
        if (tutorial.active) tutorial.stop();
        $("#dialog").close();
        $("#layer-menu").hidden = true;
        $("#layers-button").setAttribute("aria-expanded", "false");
    }
    observeButton.textContent = hidden ? "Show UI" : "Hide UI";
    observeButton.setAttribute(
        "aria-label",
        hidden ? "Show interface" : "Hide interface",
    );
    observeButton.setAttribute("aria-pressed", String(hidden));
    observeButton.focus({ preventScroll: true });
}
observeButton.onclick = toggleObservation;
document.addEventListener("keydown", (event) => {
    if (
        event.key.toLowerCase() === "h" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.target.closest("input,select,textarea,[contenteditable]")
    ) {
        event.preventDefault();
        toggleObservation();
    }
});

const junctionJumps = document.createElement('div');
// Keep navigation above the right-side panels on narrow screens.
$('#app').append($('.navigation-panel'));
$('.navigation-panel').open=false;
$('.navigation-panel').insertAdjacentHTML('beforeend','<p class="preview-accidents">Pedestrian accidents · preview: <strong id="pedestrian-accident-count">0</strong></p>');
junctionJumps.className = 'intersection-jumps';
junctionJumps.innerHTML = '<button id="previous-intersection" aria-label="Previous intersection" title="Previous intersection">←</button><span id="jump-intersection-name">Jump to intersection</span><button id="next-intersection" aria-label="Next intersection" title="Next intersection">→</button>';
$('.navigation-panel summary').after(junctionJumps);
const designCamera = document.createElement('div');
designCamera.className = 'design-camera';
designCamera.setAttribute('aria-label', 'Design camera controls');
designCamera.innerHTML = '<button id="design-previous" aria-label="Jump to previous intersection">←</button><label for="design-rotation">Rotate view <output id="design-rotation-value">41°</output><input id="design-rotation" type="range" min="0" max="360" value="41" step="1"></label><button id="design-next" aria-label="Jump to next intersection">→</button>';
$('#app').append(designCamera);
$('#design-previous').onclick = () => $('#previous-intersection').click();
$('#design-next').onclick = () => $('#next-intersection').click();
$('#design-rotation').oninput = event => {
    $('#design-rotation-value').textContent = event.target.value + '°';
    scene?.rotateView(Number(event.target.value));
};
function setTrials(value){
    if(running||gameMode)return;
    settings.runs=Math.max(10,Math.min(500,Math.round(Number(value))));
    $('#runs-slider').value=settings.runs;$('#runs-value').textContent=settings.runs+' runs';$('#quick-runs').textContent=settings.runs;
    $('#runs-minus').disabled=settings.runs===10;$('#runs-plus').disabled=settings.runs===500;markDirty();
}
$('#runs-slider').oninput=e=>setTrials(e.target.value);
$('#runs-minus').onclick=()=>setTrials(settings.runs-1);$('#runs-plus').onclick=()=>setTrials(settings.runs+1);
for (const [id, direction] of [['previous-intersection', -1], ['next-intersection', 1]]) {
    $('#' + id).onclick = () => {
        const current = INTERSECTIONS.findIndex(site => site.id === $('.signal-hud').dataset.intersection);
        const site = INTERSECTIONS[((current < 0 ? 0 : current) + direction + INTERSECTIONS.length) % INTERSECTIONS.length];
        scene?.jumpToIntersection(site.id, topView);
        $('#design-rotation').value = topView ? '0' : '41';
        $('#design-rotation-value').textContent = (topView ? '0' : '41') + '°';
        $('.signal-hud').dataset.intersection = site.id;
        $('#jump-intersection-name').textContent = site.name;
    };
}

document.querySelectorAll("button[data-navigation]").forEach(
    (button) =>
        (button.onclick = () => {
            scene?.setNavigation(button.dataset.navigation);
        }),
);
document.querySelectorAll("[data-move]").forEach((button) => {
    button.onpointerdown = (event) => {
        button.setPointerCapture(event.pointerId);
        scene?.nudgeNavigation(button.dataset.move);
        scene?.holdNavigation(button.dataset.move, true);
    };
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
        button.addEventListener(event, () =>
            scene?.holdNavigation(button.dataset.move, false),
        );
    button.onclick = (event) => {
        if (event.detail === 0) scene?.nudgeNavigation(button.dataset.move);
    };
});
if (matchMedia("(max-width:760px)").matches)
    $(".navigation-panel").open = false;

$("#collision-demo").onclick = () => {
    scene?.previewCollision();
    if (paused) toast("Collision preview ready. Resume animation to play.");
    else
        toast(
            "Scripted collision + fire preview. Simulation metrics are unchanged.",
        );
};

$('#cost-sources').onclick=()=>dialog('Oakland cost sources',`<p>${COST_DATA.note}</p><p><strong>Local benchmark:</strong> Terrace / DeSoto’s multi-block safety project was reported at about $110,000 in 2025. It is not a per-upgrade rate.</p><ul>${COST_DATA.sources.map(source=>`<li><a href="${source.url}" target="_blank" rel="noreferrer">${source.title}</a> · ${source.publisher}${source.costBand?' · '+source.costBand:''}</li>`).join('')}</ul><p>Tool prices are labeled planning allowances. Design, drainage, utilities, accessibility, procurement and inflation require a project-specific estimate.</p>`);

function syncModeControls(){
    $('#run').textContent=gameMode?'Test my design':'Run simulation';
    $('#quick-run').innerHTML=icon('Play')+(gameMode?' Test my design':' Run simulation');
    $('#quick-run').setAttribute('aria-label',gameMode?'Test my design now':'Run simulation settings');
    $('#runs').disabled=gameMode;
    settings.av=0; // AV simulation is disabled until the feature is re-enabled.
    for(const key of ['demand','green','av']){
        $('#'+key).value=settings[key];$('#'+key).disabled=key==='av'||gameMode;
        $('#'+key+'-value').textContent=settings[key]+{demand:' veh/h',green:' sec',av:'%'}[key];
    }
    const c=settings.conditions;
    $('#weather').value=c.weather;
    if(c.weatherObservation)$('#weather-date').value=c.weatherObservation.date;
    $('#weather-source').textContent=c.weatherObservation?`${c.weatherObservation.date}: ${WEATHER[c.weather].label}, ${c.weatherObservation.temperatureF}°F daily mean, ${c.weatherObservation.precipitationIn} in precipitation. ${WEATHER_DATA.source}. ${WEATHER_DATA.site}. Historical reanalysis, not live weather. Driving adjustments are assumptions.`:'Driving adjustments use shared weather profiles: slower speeds, longer following gaps and reduced braking in bad weather. Engineering assumptions, not calibrated crash predictions.';
    $('#closed-road').value=c.closure?c.closure.intersection+'/'+c.closure.zone:'';
    $('#pothole-road').value=c.pothole?c.pothole.intersection+'/'+c.pothole.zone:'';
    $('#start-hour').value=c.hour;$('#hour-value').textContent=String(c.hour).padStart(2,'0')+':00';
    $('#day-night').checked=c.dayNight;$('#scenario-budget').value=budgetLimit;
    $('#condition-controls').disabled=gameMode;$('#runs').value=settings.runs;$('#quick-runs').textContent=settings.runs;
    $('#runs-slider').disabled=gameMode;$('#runs-minus').disabled=gameMode||settings.runs<=10;$('#runs-plus').disabled=gameMode||settings.runs>=500;
    $('#runs-slider').value=Math.min(500,settings.runs);$('#runs-value').textContent=settings.runs+' runs';
    $('#mode-explanation').textContent=gameMode?'Challenge conditions are locked. Use your budget to redesign the streets.':'Set weather and time, then place road conditions directly on the map. No build budget applies.';
    $('#traffic-data-note').textContent=`Car speed baseline: ${DRIVING_DATA.medianSpeedMph} mph median, ${DRIVING_DATA.p85SpeedMph} mph 85th percentile (${DRIVING_DATA.site}, ${DRIVING_DATA.observedAt.slice(0,10)}; ${DRIVING_DATA.source}). Nearby proxy, not a current campus measurement. Demand is your scenario setting.`;
    syncResultPresentation();
    $('#results-run').textContent=gameMode?'Review challenge settings →':'Set up a simulation →';
    $('.seed-tag').textContent=gameMode?'Seed 42 · paired trials':'Seed 42 · repeatable trials';
    $('#play-mode').classList.toggle('active',gameMode);$('#play-mode').setAttribute('aria-pressed',String(gameMode));
    $('#model-mode').classList.toggle('active',!gameMode);$('#model-mode').setAttribute('aria-pressed',String(!gameMode));
    scene?.setSettings(settings);updateDesign();renderConditions();
}
async function startChallenge(){
    if(running)return toast('Wait for the current run to finish.');
    if(tutorial?.active)tutorial.stop();
    setHazardTool(null);
    if(!gameMode)freeSession={items:structuredClone(items),settings:structuredClone(settings),budget:budgetLimit,result:structuredClone(result)};
    activeScenario=makeScenario();gameMode=true;document.body.dataset.mode='play';
    settings=structuredClone(activeScenario.settings);settings.challenge={id:activeScenario.id,title:activeScenario.title};budgetLimit=activeScenario.budget;items=[];chooseTool(null);
    $('.scenario-banner').hidden=false;$('#scenario-title').textContent=activeScenario.title;
    $('#scenario-description').textContent=activeScenario.description;
    const condition=activeScenario.settings.conditions;
    $('#challenge-location').textContent=condition.closure||condition.pothole?intersectionById((condition.closure||condition.pothole).intersection).name:'Pitt campus · Oakland';
    $('#challenge-constraint').textContent=condition.closure?`${condition.closure.zone} approach closed`:condition.pothole?`Large pothole · ${condition.pothole.zone} approach`:`${WEATHER[condition.weather].label} · ${activeScenario.settings.demand} veh/h`;
    markDirty();syncModeControls();openPanel(null);
    gameBaseline=null;running=true;$('#test-design').disabled=true;$('#run').disabled=true;$('#quick-run').disabled=true;
    $('#game-score').textContent='Calculating the original street baseline…';
    try {
        gameBaseline=await gameTrials([],settings);
        $('#game-score').textContent=`Baseline: ${gameBaseline.accidents} modeled accidents across ${settings.runs} trials. Add upgrades, then test your design.`;
    } catch(error) { $('#game-score').textContent='Baseline failed: '+error.message+'. Start a new challenge to retry.'; }
    finally { running=false;$('#test-design').disabled=!gameBaseline;$('#run').disabled=!gameBaseline;$('#quick-run').disabled=!gameBaseline; }

}
function enterModel(){
    if(running)return toast('Wait for the current run to finish.');
    if(tutorial?.active)tutorial.stop();
    setHazardTool(null);
    gameMode=false;$('#run').disabled=false;$('#quick-run').disabled=false;document.body.dataset.mode='model';activeScenario=null;$('.scenario-banner').hidden=true;
    items=freeSession?.items||[];settings=freeSession?.settings||{...DEFAULT_SETTINGS,conditions:{...DEFAULT_CONDITIONS},budget:BUDGET};budgetLimit=1_000_000_000;settings.budget=budgetLimit;
    chooseTool(null);markDirty();syncModeControls();
    if(freeSession?.result){result=freeSession.result;$('#result-scope').value='network';displayResult(result);}
    else openPanel('simulation');
}
$('#play-mode').onclick=()=>{if(!gameMode)startChallenge();};$('#new-challenge').onclick=startChallenge;
$('#model-mode').onclick=enterModel;
$('#play-edit-design').onclick=()=>openPanel('design',{focus:true});
$('#settings-button').onclick=()=>gameMode?dialog('Play settings','<p>Challenge traffic, weather, construction, goals, and budget are locked. Choose <strong>New challenge</strong> for another scenario, or switch to <strong>Model</strong> for free-form controls.</p>'):openPanel('simulation',{focus:true});
$('#free-design').textContent='Edit infrastructure on map';$('#free-design').onclick=()=>openPanel('design',{focus:true});$('#free-results').remove();
for(const button of document.querySelectorAll('.return-simulation'))button.onclick=()=>openPanel('simulation');
function changeConditions(event){
    if(gameMode||running)return;
    const parse=id=>{const value=$('#'+id).value;if(!value)return null;const [intersection,zone]=value.split('/');return{intersection,zone};};
    const budget=Number($('#scenario-budget').value);
    if(!Number.isFinite(budget)||budget<costOf(items)||budget<0||budget>500000){$('#scenario-budget').value=budgetLimit;return toast('Budget must cover current upgrades and be between $0 and $500,000.');}
    budgetLimit=budget;settings.budget=budget;
    settings.conditions={...settings.conditions,weatherObservation:event?.target?.id==='weather'?null:settings.conditions.weatherObservation,weather:$('#weather').value,closure:parse('closed-road'),pothole:parse('pothole-road'),hour:Number($('#start-hour').value),dayNight:$('#day-night').checked};
    markDirty();syncModeControls();
}
for(const id of ['weather','closed-road','pothole-road','start-hour','day-night','scenario-budget'])$('#'+id).addEventListener('change',changeConditions);
$('#start-hour').addEventListener('input',()=>$('#hour-value').textContent=String($('#start-hour').value).padStart(2,'0')+':00');
$('#apply-weather-date').onclick=()=>{
    if(gameMode||running)return;
    const observation=historicalWeather($('#weather-date').value);
    if(!observation)return toast('Choose a recorded date between 2019 and 2025.');
    settings.conditions={...settings.conditions,weather:observation.weather,weatherObservation:observation};
    markDirty();syncModeControls();
};
syncModeControls();

function setHazardTool(type){
    hazardTool=type;scene?.setHazardTool(type);$('#cancel-hazard').hidden=!type;
    for(const [id,kind] of [['add-pothole','pothole'],['add-closure','closure']])$('#'+id).setAttribute('aria-pressed',String(type===kind));
    $('#hazard-status').textContent=type==='closure'?'Click a glowing blue road block. Barriers will close both ends.':type==='pothole'?'Click the blue road surface to place a pothole. Keep clicking to add more.':'';
}
function placeCondition(kind,point){
    if(gameMode||running)return;
    if(kind==='closure'){
        if((settings.conditions.closures||[]).includes(point.block.id))return toast('This entire block is already closed.');
        settings.conditions.closures=[...(settings.conditions.closures||[]),point.block.id];
    }else{
        if((settings.conditions.potholes||[]).some(p=>Math.hypot(p.x-point.x,p.z-point.z)<2))return toast('A pothole already occupies that spot. Choose another blue road location.');
        settings.conditions.potholes=[...(settings.conditions.potholes||[]),{id:crypto.randomUUID(),x:point.x,z:point.z,intersection:point.block.intersection}];
    }
    markDirty();scene?.setSettings(settings);renderConditions();
    toast(kind==='closure'?point.block.name+' block closed at both ends.':'Large pothole placed. Nearby traffic slows down.');
}
function renderConditions(){
    const list=$('#hazard-list');list.replaceChildren();
    const entries=[...(settings.conditions.closures||[]).map(id=>({id,kind:'closures',name:(ROAD_BLOCKS.find(b=>b.id===id)?.name||'Road')+' · whole block'})),...(settings.conditions.potholes||[]).map((p,i)=>({id:p.id,kind:'potholes',name:'Pothole '+(i+1)}))];
    for(const entry of entries){const li=document.createElement('li'),label=document.createElement('span'),button=document.createElement('button');label.textContent=entry.name;button.textContent='Remove';button.setAttribute('aria-label','Remove '+entry.name);button.onclick=()=>{if(gameMode||running)return;settings.conditions[entry.kind]=settings.conditions[entry.kind].filter(value=>(typeof value==='string'?value:value.id)!==entry.id);markDirty();scene?.setSettings(settings);renderConditions();};li.append(label,button);list.append(li);}
    $('#clear-hazards').disabled=entries.length===0;
}
$('#add-pothole').onclick=()=>{chooseTool(null);setHazardTool(hazardTool==='pothole'?null:'pothole');};
$('#add-closure').onclick=()=>{chooseTool(null);setHazardTool(hazardTool==='closure'?null:'closure');};
$('#cancel-hazard').onclick=()=>setHazardTool(null);
$('#clear-hazards').onclick=()=>{if(gameMode||running)return;settings.conditions.closures=[];settings.conditions.potholes=[];markDirty();scene?.setSettings(settings);renderConditions();};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&hazardTool)setHazardTool(null);});

// Expanded navigation must never cover the challenge notice on narrow screens.
new ResizeObserver(entries=>document.body.style.setProperty('--navigation-bottom',entries[0].target.getBoundingClientRect().bottom+'px')).observe($('.navigation-panel'));

$('.scenario-banner').insertAdjacentHTML('beforeend','<div class="game-evaluation"><p id="game-score" role="status"></p><button id="test-design">Test my design</button><small>Modeled game accidents · paired seeded trials, not measured crashes. Traffic preview is illustrative.</small></div>');
function gameTrials(upgrades,config,onProgress){
    return new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./game-worker.js',import.meta.url),{type:'module'});
        const timer=setTimeout(()=>{worker.terminate();reject(new Error('Trial timeout'));},60000);
        const finish=()=>{clearTimeout(timer);worker.terminate();};
        worker.onerror=event=>{finish();reject(new Error(event.message));};
        worker.onmessage=({data})=>{if(data.error){finish();reject(new Error(data.error));}else if(data.done){finish();resolve(data);}else onProgress?.(data);};
        worker.postMessage({items:upgrades,settings:config,visible:!!onProgress});
    });
}
$('#test-design').onclick=async()=>{
    if(running||!gameBaseline)return;
    running=true;$('#test-design').disabled=true;$('#run').disabled=true;$('#quick-run').disabled=true;chooseTool(null);openPanel(null);
    startFastSimulation();
    try {
        const next=await gameTrials(items,settings,progress=>{
            $('#game-score').textContent=`Testing ${progress.completed}/${settings.runs} trials · ${progress.accidents} modeled accidents so far · baseline ${gameBaseline.accidents}`;
        });
        const comparison=gameComparison(gameBaseline,next);
        const {saved,improvement,score}=comparison;
        result=comparison.result;displayResult(result);
        assistant?.debrief();
        $('#game-score').textContent=`Baseline ${gameBaseline.accidents} → Your design ${next.accidents} modeled accidents · ${saved>=0?saved+' fewer':Math.abs(saved)+' more'} (${improvement}%) · Score ${score}/100`;
    } catch(error){$('#game-score').textContent='Test failed: '+error.message+'. Try again.';}
    finally{finishFastSimulation();running=false;$('#test-design').disabled=false;$('#run').disabled=false;$('#quick-run').disabled=false;}
};

let fastPreview=null;
function startFastSimulation(runs=settings.runs){
    finishFastSimulation();
    document.body.classList.add('simulation-running','replay-active');
    const plan=trialPreviewPlan(runs),wasPaused=paused;
    scene?.setReplay(null);
    scene?.startSimulation();
    if(paused)$('#pause').click();
    document.querySelector('[data-speed="100"]').click();
    $('#playback-title').textContent=plan.label;
    // Bound the visual preview even when an external simulation server takes longer.
    fastPreview={wasPaused,timer:setTimeout(()=>{
        finishFastSimulation();
        if(running)$('#playback-title').textContent='Preview finished · calculating results…';
    },plan.durationMs+500)};
}
function finishFastSimulation(){
    document.body.classList.remove('simulation-running');
    if(!document.body.classList.contains('sumo-replay'))document.body.classList.remove('replay-active');
    if(fastPreview){
        const {wasPaused,timer}=fastPreview;fastPreview=null;
        clearTimeout(timer);
        scene?.stopSimulation();
        document.querySelector('[data-speed="1"]').click();
        if(paused!==wasPaused)$('#pause').click();
    }
    $('#playback-title').textContent=paused?'A moment to rethink':'A city in motion';
}
assistant=installAssistant({services,getRevision:()=>revision,getContext:()=>sceneContext({items,settings,result,budget:budgetLimit,gameMode})});
sumoStudy=installSumoStudy({services,container:$('.simulation-settings'),getSettings:()=>settings,getScene:()=>scene,isBusy:()=>running||gameMode,
    onStart(){
        running=true;setHazardTool(null);chooseTool(null);startFastSimulation(3);
        document.querySelectorAll('.settings-grid input,#runs,#runs-slider,#runs-minus,#runs-plus,#run').forEach(el=>el.disabled=true);
        $('#condition-controls').disabled=true;
    },
    onFinish(){
        finishFastSimulation();
        if($('#scene canvas')?.dataset.trafficSource==='sumo-traci')$('#playback-title').textContent='SUMO · Forbes / Bigelow';
        running=false;
        document.querySelectorAll('.settings-grid input,#runs,#runs-slider,#run').forEach(el=>el.disabled=false);
        $('#runs-minus').disabled=settings.runs<=10;$('#runs-plus').disabled=settings.runs>=500;
        $('#condition-controls').disabled=false;
    },
});

// Product entry point: one challenge first, with Model always one tab away.
startChallenge();
