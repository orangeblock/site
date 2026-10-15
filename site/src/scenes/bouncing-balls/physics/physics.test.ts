import { describe, expect, it } from 'vitest';
import { Euler, Matrix4 } from 'three';
import { BallGrid } from './ball-grid';
import { BallStore, type BallSpec } from './ball-store';
import { createCollider, rotationMatrix, type ColliderSpec, type Contact } from './colliders';
import { GRAVITY } from './constants';
import { Simulation } from './simulation';
import { patternOffsets, randomFill, randomTemplate, RANDOM_RANGES, spawnPattern, DEFAULT_TEMPLATE } from './spawn';
import { pickBall, pickField, raySphere } from '../interaction/picking';

const ball = (over: Partial<BallSpec> = {}): BallSpec => ({
	x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 0.2, mass: 1, restitution: 1, ...over,
});

/** Runs `seconds` of simulated time in ticks of 1/rate. */
function run(sim: Simulation, seconds: number, rate: number): void {
	sim.tickRate = rate;
	const ticks = Math.round(seconds * rate);
	for (let i = 0; i < ticks; i++) sim.tick();
}

describe('free fall', () => {
	for (const rate of [60, 300, 500]) {
		it(`matches y = y0 - g t²/2 and v = -g t at ${rate} Hz`, () => {
			const sim = new Simulation([]);
			sim.addBall(ball({ y: 100, vx: 3 }));
			run(sim, 2, rate);
			const s = sim.store;
			expect(s.py[0]).toBeCloseTo(100 - 0.5 * GRAVITY * 4, 9);
			expect(s.vy[0]).toBeCloseTo(-GRAVITY * 2, 9);
			expect(s.px[0]).toBeCloseTo(6, 9);
		});
	}

	it('does not depend on mass', () => {
		const sim = new Simulation([]);
		sim.addBall(ball({ y: 50, mass: 0.1 }));
		sim.addBall(ball({ x: 5, y: 50, mass: 9 }));
		run(sim, 1, 300);
		expect(sim.store.py[0]).toBeCloseTo(sim.store.py[1], 12);
	});
});

