import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import type { RadialField } from '../physics/forces';
import { palette } from './palette';

const unitSphere = new SphereGeometry(1, 32, 16);
const pushColour = new Color(palette.ball);
const pullColour = new Color(palette.selected);

interface Marker {
	group: Group;
	shell: MeshBasicMaterial;
	wire: MeshBasicMaterial;
	dot: Mesh;
	dotMaterial: MeshBasicMaterial;
}

/**
 * Draws each force field as a translucent sphere (its reach) with a dot at its centre. Push fields are amber,
 * pull fields cyan. The sphere brightens on every pulse, so the rhythm of a pulsed field is visible, and it fades
 * out as the field's lifetime ends. A selected field has a white outline and a larger dot.
 */
export class FieldMarkers {
	readonly group = new Group();
	private readonly markers = new Map<number, Marker>();

	sync(fields: readonly RadialField[], selectedId: number): void {
		const live = new Set<number>();
		for (const f of fields) {
			live.add(f.id);
			let m = this.markers.get(f.id);
			if (!m) {
				m = this.create();
				this.markers.set(f.id, m);
				this.group.add(m.group);
			}
			this.update(m, f, f.id === selectedId);
		}
		for (const [id, m] of this.markers) {
			if (live.has(id)) continue;
			this.group.remove(m.group);
			m.shell.dispose();
			m.wire.dispose();
			m.dotMaterial.dispose();
			this.markers.delete(id);
		}
	}

	private create(): Marker {
		const make = (wireframe: boolean) => new MeshBasicMaterial({ transparent: true, depthWrite: false, wireframe, side: DoubleSide });
		const shell = make(false);
		const wire = make(true);
		const dotMaterial = new MeshBasicMaterial({ transparent: true });
		const dot = new Mesh(unitSphere, dotMaterial);
		const group = new Group();
		group.add(new Mesh(unitSphere, shell), new Mesh(unitSphere, wire), dot);
		return { group, shell, wire, dot, dotMaterial };
	}

	private update(m: Marker, f: RadialField, selected: boolean): void {
		const colour = f.power >= 0 ? pushColour : pullColour;
		for (const material of [m.shell, m.wire, m.dotMaterial]) material.color.copy(colour);
		if (selected) m.wire.color.set(0xffffff);

		// Brightest at the moment of a pulse, fading over a few time constants. A constant field glows steadily.
		let flash = 0.4;
		if (f.pulseRate > 0) {
			const sincePulse = (f.age * f.pulseRate - Math.floor(f.age * f.pulseRate)) / f.pulseRate;
			flash = f.lifetime > 0 && f.age >= f.lifetime ? 0 : Math.exp(-sincePulse / (3 * f.tau));
		}
		const fade = f.lifetime > 0 ? Math.min(Math.max((f.lifetime - f.age) / 0.5, 0), 1) : 1;

		m.group.position.set(f.cx, f.cy, f.cz);
		m.shell.opacity = (0.04 + 0.2 * flash) * fade;
		m.wire.opacity = (0.15 + 0.5 * flash) * fade;
		m.dotMaterial.opacity = Math.max(fade, 0.15);
		m.group.children[0].scale.setScalar(f.radius);
		m.group.children[1].scale.setScalar(f.radius);
		m.dot.scale.setScalar(selected ? 0.3 : 0.18);
	}
}
