# Before D-050 (commit de2f0e1): frames sent thirty times a second whatever the page does

Measured 2026-11-25T22:14:31.885Z against http://127.0.0.1:3298 with scripts/trail.mjs. 4 × Intel(R) Xeon(R) Processor @ 2.30GHz; Node v22.23.5; renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver).
View: 1366×768, ?q=low&pr=0.4, First Light seed 7, 50 people. The slowing is Chromium's CPU throttling of the page (not of the worker).
A software rasterizer is itself a slow page; these numbers describe this machine, not a device.

| Page slowed | Speed | Played | Timer late | World lived at | Picture ran on after pause | "Paused" shown after |
|---|---|---|---|---|---|---|
| 1× | 4× | 20 s | 707 ms | 8 ticks/s | 6 ticks | 465 ms |
| 1× | 64× | 20 s | 755 ms | 127.9 ticks/s | 84 ticks | 363 ms |
| 1× | 64× | 40 s | 746 ms | 123.1 ticks/s | 55 ticks | 449 ms |
| 4× | 64× | 20 s | 1026 ms | 123.6 ticks/s | 169 ticks | 661 ms |
| 10× | 64× | 20 s | 751 ms | 119.6 ticks/s | 98 ticks | 1169 ms |
| 20× | 4× | 20 s | 894 ms | 8 ticks/s | 8 ticks | 1071 ms |
| 20× | 64× | 20 s | 26924 ms | 125.4 ticks/s | 3359 ticks | 38924 ms |
| 20× | 64× | 40 s | 16892 ms | 119.9 ticks/s | 2079 ticks | 30873 ms |
