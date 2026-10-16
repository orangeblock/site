import type { Pick } from '../interaction/picking';
import type { BallSpec, BallStore } from './ball-store';
import type { ColliderSpec } from './colliders';
import type { ForceSet } from './forces';

/** The selected-ball properties the panel can edit. */
export type BallProp = 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'mass' | 'restitution' | 'radius';

/**
 * What the app needs from a physics engine. `Simulation` runs on the CPU. `GpuSimulation` (in `gpu/`) keeps
 * the balls in GPU buffers, so for it `store` is a copy that is exact for everything except the live position
 * and velocity, which are only kept up to date for the selected ball (see `refreshSelected`).
 */
export interface Engine {
	readonly store: BallStore;
	readonly forces: ForceSet;
	gravity: number;
	tickRate: number;
	friction: number;
	running: boolean;

	setColliders(colliders: ColliderSpec[]): void;
	addBall(spec: BallSpec): number;
	removeBall(i: number): void;
	clearBalls(): void;
	resetBall(i: number): void;
	resetAll(): void;
	/** Position and velocity edit where the ball returns to on reset, and also move it right away while paused. */
	editBall(i: number, prop: BallProp, value: number): void;
	tick(): void;
	/** Runs the fixed ticks that `frameDt` seconds of real time cover and returns how many ran. */
	advance(frameDt: number): number;
	/** The nearest ball the ray passes through. */
	pickBall(origin: readonly [number, number, number], direction: readonly [number, number, number]): Promise<Pick | null>;
	/** Brings the selected ball's live position and velocity into `store`. */
	refreshSelected(): void;
}
