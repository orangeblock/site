import { PointerTools, type Tool } from './interaction/pointer-tools';
import { Simulation } from './physics/simulation';
import { DEFAULT_TEMPLATE, randomFill, spawnPattern } from './physics/spawn';
import { AimGuide } from './render/aim-guide';
import { FieldMarkers } from './render/field-markers';
import { CameraRig, type CameraMode } from './render/camera-rig';
import { View, type SurfaceHit } from './render/view';
import { defaultSettings, type Settings } from './settings';
import { Panel, type BallProp } from './ui/panel';
import { worlds, type World } from './worlds';

const RANDOM_BALLS = 5000;

/**
 * Wires the three parts together and runs the frame loop:
 *
 *   physics (Simulation)  ←→  App  ←→  rendering (View, CameraRig)  and  UI (Panel, PointerTools)
 *
 * The simulation never knows about three.js or the DOM, and the view and panel never change the simulation
 * directly. Everything goes through the methods here.
 */
export class App {
	private readonly sim = new Simulation(worlds[0].colliders);
	private readonly view: View;
	private readonly rig: CameraRig;
	private readonly tools: PointerTools;
	private readonly guide = new AimGuide();
	private readonly markers = new FieldMarkers();
	private readonly panel: Panel;
	private readonly settings: Settings = { ...defaultSettings, batch: { ...defaultSettings.batch } };
	private readonly abort = new AbortController();

	private world: World = worlds[0];
	private wallsEnabled = true;
	/** Id of the selected force field, or -1. A ball and a field are never selected together. */
	private selectedField = -1;
	/** Maximum rendered frames per second, or 0 to render on every display refresh. */
	private renderCap = 0;

	private lastTime: number | null = null;
	private sinceRender = 0;
	private frames = 0;
	private ticks = 0;
	private sinceReadout = 0;

	constructor(canvas: HTMLCanvasElement, panelRoot: HTMLElement) {
		canvas.tabIndex = 0;
		this.view = new View(canvas);
		this.view.scene.add(this.guide.group, this.markers.group);

		// Touch screens have no keyboard for the fly camera, so they start in orbit mode.
		const touch = window.matchMedia('(pointer: coarse)').matches;
		const mode: CameraMode = touch ? 'orbit' : 'fly';
		this.rig = new CameraRig(this.view.camera, canvas, mode);

		this.panel = new Panel(panelRoot, worlds, this.settings, this.panelActions(), { cameraMode: mode, touch });

		// Created after the rig, but its listeners run first because they are registered in the capture phase.
		this.tools = new PointerTools({
			canvas,
			view: this.view,
			sim: this.sim,
			rig: this.rig,
			guide: this.guide,
			settings: this.settings,
			select: (ball) => this.select(ball),
			selectField: (id) => this.selectField(id),
			placeBalls: (surface) => this.addPattern(surface, this.settings.pattern, this.settings.count),
			emitBall: (surface) => this.addPattern(surface, 'single', 1),
			placeField: (point) => this.placeField(point),
			toolChanged: (tool) => this.panel.setTool(tool),
			aimChanged: (force) => this.panel.setAim(force),
		});

		canvas.addEventListener('keydown', (e) => this.onKey(e), { signal: this.abort.signal });
		this.loadWorld(worlds[0]);
	}

	start(): void {
		this.lastTime = null;
		this.view.renderer.setAnimationLoop((time) => this.frame(time));
	}

	stop(): void {
		this.view.renderer.setAnimationLoop(null);
	}

	dispose(): void {
		this.stop();
		this.abort.abort();
		this.tools.dispose();
		this.rig.dispose();
		this.view.dispose();
	}

	// ---- Frame loop ----

	private frame(time: number): void {
		const dt = this.lastTime === null ? 0 : Math.min((time - this.lastTime) / 1000, 0.1);
		this.lastTime = time;

		this.rig.update(dt);
		this.tools.update(dt);
		// Physics advances in fixed ticks however long this frame took, and rendering is a snapshot of the result.
		this.ticks += this.sim.advance(dt);

		this.panel.refreshBall(this.sim.store);

		this.sinceRender += dt;
		if (this.renderCap > 0 && this.sinceRender < 1 / this.renderCap - 0.002) return;
		this.sinceRender = 0;
		this.view.sync(this.sim.store);
		this.markers.sync(this.sim.forces.fields, this.selectedField);
		this.view.render();
		this.frames++;

		this.sinceReadout += dt;
		if (this.sinceReadout >= 0.5) {
			this.panel.setReadout(this.frames / this.sinceReadout, this.ticks / this.sinceReadout, this.sim.store.count);
			this.frames = this.ticks = this.sinceReadout = 0;
		}
	}

	// ---- Worlds ----

	private loadWorld(world: World): void {
		this.world = world;
		this.applyColliders();
		this.view.loadWorld(world, this.wallsEnabled);
		this.panel.setWallsAvailable(!!world.walls);

		this.sim.clearBalls();
		this.sim.forces.clearFields();
		const first = this.sim.addBall({ x: world.spawn[0], y: world.spawn[1], z: world.spawn[2], ...DEFAULT_TEMPLATE });
		this.select(first);
		this.rig.moveTo(world.camera.position, world.camera.target);
	}

