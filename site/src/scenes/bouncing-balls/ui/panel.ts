import type { BallStore } from '../physics/ball-store';
import { RANDOM_RANGES } from '../physics/spawn';
import { MAX_BALLS } from '../physics/constants';
import type { CameraMode } from '../render/camera-rig';
import type { Tool } from '../interaction/pointer-tools';
import type { Settings } from '../settings';
import type { World } from '../worlds';
import { button, checkbox, el, numberField, select, sliderField } from './dom';
import { icons } from './icons';
import './panel.css';

/** The four tools on the strip. Objects and forces also switch the pointer mode; select and world leave it on select. */
export type PanelTool = 'select' | 'objects' | 'forces' | 'world';

const modeOf = (tool: PanelTool): Tool => (tool === 'objects' ? 'add' : tool === 'forces' ? 'field' : 'select');

const TOOLS: { tool: PanelTool; label: string }[] = [
	{ tool: 'select', label: 'Select: pick and launch balls, edit the selected ball' },
	{ tool: 'objects', label: 'Objects: add balls where you click' },
	{ tool: 'forces', label: 'Forces: place force fields where you click' },
	{ tool: 'world', label: 'World and settings' },
];

/** The selected-ball properties the panel can edit. */
export type BallProp = 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'mass' | 'restitution' | 'radius';

export interface PanelActions {
	toggleRunning(): void;
	step(): void;
	resetSelected(): void;
	resetAll(): void;
	clearAll(): void;
	randomize(): void;
	clearFields(): void;
	setTool(tool: Tool): void;
	editBall(prop: BallProp, value: number): void;
	setWorld(id: string): void;
	setWalls(enabled: boolean): void;
	setCameraMode(mode: CameraMode): void;
	setCameraSpeed(speed: number): void;
	setTickRate(rate: number): void;
	setRenderCap(fps: number): void;
	setColourBySpeed(enabled: boolean): void;
	setFriction(friction: number): void;
}

/**
 * The control panel, laid over the scene: a strip of four tool icons down the left edge, a drawer next to it
 * showing the active tool's controls, and a toolbar along the bottom. Plain DOM built with `el`. The panel
 * never touches the simulation itself. User input goes out through `actions` (or straight into `settings`),
 * and the app pushes state back in with the `show*`/`set*` methods.
 *
 * Clicking a tool makes it active and opens its drawer. Clicking the active tool again only folds the drawer
 * away or brings it back, and the tool stays engaged. Objects and forces switch the pointer into add and
 * field mode while they are active.
 */
export class Panel {
	private readonly ballFields = el('fieldset', { class: 'bb-fields' });
	/** Position and velocity: only applied while the simulation is paused, so greyed out while it runs. */
	private readonly motionFields = el('fieldset', { class: 'bb-fields' });
	private readonly runningNote = el('p', { class: 'bb-hint' }, 'Position and velocity can only be changed while paused.');
	private readonly props = new Map<BallProp, { set(value: number): void }>();
	private readonly runButton: HTMLButtonElement;
	private readonly toolButtons = new Map<PanelTool, HTMLButtonElement>();
	private readonly sections = new Map<PanelTool, HTMLElement>();
	private active: PanelTool = 'select';
	private open: boolean;
	private readonly wallsField: HTMLLabelElement;
	private readonly onSetTool: (tool: Tool) => void;
	private readonly aimReadout = el('output', { class: 'bb-aim' });
	private readonly readout = el('div', { class: 'bb-readout' });
	private readonly drawer = el('div', { class: 'bb-drawer' });

