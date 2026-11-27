# Art bible

The island and its citizens are rendered from live simulation state. The phase 11 critique and measurements below are the baseline for the realism pass (D-053).

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
| Sea | `#7fd6cf` shallow → `#328ca2` → `#164b73` deep; foam `#f2fbf8` | by distance from shore |
| Fresh water | clear `#7fd6cf` over the gravel at the edge → `#175f5e` in mid-channel | streams streak along their fall; ponds lie still |
| Banks and beds | damp earth `#665539`, gravel `#56655a`, pebbles `#9c9684` | where the channel mask says water meets land |
| Cloth of agreements | `#b4533c` `#3f6a8c` `#c98a2b` `#5a7d4b` `#8c5a86` `#2f6e6a` `#c26d4a` `#6b7fb0` | one per institution: pennants, cords, the Charters panel, the atlas |
| A person hidden by scenery | ember `#f6c57e` at 13–33% | the faint shape of D-027 |
| Canopy by season | `#5c8f3f` spring, `#3a7232` summer, `#c47a2c` autumn, `#6f6b52` winter | plus per-tree hue jitter |
| Conifer by season | `#35633d`, `#285235`, `#31593a`, `#2f4f44` | |
| Sun | `#fff1dc` day, `#ffb066` golden hour | |
| Ember (the one warm accent) | `#eba94f` | fire, the play button, selection ring |

Interface tokens live in `src/app/globals.css`: forest glass `rgba(14, 24, 19, 0.8)` over the scene for
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
  conifer, low bushes with separate berries, reeds, root rosettes and grass tufts. Layered leaf colour and
  curved grass blades add detail at ground level while the crowns retain their carved silhouettes.
- Citizens: a fitted tunic with folds, belt and cuffs, trousers and boots, sculpted facial features,
  hair, and articulated arms with hands. Medium and High add finer faces and woven cloth. A straw hat
  is part of who a person is (three in ten, fixed by id). What they wear or carry for work reflects state:
  an **axe**, a **spear** or a **basket** is drawn only for someone who owns one — in the hand while it is
  being used, on the back otherwise — and what they carry is shaped by what it mostly is: logs, a rock, fish,
  or a sack in the colour of its contents, in the basket if they have one and in their arms if not.
- Structures: timber and stone primitives with visible stock (sacks at a store, sprouts on a plot). The
  shelter is a thatched A-frame: three overlapping courses a side, a dark ridge, crossed gable poles, an open
  front in shadow.
- Agreements (D-031): where an institution was ratified stands a post with a cap stone, one cord tied round
  it for each person who holds to it, up to ten, and a pennant in the institution's colour; the same pennant
  flies beside each store it governs. When the institution ends the post is left leaning, bare. A proposal draws
  nothing.

