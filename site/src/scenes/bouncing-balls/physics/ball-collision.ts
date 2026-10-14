import type { BallStore } from './ball-store';
import { PENETRATION_CORRECTION, PENETRATION_SLOP, REST_SPEED } from './constants';

/**
 * Resolves a collision between balls `i` and `j` if they are still overlapping.
 *
 * The collision is one-dimensional along the line between the centres. With masses m1, m2, approach speed
 * vn and coefficient of restitution e, the impulse that changes both velocities is
 *
 *   J = (1 + e) · vn / (1/m1 + 1/m2)
 *
 * which conserves momentum and gives a separation speed of e·vn. Each ball's restitution is combined as the
 * product r1·r2, so a dead ball (0) makes the pair inelastic.
 *
 * Friction acts on the sliding part of the relative velocity (the part along the surfaces, perpendicular to
 * the normal). Coulomb's law caps its impulse at μ times the normal impulse, and it can at most stop the
 * sliding, never reverse it.
 */
export function resolveBallPair(s: BallStore, i: number, j: number, friction = 0): void {
	const dx = s.px[i] - s.px[j];
	const dy = s.py[i] - s.py[j];
	const dz = s.pz[i] - s.pz[j];
	const reach = s.radius[i] + s.radius[j];
	const distSq = dx * dx + dy * dy + dz * dz;
	if (distSq > reach * reach) return;

	// Unit normal from j to i. Exactly coincident balls get pushed apart vertically.
	const dist = Math.sqrt(distSq);
	const nx = dist > 0 ? dx / dist : 0;
	const ny = dist > 0 ? dy / dist : 1;
	const nz = dist > 0 ? dz / dist : 0;

	const invMi = 1 / s.mass[i];
	const invMj = 1 / s.mass[j];
	const invMassSum = invMi + invMj;

	// Relative velocity of i with respect to j along the normal. Negative means the balls are approaching.
	const vn = (s.vx[i] - s.vx[j]) * nx + (s.vy[i] - s.vy[j]) * ny + (s.vz[i] - s.vz[j]) * nz;
	if (vn < 0) {
		const e = -vn < REST_SPEED ? 0 : s.restitution[i] * s.restitution[j];
		const impulse = (-(1 + e) * vn) / invMassSum;
		s.vx[i] += impulse * invMi * nx;
		s.vy[i] += impulse * invMi * ny;
		s.vz[i] += impulse * invMi * nz;
		s.vx[j] -= impulse * invMj * nx;
		s.vy[j] -= impulse * invMj * ny;
		s.vz[j] -= impulse * invMj * nz;

		if (friction > 0) {
			// Sliding velocity of i relative to j: the relative velocity with its normal part removed.
			const rx = s.vx[i] - s.vx[j];
			const ry = s.vy[i] - s.vy[j];
			const rz = s.vz[i] - s.vz[j];
			const rn = rx * nx + ry * ny + rz * nz;
			const tx = rx - rn * nx;
			const ty = ry - rn * ny;
			const tz = rz - rn * nz;
			const slide = Math.hypot(tx, ty, tz);
			if (slide > 1e-9) {
				const frictionImpulse = Math.min(friction * impulse, slide / invMassSum);
				const k = frictionImpulse / slide;
				s.vx[i] -= k * invMi * tx;
				s.vy[i] -= k * invMi * ty;
				s.vz[i] -= k * invMi * tz;
				s.vx[j] += k * invMj * tx;
				s.vy[j] += k * invMj * ty;
				s.vz[j] += k * invMj * tz;
			}
		}
	}

	// Push the balls apart, the lighter one further, so they do not stay merged.
	const penetration = reach - dist;
	const correction = (Math.max(penetration - PENETRATION_SLOP, 0) * PENETRATION_CORRECTION) / invMassSum;
	s.px[i] += correction * invMi * nx;
	s.py[i] += correction * invMi * ny;
	s.pz[i] += correction * invMi * nz;
	s.px[j] -= correction * invMj * nx;
	s.py[j] -= correction * invMj * ny;
	s.pz[j] -= correction * invMj * nz;
}
