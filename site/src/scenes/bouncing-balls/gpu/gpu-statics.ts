import { Fn, If, abs, clamp, dot, float, floor, instanceIndex, instancedArray, length, max, min, select, sqrt, uint, vec2, vec3, vec4 } from 'three/tsl';
import type { ComputeNode, StorageBufferNode, UniformNode } from 'three/webgpu';
import { HeightfieldCollider, rotationMatrix, type ColliderSpec } from '../physics/colliders';
import { REST_SPEED } from '../physics/constants';
import { STATIC_CELL, StaticColliders } from '../physics/static-colliders';
import { forRange } from './loop';

const KIND = { plane: 0, sphere: 1, box: 2, cylinder: 3, heightfield: 4 } as const;
/** vec4s per collider in the collider buffer. */
const STRIDE = 5;

/**
 * Packs the colliders into flat buffers:
 *  - colliders: 5 vec4 each. [0] = (kind, x, y, z) with the centre (or a point on a plane), [1] = the shape's
 *    size, [2..4] = the columns of its rotation matrix. A height-field uses [0..2] for its grid instead.
 *  - lists: the CPU's coarse grid (`StaticColliders`): the start of each cell's list (one more entry than there
 *    are cells), then the infinite colliders, then every cell's collider indices.
 *  - heights: every height-field's samples, one after another.
 */
function pack(specs: ColliderSpec[]) {
	const grid = new StaticColliders(specs);
	const colliders = new Float32Array(Math.max(specs.length, 1) * STRIDE * 4);
	const heights: number[] = [];

	specs.forEach((spec, k) => {
		const out = (slot: number, values: number[]) => colliders.set(values, (k * STRIDE + slot) * 4);
		const columns = (rotation: [number, number, number] = [0, 0, 0]) => {
			const R = rotationMatrix(...rotation);
			out(2, [R[0], R[3], R[6], 0]);
			out(3, [R[1], R[4], R[7], 0]);
			out(4, [R[2], R[5], R[8], 0]);
		};
		switch (spec.kind) {
			case 'plane': {
				const len = Math.hypot(...spec.normal);
				out(0, [KIND.plane, ...spec.point]);
				out(1, [spec.normal[0] / len, spec.normal[1] / len, spec.normal[2] / len, 0]);
				break;
			}
			case 'sphere':
				out(0, [KIND.sphere, ...spec.center]);
				out(1, [spec.radius, 0, 0, 0]);
				break;
			case 'box':
				out(0, [KIND.box, ...spec.center]);
				out(1, [spec.size[0] / 2, spec.size[1] / 2, spec.size[2] / 2, 0]);
				columns(spec.rotation);
				break;
			case 'cylinder':
				out(0, [KIND.cylinder, ...spec.center]);
				out(1, [spec.radius, spec.height / 2, 0, 0]);
				columns(spec.rotation);
				break;
			case 'heightfield': {
				const hf = grid.colliders[k] as HeightfieldCollider;
				out(0, [KIND.heightfield, spec.origin[0], spec.origin[1], heights.length]);
				out(1, [spec.size[0], spec.size[1], spec.cols, spec.rows]);
				out(2, [hf.dx, hf.dz, hf.reachFactor, 0]);
				for (let i = 0; i < spec.cols * spec.rows; i++) heights.push(spec.heights[i]);
				break;
			}
		}
	});

	const cellCount = grid.cells.length;
	const lists: number[] = new Array(cellCount + 1).fill(0);
	lists.push(...grid.infinite);
	for (let c = 0; c < cellCount; c++) {
		lists[c] = lists.length;
		lists.push(...grid.cells[c]);
	}
	lists[cellCount] = lists.length;
	return { grid, colliders, lists: new Uint32Array(lists), heights: new Float32Array(heights.length ? heights : [0]) };
}

/**
 * The compute kernel that resolves every ball against the static colliders: `StaticColliders.resolve` and the
 * collider tests in `colliders.ts`, in TSL. Each ball tests the infinite colliders, then the ones listed for
 * its coarse grid cell, one after another, as on the CPU. The world is baked into the kernel, so a new one is
 * built whenever the colliders change.
 */
