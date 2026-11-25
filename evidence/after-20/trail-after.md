# After D-050: a frame is sent only when the page has taken the last one

Measured 2026-11-25T22:21:01.449Z against http://127.0.0.1:3299 with scripts/trail.mjs. 4 × Intel(R) Xeon(R) Processor @ 2.30GHz; Node v22.23.5; renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver).
View: 1366×768, ?q=low&pr=0.4, First Light seed 7, 50 people. The slowing is Chromium's CPU throttling of the page (not of the worker).
A software rasterizer is itself a slow page; these numbers describe this machine, not a device.

| Page slowed | Speed | Played | Timer late | World lived at | Picture ran on after pause | "Paused" shown after |
|---|---|---|---|---|---|---|
| 1× | 4× | 20 s | 458 ms | 8 ticks/s | 5 ticks | 335 ms |
| 1× | 64× | 20 s | 568 ms | 127.8 ticks/s | 109 ticks | 369 ms |
| 1× | 64× | 40 s | 315 ms | 126.7 ticks/s | 47 ticks | 311 ms |
| 4× | 64× | 20 s | 937 ms | 128 ticks/s | 131 ticks | 484 ms |
| 10× | 64× | 20 s | 1123 ms | 126 ticks/s | 148 ticks | 639 ms |
| 20× | 4× | 20 s | 871 ms | 8 ticks/s | 7 ticks | 474 ms |
| 20× | 64× | 20 s | 1172 ms | 117.9 ticks/s | 111 ticks | 736 ms |
| 20× | 64× | 40 s | 1056 ms | 118.1 ticks/s | 247 ticks | 899 ms |
