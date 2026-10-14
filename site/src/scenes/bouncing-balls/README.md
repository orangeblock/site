# bouncing-balls

A ball physics sandbox: thousands of spheres, forces, collisions and a few worlds, drawn with three.js. It is written to be read in order.

## Reading order

| Folder / file | What it shows |
| --- | --- |
| `physics/ball-store.ts` | Ball state as parallel typed arrays, and why |
| `physics/forces.ts` | A decaying force integrated exactly, so the tick rate does not matter |
| `physics/simulation.ts` | The fixed-timestep loop and the integration step |
| `physics/ball-grid.ts` | Spatial hash: finding touching pairs without comparing every pair |
| `physics/ball-collision.ts` | The impulse for a ball-ball collision |
| `physics/colliders.ts`, `static-colliders.ts` | Static shapes as data, and a coarse grid so each ball tests only nearby ones |
| `worlds/` | A world is a data module; add one to add a scene |
| `render/view.ts` | three.js: renderer, scene, lights, and one `InstancedMesh` for every ball |
| `render/collider-meshes.ts` | Building meshes (including a height-field) from collider specs |
| `render/camera-rig.ts` | `OrbitControls` and a first-person fly camera sharing one camera |
| `interaction/` | Ray picking, and the pull-back aim gesture |
| `ui/` | The control panel, plain DOM |
| `app.ts` | Wires it together and runs the frame loop |

`physics/` never imports three.js or touches the DOM. It can be run and tested on its own.

## Commands

From `site/`:

```
npm test              # physics tests (vitest)
npx astro dev         # the page is at /projects/bouncing-balls/
```

## Design notes

- Units are metres and seconds. Gravity is 9.81 m/s².
- The panel's Physics Hz sets the tick rate. The timestep is always `1 / tickRate`, however fast frames are drawn. If ticks cannot be computed within 10 ms of a frame, the simulation slows down instead of freezing the page.
- Ball capacity is `MAX_BALLS` (`physics/constants.ts`). When full, the oldest balls are recycled.
- What changed from the original C++ app and why: `docs/bouncing-balls-port.md`. Where this could go next: `docs/bouncing-balls-gpu.md`, `docs/bouncing-balls-meshes.md`.
