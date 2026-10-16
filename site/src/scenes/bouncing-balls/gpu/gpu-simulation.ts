import {
	Fn, If, atomicAdd, atomicLoad, atomicStore, dot, float, instanceIndex, instancedArray, int, max, min,
	select, sqrt, uint, uniform, uvec2, vec3, vec4,
} from 'three/tsl';
import type { ComputeNode, StorageBufferNode, WebGPURenderer } from 'three/webgpu';
import { pickBall } from '../interaction/picking';
import { BallStore, type BallSpec } from '../physics/ball-store';
import type { ColliderSpec } from '../physics/colliders';
import { DEFAULT_TICK_RATE, GPU_MAX_BALLS, GRAVITY, PENETRATION_CORRECTION, PENETRATION_SLOP, REST_SPEED } from '../physics/constants';
import type { BallProp, Engine } from '../physics/engine';
import { ForceSet } from '../physics/forces';
import { buildStaticsKernel } from './gpu-statics';
import { forRange } from './loop';

/** Directed forces and fields sent to the GPU per tick. Any beyond these are left out for that tick. */
const MAX_DIRECTED = 256;
const MAX_FIELDS = 256;
/** Collision passes per tick. Each pass resolves every contact from the same snapshot, so more passes settle piles better. */
const PASSES = 2;
/** At most this much simulated time per frame. When the GPU cannot keep up, the simulation slows down instead of the frame rate collapsing. */
const MAX_FRAME_TIME = 1 / 30;

/** Hash table size: a power of two at least twice the capacity, so few cells share a bucket. */
function tableSize(capacity: number): number {
	let t = 16;
	while (t < 2 * capacity) t *= 2;
	return t;
}

/** Contiguous index ranges waiting to be uploaded to a buffer. Consecutive balls merge into one range. */
class PendingRanges {
	private ranges: [start: number, end: number][] = [];

	mark(start: number, end = start + 1): void {
		const last = this.ranges[this.ranges.length - 1];
		if (last && start === last[1]) last[1] = end;
		else this.ranges.push([start, end]);
	}

	/** Queues the ranges on the buffers; three.js uploads them the next time a kernel or the renderer uses them. */
	flush(buffers: StorageBufferNode<'vec4'>[], itemSize: number): void {
		if (this.ranges.length === 0) return;
		for (const buffer of buffers) {
			const attribute = buffer.value;
			for (const [start, end] of this.ranges) attribute.addUpdateRange(start * itemSize, (end - start) * itemSize);
			attribute.needsUpdate = true;
		}
		this.ranges = [];
	}
}

/**
 * The GPU engine: the same physics as `Simulation`, with every ball's state in GPU storage buffers and every
 * tick run as a handful of compute kernels (three.js TSL). Nothing per ball is copied back to the CPU, except
 * the selected ball (for the panel and the aim) and, on a click, every position (for picking).
 *
 * Per tick:
 *  1. integrate: forces, gravity and the position update, as in `Simulation.tick`; then each ball adds itself to
 *     its hash bucket with an atomic counter, which also gives it its slot within the bucket.
 *  2. allocate, fill: every non-empty bucket reserves a run of a shared index list (another atomic counter, so
 *     the runs end up in no particular order), and every ball writes its index into its bucket's run.
 *  3. collide, apply (twice): every ball looks through the 27 neighbouring buckets and adds up the impulses and
 *     position corrections from all the balls it overlaps, using the state at the start of the pass. It writes
 *     only its own result, so no two threads write the same ball. Then the results are applied.
 *  4. statics: the static colliders, as in `StaticColliders`.
 *
 * Step 3 differs from the CPU, which resolves pairs one after another. Resolving them all at once from one
 * snapshot is what makes the GPU version possible; the price is that piles settle a little differently.
 *
 * `store` holds the same balls as the GPU buffers. Everything except the live position and velocity is exact,
 * and changes to it are uploaded before the next tick. Live position and velocity are only uploaded for balls
 * that were just added, reset or edited while paused, and only read back for the selected ball.
 */
export class GpuSimulation implements Engine {
	readonly store = new BallStore(GPU_MAX_BALLS);
	readonly forces = new ForceSet();
	gravity = GRAVITY;
	tickRate = DEFAULT_TICK_RATE;
	friction = 0;
	running = false;

