# What can be seen on the deployed site after pull request 7 was merged (main at bdcbd83)

Measured 2026-11-26T04:51:17.942Z against https://tabula-rasa-bay.vercel.app with scripts/sight.mjs, in headless Chromium (not a phone, not Safari).

## The Recordings sheet: the first row

| Page | List | Name | Row past the list | Name over the paragraph above | Sheet scrolls sideways |
|---|---|---|---|---|---|
| 320×568 | 286 px | 286 px on 1 line | 0 px | 0 px | no |
| 360×740 | 326 px | 326 px on 1 line | 0 px | 0 px | no |
| 390×844 | 356 px | 356 px on 1 line | 0 px | 0 px | no |
| 430×932 | 396 px | 396 px on 1 line | 0 px | 0 px | no |
| 768×1024 | 734 px | 734 px on 1 line | 0 px | 0 px | no |
| 1366×768 | 726 px | 726 px on 1 line | 0 px | 0 px | no |

## A citizen tapped, then followed (First Light, seed 7, after 130 ticks)

| Page | Step | Drawn at | On top at that point | Button says following | Card |
|---|---|---|---|---|---|
| phone 390×844 | tapped | (195, 286) | the map | no | 416..703 |
| phone 390×844 | Follow pressed | (195, 274) | the map | yes | 416..703 |
| phone 390×844 | zoomed in | (195, 271) | the map | yes | 416..703 |
| desktop 1366×768 | tapped | (667, 314) | the map | no | 74..686 |
| desktop 1366×768 | Follow pressed | (683, 364) | the map | yes | 74..686 |
| desktop 1366×768 | zoomed in | (683, 360) | the map | yes | 74..686 |

| Page | Time running at 8× | Samples | Hidden in | Furthest from where they were held | Still following |
|---|---|---|---|---|---|
| phone | 234 ticks | 35 | 0 | 17 px | yes |
| desktop | 255 ticks | 34 | 0 | 12 px | yes |