	constructor(
		root: HTMLElement,
		worlds: World[],
		settings: Settings,
		actions: PanelActions,
		options: { cameraMode: CameraMode; touch: boolean },
	) {
		this.onSetTool = actions.setTool;
		// On a narrow screen the drawer would cover the scene, so it starts folded away there.
		this.open = !window.matchMedia('(max-width: 640px)').matches;

		// --- Selected ball ---
		const slider = (prop: BallProp, label: string, min: number, max: number, step: number) => {
			const field = sliderField(label, { min, max, step, value: 0 }, (v) => actions.editBall(prop, v));
			this.props.set(prop, field);
			return field.root;
		};
		const number = (prop: BallProp, label: string, limits: { min?: number; max?: number; step: number }) => {
			const field = numberField(label, { ...limits, value: 0 }, (v) => actions.editBall(prop, v));
			this.props.set(prop, { set: (v) => document.activeElement !== field.input && (field.input.value = String(+v.toFixed(3))) });
			return field.root;
		};
		this.motionFields.append(
			slider('x', 'x', -30, 30, 0.1),
			slider('y', 'y', 0, 30, 0.1),
			slider('z', 'z', -30, 30, 0.1),
			el('div', { class: 'bb-row' }, number('vx', 'vx', { min: -100, max: 100, step: 0.5 }), number('vy', 'vy', { min: -100, max: 100, step: 0.5 }), number('vz', 'vz', { min: -100, max: 100, step: 0.5 })),
		);
		this.runningNote.hidden = true;
		this.ballFields.append(
			this.motionFields,
			this.runningNote,
			el('div', { class: 'bb-row' }, number('mass', 'mass', { min: 0.01, step: 0.1 }), number('restitution', 'bounce', { min: 0, max: 1, step: 0.05 }), number('radius', 'radius', { min: 0.01, max: 2, step: 0.01 })),
		);
		this.ballFields.disabled = true;
		const selectBody = [
			el('p', { class: 'bb-hint' }, 'Click a ball to select it. Press a ball, drag away and release to launch it. Shift: up or down. Power and duration are under Forces.'),
			this.ballFields,
		];

		// --- Forces and fields ---
		const withTitle = (field: { root: HTMLLabelElement }, title: string) => {
			field.root.title = title;
			return field.root;
		};
		const forces = [
			el('div', { class: 'bb-row' }, numberField('power (N)', { min: -2000, max: 2000, step: 10, value: settings.power }, (v) => (settings.power = v)).root, numberField('duration (s)', { min: 0.001, max: 5, step: 0.01, value: settings.duration }, (v) => (settings.duration = Math.max(v, 0.001))).root),
			el('p', { class: 'bb-hint' }, 'Click the scene to place a force field. It radiates force: positive pushes, negative pulls. In select mode, click its dot to select it, Backspace removes it. The power and duration also set the launch force.'),
			el(
				'div',
				{ class: 'bb-row' },
				numberField('radius (m)', { min: 0.5, max: 30, step: 0.5, value: settings.fieldRadius }, (v) => (settings.fieldRadius = v)).root,
				withTitle(numberField('lasts (s)', { min: 0, max: 600, step: 1, value: settings.fieldLifetime }, (v) => (settings.fieldLifetime = Math.max(v, 0))), '0 keeps the field until it is removed'),
				withTitle(numberField('pulses/s', { min: 0, max: 30, step: 0.1, value: settings.pulseRate }, (v) => (settings.pulseRate = Math.max(v, 0))), '0 is one steady force instead of pulses'),
			),
			button('Clear fields', actions.clearFields),
		];

		// --- Adding balls ---
		const batch = (key: keyof Settings['batch'], label: string, limits: { min?: number; max?: number; step: number }) =>
			numberField(label, { ...limits, value: settings.batch[key] }, (v) => (settings.batch[key] = v)).root;
		const batchFields = el(
			'fieldset',
			{ class: 'bb-fields' },
			el('div', { class: 'bb-row' }, batch('mass', 'mass', { min: 0.01, step: 0.1 }), batch('restitution', 'bounce', { min: 0, max: 1, step: 0.05 }), batch('radius', 'radius', { min: 0.01, max: 2, step: 0.01 })),
			el('div', { class: 'bb-row' }, batch('vx', 'vx', { min: -100, max: 100, step: 0.5 }), batch('vy', 'vy', { min: -100, max: 100, step: 0.5 }), batch('vz', 'vz', { min: -100, max: 100, step: 0.5 })),
		);
		const [mass, bounce, radius, speed] = [RANDOM_RANGES.mass, RANDOM_RANGES.restitution, RANDOM_RANGES.radius, RANDOM_RANGES.velocity];
		const random = checkbox('random properties', settings.randomise, (v) => {
			settings.randomise = v;
			batchFields.disabled = v;
		});
		random.root.title = `Each ball gets its own mass ${mass[0]}–${mass[1]}, bounce ${bounce[0]}–${bounce[1]}, radius ${radius[0]}–${radius[1]} and velocity ${speed[0]} to ${speed[1]} m/s on each axis.`;
		const add = [
			el('p', { class: 'bb-hint' }, 'Click the scene to add balls with these properties.'),
			el(
				'div',
				{ class: 'bb-row' },
				select('pattern', [{ value: 'single', label: 'single' }, { value: 'grid', label: 'grid' }, { value: 'cloud', label: 'cloud' }], settings.pattern, (v) => (settings.pattern = v)).root,
				numberField('count', { min: 1, max: MAX_BALLS, step: 10, value: settings.count }, (v) => (settings.count = Math.max(1, Math.floor(v)))).root,
			),
			el('div', { class: 'bb-row' }, checkbox('hold to emit', settings.emit, (v) => (settings.emit = v)).root, numberField('per second', { min: 1, max: 500, step: 5, value: settings.emitRate }, (v) => (settings.emitRate = v)).root),
			batchFields,
			random.root,
			el('p', { class: 'bb-hint' }, `Random: mass ${mass[0]}–${mass[1]}, bounce ${bounce[0]}–${bounce[1]}, radius ${radius[0]}–${radius[1]}, velocity ±${speed[1]} m/s.`),
		];

		// --- World, camera and simulation settings ---
		this.wallsField = checkbox('walls', true, actions.setWalls).root;
		const cameraChoices = options.touch ? [{ value: 'orbit' as const, label: 'orbit' }] : [{ value: 'fly' as const, label: 'fly' }, { value: 'orbit' as const, label: 'orbit' }];
		const view = [
			select('world', worlds.map((w) => ({ value: w.id, label: w.label })), worlds[0].id, actions.setWorld).root,
			this.wallsField,
			el(
				'div',
				{ class: 'bb-row' },
				select('camera', cameraChoices, options.cameraMode, actions.setCameraMode).root,
				numberField('fly speed (m/s)', { min: 1, max: 100, step: 1, value: 12 }, actions.setCameraSpeed).root,
			),
			el(
				'div',
				{ class: 'bb-row' },
				numberField('physics Hz', { min: 1, max: 500, step: 10, value: 300 }, (v) => actions.setTickRate(Math.max(1, Math.min(500, v)))).root,
				select('render cap', [{ value: '0', label: 'display rate' }, { value: '60', label: '60 fps' }, { value: '30', label: '30 fps' }], '0', (v) => actions.setRenderCap(Number(v))).root,
			),
			withTitle(numberField('placement distance (m)', { min: 1, max: 200, step: 1, value: settings.placeDistance }, (v) => (settings.placeDistance = Math.max(v, 1))), 'How far in front of the camera balls and fields are placed. A surface closer than this takes over.'),
			numberField('friction (μ)', { min: 0, max: 2, step: 0.05, value: 0 }, (v) => actions.setFriction(Math.max(0, v))).root,
			checkbox('colour by speed', true, actions.setColourBySpeed).root,
			el('p', { class: 'bb-hint' }, 'Keys while the scene is focused: Space start/stop, → step, R reset all, G randomize, Backspace delete selected, Z reset camera, Esc cancel.'),
		];

		const section = (tool: PanelTool, title: string, ...children: HTMLElement[]) => {
			const root = el('section', { class: 'bb-section' }, el('h3', {}, title), el('div', { class: 'bb-body' }, ...children));
			this.sections.set(tool, root);
			this.drawer.append(root);
		};
		section('select', 'Selected ball', ...selectBody);
		section('objects', 'Add balls', ...add);
		section('forces', 'Forces and fields', ...forces);
		section('world', 'World and settings', ...view);

		// --- Toolbar along the bottom, tool strip down the left ---
		this.runButton = button('Start', actions.toggleRunning);
		const bar = el(
			'div',
			{ class: 'bb-bar' },
			this.runButton,
			button('Step', actions.step),
			button('Reset selected', actions.resetSelected),
			button('Reset all', actions.resetAll),
			button('Clear all', actions.clearAll),
			button('Randomize 5000', actions.randomize),
			this.readout,
		);
		const strip = el('div', { class: 'bb-tools' });
		for (const { tool, label } of TOOLS) {
			const b = el('button', { type: 'button', title: label, innerHTML: icons[tool] });
			b.setAttribute('aria-label', label);
			b.addEventListener('click', () => this.clickTool(tool));
			this.toolButtons.set(tool, b);
			strip.append(b);
		}
		this.render();

		root.replaceChildren(this.aimReadout, strip, this.drawer, bar);
	}