	readonly pos: StorageBufferNode<'vec4'>;
	readonly vel: StorageBufferNode<'vec4'>;
	/** radius, mass, restitution, unused. */
	readonly props: StorageBufferNode<'vec4'>;
	private readonly forceData: StorageBufferNode<'vec4'>;

	// Single values the kernels read. `tick` sets them before each dispatch; changing `.value` needs no rebuild.
	private readonly uCount = uniform(0, 'uint');
	private readonly uDt = uniform(1 / DEFAULT_TICK_RATE);
	private readonly uGravity = uniform(GRAVITY);
	private readonly uFriction = uniform(0);
	/** 1 / grid cell size. */
	private readonly uCellInv = uniform(1);
	/** How many entries of `forceData` this tick uses: directed forces, then fields. */
	private readonly uDirected = uniform(0, 'uint');
	private readonly uFields = uniform(0, 'uint');
	private readonly uMoveFrom = uniform(0, 'uint');
	private readonly uMoveTo = uniform(0, 'uint');

	private readonly ballKernels: ComputeNode[];
	private statics: ComputeNode | null = null;
	private readonly move: ComputeNode;

	private readonly liveRanges = new PendingRanges();
	private readonly propRanges = new PendingRanges();
	/**
	 * Largest radius among the balls, which sets the grid cell size. It may be too large (cells wider than needed
	 * only cost time) but never too small: overlapping balls would then be more than one cell apart and their
	 * collision would be missed. Adding or growing a ball raises it at once. When the largest ball might have gone
	 * (removed, recycled, shrunk), `maxRadiusStale` asks `tick` to recompute it from the store before the next grid.
	 */
	private maxRadius = 0;
	private maxRadiusStale = false;
	private accumulator = 0;
	private reading = false;
	/** Bumped by every edit, so a read-back that started before it does not overwrite the edited value. */
	private edits = 0;

