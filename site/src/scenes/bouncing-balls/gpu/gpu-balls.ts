import { Color } from 'three';
import { clamp, color, instanceIndex, length, mix, positionLocal, select, uniform, vertexStage } from 'three/tsl';
import { Mesh, MeshStandardNodeMaterial, type Node, SphereGeometry } from 'three/webgpu';
import type { BallStore } from '../physics/ball-store';
import { FAST_SPEED, palette } from '../render/palette';
import type { BallMesh } from '../render/view';
import type { GpuSimulation } from './gpu-simulation';

/**
 * The GPU engine's balls: one mesh drawn once per ball, with a node material that reads each ball's position,
 * radius and velocity straight from the simulation's storage buffers. Nothing per ball passes through the CPU.
 */
export class GpuBalls implements BallMesh {
	readonly object: Mesh;
	private readonly uSelected = uniform(-1, 'int');
	private readonly uBySpeed = uniform(1);

	constructor(private readonly sim: GpuSimulation) {
		const material = new MeshStandardNodeMaterial({ roughness: 0.5 });
		const position = sim.pos.toAttribute();
		const radius = sim.props.toAttribute().x;
		material.positionNode = positionLocal.mul(radius).add(position.xyz);

		// The same colours as `CpuBalls`: slow → medium → fast by speed, or one colour, and the selected ball highlighted.
		const t = clamp(length(sim.vel.toAttribute().xyz).div(FAST_SPEED), 0, 1);
		const bySpeed = select(
			t.lessThan(0.5),
			mix(color(palette.slow), color(palette.medium), t.mul(2)),
			mix(color(palette.medium), color(palette.fast), t.mul(2).sub(1)),
		);
		const plain = select(this.uBySpeed.greaterThan(0), bySpeed, color(new Color(palette.ball)));
		// Worked out per vertex: it is the same for the whole ball.
		material.colorNode = vertexStage(select(instanceIndex.toInt().equal(this.uSelected), color(new Color(palette.selected)), plain)) as Node<'vec3'>;

		this.object = new Mesh(new SphereGeometry(1, 12, 8), material);
		this.object.count = 0;
		// The balls are not where the geometry's bounding sphere says, so never cull them.
		this.object.frustumCulled = false;
	}

	get colourBySpeed(): boolean {
		return this.uBySpeed.value > 0;
	}

	set colourBySpeed(enabled: boolean) {
		this.uBySpeed.value = enabled ? 1 : 0;
	}

	sync(store: BallStore): void {
		this.sim.flush();
		this.object.count = store.count;
		this.uSelected.value = store.selected;
	}
}
