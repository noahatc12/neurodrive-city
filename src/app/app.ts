/**
 * Application shell: owns the world model, renderers, editor, UI and main loop, and
 * wires them together. Mode state machine: edit ⇄ simulate ⇄ train.
 * @module app/app
 */
import { TweenManager } from '../anim/tween.ts';
import { Stats } from '../debug/stats.ts';
import { DisposeWorldCommand } from '../editor/commands.ts';
import { EditorController } from '../editor/editorController.ts';
import { History } from '../editor/history.ts';
import { parseWorldText, serializeWorld, type WorldView } from '../engine/io/serialize.ts';
import type { WorldSettings } from '../engine/world/settings.ts';
import { WorldModel } from '../engine/world/worldModel.ts';
import { Canvas2DRenderer } from '../render2d/canvas2dRenderer.ts';
import { Viewport } from '../render2d/viewport.ts';
import { Minimap } from '../render2d/minimap.ts';
import { ProgressOverlay } from '../ui/progressOverlay.ts';
import { generateDemoCity, type DemoCityOptions } from '../engine/world/demoCity.ts';
import type { Vec2 } from '../engine/math/vec2.ts';
import { WorldManager } from './worldManager.ts';
import { TrafficLightSystem } from '../engine/markings/trafficLightController.ts';
import { resolveMarking } from '../engine/markings/marking.ts';
import { addDemoMarkings } from '../engine/world/demoMarkings.ts';
import {
  OsmFormatError,
  importOsmSteps,
  type OsmImportOptions,
  type OsmResult,
} from '../engine/osm/osmParse.ts';
import { OsmDialog } from '../ui/panels/osmDialog.ts';
import { LibraryDialog } from '../ui/panels/libraryDialog.ts';
import { Simulation } from '../engine/sim/simulation.ts';
import { planRoute } from '../engine/nav/routeFollower.ts';
import { activeTarget } from '../engine/markings/target.ts';
import type { LanePath } from '../engine/nav/lanePath.ts';
import type { Sensor } from '../engine/car/sensor.ts';
import { Hud } from '../ui/hud.ts';
import { h } from '../ui/dom.ts';
import { HelpOverlay } from '../ui/panels/helpOverlay.ts';
import { WorldPanel } from '../ui/panels/worldPanel.ts';
import { Statusbar } from '../ui/statusbar.ts';
import { Toaster, type ToastOptions } from '../ui/toast.ts';
import { Toolbar } from '../ui/toolbar.ts';
import { Topbar, type MenuItem } from '../ui/topbar.ts';
import { matchBinding, type ActionId } from './keymap.ts';
import { MainLoop, type FrameInfo } from './loop.ts';
import {
  DEFAULT_LAYERS,
  type AppMode,
  type FrameContext,
  type LayerFlags,
  type ToolId,
} from './renderer.ts';
import {
  getLastWorldId,
  getPref,
  newWorldId,
  openWorldStore,
  setLastWorldId,
  setPref,
  type WorldStore,
} from './storage.ts';

const MENU: readonly MenuItem[] = [
  { id: 'demo', label: 'Demo city', icon: 'city' },
  { id: 'ring', label: 'Ring road', icon: 'ring' },
  { id: 'infinite', label: 'Infinite road', icon: 'road' },
  { id: 'osm-sample', label: 'Load sample OSM', icon: 'globe', separatorBefore: true },
  { id: 'osm-import', label: 'Import OSM…', icon: 'globe' },
  { id: 'library', label: 'World library…', icon: 'folder', separatorBefore: true },
  { id: 'open', label: 'Open…', icon: 'upload', shortcut: 'Ctrl+O' },
  { id: 'save', label: 'Save…', icon: 'download', shortcut: 'Ctrl+S' },
  { id: 'dispose', label: 'Dispose world', icon: 'trash', separatorBefore: true, danger: true },
];

export class App {
  readonly root: HTMLElement;
  model: WorldModel;
  readonly history = new History(200);
  readonly viewport = new Viewport();
  readonly renderer2d: Canvas2DRenderer;
  readonly editor: EditorController;
  readonly loop: MainLoop;
  readonly stats = new Stats();
  readonly tweens = new TweenManager();
  readonly toaster = new Toaster();
  mode: AppMode = 'edit';
  layers: LayerFlags = { ...DEFAULT_LAYERS };
  store: WorldStore | null = null;
  worldId: string = newWorldId();
  readonly reducedMotion: boolean;

