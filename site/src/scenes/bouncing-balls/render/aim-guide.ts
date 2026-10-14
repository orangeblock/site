import { ArrowHelper, BufferGeometry, Group, Line, LineBasicMaterial, Vector3 } from 'three';

/**
 * The visual feedback while pulling back on a ball: a rubber-band line from the ball to the pointer and an
 * arrow showing where the ball will go. The arrow grows and brightens with power.
 */
export class AimGuide {
	readonly group = new Group();
	private readonly band = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]), new LineBasicMaterial({ color: 0x8a8378 }));
	private readonly arrow = new ArrowHelper(new Vector3(0, 1, 0), new Vector3(), 1, 0xe0a458, 0.4, 0.25);

	constructor() {
		this.group.add(this.band, this.arrow);
		this.group.visible = false;
		this.band.frustumCulled = false;
	}

	/** `ball` is where the ball is, `pull` the point the pointer has dragged to, `power` runs from 0 to 1. */
	show(ball: Vector3, pull: Vector3, direction: Vector3, power: number): void {
		this.band.geometry.setFromPoints([ball, pull]);
		this.arrow.position.copy(ball);
		this.arrow.setDirection(direction);
		this.arrow.setLength(0.5 + power * 4, 0.4 + power * 0.4, 0.25 + power * 0.2);
		this.arrow.setColor(power < 0.5 ? 0xe0a458 : 0xfff4e0);
		this.group.visible = true;
	}

	hide(): void {
		this.group.visible = false;
	}
}