describe('static colliders', () => {
	const floor: ColliderSpec[] = [{ kind: 'plane', point: [0, 0, 0], normal: [0, 1, 0] }];

	it('bounces off a floor with the ball restitution', () => {
		const sim = new Simulation([...floor]);
		sim.addBall(ball({ y: 10, restitution: 0.5 }));
		sim.tickRate = 1000;
		const impact = Math.sqrt(2 * GRAVITY * (10 - 0.2));
		let peak = 0;
		let bounced = false;
		for (let i = 0; i < 5000; i++) {
			sim.tick();
			if (sim.store.vy[0] > 0) bounced = true;
			if (bounced) peak = Math.max(peak, sim.store.vy[0]);
		}
		expect(peak).toBeGreaterThan(0.5 * impact * 0.99);
		expect(peak).toBeLessThan(0.5 * impact * 1.01);
	});

	it('settles on the floor without sinking or buzzing', () => {
		const sim = new Simulation([...floor]);
		sim.addBall(ball({ y: 1, restitution: 0.8 }));
		run(sim, 6, 300);
		expect(sim.store.py[0]).toBeCloseTo(0.2, 2);
		expect(Math.abs(sim.store.vy[0])).toBeLessThan(0.1);
	});

	const contact = (): Contact => ({ nx: 0, ny: 0, nz: 0, depth: 0 });

	it('box: face, edge and inside contacts', () => {
		const box = createCollider({ kind: 'box', center: [0, 0, 0], size: [2, 2, 2] });
		const c = contact();
		expect(box.test(0, 1.1, 0, 0.2, c)).toBe(true);
		expect([c.nx, c.ny, c.nz]).toEqual([0, 1, 0]);
		expect(c.depth).toBeCloseTo(0.1, 12);
		expect(box.test(0, 1.3, 0, 0.2, c)).toBe(false);
		// Past an edge the normal points diagonally away from it.
		expect(box.test(1.1, 1.1, 0, 0.2, c)).toBe(true);
		expect(c.nx).toBeCloseTo(Math.SQRT1_2, 12);
		expect(c.ny).toBeCloseTo(Math.SQRT1_2, 12);
		// A centre inside the box leaves through the nearest face.
		expect(box.test(0.9, 0, 0, 0.2, c)).toBe(true);
		expect(c.nx).toBe(1);
		expect(c.depth).toBeCloseTo(0.3, 12);
	});

	it('cylinder: side, cap and rim contacts', () => {
		const cyl = createCollider({ kind: 'cylinder', center: [0, 0, 0], radius: 1, height: 2 });
		const c = contact();
		expect(cyl.test(1.1, 0, 0, 0.2, c)).toBe(true);
		expect([c.nx, c.ny, c.nz]).toEqual([1, 0, 0]);
		expect(cyl.test(0, 1.1, 0, 0.2, c)).toBe(true);
		expect([c.nx, c.ny, c.nz]).toEqual([0, 1, 0]);
		expect(cyl.test(1.1, 1.1, 0, 0.2, c)).toBe(true);
		expect(c.nx).toBeCloseTo(Math.SQRT1_2, 12);
		expect(cyl.test(1.3, 0, 0, 0.2, c)).toBe(false);
	});

	it('static sphere pushes a ball away along the line of centres', () => {
		const sphere = createCollider({ kind: 'sphere', center: [0, 0, 0], radius: 1 });
		const c = contact();
		expect(sphere.test(0, 1.1, 0, 0.2, c)).toBe(true);
		expect(c.ny).toBe(1);
		expect(c.depth).toBeCloseTo(0.1, 12);
	});

	it('heightfield: a flat field acts like a plane and a ramp tilts the normal', () => {
		const heights = new Float32Array(4 * 4);
		const flat = createCollider({ kind: 'heightfield', origin: [0, 0], size: [3, 3], cols: 4, rows: 4, heights });
		const c = contact();
		expect(flat.test(1.5, 0.1, 1.5, 0.2, c)).toBe(true);
		expect(c.ny).toBeCloseTo(1, 6);
		expect(c.depth).toBeCloseTo(0.1, 6);
		expect(flat.test(1.5, 0.3, 1.5, 0.2, c)).toBe(false);
		expect(flat.test(-1, 0, 1.5, 0.2, c)).toBe(false);

		// Height rises 1 m per metre along x: a 45 degree slope.
		const ramp = new Float32Array(16);
		for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) ramp[j * 4 + i] = i;
		const slope = createCollider({ kind: 'heightfield', origin: [0, 0], size: [3, 3], cols: 4, rows: 4, heights: ramp });
		expect(slope.test(1.5, 1.6, 1.5, 0.2, c)).toBe(true);
		expect(c.nx).toBeCloseTo(-Math.SQRT1_2, 3);
		expect(c.ny).toBeCloseTo(Math.SQRT1_2, 3);
	});

	it('rotation matrix agrees with three.js Euler XYZ', () => {
		const [rx, ry, rz] = [0.3, -1.1, 2.2];
		const mine = rotationMatrix(rx, ry, rz);
		const e = new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz, 'XYZ')).elements;
		// three stores column-major.
		for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) expect(mine[row * 3 + col]).toBeCloseTo(e[col * 4 + row], 12);
	});
});

describe('ball-ball collisions', () => {
	const headOn = (m1: number, m2: number, e: number) => {
		const sim = new Simulation([]);
		sim.gravity = 0;
		sim.addBall(ball({ x: -0.19, vx: 4, mass: m1, restitution: e }));
		sim.addBall(ball({ x: 0.19, vx: -1, mass: m2, restitution: e }));
		return sim;
	};

	it('conserves momentum', () => {
		const sim = headOn(2, 5, 0.7);
		sim.tick(0.001);
		const s = sim.store;
		expect(2 * s.vx[0] + 5 * s.vx[1]).toBeCloseTo(2 * 4 + 5 * -1, 12);
	});

	it('elastic equal masses swap velocities', () => {
		const sim = headOn(1, 1, 1);
		sim.tick(0.001);
		expect(sim.store.vx[0]).toBeCloseTo(-1, 12);
		expect(sim.store.vx[1]).toBeCloseTo(4, 12);
	});

	it('separates at e times the approach speed, where e is the product of the two restitutions', () => {
		const sim = headOn(1, 3, 0.8);
		sim.tick(0.001);
		const s = sim.store;
		expect(s.vx[1] - s.vx[0]).toBeCloseTo(0.8 * 0.8 * 5, 12);
	});

	it('does not touch balls that are moving apart', () => {
		const sim = new Simulation([]);
		sim.gravity = 0;
		sim.addBall(ball({ x: -0.19, vx: -2 }));
		sim.addBall(ball({ x: 0.19, vx: 2 }));
		sim.tick(0.001);
		expect(sim.store.vx[0]).toBeCloseTo(-2, 12);
		expect(sim.store.vx[1]).toBeCloseTo(2, 12);
	});

	it('pushes overlapping balls apart', () => {
		const sim = new Simulation([]);
		sim.gravity = 0;
		sim.addBall(ball({ x: -0.1 }));
		sim.addBall(ball({ x: 0.1 }));
		for (let i = 0; i < 50; i++) sim.tick(0.001);
		expect(sim.store.px[1] - sim.store.px[0]).toBeGreaterThan(0.398);
	});
});

