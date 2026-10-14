import type { SceneControls } from '../types';
import { App } from './app';

/**
 * Entry point used by `<Scene name="bouncing-balls" panel />`: `canvas` is the drawing surface and `panel`
 * an empty element below it for the controls. Everything else is created here, so none of it (including
 * three.js) is downloaded until the Play button is pressed.
 */
export function mount(canvas: HTMLCanvasElement, panel: HTMLElement): SceneControls {
	const app = new App(canvas, panel);
	return {
		start: () => app.start(),
		stop: () => app.stop(),
	};
}
