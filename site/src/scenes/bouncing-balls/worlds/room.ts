import type { ColliderSpec } from '../physics/colliders';
import type { World } from './types';

/** The original simulation's world: an endless floor and four 15 m walls around a 60 m square. */
const walls: ColliderSpec[] = [
	{ kind: 'box', center: [-30.5, 7.5, 0], size: [1, 15, 62], look: 'wall' },
	{ kind: 'box', center: [30.5, 7.5, 0], size: [1, 15, 62], look: 'wall' },
	{ kind: 'box', center: [0, 7.5, -30.5], size: [62, 15, 1], look: 'wall' },
	{ kind: 'box', center: [0, 7.5, 30.5], size: [62, 15, 1], look: 'wall' },
];

export const room: World = {
	id: 'room',
	label: 'Room',
	colliders: [{ kind: 'plane', point: [0, 0, 0], normal: [0, 1, 0], look: 'ground' }],
	walls,
	spawn: [0, 10, 0],
	fill: { center: [0, 16, 0], size: [10, 12, 10], velocity: { min: [-10, -10, -10], max: [10, 0, 10] } },
	camera: { position: [0, 9, 24], target: [0, 7, 0] },
};