describe('friction', () => {
	const floor: ColliderSpec[] = [{ kind: 'plane', point: [0, 0, 0], normal: [0, 1, 0] }];

	it('slows a ball sliding on the floor at μ·g', () => {
		const sim = new Simulation(floor);
		sim.friction = 0.5;
		sim.addBall(ball({ y: 0.2, vx: 3 }));
		run(sim, 0.2, 300);
		expect(sim.store.vx[0]).toBeCloseTo(3 - 0.5 * GRAVITY * 0.2, 1);
	});

	it('brings a sliding ball to rest and never reverses it', () => {
		const sim = new Simulation(floor);
		sim.friction = 0.5;
		sim.addBall(ball({ y: 0.2, vx: 3 }));
		run(sim, 3, 300);
		expect(sim.store.vx[0]).toBeGreaterThanOrEqual(0);
		expect(sim.store.vx[0]).toBeLessThan(1e-6);
	});

	it('does nothing when μ is 0', () => {
		const sim = new Simulation(floor);
		sim.addBall(ball({ y: 0.2, vx: 3 }));
		run(sim, 1, 300);
		expect(sim.store.vx[0]).toBeCloseTo(3, 9);
	});

	const glancing = (friction: number) => {
		const sim = new Simulation([]);
		sim.gravity = 0;
		sim.friction = friction;
		// Ball 0 moves along +x and clips ball 1 off-centre, so the contact normal is tilted and there is sliding.
		sim.addBall(ball({ x: -0.19, y: 0.1, vx: 4, mass: 2 }));
		sim.addBall(ball({ x: 0.19, y: 0, vy: 1, mass: 3 }));
		sim.tick(0.001);
		return { sim };
	};

	it('conserves momentum and reduces the sliding speed between balls', () => {
		const slide = (sim: Simulation) => {
			const s = sim.store;
			const n = [s.px[0] - s.px[1], s.py[0] - s.py[1], s.pz[0] - s.pz[1]];
			const len = Math.hypot(...n);
			const r = [s.vx[0] - s.vx[1], s.vy[0] - s.vy[1], s.vz[0] - s.vz[1]];
			const rn = (r[0] * n[0] + r[1] * n[1] + r[2] * n[2]) / len ** 2;
			return Math.hypot(r[0] - rn * n[0], r[1] - rn * n[1], r[2] - rn * n[2]);
		};
		const free = glancing(0).sim;
		const rough = glancing(0.4).sim;
		expect(slide(rough)).toBeLessThan(slide(free));
		const momentum = (sim: Simulation) => [sim.store.vx, sim.store.vy, sim.store.vz].map((v) => 2 * v[0] + 3 * v[1]);
		momentum(rough).forEach((m, a) => expect(m).toBeCloseTo(momentum(free)[a], 9));
	});
});

