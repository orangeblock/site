import type { BallStore } from './ball-store';
import { MAX_RADIUS, REST_SPEED } from './constants';
import { createCollider, type Collider, type ColliderSpec, type Contact } from './colliders';

const CELL = 2;

/**
 * Tests every ball against the world's static colliders.
 *
 * Testing each ball against each collider would cost balls × colliders per tick, which is too much for a
 * pegboard with a hundred pegs. Instead the space is cut into a coarse grid and every cell lists the colliders
 * that could reach a ball centred inside it. A ball then only tests the few colliders in its own cell, plus the
 * infinite ones (planes) that appear in every cell.
 */
export class StaticColliders {
	private readonly infinite: Collider[] = [];
	private readonly cells: Collider[][] = [];
	private readonly min: [number, number, number] = [0, 0, 0];
	private readonly dims: [number, number, number] = [0, 0, 0];
	private readonly contact: Contact = { nx: 0, ny: 0, nz: 0, depth: 0 };

	constructor(specs: ColliderSpec[]) {
		const finite: Collider[] = [];
		for (const spec of specs) {
			const collider = createCollider(spec);
			(collider.bounds ? finite : this.infinite).push(collider);
		}
		if (finite.length === 0) return;

		// Bounds of the whole world, padded so a ball centre up to MAX_RADIUS away from a collider is still inside the grid.
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		for (const c of finite) {
			for (let a = 0; a < 3; a++) {
				lo[a] = Math.min(lo[a], c.bounds![a] - MAX_RADIUS);
				hi[a] = Math.max(hi[a], c.bounds![a + 3] + MAX_RADIUS);
			}
		}
		for (let a = 0; a < 3; a++) {
			this.min[a] = lo[a];
			this.dims[a] = Math.max(1, Math.ceil((hi[a] - lo[a]) / CELL));
		}

		const [nx, ny, nz] = this.dims;
		for (let i = 0; i < nx * ny * nz; i++) this.cells.push([]);
		for (const c of finite) {
			const b = c.bounds!;
			const [x0, y0, z0] = this.cellCoords(b[0] - MAX_RADIUS, b[1] - MAX_RADIUS, b[2] - MAX_RADIUS);
			const [x1, y1, z1] = this.cellCoords(b[3] + MAX_RADIUS, b[4] + MAX_RADIUS, b[5] + MAX_RADIUS);
			for (let z = z0; z <= z1; z++)
				for (let y = y0; y <= y1; y++)
					for (let x = x0; x <= x1; x++) this.cells[x + nx * (y + ny * z)].push(c);
		}
	}

	private cellCoords(x: number, y: number, z: number): [number, number, number] {
		const clamp = (v: number, a: number) => Math.max(0, Math.min(this.dims[a] - 1, Math.floor((v - this.min[a]) / CELL)));
		return [clamp(x, 0), clamp(y, 1), clamp(z, 2)];
	}

	/** Pushes balls out of the geometry and reflects the part of their velocity that points into it. */
	resolve(store: BallStore, friction = 0): void {
		const [nx, ny, nz] = this.dims;
		const { px, py, pz } = store;

		for (let i = 0; i < store.count; i++) {
			this.resolveAgainst(this.infinite, store, i, friction);
			if (this.cells.length === 0) continue;

			const inside =
				px[i] >= this.min[0] && px[i] < this.min[0] + nx * CELL &&
				py[i] >= this.min[1] && py[i] < this.min[1] + ny * CELL &&
				pz[i] >= this.min[2] && pz[i] < this.min[2] + nz * CELL;
			if (!inside) continue;
			const [cx, cy, cz] = this.cellCoords(px[i], py[i], pz[i]);
			this.resolveAgainst(this.cells[cx + nx * (cy + ny * cz)], store, i, friction);
		}
	}

	private resolveAgainst(colliders: Collider[], store: BallStore, i: number, friction: number): void {
		const { px, py, pz, vx, vy, vz, radius, restitution } = store;
		const contact = this.contact;

		for (const collider of colliders) {
			if (!collider.test(px[i], py[i], pz[i], radius[i], contact)) continue;

			// Move the ball back out along the surface normal.
			px[i] += contact.nx * contact.depth;
			py[i] += contact.ny * contact.depth;
			pz[i] += contact.nz * contact.depth;

			// Reflect the velocity component that points into the surface and scale it by the restitution.
			const vn = vx[i] * contact.nx + vy[i] * contact.ny + vz[i] * contact.nz;
			if (vn < 0) {
				// Friction removes sliding speed, at most μ times the speed the normal reaction takes away,
				// and never more than the ball has. Work out the sliding part before the reflection changes v.
				const tx = vx[i] - vn * contact.nx;
				const ty = vy[i] - vn * contact.ny;
				const tz = vz[i] - vn * contact.nz;
				const slide = Math.hypot(tx, ty, tz);

				const e = -vn < REST_SPEED ? 0 : restitution[i];
				vx[i] -= (1 + e) * vn * contact.nx;
				vy[i] -= (1 + e) * vn * contact.ny;
				vz[i] -= (1 + e) * vn * contact.nz;

				if (friction > 0 && slide > 1e-9) {
					const k = Math.min(friction * (1 + e) * -vn, slide) / slide;
					vx[i] -= k * tx;
					vy[i] -= k * ty;
					vz[i] -= k * tz;
				}
			}
		}
	}
}
