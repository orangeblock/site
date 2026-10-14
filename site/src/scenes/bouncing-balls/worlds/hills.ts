import type { World } from './types';

const SIZE = 64;
const SAMPLES = 129;

/** Rolling hills inside a raised rim, so balls stay in the bowl. */
function height(x: number, z: number): number {
	const hills = 2.2 * Math.sin(0.18 * x) * Math.cos(0.15 * z) + 1.3 * Math.sin(0.07 * x + 0.11 * z + 1) + Math.cos(0.12 * (x - z));
	const rim = 0.12 * (Math.max(0, Math.abs(x) - 20) ** 2 + Math.max(0, Math.abs(z) - 20) ** 2);
	return hills + rim;
}

const heights = new Float32Array(SAMPLES * SAMPLES);
for (let j = 0; j < SAMPLES; j++) {
	for (let i = 0; i < SAMPLES; i++) {
		heights[j * SAMPLES + i] = height(-SIZE / 2 + (i * SIZE) / (SAMPLES - 1), -SIZE / 2 + (j * SIZE) / (SAMPLES - 1));
	}
}

export const hills: World = {
	id: 'hills',
	label: 'Hills',
	colliders: [
		{ kind: 'heightfield', origin: [-SIZE / 2, -SIZE / 2], size: [SIZE, SIZE], cols: SAMPLES, rows: SAMPLES, heights, look: 'ground' },
		// Catches balls that leave the bowl.
		{ kind: 'plane', point: [0, -40, 0], normal: [0, 1, 0], look: 'hidden' },
	],
	spawn: [0, 10, 0],
	fill: { center: [0, 16, 0], size: [20, 12, 20], velocity: { min: [-10, -10, -10], max: [10, 0, 10] } },
	camera: { position: [0, 20, 40], target: [0, 2, 0] },
};
