import { hills } from './hills';
import { pegboard } from './pegboard';
import { room } from './room';
import type { World } from './types';

/** Worlds in the order the picker lists them. The first one is loaded at start. */
export const worlds: World[] = [room, hills, pegboard];
export type { World } from './types';