	constructor(private readonly renderer: WebGPURenderer, colliders: ColliderSpec[]) {
		const capacity = this.store.capacity;
		const buckets = tableSize(capacity);
		const mask = uint(buckets - 1);

		// One slot per ball (or per bucket) in each buffer. WebGPU allows 8 storage buffers per kernel by default,
		// so related data shares a buffer: `delta` and `bucketSlot` hold two things each.
		this.pos = instancedArray(capacity, 'vec4');
		this.vel = instancedArray(capacity, 'vec4');
		this.props = instancedArray(capacity, 'vec4');
		this.forceData = instancedArray(MAX_DIRECTED + 2 * MAX_FIELDS, 'vec4');
		// Velocity changes in the first `capacity` entries, position changes in the second.
		const delta = instancedArray(2 * capacity, 'vec4');
		// Each ball's bucket and its slot within the bucket.
		const bucketSlot = instancedArray(capacity, 'uvec2');
		const sorted = instancedArray(capacity, 'uint');
		const bucketCount = instancedArray(buckets, 'uint').toAtomic();
		const bucketStart = instancedArray(buckets, 'uint');
		const cursor = instancedArray(1, 'uint').toAtomic();

		const { pos, vel, props, forceData, uCount, uDt, uCellInv } = this;

		// The same spatial hash as `BallGrid`. Unsigned multiplication wraps, like Math.imul.
		const bucketOf = (x: any, y: any, z: any) =>
			x.toUint().mul(uint(73856093)).bitXor(y.toUint().mul(uint(19349663))).bitXor(z.toUint().mul(uint(83492791))).bitAnd(mask);
		const cellOf = (p: any) => [p.x.mul(uCellInv).floor().toInt(), p.y.mul(uCellInv).floor().toInt(), p.z.mul(uCellInv).floor().toInt()];

		// Kernel 1, one thread per bucket: empty every bucket, and thread 0 resets the shared run counter.
		const clearGrid = Fn(() => {
			atomicStore(bucketCount.element(instanceIndex), uint(0));
			If(instanceIndex.equal(uint(0)), () => {
				atomicStore(cursor.element(uint(0)), uint(0));
			});
		})().compute(buckets);

		// Kernel 2, one thread per ball: forces, integration, then the ball adds itself to its hash bucket.
		// Threads beyond the ball count exit at once; every ball kernel is dispatched for the full capacity.
		const integrate = Fn(() => {
			const i = instanceIndex;
			If(i.lessThan(uCount), () => {
				const p = pos.element(i).xyz.toVar();
				const v = vel.element(i).xyz.toVar();
				const mass = props.element(i).y;
				const dv = vec3(0).toVar();

				// Directed forces: (dvx, dvy, dvz, ball). Usually zero or one, so every ball checking them all is cheap.
				forRange(uint(0), this.uDirected, 'uint', 'k', (k) => {
					const f = forceData.element(k);
					If(f.w.toUint().equal(i), () => {
						dv.addAssign(f.xyz);
					});
				});
				// Fields: (centre, radius) then (impulse at the centre). Falloff and mass as in `ForceSet.accumulate`.
				forRange(uint(0), this.uFields, 'uint', 'k', (k) => {
					const centre = forceData.element(uint(MAX_DIRECTED).add(k.mul(uint(2))));
					const impulse = forceData.element(uint(MAX_DIRECTED + 1).add(k.mul(uint(2)))).x;
					const d = p.sub(centre.xyz).toVar();
					const dSq = dot(d, d).toVar();
					If(dSq.lessThan(centre.w.mul(centre.w)).and(dSq.greaterThanEqual(1e-12)), () => {
						const dist = sqrt(dSq);
						dv.addAssign(d.mul(impulse.mul(float(1).sub(dist.div(centre.w))).div(mass).div(dist)));
					});
				});

				// x += v·dt + ½(dv − g·dt)·dt and v += dv − g·dt, as in `Simulation.tick`.
				const gdt = this.uGravity.mul(uDt);
				p.addAssign(v.mul(uDt).add(dv.sub(vec3(0, gdt, 0)).mul(uDt.mul(0.5))));
				v.addAssign(dv.sub(vec3(0, gdt, 0)));
				pos.element(i).assign(vec4(p, 0));
				vel.element(i).assign(vec4(v, 0));

				// atomicAdd returns the count before adding, so the balls in one bucket get slots 0, 1, 2… in whatever
				// order their threads arrive. The count itself ends up as the bucket's size.
				const [cx, cy, cz] = cellOf(p);
				const bucket = bucketOf(cx, cy, cz).toVar();
				const slot = atomicAdd(bucketCount.element(bucket), uint(1)).toVar();
				bucketSlot.element(i).assign(uvec2(bucket, slot));
			});
		})().compute(capacity);

		// Kernel 3, one thread per bucket: each non-empty bucket reserves `count` consecutive places in `sorted`
		// from the shared counter. The runs land in no particular order, which is fine: a bucket only needs its own
		// run to be contiguous. This replaces the prefix sum the CPU uses, which is awkward to do in parallel.
		const allocate = Fn(() => {
			const count = atomicLoad(bucketCount.element(instanceIndex)).toVar();
			If(count.greaterThan(uint(0)), () => {
				bucketStart.element(instanceIndex).assign(atomicAdd(cursor.element(uint(0)), count));
			});
		})().compute(buckets);

		// Kernel 4, one thread per ball: write the ball's index into its bucket's run, at its slot.
		const fill = Fn(() => {
			const i = instanceIndex;
			If(i.lessThan(uCount), () => {
				const bs = bucketSlot.element(i);
				sorted.element(bucketStart.element(bs.x).add(bs.y)).assign(i);
			});
		})().compute(capacity);

		// Kernel 5, one thread per ball: `resolveBallPair` against every overlapping neighbour, seen from ball i only.
		// Each thread reads `pos` and `vel` as they were at the start of the pass and writes only its own `delta`
		// slots, so no two threads write the same ball. Every pair is worked out twice, once from each side, with
		// equal and opposite results.
		const collide = Fn(() => {
			const i = instanceIndex;
			If(i.lessThan(uCount), () => {
				const p = pos.element(i).xyz.toVar();
				const v = vel.element(i).xyz.toVar();
				const own = props.element(i).toVar();
				const invMi = float(1).div(own.y).toVar();
				const dv = vec3(0).toVar();
				const dp = vec3(0).toVar();
				const [cx, cy, cz] = cellOf(p);

				// The 27 cells around the ball's own. Cells are as wide as the largest ball, so anything it overlaps is in one of them.
				// If two of the 27 hash to the same bucket, that bucket's balls are counted twice for this tick (rare).
				forRange(int(-1), int(2), 'int', 'dz', (dz) => {
					forRange(int(-1), int(2), 'int', 'dy', (dy) => {
						forRange(int(-1), int(2), 'int', 'dx', (dx) => {
							const bucket = bucketOf(cx.add(dx), cy.add(dy), cz.add(dz)).toVar();
							// An empty bucket's start was not written this tick, but its count is 0 so it is never read.
							const count = atomicLoad(bucketCount.element(bucket)).toVar();
							const start = bucketStart.element(bucket).toVar();
							forRange(uint(0), count, 'uint', 'k', (k) => {
								const j = sorted.element(start.add(k)).toVar();
								If(j.notEqual(i), () => {
									const other = props.element(j).toVar();
									const d = p.sub(pos.element(j).xyz).toVar();
									const reach = own.x.add(other.x).toVar();
									const distSq = dot(d, d).toVar();
									// Only overlapping pairs; the bucket also holds balls from other cells that share its hash.
									If(distSq.lessThanEqual(reach.mul(reach)), () => {
										const dist = sqrt(distSq).toVar();
										// Exactly coincident balls are pushed apart vertically, the lower index upwards.
										const n = select(dist.greaterThan(0), d.div(dist), vec3(0, select(i.lessThan(j), float(1), float(-1)), 0)).toVar();
										const invMj = float(1).div(other.y);
										const invMassSum = invMi.add(invMj).toVar();
										const rel = v.sub(vel.element(j).xyz).toVar();
										const vn = dot(rel, n).toVar();
										// Approaching: J = (1 + e)·vn / (1/mi + 1/mj), and ball i takes J/mi of it.
										If(vn.lessThan(0), () => {
											const e = select(vn.negate().lessThan(REST_SPEED), float(0), own.z.mul(other.z));
											const impulse = e.add(1).mul(vn).negate().div(invMassSum).toVar();
											dv.addAssign(n.mul(impulse.mul(invMi)));

											// The sliding part of the relative velocity does not change with the normal impulse.
											const t = rel.sub(n.mul(vn)).toVar();
											const slide = sqrt(dot(t, t)).toVar();
											If(this.uFriction.greaterThan(0).and(slide.greaterThan(1e-9)), () => {
												const frictionImpulse = min(this.uFriction.mul(impulse), slide.div(invMassSum));
												dv.subAssign(t.mul(frictionImpulse.div(slide).mul(invMi)));
											});
										});
										// Push the balls apart, the lighter one further, as on the CPU.
										const correction = max(reach.sub(dist).sub(PENETRATION_SLOP), 0).mul(PENETRATION_CORRECTION).div(invMassSum);
										dp.addAssign(n.mul(correction.mul(invMi)));
									});
								});
							});
						});
					});
				});
				delta.element(i).assign(vec4(dv, 0));
				delta.element(i.add(uint(capacity))).assign(vec4(dp, 0));
			});
		})().compute(capacity);

		// Kernel 6, one thread per ball: add the collision results. A separate kernel, so that no `collide` thread
		// sees another ball already moved within the same pass.
		const apply = Fn(() => {
			const i = instanceIndex;
			If(i.lessThan(uCount), () => {
				vel.element(i).assign(vec4(vel.element(i).xyz.add(delta.element(i).xyz), 0));
				pos.element(i).assign(vec4(pos.element(i).xyz.add(delta.element(i.add(uint(capacity))).xyz), 0));
			});
		})().compute(capacity);

		// One tick, in order: [clearGrid, integrate, allocate, fill, collide, apply, collide, apply]. The grid is built
		// once and reused by both passes; the second pass starts from the state the first one corrected. The statics
		// kernel is appended in `tick`, because it is rebuilt whenever the world changes.
		this.ballKernels = [clearGrid, integrate, allocate, fill];
		for (let k = 0; k < PASSES; k++) this.ballKernels.push(collide, apply);

		// One thread: copy one ball's live state to another slot, for `removeBall`.
		this.move = Fn(() => {
			pos.element(this.uMoveTo).assign(pos.element(this.uMoveFrom));
			vel.element(this.uMoveTo).assign(vel.element(this.uMoveFrom));
		})().compute(1);

		this.setColliders(colliders);
	}

