import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type CameraMode = 'fly' | 'orbit';

/**
 * Two ways to move the camera, switchable at any time:
 *  - fly:   drag to look, WASD to move, Q/E down/up, wheel forward/back. Good for getting inside the scene.
 *  - orbit: three.js OrbitControls. Drag to orbit a point, right-drag to pan, wheel to zoom. Works on touch.
 *
 * Both act on the same PerspectiveCamera, so switching keeps the view where it is.
 */
export class CameraRig {
	/** Fly speed in m/s. */
	speed = 12;

	private _mode: CameraMode;
	private suspended = false;
	private looking = false;
	private readonly keys = new Set<string>();
	private readonly orbit: OrbitControls;
	private readonly abort = new AbortController();

	constructor(private readonly camera: PerspectiveCamera, private readonly canvas: HTMLCanvasElement, mode: CameraMode) {
		this._mode = mode;
		// YXZ order = yaw first, then pitch, which is what a first-person view needs (no roll creeps in).
		camera.rotation.order = 'YXZ';

		this.orbit = new OrbitControls(camera, canvas);
		this.orbit.enableDamping = true;
		this.applyEnabled();

		const on = { signal: this.abort.signal };
		canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e), on);
		canvas.addEventListener('pointermove', (e) => this.onPointerMove(e), on);
		canvas.addEventListener('pointerup', () => (this.looking = false), on);
		canvas.addEventListener('pointercancel', () => (this.looking = false), on);
		canvas.addEventListener('wheel', (e) => this.onWheel(e), { ...on, passive: false });
		canvas.addEventListener('contextmenu', (e) => e.preventDefault(), on);
		canvas.addEventListener('keydown', (e) => this.keys.add(e.code), on);
		canvas.addEventListener('keyup', (e) => this.keys.delete(e.code), on);
		canvas.addEventListener('blur', () => this.keys.clear(), on);
	}

	get mode(): CameraMode {
		return this._mode;
	}

	setMode(mode: CameraMode): void {
		if (mode === this._mode) return;
		this._mode = mode;
		if (mode === 'orbit') {
			// Orbit around a point in front of where the camera is looking.
			const ahead = this.camera.getWorldDirection(new Vector3()).multiplyScalar(15);
			this.orbit.target.copy(this.camera.position).add(ahead);
			this.orbit.update();
		}
		this.applyEnabled();
	}

	/** While true neither mode reacts to the pointer, so another tool (aiming) can use it. */
	setSuspended(suspended: boolean): void {
		this.suspended = suspended;
		if (suspended) this.looking = false;
		this.applyEnabled();
	}

	moveTo(position: readonly [number, number, number], target: readonly [number, number, number]): void {
		this.camera.position.set(...position);
		this.orbit.target.set(...target);
		this.camera.lookAt(...target);
		this.orbit.update();
	}

	update(dt: number): void {
		if (this._mode === 'orbit') {
			this.orbit.update();
			return;
		}
		const step = this.speed * dt * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.5 : 1);
		const key = (code: string) => (this.keys.has(code) ? 1 : 0);
		this.camera.translateX((key('KeyD') - key('KeyA')) * step);
		this.camera.translateZ((key('KeyS') - key('KeyW')) * step);
		this.camera.position.y += (key('KeyE') - key('KeyQ')) * step;
	}

	dispose(): void {
		this.abort.abort();
		this.orbit.dispose();
	}

	private applyEnabled(): void {
		this.orbit.enabled = this._mode === 'orbit' && !this.suspended;
	}

	private onPointerDown(e: PointerEvent): void {
		if (this._mode !== 'fly' || this.suspended) return;
		this.looking = true;
		this.canvas.setPointerCapture(e.pointerId);
	}

	private onPointerMove(e: PointerEvent): void {
		if (!this.looking) return;
		this.camera.rotation.y -= e.movementX * 0.0035;
		this.camera.rotation.x = MathUtils.clamp(this.camera.rotation.x - e.movementY * 0.0035, -1.55, 1.55);
	}

	private onWheel(e: WheelEvent): void {
		if (this._mode !== 'fly') return;
		e.preventDefault();
		this.camera.translateZ(e.deltaY * 0.01 * (this.speed / 12));
	}
}
