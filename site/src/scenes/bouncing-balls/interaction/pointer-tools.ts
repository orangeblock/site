import { Vector3 } from 'three';
import type { Engine } from '../physics/engine';
import type { AimGuide } from '../render/aim-guide';
import type { CameraRig } from '../render/camera-rig';
import type { SurfaceHit, View } from '../render/view';
import type { Settings } from '../settings';
import { pickField, rayPlane } from './picking';

export type Tool = 'select' | 'add' | 'field';

/** Pull distance (m) that gives full power. */
const MAX_PULL = 4;
/** Pulls shorter than this (m) only select the ball. */
const DEAD_ZONE = 0.3;
/** A press that moves less than this many pixels counts as a click. */
const CLICK_PIXELS = 5;

export interface ToolContext {
	canvas: HTMLCanvasElement;
	view: View;
	sim: Engine;
	rig: CameraRig;
	guide: AimGuide;
	settings: Settings;
	select(ball: number): void;
	selectField(id: number): void;
	placeBalls(surface: SurfaceHit): void;
	emitBall(surface: SurfaceHit): void;
	placeField(point: [number, number, number]): void;
	/** Called when the tool changes by itself, so the panel can update its buttons. */
	toolChanged(tool: Tool): void;
	/** Called while aiming with the force in newtons, and with null when the aim ends. */
	aimChanged(force: number | null): void;
}

/**
 * Turns pointer input on the canvas into actions. What a press does depends on the active tool:
 *
 *  - select: pressing a ball selects it and starts a pull-back aim, like a pool cue or a slingshot. Drag away
 *    from the ball, release, and it is pushed the opposite way with a force that grows with the pull length.
 *    Pressing empty space moves the camera as usual.
 *  - add:    a click adds balls where the pointer touches the world (hold to keep emitting, if enabled).
 *  - field:  a click places a force field there. Fields can be selected by clicking their centre dot in
 *            select mode.
 *
 * Add and field stay on until switched off (Esc, or the mode buttons).
 *
 * The listeners are registered in the capture phase so they run before the camera's, which lets an aim
 * take over the pointer.
 */
export class PointerTools {
	private _tool: Tool = 'select';
	private readonly abort = new AbortController();

	private aim: { ball: number; fraction: number; direction: [number, number, number] } | null = null;
	private pressed = false;
	private emitting = false;
	private emitCredit = 0;
	private downX = 0;
	private downY = 0;
	private pointerX = 0;
	private pointerY = 0;
	private shift = false;

	constructor(private readonly ctx: ToolContext) {
		const { canvas } = ctx;
		const on = { signal: this.abort.signal, capture: true };
		canvas.addEventListener('pointerdown', (e) => this.onDown(e), on);
		canvas.addEventListener('pointermove', (e) => this.onMove(e), on);
		canvas.addEventListener('pointerup', (e) => this.onUp(e), on);
		canvas.addEventListener('pointercancel', () => this.cancel(), on);
		canvas.addEventListener('keydown', (e) => e.code === 'Escape' && this.escape(), on);
	}

	get tool(): Tool {
		return this._tool;
	}

	setTool(tool: Tool): void {
		this.cancel();
		this._tool = tool;
		this.ctx.canvas.style.cursor = tool === 'select' ? '' : 'crosshair';
	}

	/** Escape cancels an aim in progress, or otherwise leaves add / field mode. */
	private escape(): void {
		if (this.aim || this.emitting) return this.cancel();
		if (this._tool === 'select') return;
		this.setTool('select');
		this.ctx.toolChanged('select');
	}

	/** Abandons an aim in progress and stops emitting. */
	cancel(): void {
		this.endAim();
		this.pressed = false;
		this.emitting = false;
	}

	/** Called every frame: keeps the aim guide on a moving ball and emits balls while the pointer is held. */
	update(dt: number): void {
		if (this.aim) this.refreshAim();
		if (!this.emitting) return;

		const surface = this.ctx.view.pickPlacement(this.pointerX, this.pointerY, this.ctx.settings.placeDistance);
		this.emitCredit += dt * this.ctx.settings.emitRate;
		while (this.emitCredit >= 1) {
			this.ctx.emitBall(surface);
			this.emitCredit -= 1;
		}
	}

	dispose(): void {
		this.abort.abort();
	}

