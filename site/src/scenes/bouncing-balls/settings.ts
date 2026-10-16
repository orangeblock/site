import { DEFAULT_TEMPLATE, type BallTemplate, type Pattern } from './physics/spawn';

/** Values the panel edits and the tools read. */
export interface Settings {
	/** Force (N) when a ball is pulled back to full length. Also the force of a field. */
	power: number;
	/** Time constant (s) of a force, or of each field pulse: it fades as e^(-t/duration). */
	duration: number;
	/** Reach (m) of a force field. */
	fieldRadius: number;
	/** Seconds a field lasts. 0 keeps it until it is removed. */
	fieldLifetime: number;
	/** Pulses per second. 0 is one constant force. */
	pulseRate: number;
	pattern: Pattern;
	count: number;
	/** Distance (m) from the camera at which balls and fields are placed, unless a surface is nearer. */
	placeDistance: number;
	/** Keep adding balls while the pointer is held down in Add mode. */
	emit: boolean;
	/** Balls per second while emitting. */
	emitRate: number;
	/** Properties of the balls Add mode creates. */
	batch: BallTemplate;
	/** Give every new ball random properties instead of `batch`. */
	randomise: boolean;
}

export const defaultSettings: Settings = {
	power: 100,
	duration: 0.05,
	fieldRadius: 3,
	fieldLifetime: 5,
	pulseRate: 2,
	pattern: 'single',
	count: 100,
	placeDistance: 15,
	emit: false,
	emitRate: 30,
	batch: { ...DEFAULT_TEMPLATE },
	randomise: false,
};
