import { Color, DirectionalLight, Fog, Group, HemisphereLight, type Object3D, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3 } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { BallStore } from '../physics/ball-store';
import type { World } from '../worlds';
import { buildColliderMeshes } from './collider-meshes';
import { palette } from './palette';

/** Draws every ball. Each engine has its own (`CpuBalls`, `GpuBalls`). */
export interface BallMesh {
	readonly object: Object3D;
	colourBySpeed: boolean;
	/** Called before every render. */
	sync(store: BallStore): void;
}

export interface SurfaceHit {
	point: [number, number, number];
	normal: [number, number, number];
}

/**
 * Everything three.js: the renderer, the scene graph and the camera. The balls are drawn by a `BallMesh`.
 *
 * `WebGPURenderer` uses WebGPU where the browser has it and falls back to WebGL 2 otherwise. The GPU engine
 * needs the WebGPU backend; the CPU engine runs on either.
 */
export class View {
	readonly renderer: WebGPURenderer;
	readonly scene = new Scene();
	readonly camera = new PerspectiveCamera(45, 1, 0.1, 400);
	private balls: BallMesh | null = null;

	private world = new Group();
	private walls = new Group();
	private readonly raycaster = new Raycaster();

	constructor(readonly canvas: HTMLCanvasElement) {
		this.renderer = new WebGPURenderer({ canvas, antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

		this.scene.background = new Color(palette.background);
		this.scene.fog = new Fog(palette.background, 60, 200);
		this.scene.add(new HemisphereLight(0xcfd8ff, 0x3a3d46, 1.6));
		const sun = new DirectionalLight(0xffffff, 2.2);
		sun.position.set(20, 40, 15);
		this.scene.add(sun);

		new ResizeObserver(() => this.resize()).observe(canvas);
	}

	resize(): void {
		const { clientWidth, clientHeight } = this.canvas;
		if (clientWidth === 0 || clientHeight === 0) return;
		this.renderer.setSize(clientWidth, clientHeight, false);
		this.camera.aspect = clientWidth / clientHeight;
		this.camera.updateProjectionMatrix();
	}

	/** Replaces the static geometry with the given world's. */
	loadWorld(world: World, wallsEnabled: boolean): void {
		this.scene.remove(this.world, this.walls);
		this.world = buildColliderMeshes(world.colliders);
		this.walls = buildColliderMeshes(world.walls ?? []);
		this.walls.visible = wallsEnabled;
		this.scene.add(this.world, this.walls);
	}

	setWallsVisible(visible: boolean): void {
		this.walls.visible = visible;
	}

	setBalls(balls: BallMesh): void {
		if (this.balls) this.scene.remove(this.balls.object);
		this.balls = balls;
		this.scene.add(balls.object);
	}

	/** Draws a frame. The balls are taken from `store` (the GPU engine's mesh ignores it). */
	render(store: BallStore): void {
		this.balls?.sync(store);
		this.renderer.render(this.scene, this.camera);
	}

	/** Converts a pointer position into a ray from the camera through that pixel. */
	rayFromPointer(clientX: number, clientY: number): { origin: Vector3; direction: Vector3 } {
		const rect = this.canvas.getBoundingClientRect();
		const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
		this.raycaster.setFromCamera(ndc, this.camera);
		return { origin: this.raycaster.ray.origin.clone(), direction: this.raycaster.ray.direction.clone() };
	}

	/** Finds the first piece of static geometry under the pointer, ignoring glass. */
	pickSurface(clientX: number, clientY: number): SurfaceHit | null {
		this.rayFromPointer(clientX, clientY);
		const candidates = [this.world, this.walls.visible ? this.walls : null].filter((g): g is Group => g !== null);
		for (const hit of this.raycaster.intersectObjects(candidates, true)) {
			if (hit.object.userData.noPick || !hit.face) continue;
			const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
			return { point: hit.point.toArray(), normal: normal.toArray() };
		}
		return null;
	}

	/**
	 * Where to place something for the pointer: `distance` metres from the camera along the pointer ray, or the
	 * surface under the pointer if that is nearer. In open air the normal points up.
	 */
	pickPlacement(clientX: number, clientY: number, distance: number): SurfaceHit {
		const { origin, direction } = this.rayFromPointer(clientX, clientY);
		const surface = this.pickSurface(clientX, clientY);
		if (surface && origin.distanceTo(new Vector3(...surface.point)) <= distance) return surface;
		return { point: origin.addScaledVector(direction, distance).toArray(), normal: [0, 1, 0] };
	}

	dispose(): void {
		this.renderer.dispose();
	}
}
