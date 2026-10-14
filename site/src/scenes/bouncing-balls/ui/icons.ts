/**
 * Inline SVG icons for the tool strip, drawn on a 24 × 24 grid with the current text colour. Only constant
 * markup defined here is ever inserted as HTML.
 */
const svg = (inner: string) =>
	`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const icons = {
	/** Mouse pointer. */
	select: svg('<path d="M5 3v16l4.2-4 3.3 6.3 2.4-1.2-3.2-6.2h5.8z"/>'),
	/** Cube. */
	objects: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
	/** Force waves spreading out from a point in the corner. */
	forces: svg('<circle cx="5" cy="19" r="1.8"/><path d="M12 19A7 7 0 0 0 5 12M17 19A12 12 0 0 0 5 7M22 19A17 17 0 0 0 5 2"/>'),
	/** Cog. */
	world: svg(
		'<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" stroke-width="2.6" stroke-linecap="butt"/>',
	),
};
