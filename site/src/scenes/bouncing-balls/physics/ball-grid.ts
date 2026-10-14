import type { BallStore } from './ball-store';

/**
 * Finds every pair of overlapping balls without comparing every ball with every other one.
 *
 * Balls are sorted into a spatial hash: space is cut into cubes as wide as the largest ball's diameter, and
 * each cube is mapped to a bucket by hashing its integer coordinates. Two balls can only touch if they sit
 * in the same cube or in neighbouring cubes, so each ball only has to look at 27 cubes. Different cubes can
 * share a bucket; that only adds candidates, because every candidate is checked with the exact overlap test.
 *
 * The buckets are built with a counting sort (count, prefix-sum, fill), which needs no per-frame allocation.
 */
export class BallGrid {
	/** Overlapping pairs found by the last call to `findPairs`: ball `pairA[k]` touches ball `pairB[k]`. */
	pairA = new Int32Array(4096);
	pairB = new Int32Array(4096);
	pairCount = 0;

	private bucketStart = new Int32Array(0);
	private cursor = new Int32Array(0);
	private stamp = new Int32Array(0);
	private occupied = new Uint32Array(0);
	private sorted = new Int32Array(0);
	private bucketOf = new Int32Array(0);
	/** Positions and radii copied into bucket order, so scanning a bucket reads contiguous memory. */
	private sx = new Float64Array(0);
	private sy = new Float64Array(0);
	private sz = new Float64Array(0);
	private sr = new Float64Array(0);

	findPairs(store: BallStore): void {
		const n = store.count;
		const { px, py, pz, radius } = store;

		let maxRadius = 0;
		for (let i = 0; i < n; i++) maxRadius = Math.max(maxRadius, radius[i]);
		const inv = 1 / (2 * maxRadius || 1);

		let tableSize = 16;
		while (tableSize < 2 * n) tableSize *= 2;
		const mask = tableSize - 1;
		if (this.bucketStart.length < tableSize + 1) {
			this.bucketStart = new Int32Array(tableSize + 1);
			this.cursor = new Int32Array(tableSize + 1);
			this.stamp = new Int32Array(tableSize + 1);
			this.occupied = new Uint32Array((tableSize >> 5) + 1);
		}
		if (this.sorted.length < n) {
			this.sorted = new Int32Array(store.capacity);
			this.bucketOf = new Int32Array(store.capacity);
			this.sx = new Float64Array(store.capacity);
			this.sy = new Float64Array(store.capacity);
			this.sz = new Float64Array(store.capacity);
			this.sr = new Float64Array(store.capacity);
		}
		const { bucketStart, cursor, stamp, occupied, sorted, bucketOf, sx, sy, sz, sr } = this;

		// Count balls per bucket.
		bucketStart.fill(0, 0, tableSize + 1);
		occupied.fill(0);
		for (let i = 0; i < n; i++) {
			const b = bucketIndex(Math.floor(px[i] * inv), Math.floor(py[i] * inv), Math.floor(pz[i] * inv), mask);
			bucketOf[i] = b;
			bucketStart[b + 1]++;
			occupied[b >> 5] |= 1 << (b & 31);
		}
		// Prefix sum: bucketStart[b] is now where bucket b begins in `sorted`.
		for (let b = 0; b < tableSize; b++) bucketStart[b + 1] += bucketStart[b];
		// Drop each ball into its bucket.
		cursor.set(bucketStart.subarray(0, tableSize));
		for (let i = 0; i < n; i++) {
			const k = cursor[bucketOf[i]]++;
			sorted[k] = i;
			sx[k] = px[i];
			sy[k] = py[i];
			sz[k] = pz[i];
			sr[k] = radius[i];
		}

		stamp.fill(0, 0, tableSize);
		this.pairCount = 0;
		for (let i = 0; i < n; i++) {
			const xi = px[i];
			const yi = py[i];
			const zi = pz[i];
			const ri = radius[i];
			const cx = Math.floor(px[i] * inv);
			const cy = Math.floor(py[i] * inv);
			const cz = Math.floor(pz[i] * inv);
			// The hash is an XOR of one term per axis, so the three terms are computed once per ball rather than 27 times.
			for (let dz = 0; dz < 3; dz++) {
				const hz = Math.imul(cz + dz - 1, 83492791);
				for (let dy = 0; dy < 3; dy++) {
					const hyz = hz ^ Math.imul(cy + dy - 1, 19349663);
					for (let dx = 0; dx < 3; dx++) {
						const b = (hyz ^ Math.imul(cx + dx - 1, 73856093)) & mask;
						// Most of the 27 buckets are empty. A bitmap small enough for the CPU cache answers that cheaply.
						if ((occupied[b >> 5] & (1 << (b & 31))) === 0) continue;
						const end = bucketStart[b + 1];
						// Two of the 27 cubes can hash to the same bucket; visit each bucket once per ball.
						if (stamp[b] === i + 1) continue;
						stamp[b] = i + 1;
						for (let k = bucketStart[b]; k < end; k++) {
							const j = sorted[k];
							// Report each pair once, from its lower index.
							if (j <= i) continue;
							const ex = xi - sx[k];
							const ey = yi - sy[k];
							const ez = zi - sz[k];
							const reach = ri + sr[k];
							if (ex * ex + ey * ey + ez * ez <= reach * reach) this.addPair(i, j);
						}
					}
				}
			}
		}
	}

	private addPair(i: number, j: number): void {
		if (this.pairCount === this.pairA.length) {
			const grow = (old: Int32Array) => {
				const bigger = new Int32Array(old.length * 2);
				bigger.set(old);
				return bigger;
			};
			this.pairA = grow(this.pairA);
			this.pairB = grow(this.pairB);
		}
		this.pairA[this.pairCount] = i;
		this.pairB[this.pairCount] = j;
		this.pairCount++;
	}
}

function bucketIndex(x: number, y: number, z: number, mask: number): number {
	return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
}
