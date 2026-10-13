import { BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { SceneControls } from './types';

export function mount(canvas: HTMLCanvasElement): SceneControls {
	const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

	const scene = new Scene();
	const camera = new PerspectiveCamera(40, 1, 0.1, 100);
	camera.position.set(0, 1.2, 4);
	camera.lookAt(0, 0, 0);

	const cube = new LineSegments(new EdgesGeometry(new BoxGeometry(1.2, 1.2, 1.2)), new LineBasicMaterial({ color: 0xe0a458 }));
	scene.add(cube);

	function resize() {
		const { clientWidth, clientHeight } = canvas;
		renderer.setSize(clientWidth, clientHeight, false);
		camera.aspect = clientWidth / clientHeight;
		camera.updateProjectionMatrix();
		renderer.render(scene, camera);
	}
	new ResizeObserver(resize).observe(canvas);

	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	function frame(time: number) {
		cube.rotation.y = time / 4000;
		cube.rotation.x = time / 9000;
		renderer.render(scene, camera);
	}

	return {
		start() {
			if (reducedMotion) {
				frame(2000);
				return;
			}
			renderer.setAnimationLoop(frame);
		},
		stop() {
			renderer.setAnimationLoop(null);
		},
	};
}
