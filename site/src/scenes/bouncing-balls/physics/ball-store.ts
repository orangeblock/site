import { MAX_BALLS } from './constants';

export interface BallSpec {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	radius: number;
	mass: number;
	restitution: number;
}

/**
 * All balls live in parallel typed arrays ("structure of arrays"): ball `i` is `px[i], py[i], pz[i], ...`.
 * Looping over a few flat Float64Arrays is far faster than touching thousands of small objects, and the
 * arrays can be handed to a Web Worker or the GPU later without any reshaping.
 *
 * Balls are packed into indices 0..count-1. Removing a ball moves the last one into its slot.
 */
export class BallStore {
	count = 0;
	/** Index of the selected ball, or -1. */
	selected = -1;

	readonly px: Float64Array;
	readonly py: Float64Array;
	readonly pz: Float64Array;
	readonly vx: Float64Array;
	readonly vy: Float64Array;
	readonly vz: Float64Array;
	readonly radius: Float64Array;
	readonly mass: Float64Array;
	readonly restitution: Float64Array;

	/** Position and velocity a ball returns to on reset */
	readonly ox: Float64Array;
	readonly oy: Float64Array;
	readonly oz: Float64Array;
	readonly ovx: Float64Array;
	readonly ovy: Float64Array;
	readonly ovz: Float64Array;

	private readonly columns: Float64Array[];
	/** Next slot to overwrite once the store is full, so the oldest balls go first. */
	private nextRecycle = 0;

	constructor(readonly capacity = MAX_BALLS) {
		const column = () => new Float64Array(capacity);
		this.px = column();
		this.py = column();
		this.pz = column();
		this.vx = column();
		this.vy = column();
		this.vz = column();
		this.radius = column();
		this.mass = column();
		this.restitution = column();
		this.ox = column();
		this.oy = column();
		this.oz = column();
		this.ovx = column();
		this.ovy = column();
		this.ovz = column();
		this.columns = [
			this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.radius, this.mass, this.restitution,
			this.ox, this.oy, this.oz, this.ovx, this.ovy, this.ovz,
		];
	}

	/** Adds a ball and returns its index. When the store is full the oldest ball is overwritten instead. */
	add(b: BallSpec): number {
		let i: number;
		if (this.count < this.capacity) {
			i = this.count++;
		} else {
			i = this.nextRecycle;
			this.nextRecycle = (i + 1) % this.capacity;
			if (this.selected === i) this.selected = -1;
		}
		this.px[i] = this.ox[i] = b.x;
		this.py[i] = this.oy[i] = b.y;
		this.pz[i] = this.oz[i] = b.z;
		this.vx[i] = this.ovx[i] = b.vx;
		this.vy[i] = this.ovy[i] = b.vy;
		this.vz[i] = this.ovz[i] = b.vz;
		this.radius[i] = b.radius;
		this.mass[i] = b.mass;
		this.restitution[i] = b.restitution;
		return i;
	}

	remove(i: number): void {
		const last = this.count - 1;
		if (i !== last) {
			for (const col of this.columns) col[i] = col[last];
		}
		if (this.selected === i) this.selected = -1;
		else if (this.selected === last) this.selected = i;
		this.count--;
	}

	clear(): void {
		this.count = 0;
		this.selected = -1;
		this.nextRecycle = 0;
	}

	reset(i: number): void {
		this.px[i] = this.ox[i];
		this.py[i] = this.oy[i];
		this.pz[i] = this.oz[i];
		this.vx[i] = this.ovx[i];
		this.vy[i] = this.ovy[i];
		this.vz[i] = this.ovz[i];
	}
}
