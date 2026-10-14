import type { BallStore } from './ball-store';
import { FORCE_LIFETIME } from './constants';

/** A push on one ball: force `power` (N) along a unit direction, decaying as e^(-t/tau). */
interface DirectedForce {
	ball: number;
	dx: number;
	dy: number;
	dz: number;
	power: number;
	tau: number;
	age: number;
}

/**
 * A radial force field around a point, drawn in the scene as a sphere. Balls within `radius` feel `power`
 * scaled linearly from 1 at the centre to 0 at the edge, pushing outward for positive power and pulling
 * inward for negative power.
 *
 *  - `pulseRate` > 0: pulses at that many per second. Each pulse is a force that decays as e^(-t/tau).
 *  - `pulseRate` = 0: one constant force.
 *
 * The field lasts `lifetime` seconds, or until it is removed if `lifetime` is 0.
 */
export interface RadialField {
	id: number;
	cx: number;
	cy: number;
	cz: number;
	radius: number;
	power: number;
	tau: number;
	lifetime: number;
	pulseRate: number;
	age: number;
}

/**
 * Velocity change from a force F(t) = P·e^(-t/τ) acting on mass m during the interval [age, age + dt]:
 *
 *   Δv = (1/m) ∫ F dt = (P·τ/m) · (e^(-age/τ) - e^(-(age+dt)/τ))
 *
 * Integrating exactly means the total Δv over the force's lifetime is P·τ/m whatever the tick rate is.
 */
function impulseFraction(age: number, dt: number, tau: number): number {
	return tau * (Math.exp(-age / tau) - Math.exp(-(age + dt) / tau));
}

/** The impulse (N·s) a field gives a ball at its centre during [age, age + dt]. Falloff with distance is applied separately. */
function fieldImpulse(f: RadialField, dt: number): number {
	const from = f.age;
	const to = from + dt;
	const end = f.lifetime > 0 ? f.lifetime : Infinity;

	if (f.pulseRate <= 0) return f.power * Math.max(0, Math.min(to, end) - from);

	// Pulse k starts at k / pulseRate. Add up what every pulse still active during this step delivers.
	const period = 1 / f.pulseRate;
	let total = 0;
	for (let k = Math.max(0, Math.floor((from - FORCE_LIFETIME * f.tau) / period)); ; k++) {
		const start = k * period;
		if (start >= to || start >= end) break;
		total += impulseFraction(Math.max(from, start) - start, to - Math.max(from, start), f.tau);
	}
	return f.power * total;
}

export class ForceSet {
	private directed: DirectedForce[] = [];
	private _fields: RadialField[] = [];
	private nextFieldId = 1;

	/** The fields currently in the world, for drawing. */
	get fields(): readonly RadialField[] {
		return this._fields;
	}

	get isEmpty(): boolean {
		return this.directed.length === 0 && this._fields.length === 0;
	}

	/** `direction` need not be normalised. A zero vector is ignored. */
	pushDirected(ball: number, direction: readonly [number, number, number], power: number, tau: number): void {
		const [x, y, z] = direction;
		const len = Math.hypot(x, y, z);
		if (len === 0 || tau <= 0) return;
		this.directed.push({ ball, dx: x / len, dy: y / len, dz: z / len, power, tau, age: 0 });
	}

	/** Adds a field and returns its id. See `RadialField` for what the options mean. */
	addField(
		center: readonly [number, number, number],
		radius: number,
		power: number,
		tau: number,
		lifetime: number,
		pulseRate: number,
	): number {
		const id = this.nextFieldId++;
		this._fields.push({ id, cx: center[0], cy: center[1], cz: center[2], radius: Math.max(radius, 1e-3), power, tau: Math.max(tau, 1e-4), lifetime: Math.max(lifetime, 0), pulseRate: Math.max(pulseRate, 0), age: 0 });
		return id;
	}

	removeField(id: number): void {
		this._fields = this._fields.filter((f) => f.id !== id);
	}

	clearFields(): void {
		this._fields.length = 0;
	}

	/** Forgets the forces on balls. Fields are scene objects and stay until removed or expired. */
	clearDirected(): void {
		this.directed.length = 0;
	}

	/** Forgets forces aimed at a ball that has been reset, removed or recycled. */
	dropBall(ball: number): void {
		this.directed = this.directed.filter((f) => f.ball !== ball);
	}

	/** Follows a ball that moved to another index when the store closed a gap. */
	renumberBall(from: number, to: number): void {
		for (const f of this.directed) if (f.ball === from) f.ball = to;
	}

	/**
	 * Adds the velocity change every force causes over the next `dt` seconds to dvx/dvy/dvz,
	 * then ages the forces and discards the ones that have faded away.
	 */
	accumulate(store: BallStore, dt: number, dvx: Float64Array, dvy: Float64Array, dvz: Float64Array): void {
		for (const f of this.directed) {
			if (f.ball < store.count) {
				const dv = (f.power * impulseFraction(f.age, dt, f.tau)) / store.mass[f.ball];
				dvx[f.ball] += dv * f.dx;
				dvy[f.ball] += dv * f.dy;
				dvz[f.ball] += dv * f.dz;
			}
			f.age += dt;
		}

		for (const f of this._fields) {
			const impulse = fieldImpulse(f, dt);
			if (impulse !== 0) {
				const rSq = f.radius * f.radius;
				for (let i = 0; i < store.count; i++) {
					const dx = store.px[i] - f.cx;
					const dy = store.py[i] - f.cy;
					const dz = store.pz[i] - f.cz;
					const dSq = dx * dx + dy * dy + dz * dz;
					if (dSq >= rSq || dSq < 1e-12) continue;
					const d = Math.sqrt(dSq);
					const dv = (impulse * (1 - d / f.radius)) / store.mass[i] / d;
					dvx[i] += dv * dx;
					dvy[i] += dv * dy;
					dvz[i] += dv * dz;
				}
			}
			f.age += dt;
		}

		this.directed = this.directed.filter((f) => f.age < FORCE_LIFETIME * f.tau);
		this._fields = this._fields.filter((f) => f.lifetime === 0 || f.age < f.lifetime + (f.pulseRate > 0 ? FORCE_LIFETIME * f.tau : 0));
	}
}
