import {
	Color,
	DirectionalLight,
	Fog,
	Group,
	HemisphereLight,
	InstancedBufferAttribute,
	InstancedMesh,
	MeshStandardMaterial,
	PerspectiveCamera,
	Raycaster,
	Scene,
	SphereGeometry,
	Vector2,
	Vector3,
	WebGLRenderer,
} from 'three';
import type { BallStore } from '../physics/ball-store';
import { MAX_BALLS } from '../physics/constants';
import type { World } from '../worlds';
import { buildColliderMeshes } from './collider-meshes';
import { FAST_SPEED, palette } from './palette';

const baseColour = new Color(palette.ball);
const selectedColour = new Color(palette.selected);

function writeColour(out: Float32Array, offset: number, colour: Color): void {
	out[offset] = colour.r;
	out[offset + 1] = colour.g;
	out[offset + 2] = colour.b;
}

/** Blends slow → medium → fast by speed, so fast balls stand out and the spread of a force is visible. */
function writeSpeedColour(out: Float32Array, offset: number, speed: number): void {
	const t = Math.min(speed / FAST_SPEED, 1);
	const from = t < 0.5 ? palette.slow : palette.medium;
	const to = t < 0.5 ? palette.medium : palette.fast;
	const u = t < 0.5 ? t * 2 : t * 2 - 1;
	out[offset] = from.r + (to.r - from.r) * u;
	out[offset + 1] = from.g + (to.g - from.g) * u;
	out[offset + 2] = from.b + (to.b - from.b) * u;
}

export interface SurfaceHit {
	point: [number, number, number];
	normal: [number, number, number];
}

/**
 * Everything three.js: the renderer, the scene graph, and one InstancedMesh that draws every ball.
 *
 * An InstancedMesh draws the same geometry many times in a single draw call. Each copy gets its own
 * transform and colour from two big buffers, which is what makes thousands of balls cheap to render.
 */
export class View {
	readonly renderer: WebGLRenderer;
	readonly scene = new Scene();
	readonly camera = new PerspectiveCamera(45, 1, 0.1, 400);
	colourBySpeed = true;

	private readonly balls: InstancedMesh;
	private world = new Group();
	private walls = new Group();
	private readonly raycaster = new Raycaster();

	constructor(readonly canvas: HTMLCanvasElement) {
		this.renderer = new WebGLRenderer({ canvas, antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

		this.scene.background = new Color(palette.background);
		this.scene.fog = new Fog(palette.background, 60, 200);
		this.scene.add(new HemisphereLight(0xcfd8ff, 0x3a3d46, 1.6));
		const sun = new DirectionalLight(0xffffff, 2.2);
		sun.position.set(20, 40, 15);
		this.scene.add(sun);

		// One unit-radius sphere; each ball scales it to its own radius through its instance matrix.
		this.balls = new InstancedMesh(new SphereGeometry(1, 12, 8), new MeshStandardMaterial({ roughness: 0.5 }), MAX_BALLS);
		this.balls.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_BALLS * 3), 3);
		// The mesh's bounding sphere is computed once and would not follow the balls, so never cull it.
		this.balls.frustumCulled = false;
		this.balls.count = 0;
		this.scene.add(this.balls);

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

	/** Copies the simulation's positions, radii and colours into the instance buffers. */
	sync(store: BallStore): void {
		const n = store.count;
		const matrices = this.balls.instanceMatrix.array as Float32Array;
		const colours = this.balls.instanceColor!.array as Float32Array;
		const { px, py, pz, vx, vy, vz, radius } = store;

		for (let i = 0; i < n; i++) {
			// A 4×4 column-major matrix: scale on the diagonal, translation in the last column. The
			// off-diagonal entries stay zero, so only these seven numbers need writing.
			const m = i * 16;
			matrices[m] = matrices[m + 5] = matrices[m + 10] = radius[i];
			matrices[m + 12] = px[i];
			matrices[m + 13] = py[i];
			matrices[m + 14] = pz[i];
			matrices[m + 15] = 1;

			if (i === store.selected) writeColour(colours, i * 3, selectedColour);
			else if (this.colourBySpeed) writeSpeedColour(colours, i * 3, Math.hypot(vx[i], vy[i], vz[i]));
			else writeColour(colours, i * 3, baseColour);
		}

		this.balls.count = n;
		// Only upload the part of each buffer that is in use.
		for (const [attribute, size] of [[this.balls.instanceMatrix, 16], [this.balls.instanceColor!, 3]] as const) {
			attribute.clearUpdateRanges();
			attribute.addUpdateRange(0, n * size);
			attribute.needsUpdate = true;
		}
	}

	render(): void {
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
