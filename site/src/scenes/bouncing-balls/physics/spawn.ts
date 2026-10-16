import type { BallSpec } from './ball-store';
import type { Vec3 } from './colliders';

export type Pattern = 'single' | 'grid' | 'cloud';

/** Everything about a new ball except where it goes. */
export interface BallTemplate {
	radius: number;
	mass: number;
	restitution: number;
	vx: number;
	vy: number;
	vz: number;
}

export const DEFAULT_TEMPLATE: BallTemplate = { radius: 0.2, mass: 0.5, restitution: 0.8, vx: 0, vy: 0, vz: 0 };

type Rng = () => number;

/**
 * Ranges for randomised balls. The radius range is capped well below the UI's maximum so a random batch
 * cannot produce huge balls, and it is also what the spawn lattice is spaced for.
 */
export const RANDOM_RANGES = {
	mass: [0.4, 1.0],
	restitution: [0.55, 0.95],
	radius: [0.15, 0.4],
	velocity: [-5, 5],
} as const;

/** Random mass, restitution, radius and velocity, each uniform within `RANDOM_RANGES`. */
export function randomTemplate(rng: Rng = Math.random): BallTemplate {
	const between = ([min, max]: readonly [number, number]) => min + rng() * (max - min);
	return {
		mass: between(RANDOM_RANGES.mass),
		restitution: between(RANDOM_RANGES.restitution),
		radius: between(RANDOM_RANGES.radius),
		vx: between(RANDOM_RANGES.velocity),
		vy: between(RANDOM_RANGES.velocity),
		vz: between(RANDOM_RANGES.velocity),
	};
}

/**
 * Positions for `count` balls, centred on the origin. Balls start slightly apart so they are not overlapping.
 *  - single: one ball.
 *  - grid:   a cubic block on a regular lattice.
 *  - cloud:  the lattice points nearest the centre (a rough sphere), each nudged randomly.
 */
export function patternOffsets(pattern: Pattern, count: number, radius: number, rng: Rng = Math.random): Vec3[] {
	if (pattern === 'single' || count <= 1) return [[0, 0, 0]];

	if (pattern === 'grid') {
		const spacing = 2 * radius * 1.15;
		const side = Math.ceil(Math.cbrt(count));
		const layers = Math.ceil(count / (side * side));
		const offsets: Vec3[] = [];
		for (let n = 0; n < count; n++) {
			const i = n % side;
			const k = Math.floor(n / side) % side;
			const j = Math.floor(n / (side * side));
			offsets.push([(i - (side - 1) / 2) * spacing, (j - (layers - 1) / 2) * spacing, (k - (side - 1) / 2) * spacing]);
		}
		return offsets;
	}

	const spacing = 2 * radius * 1.5;
	const jitter = spacing * 0.12;
	// A sphere fills about half of its bounding cube, so generate roughly twice as many lattice points as needed.
	const side = Math.ceil(Math.cbrt(count * 1.91)) + 2;
	const points: Vec3[] = [];
	for (let i = 0; i < side; i++)
		for (let j = 0; j < side; j++)
			for (let k = 0; k < side; k++)
				points.push([(i - (side - 1) / 2) * spacing, (j - (side - 1) / 2) * spacing, (k - (side - 1) / 2) * spacing]);
	points.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
	return points.slice(0, count).map(([x, y, z]) => [x + (rng() - 0.5) * 2 * jitter, y + (rng() - 0.5) * 2 * jitter, z + (rng() - 0.5) * 2 * jitter]);
}

/**
 * Balls for `pattern` dropped just above a surface point. `normal` is the surface normal there, and the
 * block is moved out along it by its own extent so it does not start inside the surface.
 *
 * With `randomise`, every ball gets its own random properties (`template` is ignored) and the lattice is spaced
 * for the largest radius a random ball can have, so the balls still start apart.
 */
export function spawnPattern(
	pattern: Pattern,
	count: number,
	point: Vec3,
	normal: Vec3,
	template: BallTemplate,
	rng: Rng = Math.random,
	randomise = false,
): BallSpec[] {
	const spacingRadius = randomise ? RANDOM_RANGES.radius[1] : template.radius;
	const offsets = patternOffsets(pattern, count, spacingRadius, rng);
	let extent = 0;
	for (const o of offsets) extent = Math.max(extent, Math.hypot(...o));
	const lift = extent + 1.5 * spacingRadius;
	return offsets.map(([x, y, z]) => ({
		x: point[0] + normal[0] * lift + x,
		y: point[1] + normal[1] * lift + y,
		z: point[2] + normal[2] * lift + z,
		...(randomise ? randomTemplate(rng) : template),
	}));
}

/** The box Randomize fills with balls, and the range of velocities they start with. */
export interface FillRegion {
	center: Vec3;
	size: Vec3;
	velocity: { min: Vec3; max: Vec3 };
}

/**
 * Up to `count` balls on a lattice that fills a box, each with random mass, restitution and velocity (like the
 * original's `G` shortcut). The lattice is as tight as the balls allow, so a box too small for `count` balls
 * gets fewer.
 */
export function randomFill(count: number, region: FillRegion, rng: Rng = Math.random): BallSpec[] {
	const radius = 0.2;
	const { center, size, velocity } = region;
	const minPitch = 2 * radius * 1.1;
	const cells = (pitch: number): Vec3 => [
		Math.max(1, Math.floor(size[0] / pitch)),
		Math.max(1, Math.floor(size[1] / pitch)),
		Math.max(1, Math.floor(size[2] / pitch)),
	];
	// Start from the pitch that would just fit `count` balls and tighten it until enough cells exist (or the balls would touch).
	let pitch = Math.max(Math.cbrt((size[0] * size[1] * size[2]) / count), minPitch);
	let [nx, ny, nz] = cells(pitch);
	while (nx * ny * nz < count && pitch > minPitch) {
		pitch = Math.max(pitch * 0.98, minPitch);
		[nx, ny, nz] = cells(pitch);
	}
	const between = (min: number, max: number) => min + rng() * (max - min);

	const balls: BallSpec[] = [];
	for (let n = 0; n < Math.min(count, nx * ny * nz); n++) {
		const i = n % nx;
		const k = Math.floor(n / nx) % nz;
		const j = Math.floor(n / (nx * nz));
		balls.push({
			x: center[0] - size[0] / 2 + ((i + 0.5) * size[0]) / nx,
			y: center[1] - size[1] / 2 + ((j + 0.5) * size[1]) / ny,
			z: center[2] - size[2] / 2 + ((k + 0.5) * size[2]) / nz,
			vx: between(velocity.min[0], velocity.max[0]),
			vy: between(velocity.min[1], velocity.max[1]),
			vz: between(velocity.min[2], velocity.max[2]),
			radius,
			mass: between(0.4, 1),
			restitution: between(0.55, 0.95),
		});
	}
	return balls;
}
