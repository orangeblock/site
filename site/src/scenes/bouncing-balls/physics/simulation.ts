import { BallStore, type BallSpec } from './ball-store';
import { BallGrid } from './ball-grid';
import { resolveBallPair } from './ball-collision';
import type { ColliderSpec } from './colliders';
import { GRAVITY } from './constants';
import { ForceSet } from './forces';
import { StaticColliders } from './static-colliders';

/**
 * The whole physics world: balls, forces and static geometry, advanced in fixed timesteps.
 * Nothing in `physics/` imports three.js, so it can be run and tested on its own.
 */
export class Simulation {
	readonly store = new BallStore();
	readonly forces = new ForceSet();
	gravity = GRAVITY;
	/** Physics ticks per simulated second. The timestep is always 1 / tickRate, whatever the frame rate. */
	tickRate = 300;
	/** Coulomb friction coefficient μ for ball-ball and ball-surface contacts. 0 means frictionless. */
	friction = 0;
	running = false;

	private statics: StaticColliders;
	private readonly grid = new BallGrid();
	private readonly dvx = new Float64Array(this.store.capacity);
	private readonly dvy = new Float64Array(this.store.capacity);
	private readonly dvz = new Float64Array(this.store.capacity);
	private accumulator = 0;

	constructor(colliders: ColliderSpec[]) {
		this.statics = new StaticColliders(colliders);
	}

	setColliders(colliders: ColliderSpec[]): void {
		this.statics = new StaticColliders(colliders);
	}

	addBall(spec: BallSpec): number {
		const i = this.store.add(spec);
		this.forces.dropBall(i);
		return i;
	}

	removeBall(i: number): void {
		const last = this.store.count - 1;
		this.forces.dropBall(i);
		this.forces.renumberBall(last, i);
		this.store.remove(i);
	}

	clearBalls(): void {
		this.store.clear();
		this.forces.clearDirected();
	}

	resetBall(i: number): void {
		this.store.reset(i);
		this.forces.dropBall(i);
	}

	resetAll(): void {
		for (let i = 0; i < this.store.count; i++) this.store.reset(i);
		this.forces.clearDirected();
	}

	/**
	 * Advances the world by exactly `dt` seconds.
	 *
	 * With acceleration a held constant over the step, motion is
	 *   x += v·dt + ½·a·dt²,   v += a·dt
	 * which is exact for constant a. Here a·dt is gravity·dt plus the velocity change the forces cause over
	 * this step (`dv`), so free fall and the decaying forces both integrate without discretisation error.
	 * Collisions then correct positions and velocities.
	 */
	tick(dt = 1 / this.tickRate): void {
		const s = this.store;
		const n = s.count;
		const { dvx, dvy, dvz } = this;

		dvx.fill(0, 0, n);
		dvy.fill(0, 0, n);
		dvz.fill(0, 0, n);
		this.forces.accumulate(s, dt, dvx, dvy, dvz);

		const gdt = this.gravity * dt;
		for (let i = 0; i < n; i++) {
			s.px[i] += s.vx[i] * dt + 0.5 * dvx[i] * dt;
			s.py[i] += s.vy[i] * dt + 0.5 * (dvy[i] - gdt) * dt;
			s.pz[i] += s.vz[i] * dt + 0.5 * dvz[i] * dt;
			s.vx[i] += dvx[i];
			s.vy[i] += dvy[i] - gdt;
			s.vz[i] += dvz[i];
		}

		this.grid.findPairs(s);
		for (let k = 0; k < this.grid.pairCount; k++) {
			resolveBallPair(s, this.grid.pairA[k], this.grid.pairB[k], this.friction);
		}
		this.statics.resolve(s, this.friction);
	}

	/**
	 * Advances the world by `frameDt` seconds of real time using as many fixed ticks as that covers.
	 *
	 * If the ticks cannot be computed within `budgetMs`, the leftover time is dropped and the simulation runs
	 * slower than real time instead of freezing the page. Returns the number of ticks run.
	 */
	advance(frameDt: number, budgetMs = 10, now: () => number = () => performance.now()): number {
		if (!this.running) return 0;
		const dt = 1 / this.tickRate;
		// Never try to catch up more than a quarter of a second, e.g. after the tab was in the background.
		this.accumulator = Math.min(this.accumulator + frameDt, 0.25);

		const start = now();
		let ticks = 0;
		while (this.accumulator >= dt) {
			this.tick(dt);
			this.accumulator -= dt;
			ticks++;
			if (now() - start > budgetMs) {
				this.accumulator = 0;
				break;
			}
		}
		return ticks;
	}
}