describe('forces', () => {
	it('a directed force changes velocity by P·tau/m whatever the tick rate', () => {
		for (const rate of [30, 120, 300, 500]) {
			const sim = new Simulation([]);
			sim.gravity = 0;
			sim.addBall(ball({ mass: 2 }));
			sim.forces.pushDirected(0, [0, 3, 4], 100, 0.05);
			run(sim, 2, rate);
			const dv = (100 * 0.05) / 2;
			expect(sim.store.vy[0]).toBeCloseTo(dv * 0.6, 4);
			expect(sim.store.vz[0]).toBeCloseTo(dv * 0.8, 4);
			expect(sim.store.vx[0]).toBe(0);
		}
	});

	it('heavier balls speed up less', () => {
		const sim = new Simulation([]);
		sim.gravity = 0;
		sim.addBall(ball({ mass: 1 }));
		sim.addBall(ball({ z: 5, mass: 4 }));
		sim.forces.pushDirected(0, [1, 0, 0], 50, 0.1);
		sim.forces.pushDirected(1, [1, 0, 0], 50, 0.1);
		run(sim, 3, 300);
		expect(sim.store.vx[0]).toBeCloseTo(4 * sim.store.vx[1], 4);
	});

	it('forces fade out and are discarded', () => {
		const sim = new Simulation([]);
		sim.addBall(ball());
		sim.forces.pushDirected(0, [1, 0, 0], 10, 0.01);
		run(sim, 1, 300);
		expect(sim.forces.isEmpty).toBe(true);
	});

	it('a radial burst pushes outward with Δv = P·tau·(1 - d/R)/m and ignores balls outside the radius', () => {
		const sim = new Simulation([]);
		sim.gravity = 0;
		sim.addBall(ball({ x: 1, mass: 2 })); // d = 1 of R = 4
		sim.addBall(ball({ y: 3, mass: 2 })); // d = 3
		sim.addBall(ball({ z: 6, mass: 2 })); // outside
		sim.forces.addField([0, 0, 0], 4, 80, 1e-4, 0.5, 1);
		sim.tick(0.01); // far longer than tau, so the whole impulse lands in one tick
		const impulse = 80 * 1e-4;
		expect(sim.store.vx[0]).toBeCloseTo((impulse * 0.75) / 2, 9);
		expect(sim.store.vy[1]).toBeCloseTo((impulse * 0.25) / 2, 9);
		expect(sim.store.vz[2]).toBe(0);
	});

	it('negative power attracts', () => {
		const sim = new Simulation([]);
		sim.gravity = 0;
		sim.addBall(ball({ x: 2 }));
		sim.forces.addField([0, 0, 0], 4, -40, 1e-3, 0.5, 1);
		sim.tick(0.01);
		expect(sim.store.vx[0]).toBeLessThan(0);
	});

	// A heavy ball far from the field barely moves, so the pulses can be counted from its velocity.
	const pulsed = (rate: number, lifetime: number, pulseRate: number, seconds: number) => {
		const sim = new Simulation([]);
		sim.gravity = 0;
		sim.addBall(ball({ x: 1, mass: 1e9 }));
		sim.forces.addField([0, 0, 0], 4, 80, 0.02, lifetime, pulseRate);
		run(sim, seconds, rate);
		return sim;
	};

	it('a pulsed field gives each pulse P·tau·weight/m, whatever the tick rate', () => {
		for (const rate of [60, 300, 500]) {
			const sim = pulsed(rate, 2.2, 2, 4); // pulses at 0, 0.5, 1.0, 1.5, 2.0
			expect(sim.store.vx[0] * 1e9).toBeCloseTo(5 * 80 * 0.02 * 0.75, 3);
		}
	});

	it('a continuous field gives P·lifetime·weight/m and then stops', () => {
		for (const rate of [60, 300]) {
			const sim = pulsed(rate, 1.5, 0, 4);
			expect(sim.store.vx[0] * 1e9).toBeCloseTo(80 * 1.5 * 0.75, 3);
			expect(sim.forces.fields).toHaveLength(0);
		}
	});

	it('a field with lifetime 0 lasts until removed', () => {
		const sim = pulsed(300, 0, 1, 3);
		expect(sim.forces.fields).toHaveLength(1);
		sim.forces.removeField(sim.forces.fields[0].id);
		expect(sim.forces.fields).toHaveLength(0);
	});

	it('resetting or clearing balls leaves fields alone', () => {
		const sim = pulsed(300, 0, 1, 0.1);
		sim.resetAll();
		sim.clearBalls();
		expect(sim.forces.fields).toHaveLength(1);
	});
});

