import type { SceneControls } from '../types';
import { App, type EngineKind } from './app';
import { View } from './render/view';
import { GPU_MAX_BALLS, MAX_BALLS } from './physics/constants';
import { button, el } from './ui/dom';
import './ui/panel.css';

/** Why the GPU engine cannot run here, or null when it can. */
async function gpuUnavailable(): Promise<string | null> {
	if (!('gpu' in navigator)) return 'This browser has no WebGPU.';
	try {
		return (await navigator.gpu.requestAdapter()) ? null : 'WebGPU found no usable graphics adapter.';
	} catch {
		return 'WebGPU failed to start.';
	}
}

/**
 * Entry point used by `<Scene name="bouncing-balls" panel />`: `canvas` is the drawing surface and `panel`
 * an empty element below it for the controls. Everything else is created here, so none of it (including
 * three.js) is downloaded until the Play button is pressed.
 *
 * The scene first asks which engine to run. The choice holds until the page is reloaded.
 */
export function mount(canvas: HTMLCanvasElement, panel: HTMLElement): SceneControls {
	let app: App | null = null;
	let started = false;
	// One renderer for the canvas, kept if the GPU engine fails, so the CPU engine can still use it.
	const view = new View(canvas);

	const choose = async (kind: EngineKind) => {
		choice.remove();
		try {
			app = await App.create(view, panel, kind);
		} catch (error) {
			// Back to the choice, with the GPU engine ruled out.
			gpu.disabled = true;
			note.textContent = error instanceof Error ? error.message : String(error);
			panel.replaceChildren(choice);
			return;
		}
		if (started) app.start();
	};
	const cpu = button(`CPU: up to ${MAX_BALLS.toLocaleString('en')} balls`, () => choose('cpu'));
	const gpu = button(`GPU: up to ${GPU_MAX_BALLS.toLocaleString('en')} balls`, () => choose('gpu'));
	gpu.disabled = true;
	const note = el('p', { class: 'bb-hint' }, 'Checking for WebGPU…');
	const choice = el('div', { class: 'bb-choice' }, el('p', {}, 'Run the physics on'), cpu, gpu, note);
	panel.replaceChildren(choice);

	gpuUnavailable().then((reason) => {
		gpu.disabled = reason !== null;
		gpu.title = reason ?? '';
		note.textContent = reason ?? 'The GPU engine needs WebGPU.';
	});

	return {
		start: () => {
			started = true;
			app?.start();
		},
		stop: () => {
			started = false;
			app?.stop();
		},
	};
}