	setColliders(colliders: ColliderSpec[]): void {
		this.statics?.dispose();
		this.statics = buildStaticsKernel(colliders, this.pos, this.vel, this.props, this.uCount, this.uFriction, this.store.capacity);
	}

	addBall(spec: BallSpec): number {
		// When full, the oldest ball is overwritten, and it may have been the largest.
		if (this.store.count === this.store.capacity) this.maxRadiusStale = true;
		const i = this.store.add(spec);
		this.forces.dropBall(i);
		this.writeLive(i);
		this.writeProps(i);
		return i;
	}

	removeBall(i: number): void {
		const last = this.store.count - 1;
		if (this.store.radius[i] >= this.maxRadius) this.maxRadiusStale = true;
		this.forces.dropBall(i);
		this.forces.renumberBall(last, i);
		this.store.remove(i);
		if (i === last) return;
		// Move the last ball's live state into the gap on the GPU, where it is. Pending uploads go first.
		this.uMoveFrom.value = last;
		this.uMoveTo.value = i;
		this.flush();
		this.renderer.compute(this.move);
		this.writeProps(i);
	}

	clearBalls(): void {
		this.store.clear();
		this.forces.clearDirected();
		this.maxRadius = 0;
	}

	resetBall(i: number): void {
		this.store.reset(i);
		this.forces.dropBall(i);
		this.writeLive(i);
	}