	private onDown(e: PointerEvent): void {
		const { ctx } = this;
		ctx.canvas.focus({ preventScroll: true });
		this.downX = this.pointerX = e.clientX;
		this.downY = this.pointerY = e.clientY;
		this.shift = e.shiftKey;

		if (e.button === 2) {
			this.cancel();
			return;
		}
		if (e.button !== 0) return;
		this.pressed = true;

		if (this._tool === 'select') {
			this.pickAndAim(e);
		} else if (this._tool === 'add' && ctx.settings.emit) {
			this.emitting = true;
			this.emitCredit = 1;
		}
	}

	/**
	 * Selects the ball or field under the pointer and starts aiming a ball. The GPU engine has to read the
	 * positions back first, so the pick may arrive a frame or two after the press.
	 */
	private async pickAndAim(e: PointerEvent): Promise<void> {
		const { ctx } = this;
		const ray = ctx.view.rayFromPointer(e.clientX, e.clientY);
		const origin = ray.origin.toArray();
		const direction = ray.direction.toArray();
		const field = pickField(ctx.sim.forces.fields, origin, direction);
		const ball = await ctx.sim.pickBall(origin, direction);
		if (field && (!ball || field.t < ball.t)) {
			ctx.selectField(field.index);
			return;
		}
		if (!ball) return;
		ctx.select(ball.index);
		// A click released before the pick arrived only selects.
		if (!this.pressed || this.aim) return;
		this.aim = { ball: ball.index, fraction: 0, direction: [0, 1, 0] };
		ctx.rig.setSuspended(true);
		ctx.canvas.setPointerCapture(e.pointerId);
	}

	private onMove(e: PointerEvent): void {
		this.pointerX = e.clientX;
		this.pointerY = e.clientY;
		this.shift = e.shiftKey;
		if (this.aim) this.refreshAim();
	}

	private onUp(e: PointerEvent): void {
		const { ctx } = this;
		const wasClick = this.pressed && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) < CLICK_PIXELS;
		const aim = this.aim;
		const emitting = this.emitting;
		this.pressed = false;
		this.emitting = false;

		if (aim) {
			if (aim.fraction > 0 && aim.ball < ctx.sim.store.count) {
				ctx.sim.forces.pushDirected(aim.ball, aim.direction, ctx.settings.power * aim.fraction, ctx.settings.duration);
			}
			this.endAim();
			return;
		}
		if (!wasClick || emitting) return;

		const surface = ctx.view.pickPlacement(e.clientX, e.clientY, ctx.settings.placeDistance);
		if (this._tool === 'add') {
			ctx.placeBalls(surface);
		} else if (this._tool === 'field') {
			ctx.placeField(surface.point);
		}
	}

	/**
	 * Works out the pull from where the pointer ray crosses a plane through the ball: a horizontal plane
	 * normally, or one facing the camera while Shift is held (which allows pulling up and down).
	 */
	private refreshAim(): void {
		const { ctx } = this;
		const aim = this.aim!;
		const { store } = ctx.sim;
		if (aim.ball >= store.count) return this.endAim();

		const ball: [number, number, number] = [store.px[aim.ball], store.py[aim.ball], store.pz[aim.ball]];
		const ray = ctx.view.rayFromPointer(this.pointerX, this.pointerY);
		const normal: [number, number, number] = this.shift
			? ctx.view.camera.getWorldDirection(new Vector3()).negate().toArray()
			: [0, 1, 0];
		const hit = rayPlane(ray.origin.toArray(), ray.direction.toArray(), ball, normal);
		if (!hit) return;

		const pull = new Vector3(hit[0] - ball[0], hit[1] - ball[1], hit[2] - ball[2]);
		const length = pull.length();
		if (length < DEAD_ZONE) {
			aim.fraction = 0;
			ctx.guide.hide();
			ctx.aimChanged(0);
			return;
		}
		aim.fraction = Math.min(length / MAX_PULL, 1);
		// The ball goes the opposite way to the pull.
		const direction = pull.clone().divideScalar(-length);
		aim.direction = direction.toArray();
		const origin = new Vector3(...ball);
		ctx.guide.show(origin, origin.clone().addScaledVector(pull, Math.min(1, MAX_PULL / length)), direction, aim.fraction);
		ctx.aimChanged(ctx.settings.power * aim.fraction);
	}

	private endAim(): void {
		if (!this.aim) return;
		this.aim = null;
		this.ctx.guide.hide();
		this.ctx.rig.setSuspended(false);
		this.ctx.aimChanged(null);
	}
}
