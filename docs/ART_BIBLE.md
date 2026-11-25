# Art bible

Version 1 (phase 04, first art pass). Phase 11 extends this document with the full rubric, the institution
artifacts and the sound direction. Everything here describes what the product draws from live simulation
state; nothing in the repository is a painted mock-up.

## The idea

**A museum diorama that is alive.** The island sits on a walnut plinth as a cut-away slab: you can see the
strata under the turf and the depth of the sea at its rim, the way a natural-history model shows you a
cross-section. A tilt-shift lens keeps one band sharp, so the world reads as something small, precious and
physically present on a table in a dark room. The observer is a visitor leaning over a model, not a ruler
looking at a map — which is also the truth of the game: you can change the weather, never a mind.

Three consequences follow, and they are the rules for every later asset:

1. **Object, not level.** The world has an edge, a base and a room around it. Nothing fades into fog.
2. **Made of matter.** Soil, rock, water, wood, fibre. No icons floating in the scene, no glowing outlines on
   resources. State is shown by the thing itself changing: a tree is gone, a bush has no berries, a path is worn.
3. **Small people, legible deeds.** Citizens are a few pixels tall at the vista and must still be countable;
   close up, what each one is doing must be recognisable without a label.

## Palette

Scene colours are authored in sRGB and converted to linear in shaders; tonemapping is ACES.

| Role | Colour | Where |
|---|---|---|
| Room | `#0c1512` top → `#22352c` horizon; night `#04070d` → `#111d33` | backdrop dome |
| Table | `#2b3a31` near → `#0b130f` far, dimmed with the room light | floor under the plinth |
| Plinth | `#2a2019` | base |
| Meadow turf | `#7e9d4c` | seasonal tint moves it toward `#b09b50` (autumn) and `#928f70` (winter) |
| Forest floor | `#48693a` | |
| Scrub | `#a59a58` | |
| Wetland | `#587646` | |
| Highland turf | `#7f8a5c`; rock `#a39a88` / `#5b564e`; snow `#eef2f4` | rock only where steep or high |
| Shore sand | `#d6c292` | |
| Soil and worn path | `#7a5c3c`, `#b59a6c` | slab sides, traffic tint |
| Sea | `#7fd6cf` shallow → `#2f9aa3` → `#0f4f63` deep; foam `#f2fbf8` | by distance from shore |
| Canopy by season | `#5c8f3f` spring, `#3a7232` summer, `#c47a2c` autumn, `#6f6b52` winter | plus per-tree hue jitter |
| Conifer by season | `#35633d`, `#285235`, `#31593a`, `#2f4f44` | |
| Sun | `#fff1dc` day, `#ffb066` golden hour | |
| Ember (the one warm accent) | `#eba94f` | fire, the play button, selection ring |

Interface tokens live in `src/app/globals.css`: forest glass `rgba(14, 24, 19, 0.72)` over the scene for
transient controls; parchment `#f5ecd8` sheets for reading; ink `#0b130f`–`#2a4535`; text on paper `#2a2318`;
one accent (ember). Chart series are fixed and validated with the palette checker — treated `#bf6a1d`,
control `#1b84a8` on parchment.

Warm/cool contrast is the lighting key: warm sun, cool shade and cool night, with fire as the only warm light
after dark.

## Scale and camera