	/**
	 * Fills the ball fields from the store, or greys them out when no ball is selected. Position and velocity show
	 * where the ball is and how it is moving right now, so they follow it while the simulation runs.
	 */
	showBall(store: BallStore): void {
		const i = store.selected;
		this.ballFields.disabled = i < 0;
		if (i < 0) return;
		const values: Record<BallProp, number> = {
			x: store.px[i], y: store.py[i], z: store.pz[i],
			vx: store.vx[i], vy: store.vy[i], vz: store.vz[i],
			mass: store.mass[i], restitution: store.restitution[i], radius: store.radius[i],
		};
		for (const [prop, field] of this.props) field.set(values[prop]);
	}

	/** Updates the ball fields while they are on screen. Called on every animation frame, so they follow the ball smoothly. */
	refreshBall(store: BallStore): void {
		if (this.active === 'select' && this.open) this.showBall(store);
	}

	setRunning(running: boolean): void {
		this.runButton.textContent = running ? 'Stop' : 'Start';
		this.motionFields.disabled = running;
		this.runningNote.hidden = !running;
	}

	/** Called when the pointer leaves add or field mode by itself (Esc): back to the select tool, drawer folded away. */
	setTool(mode: Tool): void {
		if (modeOf(this.active) === mode) return;
		this.active = 'select';
		this.open = false;
		this.render();
	}

