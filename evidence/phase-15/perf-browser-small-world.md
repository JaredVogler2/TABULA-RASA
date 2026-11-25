Measured 2026-11-25T17:37:59.693Z · Chromium 158.0.8127.36 (headless) · Intel(R) Xeon(R) Processor @ 2.30GHz × 4 · 16 GB · renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)

**The 3D view was drawn 48 px wide on purpose, so that the renderer was idle: the frame, draw-call and triangle columns of this table mean nothing. It is here for the simulation's columns.**

**The 3D view was drawn by a software rasterizer: frame times here are NOT a measurement of any device with a graphics chip. Simulation figures do not depend on a GPU.**

| View | Agents | Preset | Frame p50 / p95 (ms) | Draw calls | Triangles | Ticks/s at 64× (128 asked) | Tick p50 / p95 / max (ms) | Capacity (ticks/s) | Worker round trip idle / at 64× (ms) | Save as text (KB / ms) | Save packed (KB / ms) | Heap worker / page (MB) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop, world drawn 48 px wide 1366x768@1 | 50 | low | 300 / 433.3 | 53 | 413840 | 128 | 0.6 / 2 / 15.1 | 1667 | 352.9 / 435 | 1637 / 473 | 322 / 439 | null / 45.2 |
| desktop, world drawn 48 px wide 1366x768@1 | 100 | low | 333.3 / 466.6 | 53 | 485744 | 110 | 1.6 / 4.9 / 22.7 | 625 | 1 / 597.1 | 3570 / 347 | 722 / 384 | null / 42.6 |
| phone, world drawn 48 px wide 390x844@3 | 50 | low | 283.4 / 366.5 | 53 | 413840 | 121 | 0.4 / 1.5 / 14.7 | 2500 | 0.6 / 302.6 | 1661 / 340 | 321 / 332 | null / 37.8 |
| phone, world drawn 48 px wide 390x844@3 | 100 | low | 333.3 / 433.3 | 53 | 485744 | 117 | 1.7 / 5.1 / 21.4 | 588 | 3.3 / 569.1 | 3579 / 493 | 723 / 506 | null / 35.6 |