describe('ball store', () => {
	it('recycles the oldest balls once full', () => {
		const store = new BallStore(3);
		for (let i = 0; i < 3; i++) store.add(ball({ x: i }));
		expect(store.add(ball({ x: 10 }))).toBe(0);
		expect(store.add(ball({ x: 11 }))).toBe(1);
		expect(store.count).toBe(3);
		expect([store.px[0], store.px[1], store.px[2]]).toEqual([10, 11, 2]);
	});

	it('keeps the selection on the same ball when another is removed', () => {
		const store = new BallStore(4);
		for (let i = 0; i < 4; i++) store.add(ball({ x: i }));
		store.selected = 3;
		store.remove(0);
		expect(store.selected).toBe(0);
		expect(store.px[0]).toBe(3);
	});

	it('simulation drops forces for removed balls and follows moved ones', () => {
		const sim = new Simulation([]);
		sim.gravity = 0;
		sim.addBall(ball({ x: 0 }));
		sim.addBall(ball({ x: 5 }));
		sim.forces.pushDirected(1, [1, 0, 0], 10, 0.1);
		sim.removeBall(0); // ball 1 moves into slot 0
		run(sim, 2, 300);
		expect(sim.store.count).toBe(1);
		expect(sim.store.vx[0]).toBeGreaterThan(0);
	});
});

describe('spatial hash', () => {
	it('finds exactly the overlapping pairs a brute-force search finds', () => {
		let seed = 12345;
		const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
		const store = new BallStore(2000);
		for (let i = 0; i < 2000; i++) {
			store.add(ball({ x: rng() * 20 - 10, y: rng() * 10, z: rng() * 20 - 10, radius: 0.1 + rng() * 0.5 }));
		}
		const grid = new BallGrid();
		grid.findPairs(store);
		const found = new Set<string>();
		for (let k = 0; k < grid.pairCount; k++) found.add(`${grid.pairA[k]},${grid.pairB[k]}`);

		const expected = new Set<string>();
		for (let i = 0; i < store.count; i++) {
			for (let j = i + 1; j < store.count; j++) {
				const d = Math.hypot(store.px[i] - store.px[j], store.py[i] - store.py[j], store.pz[i] - store.pz[j]);
				if (d <= store.radius[i] + store.radius[j]) expected.add(`${i},${j}`);
			}
		}
		expect(expected.size).toBeGreaterThan(50);
		expect(found.size).toBe(grid.pairCount); // no pair reported twice
		expect(found).toEqual(expected);
	});
});

describe('spatial hash capacity', () => {
	it('keeps every pair when there are more than the initial 4096', () => {
		let seed = 99;
		const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
		const store = new BallStore(3000);
		// A dense clump: far more overlapping pairs than balls.
		for (let i = 0; i < 3000; i++) store.add(ball({ x: rng() * 3, y: rng() * 3, z: rng() * 3, radius: 0.2 }));
		const grid = new BallGrid();
		grid.findPairs(store);

		let expected = 0;
		for (let i = 0; i < store.count; i++)
			for (let j = i + 1; j < store.count; j++)
				if (Math.hypot(store.px[i] - store.px[j], store.py[i] - store.py[j], store.pz[i] - store.pz[j]) <= 0.4) expected++;
		expect(expected).toBeGreaterThan(4096);
		expect(grid.pairCount).toBe(expected);
	});
});

describe('advance', () => {
	it('runs one tick per 1/tickRate of real time and carries the remainder', () => {
		const sim = new Simulation([]);
		sim.tickRate = 100;
		sim.running = true;
		sim.addBall(ball());
		expect(sim.advance(0.025)).toBe(2);
		expect(sim.advance(0.005)).toBe(1); // 5 ms left over + 5 ms = one 10 ms tick
	});

	it('does nothing while paused', () => {
		const sim = new Simulation([]);
		sim.addBall(ball());
		expect(sim.advance(1)).toBe(0);
	});

	it('gives up on catching up when over budget instead of freezing', () => {
		const sim = new Simulation([]);
		sim.tickRate = 500;
		sim.running = true;
		let clock = 0;
		const ticks = sim.advance(0.2, 10, () => (clock += 4));
		expect(ticks).toBeLessThan(10);
		expect(sim.advance(0, 10, () => 0)).toBe(0);
	});
});

