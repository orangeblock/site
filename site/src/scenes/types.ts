export interface SceneControls {
	start(): void;
	stop(): void;
}

export interface SceneModule {
	mount(canvas: HTMLCanvasElement): SceneControls;
}
