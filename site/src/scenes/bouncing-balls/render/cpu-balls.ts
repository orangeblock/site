import { Color, InstancedBufferAttribute, InstancedMesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { BallStore } from '../physics/ball-store';
import { FAST_SPEED, palette } from './palette';
import type { BallMesh } from './view';

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

/**
 * The CPU engine's balls: one InstancedMesh that draws the same sphere many times in a single draw call.
 * Each copy gets its own transform and colour from two big buffers, filled from the store every frame.
 */
export class CpuBalls implements BallMesh {
	readonly object: InstancedMesh;
	colourBySpeed = true;

	constructor(capacity: number) {
		// One unit-radius sphere; each ball scales it to its own radius through its instance matrix.
		this.object = new InstancedMesh(new SphereGeometry(1, 12, 8), new MeshStandardMaterial({ roughness: 0.5 }), capacity);
		this.object.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
		// The mesh's bounding sphere is computed once and would not follow the balls, so never cull it.
		this.object.frustumCulled = false;
		this.object.count = 0;
	}

	/** Copies the simulation's positions, radii and colours into the instance buffers. */
	sync(store: BallStore): void {
		const mesh = this.object;
		const n = store.count;
		const matrices = mesh.instanceMatrix.array as Float32Array;
		const colours = mesh.instanceColor!.array as Float32Array;
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

		mesh.count = n;
		// Only upload the part of each buffer that is in use.
		for (const [attribute, size] of [[mesh.instanceMatrix, 16], [mesh.instanceColor!, 3]] as const) {
			attribute.clearUpdateRanges();
			attribute.addUpdateRange(0, n * size);
			attribute.needsUpdate = true;
		}
	}
}
