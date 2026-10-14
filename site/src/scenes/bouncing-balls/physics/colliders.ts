/**
 * Static geometry the balls bounce off. A collider is described by plain data (`ColliderSpec`) so the
 * physics and the renderer can both be built from the same description, and a world is just a list of them.
 *
 * Each shape only has to answer one question: "is a ball of radius r centred here touching me, and if so,
 * which way is out and how deep is it?"
 */

export type Vec3 = [number, number, number];

/** How the renderer should draw a collider. The physics ignores it. */
export type Look = 'ground' | 'wall' | 'obstacle' | 'glass' | 'hidden';

export type ColliderSpec =
	/** Infinite half-space behind `point`, facing along `normal`. */
	| { kind: 'plane'; point: Vec3; normal: Vec3; look?: Look }
	| { kind: 'sphere'; center: Vec3; radius: number; look?: Look }
	/** `rotation` is Euler XYZ in radians, the same convention as three.js. */
	| { kind: 'box'; center: Vec3; size: Vec3; rotation?: Vec3; look?: Look }
	/** The cylinder's axis is its local Y axis. */
	| { kind: 'cylinder'; center: Vec3; radius: number; height: number; rotation?: Vec3; look?: Look }
	/**
	 * A grid of `cols` × `rows` heights (row-major, x varying fastest) spread over a rectangle that starts at
	 * `origin` (x, z) and is `size` (x, z) wide. Balls outside the rectangle do not touch it.
	 */
	| { kind: 'heightfield'; origin: [number, number]; size: [number, number]; cols: number; rows: number; heights: ArrayLike<number>; look?: Look };

export interface Contact {
	/** Unit normal pointing out of the collider, towards the ball. */
	nx: number;
	ny: number;
	nz: number;
	/** How far the ball has sunk into the collider. */
	depth: number;
}

export type Bounds = [minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number];

export interface Collider {
	/** Axis-aligned bounds, or null for shapes that extend forever. */
	readonly bounds: Bounds | null;
	/** Fills `out` and returns true when a ball of radius `r` at (x, y, z) overlaps the collider. */
	test(x: number, y: number, z: number, r: number, out: Contact): boolean;
}

/** Rotation matrix (row-major) for Euler angles in XYZ order, R = Rx·Ry·Rz, matching three.js. */
export function rotationMatrix(rx: number, ry: number, rz: number): number[] {
	const [sx, cx] = [Math.sin(rx), Math.cos(rx)];
	const [sy, cy] = [Math.sin(ry), Math.cos(ry)];
	const [sz, cz] = [Math.sin(rz), Math.cos(rz)];
	return [
		cy * cz, -cy * sz, sy,
		cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy,
		sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy,
	];
}

class PlaneCollider implements Collider {
	readonly bounds = null;
	private readonly nx: number;
	private readonly ny: number;
	private readonly nz: number;

	constructor(private readonly point: Vec3, normal: Vec3) {
		const len = Math.hypot(...normal);
		[this.nx, this.ny, this.nz] = [normal[0] / len, normal[1] / len, normal[2] / len];
	}

	test(x: number, y: number, z: number, r: number, out: Contact): boolean {
		const distance = (x - this.point[0]) * this.nx + (y - this.point[1]) * this.ny + (z - this.point[2]) * this.nz;
		if (distance >= r) return false;
		out.nx = this.nx;
		out.ny = this.ny;
		out.nz = this.nz;
		out.depth = r - distance;
		return true;
	}
}

class SphereCollider implements Collider {
	readonly bounds: Bounds;

	constructor(private readonly c: Vec3, private readonly radius: number) {
		this.bounds = [c[0] - radius, c[1] - radius, c[2] - radius, c[0] + radius, c[1] + radius, c[2] + radius];
	}

	test(x: number, y: number, z: number, r: number, out: Contact): boolean {
		const dx = x - this.c[0];
		const dy = y - this.c[1];
		const dz = z - this.c[2];
		const dist = Math.hypot(dx, dy, dz);
		if (dist >= r + this.radius) return false;
		if (dist === 0) {
			[out.nx, out.ny, out.nz] = [0, 1, 0];
		} else {
			[out.nx, out.ny, out.nz] = [dx / dist, dy / dist, dz / dist];
		}
		out.depth = r + this.radius - dist;
		return true;
	}
}

/** Shared by the shapes that can be rotated: converts world points into the shape's own axes and back. */
abstract class OrientedCollider implements Collider {
	abstract readonly bounds: Bounds;
	protected readonly R: number[];

