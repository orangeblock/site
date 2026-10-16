import { Loop } from 'three/tsl';

/**
 * `for (name = start; name < end; name++) body(name)` in TSL. Nested loops need distinct names, and the
 * three.js type definitions do not know Loop's `name` option yet.
 */
export function forRange(start: unknown, end: unknown, type: 'int' | 'uint', name: string, body: (index: any) => void): void {
	Loop({ start, end, type, condition: '<', name } as any, (inputs: any) => body(inputs[name]));
}