	resetAll(): void {
		for (let i = 0; i < this.store.count; i++) {
			this.store.reset(i);
			this.writeLive(i);
		}
		this.forces.clearDirected();
	}

	editBall(i: number, prop: BallProp, value: number): void {
		const s = this.store;
		this.edits++;
		const origin = { x: s.ox, y: s.oy, z: s.oz, vx: s.ovx, vy: s.ovy, vz: s.ovz };
		const live = { x: s.px, y: s.py, z: s.pz, vx: s.vx, vy: s.vy, vz: s.vz };
		if (prop in origin) {
			origin[prop as keyof typeof origin][i] = value;
			if (!this.running) {
				live[prop as keyof typeof live][i] = value;
				this.writeLive(i);
			}
		} else {
			s[prop as 'mass' | 'restitution' | 'radius'][i] = value;
			if (prop === 'radius') this.maxRadiusStale = true;
			this.writeProps(i);
		}
	}

	/**
	 * Runs one tick. Nothing here waits for the GPU: the work is queued, and the next frame's render reads the
	 * results straight from the buffers.
	 */
	tick(): void {
		const s = this.store;
		const dt = 1 / this.tickRate;
		// 1. Forces are aged and expired on the CPU, exactly as in `Simulation`, even with no balls.
		const { directed, fields } = this.forces.impulses(s, dt);
		if (s.count === 0) return;

		// 2. This tick's forces go into the staging array; only the entries in use are uploaded.
		const data = this.forceData.value.array as Float32Array;
		const nDirected = Math.min(directed.length, MAX_DIRECTED);
		for (let k = 0; k < nDirected; k++) data.set([directed[k].dvx, directed[k].dvy, directed[k].dvz, directed[k].ball], k * 4);
		const nFields = Math.min(fields.length, MAX_FIELDS);
		for (let k = 0; k < nFields; k++) {
			const { field: f, impulse } = fields[k];
			data.set([f.cx, f.cy, f.cz, f.radius, impulse, 0, 0, 0], (MAX_DIRECTED + 2 * k) * 4);
		}
		const attribute = this.forceData.value;
		if (nDirected > 0) attribute.addUpdateRange(0, nDirected * 4);
		if (nFields > 0) attribute.addUpdateRange(MAX_DIRECTED * 4, nFields * 8);
		if (nDirected + nFields > 0) attribute.needsUpdate = true;

		// 3. Recompute the largest radius if it may have shrunk (see `maxRadius`).
		if (this.maxRadiusStale) {
			this.maxRadius = 0;
			for (let i = 0; i < s.count; i++) this.maxRadius = Math.max(this.maxRadius, s.radius[i]);
			this.maxRadiusStale = false;
		}
		// 4. Uniforms and pending uploads. three.js writes both to the GPU before the kernels below run.
		this.uCount.value = s.count;
		this.uDt.value = dt;
		this.uGravity.value = this.gravity;
		this.uFriction.value = this.friction;
		// Cells as wide as the largest ball, as in `BallGrid`.
		this.uCellInv.value = 1 / (2 * this.maxRadius || 1);
		this.uDirected.value = nDirected;
		this.uFields.value = nFields;
		this.flush();
		// 5. Every kernel goes into one compute pass and one submit. WebGPU makes each dispatch see the previous one's writes.
		this.renderer.compute([...this.ballKernels, this.statics!]);
	}

