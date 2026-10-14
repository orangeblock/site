export interface SceneControls {
	start(): void;
	stop(): void;
}

export interface SceneModule {
	/** `panel` is an empty element below the canvas, present only when the page asks for one with the `panel` prop. */
	mount(canvas: HTMLCanvasElement, panel: HTMLElement): SceneControls;
}
