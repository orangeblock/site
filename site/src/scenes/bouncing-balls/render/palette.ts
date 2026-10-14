import { Color } from 'three';

/**
 * Colours for the scene. `Color` converts these sRGB hex values to the linear space three.js lights in,
 * so anything written straight into a buffer (like the per-ball colours) uses the Color's r/g/b.
 */
export const palette = {
	background: 0x14171f,
	ground: 0x40444f,
	grid: 0x4a4e5a,
	wall: 0x38405a,
	obstacle: 0x7a8399,
	glass: 0xaab4d0,
	ball: 0xe0a458,
	selected: 0x5fd3e0,
	/** Speed ramp: at rest, moving, fast. */
	slow: new Color(0x5a6a8a),
	medium: new Color(0xe0a458),
	fast: new Color(0xfff4e0),
};

/** Speed in m/s at which a ball is drawn at the fast end of the ramp. */
export const FAST_SPEED = 12;