export function buildStaticsKernel(
	specs: ColliderSpec[],
	pos: StorageBufferNode<'vec4'>,
	vel: StorageBufferNode<'vec4'>,
	props: StorageBufferNode<'vec4'>,
	uCount: UniformNode<'uint', number>,
	uFriction: UniformNode<'float', number>,
	capacity: number,
): ComputeNode {
	const { grid, colliders: colliderData, lists: listData, heights: heightData } = pack(specs);
	const colliders = instancedArray(colliderData, 'vec4');
	const lists = instancedArray(listData, 'uint');
	const heights = instancedArray(heightData, 'float');
	const cellCount = grid.cells.length;
	const [nx, ny, nz] = grid.dims;
	const [minX, minY, minZ] = grid.min;

	return Fn(() => {
		const i = instanceIndex;
		If(i.lessThan(uCount), () => {
			const p = pos.element(i).xyz.toVar();
			const v = vel.element(i).xyz.toVar();
			const r = props.element(i).x.toVar();
			const restitution = props.element(i).z.toVar();

			const resolve = (index: any) => {
				const base = index.mul(uint(STRIDE)).toVar();
				const c0 = colliders.element(base).toVar();
				const c1 = colliders.element(base.add(uint(1))).toVar();
				const col0 = colliders.element(base.add(uint(2))).xyz.toVar();
				const col1 = colliders.element(base.add(uint(3))).xyz.toVar();
				const col2 = colliders.element(base.add(uint(4))).xyz.toVar();
				const kind = c0.x;
				const centre = c0.yzw;
				// Contact normal (pointing out of the collider) and depth. A depth above 0 means the ball touches it.
				const n = vec3(0, 1, 0).toVar();
				const depth = float(0).toVar();
				const toWorld = (l: any) => col0.mul(l.x).add(col1.mul(l.y)).add(col2.mul(l.z));
				// Rᵀ·d: the inverse of a rotation is its transpose.
				const toLocal = (d: any) => vec3(dot(col0, d), dot(col1, d), dot(col2, d));
				const signOf = (x: any) => select(x.lessThan(0), float(-1), float(1));

				If(kind.equal(KIND.plane), () => {
					const distance = dot(p.sub(centre), c1.xyz).toVar();
					If(distance.lessThan(r), () => {
						n.assign(c1.xyz);
						depth.assign(r.sub(distance));
					});
				})
					.ElseIf(kind.equal(KIND.sphere), () => {
						const d = p.sub(centre).toVar();
						const dist = length(d).toVar();
						If(dist.lessThan(r.add(c1.x)), () => {
							n.assign(select(dist.greaterThan(0), d.div(dist), vec3(0, 1, 0)));
							depth.assign(r.add(c1.x).sub(dist));
						});
					})
					.ElseIf(kind.equal(KIND.box), () => {
						const l = toLocal(p.sub(centre)).toVar();
						const h = c1.xyz;
						// Closest point on the box to the ball's centre.
						const dl = l.sub(clamp(l, h.negate(), h)).toVar();
						const dist = length(dl).toVar();
						If(dist.greaterThan(0), () => {
							If(dist.lessThan(r), () => {
								n.assign(toWorld(dl.div(dist)));
								depth.assign(r.sub(dist));
							});
						}).Else(() => {
							// The centre is inside the box: leave through the nearest face.
							const g = h.sub(abs(l)).toVar();
							If(g.x.lessThanEqual(g.y).and(g.x.lessThanEqual(g.z)), () => {
								n.assign(col0.mul(signOf(l.x)));
								depth.assign(r.add(g.x));
							})
								.ElseIf(g.y.lessThanEqual(g.z), () => {
									n.assign(col1.mul(signOf(l.y)));
									depth.assign(r.add(g.y));
								})
								.Else(() => {
									n.assign(col2.mul(signOf(l.z)));
									depth.assign(r.add(g.z));
								});
						});
					})
					.ElseIf(kind.equal(KIND.cylinder), () => {
						const l = toLocal(p.sub(centre)).toVar();
						const radius = c1.x;
						const half = c1.y;
						const radial = length(vec2(l.x, l.z)).toVar();
						const dr = radial.sub(min(radial, radius)).toVar();
						const dy = l.y.sub(clamp(l.y, half.negate(), half)).toVar();
						const dist = sqrt(dr.mul(dr).add(dy.mul(dy))).toVar();
						// Unit vector from the axis towards the ball, in the cylinder's own axes.
						const rx = select(radial.greaterThan(0), l.x.div(max(radial, 1e-12)), float(1)).toVar();
						const rz = select(radial.greaterThan(0), l.z.div(max(radial, 1e-12)), float(0)).toVar();
						If(dist.greaterThan(0), () => {
							If(dist.lessThan(r), () => {
								n.assign(toWorld(vec3(dr.div(dist).mul(rx), dy.div(dist), dr.div(dist).mul(rz))));
								depth.assign(r.sub(dist));
							});
						}).Else(() => {
							// The centre is inside: leave through the side or the nearest cap.
							const toSide = radius.sub(radial).toVar();
							const toCap = half.sub(abs(l.y)).toVar();
							If(toSide.lessThanEqual(toCap), () => {
								n.assign(toWorld(vec3(rx, 0, rz)));
								depth.assign(r.add(toSide));
							}).Else(() => {
								n.assign(col1.mul(signOf(l.y)));
								depth.assign(r.add(toCap));
							});
						});
					})
					.ElseIf(kind.equal(KIND.heightfield), () => {
						// [0] = (kind, origin x, origin z, first sample), [1] = (size x, size z, cols, rows), [2] = (dx, dz, reach factor).
						const ox = c0.y;
						const oz = c0.z;
						const first = c0.w;
						const cols = c1.z;
						const rows = c1.w;
						const cell = colliders.element(base.add(uint(2))).toVar();
						const dx = cell.x;
						const dz = cell.y;
						// Bilinear interpolation between the four surrounding samples, as in `HeightfieldCollider.height`.
						const heightAt = (x: any, z: any) => {
							const u = clamp(x.sub(ox).div(dx), 0, cols.sub(1.0001)).toVar();
							const w = clamp(z.sub(oz).div(dz), 0, rows.sub(1.0001)).toVar();
							const iu = floor(u);
							const iw = floor(w);
							const fu = u.sub(iu).toVar();
							const fw = w.sub(iw).toVar();
							const row0 = first.add(iw.mul(cols)).add(iu).toUint().toVar();
							const row1 = row0.add(cols.toUint()).toVar();
							const top = heights.element(row0).mul(float(1).sub(fu)).add(heights.element(row0.add(uint(1))).mul(fu));
							const bottom = heights.element(row1).mul(float(1).sub(fu)).add(heights.element(row1.add(uint(1))).mul(fu));
							return top.mul(float(1).sub(fw)).add(bottom.mul(fw));
						};
						const inside = p.x.greaterThanEqual(ox).and(p.z.greaterThanEqual(oz)).and(p.x.lessThanEqual(ox.add(c1.x))).and(p.z.lessThanEqual(oz.add(c1.y)));
						If(inside, () => {
							const above = p.y.sub(heightAt(p.x, p.z)).toVar();
							If(above.lessThanEqual(r.mul(cell.z)), () => {
								// Surface normal from central differences of the height.
								const e = max(dx, dz).toVar();
								const slopeX = heightAt(p.x.add(e), p.z).sub(heightAt(p.x.sub(e), p.z)).div(e.mul(2)).toVar();
								const slopeZ = heightAt(p.x, p.z.add(e)).sub(heightAt(p.x, p.z.sub(e))).div(e.mul(2)).toVar();
								const normal = vec3(slopeX.negate(), 1, slopeZ.negate()).div(sqrt(slopeX.mul(slopeX).add(slopeZ.mul(slopeZ)).add(1))).toVar();
								// Distance from the ball's centre to the surface, measured along the normal.
								const distance = above.mul(normal.y).toVar();
								If(distance.lessThan(r), () => {
									n.assign(normal);
									depth.assign(r.sub(distance));
								});
							});
						});
					});

				// Move the ball back out, reflect the velocity component that points into the surface, and apply friction.
				If(depth.greaterThan(0), () => {
					p.addAssign(n.mul(depth));
					const vn = dot(v, n).toVar();
					If(vn.lessThan(0), () => {
						const t = v.sub(n.mul(vn)).toVar();
						const slide = length(t).toVar();
						const e = select(vn.negate().lessThan(REST_SPEED), float(0), restitution).toVar();
						v.subAssign(n.mul(e.add(1).mul(vn)));
						If(uFriction.greaterThan(0).and(slide.greaterThan(1e-9)), () => {
							v.subAssign(t.mul(min(uFriction.mul(e.add(1)).mul(vn.negate()), slide).div(slide)));
						});
					});
				});
			};

			const resolveList = (start: any, end: any) => {
				forRange(start, end, 'uint', 'k', (k) => resolve(lists.element(k)));
			};

			resolveList(uint(cellCount + 1), uint(cellCount + 1 + grid.infinite.length));
			if (cellCount > 0) {
				const local = p.sub(vec3(minX, minY, minZ)).div(STATIC_CELL).toVar();
				const inside = local.x.greaterThanEqual(0).and(local.y.greaterThanEqual(0)).and(local.z.greaterThanEqual(0))
					.and(local.x.lessThan(nx)).and(local.y.lessThan(ny)).and(local.z.lessThan(nz));
				If(inside, () => {
					const cell = floor(local.x).add(floor(local.y).mul(nx)).add(floor(local.z).mul(nx * ny)).toUint().toVar();
					resolveList(lists.element(cell), lists.element(cell.add(uint(1))));
				});
			}

			pos.element(i).assign(vec4(p, 0));
			vel.element(i).assign(vec4(v, 0));
		});
	})().compute(capacity);
}