  private readonly stage: HTMLElement;
  private readonly topbar: Topbar;
  private readonly toolbar: Toolbar;
  private readonly worldPanel: WorldPanel;
  private readonly statusbar: Statusbar;
  private readonly help: HelpOverlay;
  readonly worldManager: WorldManager;
  readonly minimap = new Minimap();
  readonly progress = new ProgressOverlay();
  /** Reused every frame (no per-frame allocation). */
  private readonly frameCtx: FrameContext;
  private readonly viewCorners: Vec2[] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  private targets: Vec2[] = [];
  private targetsVersion = -1;
  readonly lights = new TrafficLightSystem();
  private lightsVersion = -1;
  private readonly osmDialog: OsmDialog;
  private readonly library: LibraryDialog;
  private lastThumbAt = -Infinity;
  private importing = false;
  /** The running simulation (Simulate/Train modes). */
  sim: Simulation | null = null;
  private simKey = '';
  private simRoute: { path: LanePath; from: number; to: number } | null = null;
  private manualCrashAt = -1;
  private readonly noSensors: Sensor[] = [];
  private carBuf = new Float64Array(0);
  private carKinds = new Uint8Array(0);
  readonly hud = new Hud([
    { key: 'speed', label: 'Speed', suffix: ' km/h' },
    { key: 'traffic', label: 'Traffic', smooth: false },
    { key: 'parked', label: 'Parked', smooth: false },
    { key: 'arrivals', label: 'Trips done', smooth: false },
    { key: 'crashes', label: 'Collisions', smooth: false },
    { key: 'fps', label: 'FPS' },
    { key: 'simms', label: 'Sim ms', decimals: 2 },
  ]);
  private readonly fileInput: HTMLInputElement;
  private autosaveTimer = 0;
  private lastSavedSignature = '';
  private statusTick = 0;
  private spaceUsedForPan = false;
  private ready = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.model = new WorldModel({
      meta: { name: 'Untitled world', createdAt: new Date().toISOString() },
    });
    this.layers = { ...DEFAULT_LAYERS, ...getPref<Partial<LayerFlags>>('layers', {}) };

    this.stage = h('div', {
      class: 'stage',
      tabIndex: 0,
      aria: { label: 'World view. Use the tools to edit roads.' },
    });
    this.renderer2d = new Canvas2DRenderer(this.viewport);
    this.renderer2d.mount(this.stage);

    this.editor = new EditorController({
      model: this.model,
      history: this.history,
      viewport: this.viewport,
      toast: (msg) => this.toast(msg),
    });
    this.editor.attach(this.stage);

    this.topbar = new Topbar(
      {
        onMode: (m) => this.setMode(m),
        onView: (v) => this.setView(v),
        onMenu: (id) => void this.menuAction(id),
        onHelp: () => this.help.toggle(),
      },
      MENU,
    );
    this.toolbar = new Toolbar((id) => this.setTool(id));
    this.worldPanel = new WorldPanel(
      {
        onSettings: (p) => this.applySettings(p),
        onSeed: (s) => this.model.setSeed(s),
        onReseed: () => this.model.setSeed(Math.floor(Math.random() * 1e9)),
        onLayer: (k, v) => this.setLayer(k, v),
      },
      getPref('worldPanelCollapsed', true),
    );
    this.statusbar = new Statusbar({
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onGrid: () => this.toggleGrid(),
    });
    this.help = new HelpOverlay();
    this.fileInput = h('input', {
      type: 'file',
      class: 'sr-only',
      attrs: { accept: '.json,application/json', tabindex: '-1' },
      aria: { hidden: 'true' },
      onchange: () => {
        const f = this.fileInput.files?.[0];
        if (f) void this.openFile(f);
        this.fileInput.value = '';
      },
    });

    root.append(
      h(
        'div',
        { class: 'app', data: { mode: 'edit' } },
        this.stage,
        this.topbar.el,
        h('div', { class: 'left-dock' }, this.toolbar.el, this.worldPanel.el),
        this.statusbar.el,
        this.toaster.el,
        this.minimap.el,
        this.hud.el,
        this.progress.el,
        this.help.el,
        this.fileInput,
      ),
    );
    this.toolbar.setActive('graph');
    for (const id of ['infinite']) this.topbar.setItemEnabled(id, false);
    this.topbar.view.setDisabled('3d', true, '3D view arrives in a later build');

