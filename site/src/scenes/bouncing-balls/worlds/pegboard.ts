import type { ColliderSpec } from '../physics/colliders';
import type { World } from './types';

/**
 * A vertical pegboard like a Plinko board: pegs between a back plate and a glass front, bins at the bottom.
 * The slab between the plates is 1 m deep, so balls fall in a thin 3D layer.
 */
const colliders: ColliderSpec[] = [
	{ kind: 'plane', point: [0, 0, 0], normal: [0, 1, 0], look: 'ground' },
	{ kind: 'box', center: [0, 13, -0.6], size: [21, 26, 0.2], look: 'wall' },
	{ kind: 'box', center: [0, 13, 0.6], size: [21, 26, 0.2], look: 'glass' },
	{ kind: 'box', center: [-10.6, 13, 0], size: [0.2, 26, 1.4], look: 'wall' },
	{ kind: 'box', center: [10.6, 13, 0], size: [0.2, 26, 1.4], look: 'wall' },
];

// Staggered rows of pegs. A cylinder's axis is its local Y, so rotating by 90° about X points it along Z.
for (let row = 0; row < 14; row++) {
	const y = 22 - row * 1.2;
	const offset = row % 2 === 0 ? 0 : 0.7;
	for (let x = -9.1 + offset; x <= 9.1; x += 1.4) {
		colliders.push({ kind: 'cylinder', center: [x, y, 0], radius: 0.25, height: 1, rotation: [Math.PI / 2, 0, 0], look: 'obstacle' });
	}
}

// Bin dividers along the bottom.
for (let x = -9; x <= 9; x += 1.8) {
	colliders.push({ kind: 'box', center: [x, 2, 0], size: [0.2, 4, 1], look: 'obstacle' });
}

export const pegboard: World = {
	id: 'pegboard',
	label: 'Pegboard',
	colliders,
	spawn: [0, 25, 0],
	fill: { center: [0, 14, 0], size: [18, 22, 0.7], velocity: { min: [-2, -5, 0], max: [2, 0, 0] } },
	camera: { position: [0, 13, 34], target: [0, 13, 0] },
};