	constructor(protected readonly c: Vec3, rotation: Vec3) {
		this.R = rotationMatrix(...rotation);
	}

	protected local(x: number, y: number, z: number): Vec3 {
		const { R, c } = this;
		const dx = x - c[0];
		const dy = y - c[1];
		const dz = z - c[2];
		// Rᵀ·d: the inverse of a rotation is its transpose.
		return [
			R[0] * dx + R[3] * dy + R[6] * dz,
			R[1] * dx + R[4] * dy + R[7] * dz,
			R[2] * dx + R[5] * dy + R[8] * dz,
		];
	}

	protected setNormal(out: Contact, lx: number, ly: number, lz: number): void {
		const { R } = this;
		out.nx = R[0] * lx + R[1] * ly + R[2] * lz;
		out.ny = R[3] * lx + R[4] * ly + R[5] * lz;
		out.nz = R[6] * lx + R[7] * ly + R[8] * lz;
	}

	abstract test(x: number, y: number, z: number, r: number, out: Contact): boolean;
}

class BoxCollider extends OrientedCollider {
	readonly bounds: Bounds;
	private readonly h: Vec3;

	constructor(center: Vec3, size: Vec3, rotation: Vec3) {
		super(center, rotation);
		this.h = [size[0] / 2, size[1] / 2, size[2] / 2];
		const { R, h } = this;
		const ex = Math.abs(R[0]) * h[0] + Math.abs(R[1]) * h[1] + Math.abs(R[2]) * h[2];
		const ey = Math.abs(R[3]) * h[0] + Math.abs(R[4]) * h[1] + Math.abs(R[5]) * h[2];
		const ez = Math.abs(R[6]) * h[0] + Math.abs(R[7]) * h[1] + Math.abs(R[8]) * h[2];
		this.bounds = [center[0] - ex, center[1] - ey, center[2] - ez, center[0] + ex, center[1] + ey, center[2] + ez];
	}

	test(x: number, y: number, z: number, r: number, out: Contact): boolean {
		const [lx, ly, lz] = this.local(x, y, z);
		const [hx, hy, hz] = this.h;
		// Closest point on the box to the ball's centre.
		const qx = Math.max(-hx, Math.min(hx, lx));
		const qy = Math.max(-hy, Math.min(hy, ly));
		const qz = Math.max(-hz, Math.min(hz, lz));
		const dx = lx - qx;
		const dy = ly - qy;
		const dz = lz - qz;
		const dist = Math.hypot(dx, dy, dz);

		if (dist > 0) {
			if (dist >= r) return false;
			this.setNormal(out, dx / dist, dy / dist, dz / dist);
			out.depth = r - dist;
			return true;
		}

		// The centre is inside the box: leave through the nearest face.
		const gx = hx - Math.abs(lx);
		const gy = hy - Math.abs(ly);
		const gz = hz - Math.abs(lz);
		if (gx <= gy && gx <= gz) {
			this.setNormal(out, Math.sign(lx) || 1, 0, 0);
			out.depth = r + gx;
		} else if (gy <= gz) {
			this.setNormal(out, 0, Math.sign(ly) || 1, 0);
			out.depth = r + gy;
		} else {
			this.setNormal(out, 0, 0, Math.sign(lz) || 1);
			out.depth = r + gz;
		}
		return true;
	}
}

class CylinderCollider extends OrientedCollider {
	readonly bounds: Bounds;
	private readonly halfHeight: number;

	constructor(center: Vec3, private readonly radius: number, height: number, rotation: Vec3) {
		super(center, rotation);
		this.halfHeight = height / 2;
		const { R } = this;
		const ext = (row: number) => Math.abs(R[row * 3 + 1]) * this.halfHeight + radius * Math.hypot(R[row * 3], R[row * 3 + 2]);
		const [ex, ey, ez] = [ext(0), ext(1), ext(2)];
		this.bounds = [center[0] - ex, center[1] - ey, center[2] - ez, center[0] + ex, center[1] + ey, center[2] + ez];
	}

