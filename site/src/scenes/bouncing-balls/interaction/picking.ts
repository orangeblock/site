import type { BallStore } from '../physics/ball-store';
import type { RadialField } from '../physics/forces';

/** Extra distance (m) around each ball that still counts as a hit, so small balls are easy to click. */
const PICK_PADDING = 0.05;

/** Distance along the ray (unit direction) to the first point it enters the sphere, or Infinity if it misses. */
export function raySphere(
	origin: readonly [number, number, number],
	direction: readonly [number, number, number],
	cx: number,
	cy: number,
	cz: number,
	radius: number,
): number {
	// Solve |origin + t·dir - centre|² = r² for t.
	const ox = origin[0] - cx;
	const oy = origin[1] - cy;
	const oz = origin[2] - cz;
	const b = ox * direction[0] + oy * direction[1] + oz * direction[2];
	const disc = b * b - (ox * ox + oy * oy + oz * oz - radius * radius);
	if (disc < 0) return Infinity;
	const t = -b - Math.sqrt(disc);
	return t > 0 ? t : Infinity;
}

export interface Pick {
	/** Ball index or field id. */
	index: number;
	/** Distance along the ray. */
	t: number;
}

/**
 * The nearest ball the ray passes through. This tests the ray against every ball's sphere directly in the
 * physics arrays, which is simple and takes well under a millisecond for 20,000 balls.
 */
export function pickBall(
	store: BallStore,
	origin: readonly [number, number, number],
	direction: readonly [number, number, number],
): Pick | null {
	let best: Pick | null = null;
	for (let i = 0; i < store.count; i++) {
		const t = raySphere(origin, direction, store.px[i], store.py[i], store.pz[i], store.radius[i] + PICK_PADDING);
		if (t < (best?.t ?? Infinity)) best = { index: i, t };
	}
	return best;
}

/** Radius (m) of the clickable handle at the centre of a field. The whole field sphere is not clickable, or it would hide the balls inside. */
const FIELD_HANDLE = 0.35;

export function pickField(
	fields: readonly RadialField[],
	origin: readonly [number, number, number],
	direction: readonly [number, number, number],
): Pick | null {
	let best: Pick | null = null;
	for (const f of fields) {
		const t = raySphere(origin, direction, f.cx, f.cy, f.cz, FIELD_HANDLE);
		if (t < (best?.t ?? Infinity)) best = { index: f.id, t };
	}
	return best;
}

/** Where a ray crosses a plane, or null if it is parallel to it or the plane is behind the ray. */
export function rayPlane(
	origin: readonly [number, number, number],
	direction: readonly [number, number, number],
	point: readonly [number, number, number],
	normal: readonly [number, number, number],
): [number, number, number] | null {
	const denom = direction[0] * normal[0] + direction[1] * normal[1] + direction[2] * normal[2];
	if (Math.abs(denom) < 1e-6) return null;
	const t = ((point[0] - origin[0]) * normal[0] + (point[1] - origin[1]) * normal[1] + (point[2] - origin[2]) * normal[2]) / denom;
	if (t < 0) return null;
	return [origin[0] + t * direction[0], origin[1] + t * direction[1], origin[2] + t * direction[2]];
}