	private clickTool(tool: PanelTool): void {
		if (tool === this.active) {
			this.open = !this.open;
		} else {
			const before = modeOf(this.active);
			this.active = tool;
			this.open = true;
			if (modeOf(tool) !== before) this.onSetTool(modeOf(tool));
		}
		this.render();
	}

	private render(): void {
		this.drawer.hidden = !this.open;
		for (const [tool, section] of this.sections) section.hidden = tool !== this.active;
		for (const [tool, b] of this.toolButtons) {
			b.classList.toggle('bb-on', tool === this.active);
			b.classList.toggle('bb-open', tool === this.active && this.open);
		}
	}

	setWallsAvailable(available: boolean): void {
		this.wallsField.hidden = !available;
	}

	/** Shows the force of the current pull, or clears it when `force` is null. */
	setAim(force: number | null): void {
		this.aimReadout.textContent = force === null ? '' : `pull: ${force.toFixed(0)} N`;
	}

	setReadout(fps: number, hz: number, count: number): void {
		const fill = count / MAX_BALLS;
		this.readout.classList.toggle('bb-warn', fill >= 0.9);
		this.readout.textContent = `${fps.toFixed(0)} fps · ${hz.toFixed(0)} ticks/s · ${count.toLocaleString('en')} / ${MAX_BALLS.toLocaleString('en')}${fill >= 1 ? ' (full: recycling oldest)' : ''}`;
	}
}
