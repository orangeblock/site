# bouncing-balls

A ball physics sandbox: thousands of spheres, forces, collisions and a few worlds, drawn with three.js. It is written to be read in order.

## Reading order

| Folder / file | What it shows |
| --- | --- |
| `physics/ball-store.ts` | Ball state as parallel typed arrays, and why |
| `physics/forces.ts` | A decaying force integrated exactly, so the tick rate does not matter |
| `physics/engine.ts` | What the app needs from a physics engine, CPU or GPU |
| `physics/simulation.ts` | The CPU engine: the fixed-timestep loop and the integration step |
| `physics/ball-grid.ts` | Spatial hash: finding touching pairs without comparing every pair |
| `physics/ball-collision.ts` | The impulse for a ball-ball collision |
| `physics/colliders.ts`, `static-colliders.ts` | Static shapes as data, and a coarse grid so each ball tests only nearby ones |
| `worlds/` | A world is a data module; add one to add a scene |
| `render/view.ts` | three.js: `WebGPURenderer`, scene, lights, camera |
| `render/cpu-balls.ts` | One `InstancedMesh` for every ball, filled from the CPU engine each frame |
| `gpu/gpu-simulation.ts` | The GPU engine: the same physics as TSL compute kernels on storage buffers |
| `gpu/gpu-statics.ts` | The static colliders and their coarse grid, packed into buffers and tested in a kernel |
| `gpu/gpu-balls.ts` | A mesh whose material reads the GPU engine's buffers directly |
| `render/collider-meshes.ts` | Building meshes (including a height-field) from collider specs |
| `render/camera-rig.ts` | `OrbitControls` and a first-person fly camera sharing one camera |
| `interaction/` | Ray picking, and the pull-back aim gesture |
| `ui/` | The control panel, plain DOM |
| `app.ts` | Wires it together and runs the frame loop |
| `index.ts` | Asks which engine to run, then starts the app |

`physics/` never imports three.js or touches the DOM. It can be run and tested on its own. `gpu/` is the GPU engine and needs WebGPU; it has no automated tests.

## Commands

From `site/`:

```
npm test              # physics tests (vitest)
npx astro dev         # the page is at /projects/bouncing-balls/
```

## Design notes

- Units are metres and seconds. Gravity is 9.81 m/s².
- The scene first asks for an engine: CPU or GPU. The GPU button is disabled when the browser has no WebGPU adapter. The engine cannot be changed without reloading.
- The panel's Physics Hz sets the tick rate (120 by default). The timestep is always `1 / tickRate`, however fast frames are drawn. If the CPU engine cannot compute its ticks within 10 ms of a frame, or the GPU engine needs more than 1/30 s of ticks in a frame, the simulation slows down instead of freezing the page.
- Ball capacity is `MAX_BALLS` (20,000) on the CPU and `GPU_MAX_BALLS` (262,144) on the GPU, both in `physics/constants.ts`. When full, the oldest balls are recycled.
- The GPU engine resolves all ball-ball contacts of a pass from one snapshot (2 passes a tick), where the CPU resolves pairs one after another, so piles settle slightly differently. It sends at most 256 directed forces and 256 fields to the GPU per tick.
- What changed from the original C++ app and why: `docs/bouncing-balls-port.md`. Where this could go next: `docs/bouncing-balls-gpu.md`, `docs/bouncing-balls-meshes.md`.
