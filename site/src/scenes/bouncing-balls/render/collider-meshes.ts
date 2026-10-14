import {
	BoxGeometry,
	BufferGeometry,
	CylinderGeometry,
	Float32BufferAttribute,
	GridHelper,
	Group,
	Mesh,
	MeshStandardMaterial,
	PlaneGeometry,
	SphereGeometry,
	Uint32BufferAttribute,
	Vector3,
	type Material,
} from 'three';
import type { ColliderSpec, Look } from '../physics/colliders';
import { palette } from './palette';

const materials: Record<Exclude<Look, 'hidden'>, Material> = {
	ground: new MeshStandardMaterial({ color: palette.ground, roughness: 1 }),
	wall: new MeshStandardMaterial({ color: palette.wall, roughness: 1 }),
	obstacle: new MeshStandardMaterial({ color: palette.obstacle, roughness: 0.6 }),
	glass: new MeshStandardMaterial({ color: palette.glass, transparent: true, opacity: 0.08, depthWrite: false }),
};

/**
 * Draws a list of collider specs. Each spec is built from the same numbers the physics uses, so what you
 * see is what the balls hit. Meshes marked `userData.noPick` are skipped when clicks are ray-cast into the world.
 */
export function buildColliderMeshes(specs: ColliderSpec[]): Group {
	const group = new Group();

	for (const spec of specs) {
		const look = spec.look ?? 'obstacle';
		if (look === 'hidden') continue;
		const material = materials[look];

		let object: Mesh | Group;
		switch (spec.kind) {
			case 'plane': {
				// PlaneGeometry faces +Z, so rotate it to face the collider's normal.
				const mesh = new Mesh(new PlaneGeometry(400, 400), material);
				mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...spec.normal).normalize());
				mesh.position.set(...spec.point);
				object = mesh;
				if (look === 'ground' && spec.normal[1] > 0.99) {
					// A grid on the floor gives the eye something to judge height and speed against.
					const grid = new GridHelper(400, 200, palette.grid, palette.grid);
					grid.position.set(spec.point[0], spec.point[1] + 0.01, spec.point[2]);
					grid.userData.noPick = true;
					group.add(grid);
				}
				break;
			}
			case 'sphere':
				object = new Mesh(new SphereGeometry(spec.radius, 24, 16), material);
				object.position.set(...spec.center);
				break;
			case 'box':
				object = new Mesh(new BoxGeometry(...spec.size), material);
				object.position.set(...spec.center);
				object.rotation.set(...(spec.rotation ?? [0, 0, 0]));
				break;
			case 'cylinder':
				object = new Mesh(new CylinderGeometry(spec.radius, spec.radius, spec.height, 16), material);
				object.position.set(...spec.center);
				object.rotation.set(...(spec.rotation ?? [0, 0, 0]));
				break;
			case 'heightfield':
				object = new Mesh(heightfieldGeometry(spec), material);
				break;
		}
		if (look === 'glass') object.userData.noPick = true;
		group.add(object);
	}
	return group;
}

/** A grid of vertices at the sampled heights, two triangles per cell. */
function heightfieldGeometry(spec: Extract<ColliderSpec, { kind: 'heightfield' }>): BufferGeometry {
	const { cols, rows, origin, size, heights } = spec;
	const positions = new Float32Array(cols * rows * 3);
	for (let j = 0; j < rows; j++) {
		for (let i = 0; i < cols; i++) {
			const v = (j * cols + i) * 3;
			positions[v] = origin[0] + (i * size[0]) / (cols - 1);
			positions[v + 1] = heights[j * cols + i];
			positions[v + 2] = origin[1] + (j * size[1]) / (rows - 1);
		}
	}
	const indices: number[] = [];
	for (let j = 0; j < rows - 1; j++) {
		for (let i = 0; i < cols - 1; i++) {
			const a = j * cols + i;
			const b = a + 1;
			const c = a + cols;
			const d = c + 1;
			// Counter-clockwise seen from above, so the front face points up.
			indices.push(a, c, b, b, c, d);
		}
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
	geometry.setIndex(new Uint32BufferAttribute(indices, 1));
	geometry.computeVertexNormals();
	return geometry;
}