    this.worldManager = new WorldManager({
      onProgress: (f, stage) => {
        if (!this.progress.isActive) this.progress.start('Generating world');
        this.progress.set(f, `Generating world: ${stage}`);
      },
      onWorkerDone: (ms) => {
        this.progress.done();
        console.info(`world generated in a worker in ${ms.toFixed(0)} ms`);
      },
      onError: (msg) => {
        this.progress.done();
        this.toast('World generation failed', { kind: 'error', details: [msg] });
      },
    });
    this.minimap.onNavigate = (w) => this.viewport.panTo(w);
    this.osmDialog = new OsmDialog({
      onImport: (text, opts) => void this.importOsmText(text, opts),
      loadSampleText: () => this.fetchText('worlds/osm-sample.osm.json'),
      toast: (m) => this.toast(m),
    });
    this.library = new LibraryDialog({
      list: () => this.store?.list() ?? Promise.resolve([]),
      currentId: () => this.worldId,
      currentName: () => this.model.meta.name,
      open: (id) => void this.openFromLibrary(id),
      remove: (id) => this.removeFromLibrary(id),
      rename: (name) => this.renameWorld(name),
      newWorld: () => this.newWorld(),
    });
    root.querySelector('.app')?.append(this.osmDialog.dialog.el, this.library.dialog.el);
    this.frameCtx = {
      model: this.model,
      geometry: null,
      geometryStale: true,
      previewSegmentIds: null,
      lights: this.lights,
      sim: null,
      bestCarId: null,
      focusSensor: null,
      extraSensors: [],
      route: null,
      mode: this.mode,
      editor: null,
      layers: this.layers,
      alpha: 1,
      timeMs: 0,
      dtMs: 0,
      focusCarId: null,
      reducedMotion: this.reducedMotion,
    };
    this.loop = new MainLoop({ step: (dt) => this.sim?.step(dt), frame: (f) => this.frame(f) });
    this.bindGlobalEvents();
  }

  /** Loads the last world (IndexedDB) and starts the loop. */
  async start(): Promise<void> {
    this.resize();
    this.store = await openWorldStore();
    const lastId = getLastWorldId();
    let loaded = false;
    if (lastId) {
      try {
        const entry = await this.store.load(lastId);
        if (entry) {
          const res = parseWorldText(JSON.stringify(entry.file));
          if (res.ok) {
            this.worldId = entry.id;
            this.setModel(res.value.model, res.value.view);
            loaded = true;
          }
        }
      } catch (e) {
        console.warn('could not restore last world', e);
      }
    }
    if (!loaded) this.viewport.set({ x: 0, y: 0 }, 0.6);
    this.history.clear();
    this.lastSavedSignature = this.signature();
    this.history.onChange(() => this.scheduleAutosave());
    this.loop.start();
    this.ready = true;
    this.exposeDebugHooks();
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  private frame(f: FrameInfo): void {
    const dt = f.dtMs / 1000;
    this.viewport.update(dt);
    this.tweens.update(f.dtMs);
    this.worldManager.update(this.model, this.editor.isDragging, f.timeMs);
    const geo = this.worldManager.geometry;
    const frame = this.frameCtx;
    frame.model = this.model;
    frame.geometry = geo;
    frame.geometryStale = !this.worldManager.isFresh(this.model);
    frame.previewSegmentIds = this.editor.dragSegmentIds;
    frame.mode = this.mode;
    frame.editor = this.mode === 'edit' ? this.editor.overlay(f.timeMs) : null;
    frame.layers = this.layers;
    frame.alpha = f.alpha;
    frame.timeMs = f.timeMs;
    frame.dtMs = f.dtMs;
    this.syncLights();
    if (this.mode === 'edit') this.lights.update(f.dtMs / 1000);
    this.updateSim(f.dtMs);
    const sim = this.sim;
    frame.sim = sim;
    frame.lights = sim ? sim.lights : this.lights;
    frame.focusCarId = sim?.manual ? sim.manual.id : null;
    frame.focusSensor = sim?.manualSensor ?? null;
    frame.extraSensors = this.noSensors;
    frame.route = sim ? this.simRoute : null;
    if (sim?.manual)
      this.viewport.follow(sim.manual.lerpX(f.alpha), sim.manual.lerpY(f.alpha), f.dtMs / 1000);
    this.renderer2d.render(frame);
    this.stats.drawCalls = this.renderer2d.drawCalls;
    if (this.layers.minimap) this.renderMinimap(f.timeMs);
    this.stats.record(f.dtMs, f.simCostMs);
    if (f.timeMs - this.statusTick > 100) {
      this.statusTick = f.timeMs;
      this.updateStatus();
      this.checkAutosave();
    }
  }

  private updateStatus(): void {
    const w = this.editor.state.mouseWorld;
    this.statusbar.update({
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      grid: this.editor.gridEnabled,
      zoom: this.viewport.zoom,
      x: w ? w.x : null,
      y: w ? w.y : null,
      points: this.model.graph.pointCount,
      segments: this.model.graph.segmentCount,
      markings: this.model.markings.size,
    });
  }

  private resize(): void {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer2d.resize(r.width, r.height, dpr);
    const narrow = r.width < 900;
    this.minimap.resize(narrow ? 160 : 230, narrow ? 116 : 160, dpr);
  }

  /** Creates, refreshes or discards the simulation for the current mode and world. */
  private updateSim(dtMs: number): void {
    if (this.mode === 'edit') {
      if (this.sim) this.stopSim();
      return;
    }
    const geo = this.worldManager.geometry;
    if (!geo || !this.worldManager.isFresh(this.model)) return;
    const key = `${this.model.geometryVersion}:${this.model.markings.version}`;
    if (!this.sim || key !== this.simKey) this.startSim();
    const sim = this.sim;
    if (!sim) return;
    // the manual car respawns two seconds after a crash
    const m = sim.manual;
    if (m?.damaged) {
      if (this.manualCrashAt < 0) this.manualCrashAt = sim.time;
      else if (sim.time - this.manualCrashAt > 2) {
        sim.resetManual();
        this.manualCrashAt = -1;
      }
    }
    this.hud.setBadge(this.loop.paused ? 'Paused' : `×${this.loop.speed}`, this.loop.paused);
    this.hud.set('speed', m ? Math.abs(m.speed) * 0.36 : 0);
    this.hud.set('traffic', sim.traffic.cars.filter((c) => c.active).length);
    this.hud.set('parked', sim.traffic.parkedNow);
    this.hud.set('arrivals', sim.traffic.stats.arrivals);
    this.hud.set('crashes', sim.damageCount.traffic + sim.damageCount.manual);
    this.hud.set('fps', this.stats.fps);
    this.hud.set('simms', this.stats.avgSimMs);
    this.hud.update(dtMs, this.reducedMotion);
  }

  private startSim(): void {
    const geo = this.worldManager.geometry;
    if (!geo) return;
    this.sim = new Simulation(this.model, geo, {
      trafficCount: 14,
      manual: true,
      seed: this.model.seed,
    });
    this.simKey = `${this.model.geometryVersion}:${this.model.markings.version}`;
    this.manualCrashAt = -1;
    this.renderer2d.skidDecal.clear();
    // route preview from the start to the active target
    this.simRoute = null;
    const target = activeTarget(this.model.markings.ofType('target'));
    const start = this.sim.defaultSpawn();
    if (target) {
      const r = planRoute(
        this.model.graph,
        this.sim.routeGraph,
        this.model.markings,
        this.model.settings.roadWidth,
        start,
        { marking: target },
      );
      if (r) this.simRoute = { path: r.path, from: r.sStart, to: r.sEnd };
    }
    this.loop.paused = false;
    const m = this.sim.manual;
    if (m) this.viewport.set({ x: m.x, y: m.y }, Math.max(this.viewport.zoom, 0.7));
  }

  private stopSim(): void {
    this.sim = null;
    this.simKey = '';
    this.simRoute = null;
    this.loop.paused = true;
  }

  private renderMinimap(timeMs: number): void {
    const b = this.viewport.visibleBounds();
    const c = this.viewCorners;
    (c[0] as Vec2).x = b.minX;
    (c[0] as Vec2).y = b.minY;
    (c[1] as Vec2).x = b.maxX;
    (c[1] as Vec2).y = b.minY;
    (c[2] as Vec2).x = b.maxX;
    (c[2] as Vec2).y = b.maxY;
    (c[3] as Vec2).x = b.minX;
    (c[3] as Vec2).y = b.maxY;
    this.minimap.render({
      geometry: this.worldManager.geometry,
      segments: this.model.graph.segments,
      view: c,
      cars: this.packCars(),
      carCount: this.sim ? this.sim.cars.length : 0,
      carKinds: this.sim ? this.carKinds : null,
      bestCar: null,
      targets: this.targetList(),
      route: null,
      timeMs,
    });
  }

  /** Packs car positions for the minimap (reused buffers). */
  private packCars(): Float64Array | null {
    const sim = this.sim;
    if (!sim) return null;
    const n = sim.cars.length;
    if (this.carBuf.length < n * 2) {
      this.carBuf = new Float64Array(n * 2);
      this.carKinds = new Uint8Array(n);
    }
    for (let i = 0; i < n; i++) {
      const c = sim.cars[i];
      if (!c) continue;
      this.carBuf[i * 2] = c.x;
      this.carBuf[i * 2 + 1] = c.y;
      this.carKinds[i] = !c.active || c.damaged ? 2 : c.kind === 'traffic' ? 1 : 0;
    }
    return this.carBuf;
  }

  /** Replaces the world with a freshly generated demo city (seeded). */
  loadDemoCity(seed = Math.floor(Math.random() * 1e9), opts: DemoCityOptions = {}): void {
    const model = generateDemoCity(seed, opts);
    addDemoMarkings(model);
    model.meta.createdAt = new Date().toISOString();
    this.worldId = newWorldId();
    this.setModel(model, null);
    this.history.clear();
    this.scheduleAutosave(0);
    this.toast(`Demo city generated (seed ${seed})`, { kind: 'success' });
  }

  // ---------------------------------------------------------------------------
  // Model and modes
  // ---------------------------------------------------------------------------

  /** Replaces the world model (load, demo, OSM import) without a page reload. */
  setModel(model: WorldModel, view: WorldView | null = null): void {
    this.model = model;
    this.editor.setModel(model);
    this.worldManager.reset();
    this.topbar.worldName.textContent = model.meta.name;
    if (view) this.viewport.set({ x: view.offset[0], y: view.offset[1] }, view.zoom);
    else if (model.graph.pointCount > 0) this.viewport.fitPoints(model.graph.points, 80);
    this.syncPanels();
  }

  setMode(mode: AppMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.topbar.mode.set(mode);
    this.editor.editable = mode === 'edit';
    this.root.querySelector('.app')?.setAttribute('data-mode', mode);
    this.minimap.el.classList.toggle('hidden', !this.layers.minimap);
    if (mode !== 'edit') this.editor.cancel();
  }

  setView(view: '2d' | '3d'): void {
    if (view === '3d') {
      this.toast('3D view arrives in a later build', { kind: 'info' });
      this.topbar.view.set('2d');
    }
  }

  setTool(id: ToolId): void {
    if (this.mode !== 'edit') this.setMode('edit');
    this.editor.setTool(id);
    this.toolbar.setActive(id);
  }

  setLayer(key: keyof LayerFlags, value: boolean): void {
    this.layers = { ...this.layers, [key]: value };
    setPref('layers', this.layers);
    this.minimap.el.classList.toggle('hidden', !this.layers.minimap);
    this.syncPanels();
  }

  applySettings(partial: Partial<WorldSettings>): void {
    this.model.setSettings(partial);
    this.scheduleAutosave();
  }

  toggleGrid(): void {
    const on = this.editor.toggleGrid();
    this.toast(on ? 'Grid snapping on' : 'Grid snapping off');
  }

  undo(): void {
    const cmd = this.history.undo();
    if (cmd) {
      this.editor.clearSelection();
      this.editor.refreshHover();
      this.toast(`Undo: ${cmd.label}`);
    }
  }

  redo(): void {
    const cmd = this.history.redo();
    if (cmd) {
      this.editor.refreshHover();
      this.toast(`Redo: ${cmd.label}`);
    }
  }

  private syncPanels(): void {
    this.worldPanel.sync(this.model.settings, this.model.seed, this.layers);
  }

  toast(msg: string, opts: ToastOptions = {}): void {
    this.toaster.show(msg, opts);
  }

  // ---------------------------------------------------------------------------
  // World menu and files
  // ---------------------------------------------------------------------------

  async menuAction(id: string): Promise<void> {
    switch (id) {
      case 'save':
        this.saveFile();
        break;
      case 'open':
        this.fileInput.click();
        break;
      case 'demo':
        this.loadDemoCity();
        break;
      case 'dispose':
        this.disposeWorld();
        break;
      case 'ring':
        await this.loadBundled('worlds/ring-road.world.json', 'Ring road');
        break;
      case 'osm-sample':
        await this.importOsmText(await this.fetchText('worlds/osm-sample.osm.json'), {
          name: 'Neuenstadt (OSM sample)',
          decorate: true,
        });
        break;
      case 'osm-import':
        this.osmDialog.show();
        break;
      case 'library':
        await this.library.show();
        break;
      default:
        this.toast('Coming in a later build');
    }
  }

  /** Fetches a bundled file relative to the app base path. */
  async fetchText(path: string): Promise<string> {
    const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
    if (!res.ok) throw new Error(`Could not fetch ${path} (${res.status})`);
    return res.text();
  }

  /** Loads a bundled world file. */
  async loadBundled(path: string, label: string): Promise<boolean> {
    try {
      return this.loadWorldText(await this.fetchText(path), label);
    } catch (e) {
      this.toast(`Could not load ${label}`, { kind: 'error', details: [String(e)] });
      return false;
    }
  }

  /**
   * Imports Overpass JSON text (spec J4/J5). Parsing runs as a generator stepped in
   * slices of about 8 ms per frame with a progress bar, so the UI never blocks; the
   * world is then generated (in a worker when large).
   */
  async importOsmText(
    text: string,
    opts: OsmImportOptions & { decorate?: boolean } = {},
  ): Promise<boolean> {
    if (this.importing) return false;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      this.toast('That is not valid JSON', {
        kind: 'error',
        details: [e instanceof Error ? e.message : String(e)],
      });
      return false;
    }
    this.importing = true;
    this.progress.start('Importing OpenStreetMap data');
    try {
      const steps = importOsmSteps(json, opts);
      let result: OsmResult | null = null;
      while (!result) {
        const t0 = performance.now();
        while (performance.now() - t0 < 8) {
          const r = steps.next();
          if (r.done) {
            result = r.value;
            break;
          }
          this.progress.set(r.value * 0.5, 'Importing OpenStreetMap data');
        }
        if (!result) await new Promise((res) => requestAnimationFrame(res));
      }
      if (result.model.graph.segmentCount === 0) {
        this.progress.done();
        this.toast('No drivable roads found', { kind: 'warn', details: result.warnings });
        return false;
      }
      result.model.meta.createdAt = new Date().toISOString();
      if (opts.decorate) addDemoMarkings(result.model);
      this.worldId = newWorldId();
      this.setModel(result.model, null);
      this.history.clear();
      this.scheduleAutosave(0);
      this.progress.done();
      const st = result.stats;
      this.toast(
        `Imported ${result.model.graph.segmentCount} road segments from ${st.highways} ways`,
        {
          kind: 'success',
          details: [
            `${st.oneWay} one-way, ${st.bridges} bridges, ${st.tunnels} tunnels, ${st.skipped} ways skipped`,
          ],
        },
      );
      return true;
    } catch (e) {
      this.progress.done();
      const msg =
        e instanceof OsmFormatError
          ? e.message
          : `Import failed: ${e instanceof Error ? e.message : String(e)}`;
      this.toast('Could not import OSM data', { kind: 'error', details: [msg] });
      return false;
    } finally {
      this.importing = false;
    }
  }

  /** Re-groups traffic lights when markings change (cheap version check). */
  private syncLights(): void {
    const v = this.model.markings.version;
    if (v === this.lightsVersion) return;
    this.lightsVersion = v;
    this.lights.build(
      this.model.markings.ofType('light'),
      this.model.graph,
      this.model.settings.roadWidth,
      v,
    );
  }

  /** Target positions for the minimap (rebuilt on markings change). */
  private targetList(): Vec2[] {
    const v = this.model.markings.version;
    if (v !== this.targetsVersion) {
      this.targetsVersion = v;
      this.targets = [];
      for (const m of this.model.markings.ofType('target')) {
        const r = resolveMarking(m, this.model.graph, this.model.settings.roadWidth);
        if (r) this.targets.push(r.center);
      }
    }
    return this.targets;
  }

  // ---------------------------------------------------------------------------
  // World library
  // ---------------------------------------------------------------------------

  private async openFromLibrary(id: string): Promise<void> {
    if (!this.store || id === this.worldId) return;
    await this.autosave();
    const entry = await this.store.load(id);
    if (!entry) {
      this.toast('That world no longer exists', { kind: 'warn' });
      return;
    }
    const res = parseWorldText(JSON.stringify(entry.file));
    if (!res.ok) {
      this.toast('Could not open world', { kind: 'error', details: res.errors });
      return;
    }
    this.worldId = entry.id;
    this.setModel(res.value.model, res.value.view);
    this.history.clear();
    setLastWorldId(entry.id);
    this.lastSavedSignature = this.signature();
    this.toast(`Opened "${entry.name}"`, { kind: 'success' });
  }

  private async removeFromLibrary(id: string): Promise<void> {
    if (!this.store) return;
    const entry = await this.store.load(id);
    await this.store.remove(id);
    if (entry) {
      this.toast(`Deleted "${entry.name}"`, {
        kind: 'warn',
        action: {
          label: 'Undo',
          run: () => void this.store?.save(entry).then(() => this.library.refresh()),
        },
      });
    }
    if (id === this.worldId) {
      this.worldId = newWorldId();
      this.lastSavedSignature = '';
    }
  }

  renameWorld(name: string): void {
    this.model.meta.name = name;
    this.topbar.worldName.textContent = name;
    this.scheduleAutosave(0);
  }

  newWorld(): void {
    void this.autosave().then(() => {
      this.worldId = newWorldId();
      this.setModel(
        new WorldModel({ meta: { name: 'Untitled world', createdAt: new Date().toISOString() } }),
        null,
      );
      this.viewport.set({ x: 0, y: 0 }, 0.6);
      this.history.clear();
      this.scheduleAutosave(0);
    });
  }

  disposeWorld(): void {
    if (this.model.graph.pointCount === 0 && this.model.markings.size === 0) {
      this.toast('The world is already empty');
      return;
    }
    this.history.push(new DisposeWorldCommand(this.model));
    this.editor.clearSelection();
    this.toast('World disposed', {
      kind: 'warn',
      action: { label: 'Undo', run: () => this.undo() },
    });
  }

  private currentView(): WorldView {
    return { zoom: this.viewport.zoom, offset: [this.viewport.center.x, this.viewport.center.y] };
  }

  saveFile(): void {
    const file = serializeWorld(this.model, this.currentView());
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const a = h('a', {
      attrs: {
        href: URL.createObjectURL(blob),
        download: `${slug(this.model.meta.name)}.world.json`,
      },
    });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toast('World saved to file', { kind: 'success' });
  }

  async openFile(file: File): Promise<void> {
    const text = await file.text();
    this.loadWorldText(text, file.name);
  }

  /** Loads world JSON text; shows validation errors as a toast. Never reloads the page. */
  loadWorldText(text: string, label = 'file'): boolean {
    const res = parseWorldText(text);
    if (!res.ok) {
      this.toast(`Could not load ${label}`, { kind: 'error', details: res.errors });
      return false;
    }
    this.worldId = newWorldId();
    this.setModel(res.value.model, res.value.view);
    this.history.clear();
    this.scheduleAutosave(0);
    if (res.value.warnings.length > 0)
      this.toast(`Loaded with ${res.value.warnings.length} warnings`, {
        kind: 'warn',
        details: res.value.warnings,
      });
    else this.toast(`Loaded "${res.value.model.meta.name}"`, { kind: 'success' });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Autosave (IndexedDB, debounced 1 s)
  // ---------------------------------------------------------------------------

  private signature(): string {
    return `${this.model.geometryVersion}:${this.model.markings.version}:${this.model.meta.name}`;
  }

  private checkAutosave(): void {
    if (this.signature() !== this.lastSavedSignature) this.scheduleAutosave();
  }

  private scheduleAutosave(delay = 1000): void {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => void this.autosave(), delay);
  }

  /** Minimap-based thumbnail, refreshed at most every 10 s (kept between saves). */
  private thumbCache: string | null = null;
  private thumbnail(): string | null {
    const now = performance.now();
    if (now - this.lastThumbAt > 10_000 || this.thumbCache === null) {
      this.thumbCache = this.minimap.thumbnail();
      this.lastThumbAt = now;
    }
    return this.thumbCache;
  }

  async autosave(): Promise<void> {
    if (!this.store) return;
    const sig = this.signature();
    const file = serializeWorld(this.model, this.currentView());
    try {
      await this.store.save({
        id: this.worldId,
        name: this.model.meta.name,
        updatedAt: new Date().toISOString(),
        thumbnail: this.thumbnail(),
        file,
      });
      setLastWorldId(this.worldId);
      this.lastSavedSignature = sig;
    } catch (e) {
      console.warn('autosave failed', e);
      this.toast('Autosave failed', { kind: 'error' });
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  private bindGlobalEvents(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => {
      this.editor.spaceDown = false;
    });
    // drag-and-drop world files onto the canvas
    this.stage.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.stage.classList.add('drop');
    });
    this.stage.addEventListener('dragleave', () => this.stage.classList.remove('drop'));
    this.stage.addEventListener('drop', (e) => {
      e.preventDefault();
      this.stage.classList.remove('drop');
      const f = e.dataTransfer?.files[0];
      if (f) void this.openFile(f);
    });
    window.addEventListener('beforeunload', () => {
      if (this.signature() !== this.lastSavedSignature) void this.autosave();
    });
  }

  private onKeyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)
    ) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (this.driveKey(e, true)) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) {
        this.editor.spaceDown = true;
        this.spaceUsedForPan = false;
      }
      return;
    }
    if (this.help.isOpen && e.key === 'Escape') {
      this.help.hide();
      return;
    }
    const action = matchBinding(e);
    if (!action) return;
    if (
      action === 'mode.toggle' ||
      action === 'file.save' ||
      action === 'file.open' ||
      action === 'edit.delete'
    )
      e.preventDefault();
    this.runAction(action);
  }

  /** Arrow keys / WASD drive the manual car in Simulate mode. Returns true if handled. */
  private driveKey(e: KeyboardEvent, down: boolean): boolean {
    const sim = this.sim;
    if (!sim?.manual || this.mode === 'edit' || e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key.toLowerCase();
    const map: Record<string, keyof typeof sim.keys> = {
      arrowup: 'up',
      w: 'up',
      arrowdown: 'down',
      s: 'down',
      arrowleft: 'left',
      a: 'left',
      arrowright: 'right',
      d: 'right',
    };
    const dir = map[k];
    if (!dir) return false;
    e.preventDefault();
    sim.keys[dir] = down;
    return true;
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (this.driveKey(e, false)) return;
    if (e.key === ' ') {
      this.editor.spaceDown = false;
      if (!this.spaceUsedForPan && this.mode !== 'edit') this.loop.paused = !this.loop.paused;
    }
  }

  /** Executes a keyboard action (also used by UI buttons and tests). */
  runAction(action: ActionId): void {
    const tools: Partial<Record<ActionId, ToolId>> = {
      'tool.graph': 'graph',
      'tool.stop': 'stop',
      'tool.yield': 'yield',
      'tool.crossing': 'crossing',
      'tool.parking': 'parking',
      'tool.light': 'light',
      'tool.start': 'start',
      'tool.target': 'target',
      'tool.erase': 'erase',
    };
    const tool = tools[action];
    if (tool) {
      this.setTool(tool);
      return;
    }
    switch (action) {
      case 'edit.grid':
        this.toggleGrid();
        break;
      case 'edit.oneWay':
        if (!this.editor.toggleOneWay()) this.toast('Select a road segment first');
        break;
      case 'edit.delete':
        this.editor.deleteSelection();
        break;
      case 'edit.undo':
        this.undo();
        break;
      case 'edit.redo':
        this.redo();
        break;
      case 'edit.cancel':
        if (this.topbar.menuOpen) this.topbar.toggle(false);
        else this.editor.cancel();
        break;
      case 'mode.toggle':
        this.setMode(this.mode === 'edit' ? 'simulate' : 'edit');
        break;
      case 'sim.faster':
        this.loop.speed = Math.min(8, this.loop.speed * 2);
        this.toast(`Simulation speed ×${this.loop.speed}`);
        break;
      case 'sim.slower':
        this.loop.speed = Math.max(1, this.loop.speed / 2);
        this.toast(`Simulation speed ×${this.loop.speed}`);
        break;
      case 'sim.resetCar':
        this.sim?.resetManual();
        break;
      case 'view.focusBest':
        if (this.sim?.manual) this.viewport.followPausedUntil = 0;
        break;
      case 'view.minimap':
        this.setLayer('minimap', !this.layers.minimap);
        break;
      case 'file.save':
        this.saveFile();
        break;
      case 'file.open':
        this.fileInput.click();
        break;
      case 'help.toggle':
        this.help.toggle();
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Debug hooks (window.__ND__)
  // ---------------------------------------------------------------------------

  private exposeDebugHooks(): void {
    const hooks = {
      actions: {
        run: (a: ActionId) => this.runAction(a),
        worldToScreen: (x: number, y: number) => this.viewport.worldToScreen(x, y),
        setView: (cx: number, cy: number, zoom: number) =>
          this.viewport.set({ x: cx, y: cy }, zoom),
        autosaveNow: () => this.autosave(),
        loadWorldText: (text: string) => this.loadWorldText(text),
        loadDemo: (seed?: number, opts?: DemoCityOptions) => this.loadDemoCity(seed, opts),
        loadBundled: (path: string) => this.loadBundled(path, path),
        loadSampleOsm: () => this.menuAction('osm-sample'),
        lightColor: (id: number) => this.lights.colorOf(id),
        updateLights: (dt: number) => this.lights.update(dt),
        setLayer: (k: keyof LayerFlags, v: boolean) => this.setLayer(k, v),
        setMode: (m: AppMode) => this.setMode(m),
        setSimSpeed: (x: number) => {
          this.loop.speed = Math.max(1, Math.min(8, Math.round(x)));
        },
        setKeys: (k: Partial<Record<'up' | 'down' | 'left' | 'right', boolean>>) => {
          if (this.sim) Object.assign(this.sim.keys, k);
        },
      },
    };
    const getters: Record<string, () => unknown> = {
      ready: () => this.ready,
      world: () => this.model,
      stats: () => this.stats,
      geometry: () => {
        const g = this.worldManager.geometry;
        return g
          ? {
              version: g.version,
              fresh: this.worldManager.isFresh(this.model),
              roads: g.data.roads.length,
              borders: g.data.roadBorders.length,
              buildings: g.data.buildings.length,
              trees: g.data.trees.length,
              genMs: this.worldManager.lastGenMs,
              timings: g.data.timings,
            }
          : null;
      },
      minimap: () => ({ staticRedraws: this.minimap.staticRedraws }),
      sim: () => {
        const sim = this.sim;
        if (!sim) return null;
        return {
          stepCount: sim.stepCount,
          time: sim.time,
          paused: this.loop.paused,
          speed: this.loop.speed,
          carCount: sim.cars.length,
          manual: sim.manual
            ? {
                x: sim.manual.x,
                y: sim.manual.y,
                speed: sim.manual.speed,
                damaged: sim.manual.damaged,
              }
            : null,
          traffic: {
            ...sim.traffic.stats,
            active: sim.traffic.cars.filter((c) => c.active).length,
          },
          carPositions: sim.cars.map((c) => [Math.round(c.x), Math.round(c.y)]),
        };
      },
      mode: () => this.mode,
      viewport: () => ({ zoom: this.viewport.zoom, center: { ...this.viewport.center } }),
      history: () => ({ undo: this.history.undoSize, canRedo: this.history.canRedo }),
      editor: () => {
        const s = this.editor.state;
        return {
          selectedPointId: s.selectedPointId,
          selectedSegmentIds: [...s.selectedSegmentIds],
          selectedPointIds: [...s.selectedPointIds],
        };
      },
    };
    for (const [key, get] of Object.entries(getters))
      Object.defineProperty(hooks, key, { get, enumerable: true });
    Object.defineProperty(window, '__ND__', { value: Object.freeze(hooks), configurable: true });
  }
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'world'
  );
}
