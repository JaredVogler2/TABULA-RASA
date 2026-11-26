# What could be seen before the change (the deployed build, from main at 1bb4759)

Measured 2026-11-26T04:11:20.679Z against https://tabula-rasa-bay.vercel.app with scripts/sight.mjs, in headless Chromium (not a phone, not Safari).

## The Recordings sheet: the first row

| Page | List | Name | Row past the list | Name over the paragraph above | Sheet scrolls sideways |
|---|---|---|---|---|---|
| 320×568 | 286 px | 44 px on 5 lines | 350 px | 0 px | yes |
| 360×740 | 326 px | 44 px on 5 lines | 310 px | 0 px | yes |
| 390×844 | 356 px | 44 px on 5 lines | 280 px | 0 px | yes |
| 430×932 | 396 px | 44 px on 5 lines | 240 px | 0 px | yes |
| 768×1024 | 734 px | 142 px on 1 line | 0 px | 0 px | no |
| 1366×768 | 726 px | 134 px on 2 lines | 0 px | 0 px | no |

## A citizen tapped, then followed (First Light, seed 7, after 130 ticks)

| Page | Step | Drawn at | On top at that point | Button says following | Card |
|---|---|---|---|---|---|
| phone 390×844 | tapped | (182, 365) | inspector-body | no | 213..703 |
| phone 390×844 | Follow pressed | (195, 406) | overlay-knowledge | yes | 213..703 |
| phone 390×844 | zoomed in | (195, 403) | overlay-knowledge | no | 213..703 |
| phone 390×844 | Follow pressed again | (195, 403) | overlay-knowledge | yes | 213..703 |
| desktop 1366×768 | tapped | (671, 314) | the map | no | 74..686 |
| desktop 1366×768 | Follow pressed | (683, 370) | the map | yes | 74..686 |
| desktop 1366×768 | zoomed in | (683, 360) | the map | no | 74..686 |
| desktop 1366×768 | Follow pressed again | (683, 360) | the map | yes | 74..686 |

| Page | Time running at 8× | Samples | Hidden in | Furthest from where they were held | Still following |
|---|---|---|---|---|---|
| phone | 227 ticks | 29 | 29 | 39 px | yes |
| desktop | 256 ticks | 36 | 0 | 64 px | yes |