Every count on screen is a count in the engine: trees thin out as wood stock falls, berries vanish one by one,
piles appear where goods were dropped, cords on a post are members (the eleventh member and those after add no
cord: `src/render/structures.ts`), smoke rises only from fires that are lit,
fish rise only over waters that still hold fish, and worn ground is ground that was walked (a beaten track is
a tile past the engine's own threshold for easier going; D-032).

## Animation

Interpolation runs between simulation ticks. Walking includes knee flex, opposing arm swing and shorter
strides under load or illness. Follow brings a selected person closer. Gather (bend and
reach), fell (a slow raise and a quick strike), fish (poised, then a lunge), carry (arms round the load),
eat/drink (hand to mouth), rest/sleep (lying), build/work (hammer swing), speak (a gesture and a short bubble).

- **Beside, not inside.** Someone working on a thing stands next to it and faces it: at the edge of a tree's
  crown, beside the bush, at the wall of what they are building, at the water's edge to fish; each person
  from a side of their own, so two workers do not merge.
- **Facing each other.** Someone speaking or giving turns toward the person concerned.
- **Hands.** A load is set down for work that needs the hands and taken up again afterwards.
- **Ambient life.** Smoke rises and leans downwind from lit fires. Rings spread on fishing water in
  proportion to its stock. A few birds circle by day and leave the sky at dusk and in a storm; they are
  scenery and say nothing about state. Pennants flutter.

Foliage and grass sway with weather. Reduced motion slows time-driven motion to 35% and wind to 25%, removes
birds and fish rings, disables auto-orbit and the selection pulse, and makes camera moves snap instead of ease.

## Sound

Synthesized in the browser, silent until asked for (D-028); no audio file exists in the repository.

| Layer | Made from | Follows |
|---|---|---|
| Wind | band-passed noise with a wandering centre | weather; louder with the whole island in view |
| Surf | low-passed noise with a slow swell | how near the camera's focus is to the sea |
| Rain, thunder | high-passed noise; brown-noise bursts | rain and storm; thunder only in a storm |
| Birds | short swept sine notes, panned | daylight, less in rain and winter |
| Crickets | two pulsed high tones | night, warm seasons, not in rain |
| Fire | low roar and scheduled crackles | a lit fire near what the camera looks at |
| Pad | three detuned triangle voices on pentatonic clusters, brighter by day | time of day; pauses with the clock |
| Tones | three-partial bells | agreements ratified and ended, deaths, arrivals, buildings, seasons, your interventions |

The palette is deliberately plain — air, water, fire, a few birds, one soft instrument — for the same reason
the picture is: the island is the subject. **Nobody has listened to it** (this environment has no audio
output); the tests show only that signal is produced, follows the controls and stops when told.

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
| High | 4× terrain mesh, full canopies, sun shadows 2048², bloom, tilt-shift, 4× MSAA, pixel ratio ≤ 2 | 1.65 million triangles per frame incl. the shadow pass, 84 draw calls at the vista (seed 1, day 3) |
| Medium | as high without bloom, shadows 1024², 2× MSAA, pixel ratio ≤ 1.5 | 1.62 million triangles, 71 draw calls |
| Low | 2× terrain mesh, simplified canopies/bushes/rocks, no shadows or post chain, cheaper terrain and water shaders, pixel ratio ≤ 1 | 0.41 million triangles, 52 draw calls |

Measured after phase 11 (`evidence/phase-11/shots.txt`). In phase 04, before the ecology was retuned to carry
about one and a half times the flora (D-014), the phase-04 version of this table gave 1.08, 1.05 and 0.26
million triangles in 58, 45 and 30 calls for the same three presets (seed 1; the high preset's figure was stated
as including the shadow pass). No raw output for those figures was kept. The phase-04 measurement that is on
file, `evidence/phase-04/render-budget.txt`, counts the triangles of the scene's meshes without the shadow pass:
600,682, 575,258 and 249,190.

All presets lower their internal resolution when frames stay above 42 ms for three seconds: the pixel ratio
drops by 0.2 at a time and never below 0.6 (`adapt` in `src/render/WorldRenderer.ts`). From a ratio of 1 that is
two steps of 20%, down to 60%; from 2, the high preset's cap, it is seven steps, down to 30% of where it began.
Presets and resolution change drawing only; the simulation cannot observe them.

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

### Phase 11 passes

Captures of passes 6 to 9 are kept, reduced, in `evidence/phase-11/cycles/` (eight files, two for each pass);
the final state is in `evidence/phase-11/shots/`. Two captures the table speaks of were not kept: the first
charter capture of pass 9 (the only charter capture on file is the final `shots/charter.jpg`) and the dark
first knowledge view that pass 10 started from (`shots/knowledge.jpg` shows the pale wash that replaced it). The
phase-04 stills (`evidence/phase-04/shots/`) are the "before".

| Pass | Seen in the capture | Change made next |
|---|---|---|
| 6 | `1-closeup-…`, `1-midday-…`: fresh water was a milky, uniform pale blue over sand-coloured beds; clay banks were single slabs that overhung stream banks like floating discs; smoke stacked into a pale vertical bar; shelters read as flat tan planks from above. Hats, by contrast, made people findable across the island. | Fresh water coloured by depth over dark gravel, with damp earth on the banks and streaks along the current; clay as low lumps set into the ground; smoke puffs that wander, spread and lean downwind; the shelter rebuilt as a thatched A-frame with courses, ridge, gable poles and a dark open front. |
| 7 | `2-woodcutter-hidden.jpg`, `2-stream-stair-steps.jpg`: a woodcutter beside the trunk was invisible under the crown, a builder behind a shelter likewise; stream edges and mouths ended in the stair-steps of the water mesh; the lake was marbled by "current" streaks. The forager with a basket of berries, standing beside the bush, read exactly as intended. | Work stance moved to the crown's edge and toward the middle of the tile; one more ring of water samples beyond every bank so the visible edge is the mask's contour; ponds flagged as still water; pebbles on the banks; sleeves and a belt on the figures; a first version of the faint shape for hidden people. |
| 8 | `3-silhouette-smear.jpg`, `3-midday-loud-silhouettes.jpg`: the faint shapes worked for hidden people but also smeared over visible ones wherever a belt, hem or hat overlapped the body, and at the vista they were near-white and louder than the people in plain sight. | Stencil-gated silhouettes (D-027) in ember; opacity tied to how close the camera is. |
| 9 | `4-silhouette-clean.jpg`, `4-midday.jpg`, and the first charter capture (not kept): visible people clean, hidden people hinted; the lake a calm teal; a ratified charter's post, cords and pennant legible beside its store in the snow. Worn paths still could not be found at day 22. | Traffic was measured (never above about 33 on a tile in 40 days) and the wear mapping recalibrated to the engine's own threshold, with grass trodden down on worn tiles (D-032). |
| 10 | The first knowledge view (capture not kept; `shots/knowledge.jpg` is the view after this pass): it washed unknown land to a dark slab, heaviest over the sea. | The wash became a pale parchment tone scaled to the light of the hour, so that it reads as unmapped paper by day and does not glow at night. |

## Phase 11 rubric (S02 scale: 0 absent · 1 placeholder · 2 functional · 3 polished · 4 exceptional and verified)

Scored by the builder from the captures named, after phase 11. A score of 4 needs verification on real
hardware and with people; none has happened, so nothing scores 4.

| Criterion | Phase 04 | Now | What the score rests on | What holds it down |
|---|---|---|---|---|
| Terrain and vegetation detail | 3 | 3 | `shots/vista.jpg`, `closeup.jpg`, `winter.jpg`: strata, luminous shallows, crags, snow line, three canopy forms with seasonal colour, streams with gravel beds, damp banks and pebbles | Trees are still faceted lumps; no undergrowth variety beyond grass, reeds and rosettes |
| Citizen animation | 2 | 3 | `forager.jpg`, `woodcutter.jpg`, `fisher.jpg`, `builder.jpg`: people stand beside their work and face it; tools and loads are drawn from what they own and carry | Figures are pawn-like; no hands, no walk variation by load or age; speech is a bubble |
| Lighting and materials | 3 | 3 | `dusk.jpg`, `night.jpg`: low warm sun and long shadows, readable moonlit night with pools of firelight and smoke | No ambient occlusion pass on high; materials are flat-shaded colour only |
| Camera and composition | 3 | 3 | `vista.jpg`; follow and focus ease; the slab on its plinth in a dark room | No cinematic presets; a low camera can put a ridge between you and a citizen (the faint shape of D-027 mitigates it) |
| State readability | 2 | 3 | `knowledge.jpg` (what one citizen knows, and whom), `charter.jpg` (a ratified agreement's post, cords and pennants), stock visible on trees, bushes, stores and plots; hidden people findable | Worn paths are honest but rare (few tiles reach the engine's threshold in a year); belief errors are listed, not drawn |
| Layout and typography | 3 | 3 | `evidence/phase-12/e2e/*`: atlas, almanac, journal, inspector on parchment; one accent | — |
| Mobile interaction | 2 | 2 | `phone.jpg`, `phone_landscape.jpg`, phone E2E flows with taps | Emulation only; no physical device |
| Visual originality | 3 | 3 | cut-away diorama, tilt-shift, pennants and cords for agreements, parchment wash for the unknown; all assets procedural | — |
| Performance | 1 | 1 | only software-rendered numbers exist (below) | No GPU, no device, no frame-rate claim |
| Accessibility | 2 | 3 | axe scan of thirteen states on desktop and phone with no serious violation after one fix; contrast computed from tokens with two fixes; keys for every instrument; reduced motion | No screen-reader session; colour-vision check only for charts |

## Performance, as measured

Headless Chromium here renders WebGL on the CPU (SwiftShader). These numbers say nothing about a device with
a GPU; they are recorded so that nobody mistakes them for one. **The 60 fps desktop / 30 fps phone targets are
unverified.**

| Preset | Viewport | Draw calls | Triangles per frame (incl. shadow pass) | Source |
|---|---|---|---|---|
| High | 1920×1080 | 84–86 at the vista, 92–102 close in with people and agreements in view | 1.65–1.73 million | `evidence/phase-11/shots.txt` |
| Medium | 390×844 and 844×390 (phone emulation, pixel ratio capped at 2) | 71 | 1.62 million | same |
| Low | 1366×768 | 52 | 0.41 million | same |

Phase 11 added about 28 draw calls to the high preset (props, loads, smoke, rings, birds, posts, pennants,
silhouettes, ties) and under 1% to its triangles; the reference island carries about one and a half times the
flora it had in phase 04 (D-014), which is where the rise from 1.08 to 1.65 million triangles came from.
Frame intervals on the software renderer were 1.3–4 s on high while other jobs shared the machine; they are
not a measurement of anything a player would see.

## Known weaknesses after phase 11

- Citizens are still pawns: no hands, no gait that changes with load, age or illness beyond a lean.
- A beaten path needs more concentrated traffic than these people produce; trails remain faint in most worlds.
- Belief errors (a bush believed full that is bare) are not drawn in the world.
- No whole-society view of ties; arcs are for one citizen at a time.
- Sound has never been heard by anyone (D-028).
- Nothing has been seen on a GPU or a phone.

## Sources and licensing

All geometry, shaders and textures are generated by code in `src/render/`. Fonts: Fraunces and Inter (SIL Open
Font License 1.1) via `@fontsource-variable`. Icons: Lucide (ISC). three.js (MIT). No images, models, audio or
third-party art are bundled.