	test(x: number, y: number, z: number, r: number, out: Contact): boolean {
		const [lx, ly, lz] = this.local(x, y, z);
		const radial = Math.hypot(lx, lz);
		const H = this.halfHeight;
		// Closest point on the solid cylinder: clamp the radial distance and the height independently.
		const qr = Math.min(radial, this.radius);
		const qy = Math.max(-H, Math.min(H, ly));
		const dr = radial - qr;
		const dy = ly - qy;
		const dist = Math.hypot(dr, dy);

		if (dist > 0) {
			if (dist >= r) return false;
			// Split the outward direction into its radial part (along lx, lz) and its axial part.
			const rx = radial > 0 ? lx / radial : 1;
			const rz = radial > 0 ? lz / radial : 0;
			this.setNormal(out, (dr / dist) * rx, dy / dist, (dr / dist) * rz);
			out.depth = r - dist;
			return true;
		}

		// The centre is inside: leave through the side or the nearest cap.
		const toSide = this.radius - radial;
		const toCap = H - Math.abs(ly);
		if (toSide <= toCap) {
			const rx = radial > 0 ? lx / radial : 1;
			const rz = radial > 0 ? lz / radial : 0;
			this.setNormal(out, rx, 0, rz);
			out.depth = r + toSide;
		} else {
			this.setNormal(out, 0, Math.sign(ly) || 1, 0);
			out.depth = r + toCap;
		}
		return true;
	}
}

class HeightfieldCollider implements Collider {
	readonly bounds: Bounds;
	private readonly dx: number;
	private readonly dz: number;
	/** How far above the surface a ball can be and still touch it, as a multiple of its radius (steeper slopes reach further). */
	private readonly reachFactor: number;

	constructor(
		private readonly origin: [number, number],
		private readonly size: [number, number],
		private readonly cols: number,
		private readonly rows: number,
		private readonly heights: ArrayLike<number>,
	) {
		this.dx = size[0] / (cols - 1);
		this.dz = size[1] / (rows - 1);

		let min = Infinity;
		let max = -Infinity;
		let maxSlope = 0;
		for (let j = 0; j < rows; j++) {
			for (let i = 0; i < cols; i++) {
				const h = heights[j * cols + i];
				min = Math.min(min, h);
				max = Math.max(max, h);
				const sx = i + 1 < cols ? (heights[j * cols + i + 1] - h) / this.dx : 0;
				const sz = j + 1 < rows ? (heights[(j + 1) * cols + i] - h) / this.dz : 0;
				maxSlope = Math.max(maxSlope, Math.hypot(sx, sz));
			}
		}
		this.reachFactor = Math.sqrt(1 + (maxSlope * 1.2) ** 2);
		this.bounds = [origin[0], min, origin[1], origin[0] + size[0], max, origin[1] + size[1]];
	}

	/** Bilinear interpolation between the four surrounding samples. */
	height(x: number, z: number): number {
		const u = Math.max(0, Math.min(this.cols - 1.0001, (x - this.origin[0]) / this.dx));
		const v = Math.max(0, Math.min(this.rows - 1.0001, (z - this.origin[1]) / this.dz));
		const i = Math.floor(u);
		const j = Math.floor(v);
		const fu = u - i;
		const fv = v - j;
		const h = this.heights;
		const row0 = j * this.cols + i;
		const row1 = row0 + this.cols;
		return (h[row0] * (1 - fu) + h[row0 + 1] * fu) * (1 - fv) + (h[row1] * (1 - fu) + h[row1 + 1] * fu) * fv;
	}

	test(x: number, y: number, z: number, r: number, out: Contact): boolean {
		if (x < this.origin[0] || z < this.origin[1] || x > this.origin[0] + this.size[0] || z > this.origin[1] + this.size[1]) return false;

		const above = y - this.height(x, z);
		if (above > r * this.reachFactor) return false;

		// Surface normal from central differences of the height, which stays smooth across grid cells.
		const e = Math.max(this.dx, this.dz);
		const slopeX = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
		const slopeZ = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
		const len = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ + 1);
		out.nx = -slopeX / len;
		out.ny = 1 / len;
		out.nz = -slopeZ / len;

		// Distance from the ball's centre to the surface, measured along the normal.
		const distance = above * out.ny;
		if (distance >= r) return false;
		out.depth = r - distance;
		return true;
	}
}

export function createCollider(spec: ColliderSpec): Collider {
	switch (spec.kind) {
		case 'plane':
			return new PlaneCollider(spec.point, spec.normal);
		case 'sphere':
			return new SphereCollider(spec.center, spec.radius);
		case 'box':
			return new BoxCollider(spec.center, spec.size, spec.rotation ?? [0, 0, 0]);
		case 'cylinder':
			return new CylinderCollider(spec.center, spec.radius, spec.height, spec.rotation ?? [0, 0, 0]);
		case 'heightfield':
			return new HeightfieldCollider(spec.origin, spec.size, spec.cols, spec.rows, spec.heights);
	}
}