	advance(frameDt: number): number {
		if (!this.running) return 0;
		const dt = 1 / this.tickRate;
		this.accumulator = Math.min(this.accumulator + frameDt, MAX_FRAME_TIME);
		let ticks = 0;
		while (this.accumulator >= dt) {
			this.tick();
			this.accumulator -= dt;
			ticks++;
		}
		return ticks;
	}

	/** Reads every position back from the GPU (16 bytes a ball) and tests the ray against them. */
	async pickBall(origin: readonly [number, number, number], direction: readonly [number, number, number]) {
		const s = this.store;
		const count = s.count;
		if (count === 0) return null;
		let data: Float32Array;
		try {
			data = new Float32Array(await this.renderer.getArrayBufferAsync(this.pos.value, null, 0, count * 16));
		} catch {
			return null;
		}
		const n = Math.min(count, s.count);
		for (let i = 0; i < n; i++) {
			s.px[i] = data[i * 4];
			s.py[i] = data[i * 4 + 1];
			s.pz[i] = data[i * 4 + 2];
		}
		return pickBall(s, origin, direction);
	}

	/** Starts reading the selected ball back, unless a read is still under way. The result arrives a frame or two later. */
	refreshSelected(): void {
		const s = this.store;
		const i = s.selected;
		if (i < 0 || this.reading) return;
		this.reading = true;
		const edits = this.edits;
		Promise.all([
			this.renderer.getArrayBufferAsync(this.pos.value, null, i * 16, 16),
			this.renderer.getArrayBufferAsync(this.vel.value, null, i * 16, 16),
		])
			.then(([p, v]) => {
				if (s.selected !== i || this.edits !== edits) return;
				[s.px[i], s.py[i], s.pz[i]] = new Float32Array(p);
				[s.vx[i], s.vy[i], s.vz[i]] = new Float32Array(v);
			})
			// The buffers only exist on the GPU once a kernel or a frame has used them; until then there is nothing to read.
			.catch(() => {})
			.finally(() => (this.reading = false));
	}

	/**
	 * Queues every pending change for upload. Only the marked ranges are sent: uploading a whole buffer would
	 * overwrite the positions the GPU has computed with the CPU's stale copies.
	 */
	flush(): void {
		this.liveRanges.flush([this.pos, this.vel], 4);
		this.propRanges.flush([this.props], 4);
	}

	/** Stages ball i's position and velocity from the store. Only for balls whose live state the CPU just set. */
	private writeLive(i: number): void {
		const s = this.store;
		(this.pos.value.array as Float32Array).set([s.px[i], s.py[i], s.pz[i], 0], i * 4);
		(this.vel.value.array as Float32Array).set([s.vx[i], s.vy[i], s.vz[i], 0], i * 4);
		this.liveRanges.mark(i);
	}

	/** Stages ball i's radius, mass and restitution. Safe while it moves: its live state is not touched. */
	private writeProps(i: number): void {
		const s = this.store;
		(this.props.value.array as Float32Array).set([s.radius[i], s.mass[i], s.restitution[i], 0], i * 4);
		this.propRanges.mark(i);
		this.maxRadius = Math.max(this.maxRadius, s.radius[i]);
	}
}