	private applyColliders(): void {
		const { colliders, walls = [] } = this.world;
		this.sim.setColliders(this.wallsEnabled ? [...colliders, ...walls] : colliders);
	}

	// ---- Balls ----

	private select(ball: number): void {
		this.selectedField = -1;
		this.sim.store.selected = ball;
		this.panel.showBall(this.sim.store);
	}

	private selectField(id: number): void {
		this.sim.store.selected = -1;
		this.selectedField = id;
		this.panel.showBall(this.sim.store);
	}

	private placeField(point: [number, number, number]): void {
		const { fieldRadius, power, duration, fieldLifetime, pulseRate } = this.settings;
		this.selectField(this.sim.forces.addField(point, fieldRadius, power, duration, fieldLifetime, pulseRate));
	}

	private addPattern(surface: SurfaceHit, pattern: Settings['pattern'], count: number): void {
		for (const spec of spawnPattern(pattern, count, surface.point, surface.normal, this.settings.batch, Math.random, this.settings.randomise)) this.sim.addBall(spec);
	}

	/**
	 * Changes one property of the selected ball. Position and velocity edit where the ball returns to on reset,
	 * and also move it right away while the simulation is paused.
	 */
	private editBall(prop: BallProp, value: number): void {
		const s = this.sim.store;
		const i = s.selected;
		if (i < 0) return;
		const paused = !this.sim.running;
		const origin = { x: s.ox, y: s.oy, z: s.oz, vx: s.ovx, vy: s.ovy, vz: s.ovz };
		const live = { x: s.px, y: s.py, z: s.pz, vx: s.vx, vy: s.vy, vz: s.vz };
		if (prop in origin) {
			origin[prop as keyof typeof origin][i] = value;
			if (paused) live[prop as keyof typeof live][i] = value;
		} else {
			s[prop as 'mass' | 'restitution' | 'radius'][i] = value;
		}
	}

	private randomize(): void {
		this.sim.clearBalls();
		for (const spec of randomFill(RANDOM_BALLS, this.world.fill)) this.sim.addBall(spec);
		this.panel.showBall(this.sim.store);
	}

	private setRunning(running: boolean): void {
		this.sim.running = running;
		this.panel.setRunning(running);
	}

	// ---- Input wiring ----

	private panelActions() {
		return {
			toggleRunning: () => this.setRunning(!this.sim.running),
			step: () => this.sim.tick(),
			resetSelected: () => this.sim.store.selected >= 0 && this.sim.resetBall(this.sim.store.selected),
			resetAll: () => this.sim.resetAll(),
			clearAll: () => {
				this.sim.clearBalls();
				this.sim.forces.clearFields();
				this.selectedField = -1;
				this.panel.showBall(this.sim.store);
			},
			randomize: () => this.randomize(),
			clearFields: () => {
				this.sim.forces.clearFields();
				this.selectedField = -1;
			},
			setTool: (tool: Tool) => this.tools.setTool(tool),
			editBall: (prop: BallProp, value: number) => this.editBall(prop, value),
			setWorld: (id: string) => this.loadWorld(worlds.find((w) => w.id === id) ?? worlds[0]),
			setWalls: (enabled: boolean) => {
				this.wallsEnabled = enabled;
				this.applyColliders();
				this.view.setWallsVisible(enabled);
			},
			setCameraMode: (mode: CameraMode) => this.rig.setMode(mode),
			setCameraSpeed: (speed: number) => (this.rig.speed = speed),
			setTickRate: (rate: number) => (this.sim.tickRate = rate),
			setRenderCap: (fps: number) => (this.renderCap = fps),
			setColourBySpeed: (enabled: boolean) => (this.view.colourBySpeed = enabled),
			setFriction: (friction: number) => (this.sim.friction = friction),
		};
	}

	/** Keyboard shortcuts. They only fire while the canvas has focus, so Space does not scroll the page elsewhere. */
	private onKey(e: KeyboardEvent): void {
		const handlers: Record<string, () => void> = {
			Space: () => this.setRunning(!this.sim.running),
			ArrowRight: () => this.sim.tick(),
			KeyR: () => this.sim.resetAll(),
			KeyG: () => this.randomize(),
			KeyZ: () => this.rig.moveTo(this.world.camera.position, this.world.camera.target),
			Backspace: () => this.deleteSelected(),
			Delete: () => this.deleteSelected(),
		};
		const handler = handlers[e.code];
		if (!handler) return;
		e.preventDefault();
		handler();
	}

	private deleteSelected(): void {
		if (this.selectedField >= 0) {
			this.sim.forces.removeField(this.selectedField);
			this.selectedField = -1;
			return;
		}
		const i = this.sim.store.selected;
		if (i < 0) return;
		this.sim.removeBall(i);
		this.panel.showBall(this.sim.store);
	}
}