- One tile is one world unit. Height scale 10.5 units over the terrain range; sea depth 3.4.
- Citizens are drawn at 1.25–1.55× the scale of the trees (it varies with each citizen's physique) so that
  fifty of them can be counted at the vista.
- Default framing: orbit distance 1.95 × island size, 0.92 rad from vertical (about 53°), the slab in the
  lower two thirds so the title can sit in the dark upper third.
- Orbit, pan, zoom, pinch and two-finger twist; `focus` and `follow` ease, never cut. Keyboard: arrows/WASD,
  Q/E, +/−.
- Tilt-shift blur strength grows as the camera approaches; the sharp band tracks the orbit target.

## Geometry language

- Terrain: Catmull-Rom surface through tile centres at 4× subdivision, crags on steep highland, a sea floor
  that falls away from the shore so shallows are luminous and the rim is deep.
- Flora: faceted, slightly irregular lumps — three broadleaf silhouettes (round, tall, wide), a three-tier
  conifer, low bushes with separate berries, reeds, root rosettes, grass tufts. Flat shading on purpose: the
  facets are the "carved model" signature.
- Citizens: eight instanced parts (body, head, hair, two arms, two legs, carried load); posed per action.
- Structures: timber and stone primitives with visible stock (sacks at a store, sprouts on a plot).

Every count on screen is a count in the engine: trees thin out as wood stock falls, berries vanish one by one,
piles appear where goods were dropped, worn tiles are those actually walked.

## Animation

Interpolation runs between simulation ticks and never feeds back. Walk (leg swing, bob), gather (bend and
reach), carry (load on the back), eat/drink (hand to mouth), rest/sleep (seated, lying), build/work (hammer
swing), speak (a short bubble). Foliage and grass sway with weather. Reduced motion slows time-driven motion
to 35% and wind to 25%, disables auto-orbit and the selection pulse, and makes camera moves snap instead of
ease.

## Light

The sun and moon follow the simulation clock and season (day length changes through the year). Shadows from
the sun on medium/high. Night is deliberately readable: a cool moon at 1.25, raised ambient and +0.38 exposure,
so that the board stays legible while fires dominate. Rain and snow are particle sheets with overcast grading.

## Typography and icons

Fraunces (variable, soft optical style) for names, headings and the clock; Inter for everything else; tabular
figures wherever numbers change. Both are bundled (`@fontsource-variable/*`), no network font requests.
Icons are Lucide line icons, always paired with a text label or an accessible name, never colour-coded alone.

## Quality presets

| Preset | What changes | Measured budget (First Light, `scripts/shots.mjs`) |
|---|---|---|
| High | 4× terrain mesh, full canopies, sun shadows 2048², bloom, tilt-shift, 4× MSAA, pixel ratio ≤ 2 | 1,081k triangles per frame incl. the shadow pass, 58 draw calls (seed 1) |
| Medium | as high without bloom, shadows 1024², 2× MSAA, pixel ratio ≤ 1.5 | 1,054k triangles, 45 draw calls (seed 1) |
| Low | 2× terrain mesh, simplified canopies/bushes/rocks, no shadows or post chain, cheaper terrain and water shaders, pixel ratio ≤ 1 | 256k triangles, 30 draw calls (seed 1); was 550k before the rebuild |

The table was measured before the ecology was retuned (D-014). The reference island now carries about one and
a half times as many trees, bushes and reeds; re-measured figures are in `evidence/phase-05/render-budget.txt`.

All presets lower their internal resolution in 20% steps (to 60% at most) when frames stay above 42 ms for
three seconds. Presets and resolution change drawing only; the simulation cannot observe them.

## Screenshot-led critique log

Each pass was: capture from the running product → look at the image → name what is wrong → change code →
recapture. Images for the final state are in `evidence/phase-04/shots/`.

| Pass | Seen in the capture | Change |
|---|---|---|
| 1 | Sea read as a shallow pool with a blue frame; mountains were smooth white domes; slab washed out; framing cropped the plinth; lime "bubble" trees; figures too small to count; streams were dashed diagonals | — |
| 2 | (after) Sea floor by shore distance, relief curve and crags, ambient occlusion, darker strata and plinth with a pool of table light, larger citizens and trees, camera pulled back | Rock still everywhere on slopes; canopies identical; stream edges jagged |
| 3 | (after) Rock only where steep or high; three canopy shapes with hue variety; stream edges from a mask contour; gentler foam; denser, quieter grass; less blur | Night nearly black; table floor glowed at night |
| 4 | (after) Moon and night ambient raised, night exposure, water lit by the same ambient, table dims with the room | Title attract-mode captured at night with rain |
| 5 | (after) Attract mode starts on an early-summer morning and runs slowly; phone timebar gets its own clock row so all six speeds fit; coach mark moves out of the sheet's way; low preset rebuilt at half the triangles | Listed under "Known weaknesses" |

## First rubric scores (self-assessed from the captures, S02 scale 0–4)

| Criterion | Score | Basis |
|---|---|---|
| Terrain and vegetation detail | 3 | `vista.jpg`, `closeup.jpg`: strata, shallows, crags, three canopy forms; streams are still flat ribbons |
| Citizen animation | 2 | Poses per action exist and follow state; silhouettes are simple and gathering figures intersect the bush |
| Lighting and materials | 3 | `dusk.jpg`, `night.jpg`: sun/moon cycle, shadows, readable night |
| Camera and composition | 3 | Default framing leaves title space; follow and focus ease |
| State readability | 2 | Depletion and piles visible; no path wear overlay toggle, no knowledge or network overlays yet (phase 12) |
| Layout and typography | 3 | `e2e/desktop/*`, `e2e/mobile/*` |
| Mobile interaction | 2 | Verified in 390×844 emulation with taps only; no physical device |
| Visual originality | 3 | Cut-away slab on a plinth with tilt-shift; all assets procedural |
| Performance | 1 | Only software-rendered numbers exist (below); no GPU or device measurement |
| Accessibility | 2 | Keyboard-only path tested; reduced motion; table view for charts; no screen-reader audit yet |

Nothing scores 4: that level requires verification on real hardware and with people, which has not happened.

## Performance, as measured

Headless Chromium here renders WebGL on the CPU (SwiftShader). Median interval between frames reaching the
screen: low preset 310–370 ms at 1366×768 (about 3 per second; it was 510–600 ms before the triangle count was
halved); high preset 1.28 s at 1366×768 and 1.8–1.9 s at 1920×1080. These numbers say nothing about a device
with a GPU; they are recorded so that nobody mistakes them for one. The 60 fps desktop / 30 fps phone targets
are **unverified**.

## Known weaknesses carried to phase 11

- Citizens stand inside the bush or tree they are harvesting; they should stand beside it and face it.
- Streams are flat ribbons without banks; ponds lack shoreline detail.
- Citizens need more character: clothing variation, tools in hand, a visible carried load by item type.
- No ambient life (birds, fish rises, smoke drift), no sound.
- Path wear exists as a ground tint but is subtle; trails should become clearly visible where traffic is heavy.
- Structures are placeholders for the grammar of built form that institutions will need (phase 09/11).

## Sources and licensing

All geometry, shaders and textures are generated by code in `src/render/`. Fonts: Fraunces and Inter (SIL Open
Font License 1.1) via `@fontsource-variable`. Icons: Lucide (ISC). three.js (MIT). No images, models, audio or
third-party art are bundled.
