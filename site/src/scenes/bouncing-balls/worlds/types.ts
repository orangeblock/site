import type { ColliderSpec, Vec3 } from '../physics/colliders';
import type { FillRegion } from '../physics/spawn';

/**
 * A world is plain data: the static geometry the balls bounce off, where the first ball starts, and where
 * the camera starts. To add a world, create a file that exports one of these and list it in `index.ts`.
 */
export interface World {
	id: string;
	label: string;
	colliders: ColliderSpec[];
	/** Extra colliders the Walls checkbox switches on and off. Worlds without any hide the checkbox. */
	walls?: ColliderSpec[];
	/** Where the first ball is placed. */
	spawn: Vec3;
	/** Where Randomize puts its balls. */
	fill: FillRegion;
	camera: { position: Vec3; target: Vec3 };
}
