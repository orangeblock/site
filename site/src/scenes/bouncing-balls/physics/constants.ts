/** Standard gravity in m/s². The world is in metres: a ball of radius 0.2 is 40 cm across. */
export const GRAVITY = 9.81;

/** Hard capacity of the ball arrays on the CPU engine. When full, the oldest balls are recycled. */
export const MAX_BALLS = 20_000;

/** Capacity of the GPU engine's buffers. */
export const GPU_MAX_BALLS = 262_144;

/** Physics ticks per second until the panel changes it. */
export const DEFAULT_TICK_RATE = 120;

/** Largest ball radius the UI allows. The static-collider broad phase pads its cells by this. */
export const MAX_RADIUS = 2;

/** Impacts slower than this (m/s) lose all their bounce, so resting balls settle instead of buzzing. */
export const REST_SPEED = 0.5;

/** Overlap tolerated before position correction starts, and the fraction of the rest corrected per tick. */
export const PENETRATION_SLOP = 0.001;
export const PENETRATION_CORRECTION = 0.8;

/** A force is dropped once its remaining impulse is below e^-14 (about 1e-6) of the total. Measured in time constants. */
export const FORCE_LIFETIME = 14;