describe('spawn patterns', () => {
	it('places the requested number of balls without overlaps', () => {
		for (const pattern of ['grid', 'cloud'] as const) {
			const offsets = patternOffsets(pattern, 200, 0.2);
			expect(offsets).toHaveLength(200);
			let minGap = Infinity;
			for (let i = 0; i < offsets.length; i++)
				for (let j = i + 1; j < offsets.length; j++)
					minGap = Math.min(minGap, Math.hypot(offsets[i][0] - offsets[j][0], offsets[i][1] - offsets[j][1], offsets[i][2] - offsets[j][2]));
			expect(minGap).toBeGreaterThan(0.4);
		}
	});

	it('randomFill fills the box without overlaps, and stops when the box is full', () => {
		const region = { center: [0, 10, 0] as [number, number, number], size: [10, 10, 10] as [number, number, number], velocity: { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] } };
		const balls = randomFill(5000, region);
		expect(balls).toHaveLength(5000);
		for (const b of balls) {
			expect(Math.abs(b.x)).toBeLessThanOrEqual(5);
			expect(Math.abs(b.y - 10)).toBeLessThanOrEqual(5);
		}
		const thin = randomFill(5000, { ...region, size: [10, 10, 0.5] });
		expect(thin.length).toBeGreaterThan(0);
		expect(thin.length).toBeLessThan(5000);
	});
});

describe('random batches', () => {
	it('randomTemplate stays inside the ranges, including the capped radius', () => {
		for (let i = 0; i < 200; i++) {
			const t = randomTemplate();
			expect(t.mass).toBeGreaterThanOrEqual(RANDOM_RANGES.mass[0]);
			expect(t.mass).toBeLessThanOrEqual(RANDOM_RANGES.mass[1]);
			expect(t.restitution).toBeGreaterThanOrEqual(RANDOM_RANGES.restitution[0]);
			expect(t.restitution).toBeLessThanOrEqual(RANDOM_RANGES.restitution[1]);
			expect(t.radius).toBeGreaterThanOrEqual(RANDOM_RANGES.radius[0]);
			expect(t.radius).toBeLessThanOrEqual(RANDOM_RANGES.radius[1]);
			for (const v of [t.vx, t.vy, t.vz]) expect(Math.abs(v)).toBeLessThanOrEqual(RANDOM_RANGES.velocity[1]);
		}
	});

	it('a random batch varies per ball and starts without overlaps', () => {
		for (const pattern of ['grid', 'cloud'] as const) {
			const balls = spawnPattern(pattern, 150, [0, 0, 0], [0, 1, 0], DEFAULT_TEMPLATE, Math.random, true);
			expect(new Set(balls.map((b) => b.mass)).size).toBeGreaterThan(100);
			for (let i = 0; i < balls.length; i++)
				for (let j = i + 1; j < balls.length; j++) {
					const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y, balls[i].z - balls[j].z);
					expect(d).toBeGreaterThan(balls[i].radius + balls[j].radius);
				}
		}
	});

	it('a plain batch uses the given properties for every ball', () => {
		const template = { radius: 0.3, mass: 2, restitution: 0.4, vx: 1, vy: 2, vz: 3 };
		const balls = spawnPattern('grid', 20, [0, 0, 0], [0, 1, 0], template);
		for (const b of balls) expect(b).toMatchObject(template);
	});
});

describe('picking', () => {
	it('raySphere returns the entry distance, and Infinity for a miss or a sphere behind the ray', () => {
		expect(raySphere([0, 0, 0], [0, 0, 1], 0, 0, 10, 1)).toBeCloseTo(9, 12);
		expect(raySphere([0, 0, 0], [0, 0, 1], 5, 0, 10, 1)).toBe(Infinity);
		expect(raySphere([0, 0, 0], [0, 0, 1], 0, 0, -10, 1)).toBe(Infinity);
	});

	it('picks the nearer of overlapping targets and the field handle only near its centre', () => {
		const sim = new Simulation([]);
		sim.addBall(ball({ z: 10 }));
		sim.addBall(ball({ z: 5 }));
		const hit = pickBall(sim.store, [0, 0, 0], [0, 0, 1]);
		expect(hit?.index).toBe(1);
		const id = sim.forces.addField([0, 0, 7], 6, 10, 0.05, 0, 1);
		expect(pickField(sim.forces.fields, [0, 0, 0], [0, 0, 1])?.index).toBe(id);
		// A ray through the field's reach but not its dot does not select it.
		expect(pickField(sim.forces.fields, [2, 0, 0], [0, 0, 1])).toBeNull();
	});
});
