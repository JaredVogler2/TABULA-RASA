# Study bundle — pilot (development seeds)

Engine 0.7.0 · schema 6 · affordances 2026.11-i · 224 of 224 runs finished · seeds 1–16 (16) · no model consulted, no cost.

Intervals are 95% percentile bootstrap intervals over seeds (10,000 resamples, fixed analysis seed). Conditions are paired by seed. Nothing here is a claim about human societies (protocol §1).

### H1 — Scarcity and cooperation (inverted U)

**Pilot** (development seeds) · 16 seeds (1–16) · 40 days · 48 of 48 runs finished

> Development seeds: these numbers size a study. They are not a test of any hypothesis, and the verdict column is only what the rule would say.
> Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: 7 contrasts with a p-value (ratio contrasts are read from their interval and have none).

| Condition | n | Survival | Welfare | Voluntary cooperation | Reciprocity | Specialization | Inequality of holdings | Commons health | Deliberations |
|---|---|---|---|---|---|---|---|---|---|
| richness 0.4 | 16 | 0.020 [0.012, 0.028] | 0.113 [0.107, 0.119] | 0.0067 [0.0043, 0.0101] | 0.000 [0.000, 0.000] | 0.325 [0.313, 0.338] | 0.162 [0.147, 0.179] | 0.004 [0.000, 0.010] | 4270 [2970, 6164] |
| richness 0.7 | 16 | 0.379 [0.214, 0.555] | 0.431 [0.399, 0.464] | 0.0180 [0.0123, 0.0238] | 0.018 [0.000, 0.054] | 0.246 [0.241, 0.251] | 0.203 [0.195, 0.213] | 0.023 [0.012, 0.037] | 15390 [11404, 19679] |
| richness 1.3 | 16 | 0.999 [0.996, 1.000] | 0.559 [0.556, 0.562] | 0.0019 [0.0009, 0.0034] | 0.017 [0.000, 0.050] | 0.321 [0.312, 0.330] | 0.189 [0.186, 0.192] | 0.264 [0.249, 0.278] | 11206 [10994, 11465] |

| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |
|---|---|---|---|---|---|---|---|---|
| H1 | Cooperation is higher at richness 0.7 than at 1.3. | 0.0161 [0.0104, 0.0218] | 16 | 0.0121 | 1.33 | 0.88 | 0.0001 (0.0007) | would read "supported" |
| H1 | Cooperation is higher at richness 0.7 than at 0.4. | 0.0113 [0.0054, 0.0171] | 16 | 0.0123 | 0.92 | 0.55 | 0.0002 (0.0010) | would read "supported" |

### H2 — Mobility and specialization

**Pilot** (development seeds) · 16 seeds (1–16) · 40 days · 32 of 32 runs finished

> Development seeds: these numbers size a study. They are not a test of any hypothesis, and the verdict column is only what the rule would say.
> Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: 7 contrasts with a p-value (ratio contrasts are read from their interval and have none).

| Condition | n | Survival | Welfare | Voluntary cooperation | Reciprocity | Specialization | Inequality of holdings | Commons health | Deliberations |
|---|---|---|---|---|---|---|---|---|---|
| movement cost 1.0 | 16 | 1.000 [1.000, 1.000] | 0.557 [0.554, 0.560] | 0.0021 [0.0013, 0.0031] | 0.031 [0.000, 0.094] | 0.284 [0.274, 0.295] | 0.192 [0.189, 0.195] | 0.181 [0.162, 0.198] | 10932 [10829, 11024] |
| movement cost 2.0 | 16 | 0.940 [0.909, 0.966] | 0.435 [0.424, 0.445] | 0.0153 [0.0128, 0.0179] | 0.036 [0.006, 0.070] | 0.348 [0.337, 0.359] | 0.247 [0.239, 0.256] | 0.266 [0.250, 0.282] | 8046 [7884, 8203] |

| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |
|---|---|---|---|---|---|---|---|---|
| H2 | Doubling the cost of movement raises the specialization index. | 0.063 [0.055, 0.071] | 16 | 0.017 | 3.68 | 0.97 | 0.0001 (0.0007) | would read "supported" |

### H3 — Communication range and adoption

**Pilot** (development seeds) · 16 seeds (1–16) · 40 days · 32 of 32 runs finished

> Development seeds: these numbers size a study. They are not a test of any hypothesis, and the verdict column is only what the rule would say.
> Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: 7 contrasts with a p-value (ratio contrasts are read from their interval and have none).

| Condition | n | Survival | Welfare | Voluntary cooperation | Reciprocity | Specialization | Inequality of holdings | Commons health | Reached E2 (adopted) | Deliberations |
|---|---|---|---|---|---|---|---|---|---|---|
| hearing radius 2 | 16 | 1.000 [1.000, 1.000] | 0.556 [0.553, 0.559] | 0.0040 [0.0031, 0.0049] | 0.673 [0.548, 0.789] | 0.288 [0.279, 0.297] | 0.193 [0.189, 0.196] | 0.177 [0.155, 0.196] | 0.13 [0.00, 0.31] | 11221 [11123, 11313] |
| hearing radius 9 | 16 | 0.999 [0.996, 1.000] | 0.556 [0.553, 0.559] | 0.0078 [0.0066, 0.0091] | 0.813 [0.771, 0.854] | 0.287 [0.278, 0.296] | 0.190 [0.186, 0.193] | 0.179 [0.158, 0.199] | 0.25 [0.06, 0.50] | 11623 [11514, 11723] |

| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |
|---|---|---|---|---|---|---|---|---|
| H3 | More runs reach E2 when voices carry nine tiles than when they carry two. | 0.13 [-0.19, 0.44] | 16 | 0.62 | 0.20 | 0.13 | 0.5313 (1.0000) | would read "falsified" |

### H4 — Diversity and resilience

**Pilot** (development seeds) · 16 seeds (1–16) · 40 days · 32 of 32 runs finished

> Development seeds: these numbers size a study. They are not a test of any hypothesis, and the verdict column is only what the rule would say.
> Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: 7 contrasts with a p-value (ratio contrasts are read from their interval and have none).

| Condition | n | Survival | Welfare | Voluntary cooperation | Reciprocity | Specialization | Inequality of holdings | Commons health | Deliberations |
|---|---|---|---|---|---|---|---|---|---|
| diversity 0.2 | 16 | 0.998 [0.994, 1.000] | 0.555 [0.552, 0.557] | 0.0005 [0.0002, 0.0009] | 0.000 [0.000, 0.000] | 0.252 [0.244, 0.259] | 0.183 [0.180, 0.187] | 0.167 [0.155, 0.178] | 11075 [10973, 11171] |
| diversity 1.0 | 16 | 0.996 [0.990, 1.000] | 0.554 [0.551, 0.556] | 0.0020 [0.0013, 0.0028] | 0.042 [0.000, 0.125] | 0.255 [0.250, 0.260] | 0.196 [0.192, 0.199] | 0.131 [0.113, 0.148] | 10819 [10698, 10935] |

| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |
|---|---|---|---|---|---|---|---|---|
| H4 | After the same blight on day 16, more people survive where temperaments and skills vary more. | -0.001 [-0.005, 0.003] | 16 | 0.009 | -0.14 | -0.01 | 0.7614 (1.0000) | would read "falsified" |

### H5 — Cadence has diminishing returns

**Pilot** (development seeds) · 16 seeds (1–16) · 40 days · 32 of 32 runs finished

> Development seeds: these numbers size a study. They are not a test of any hypothesis, and the verdict column is only what the rule would say.
> Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: 7 contrasts with a p-value (ratio contrasts are read from their interval and have none).

| Condition | n | Survival | Welfare | Voluntary cooperation | Specialization | Inequality of holdings | Commons health | Deliberations |
|---|---|---|---|---|---|---|---|---|
| deliberate every 12 ticks | 16 | 0.999 [0.996, 1.000] | 0.553 [0.549, 0.556] | 0.0018 [0.0011, 0.0026] | 0.336 [0.325, 0.347] | 0.169 [0.166, 0.173] | 0.221 [0.201, 0.238] | 6406 [6352, 6458] |
| deliberate every 48 ticks | 16 | 0.974 [0.929, 1.000] | 0.580 [0.565, 0.591] | 0.0016 [0.0006, 0.0030] | 0.403 [0.393, 0.413] | 0.169 [0.163, 0.177] | 0.215 [0.191, 0.237] | 3096 [3042, 3134] |

| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |
|---|---|---|---|---|---|---|---|---|
| H5 | Welfare at cadence 48 is at least 90% of welfare at cadence 12. | ratio 1.050 [1.025, 1.066] | 16 | 0.025 | 1.11 | 0.76 | — (—) | would read "supported" |
| H5 | …with at most 35% as many deliberations (the check that the treatment was applied). | ratio 0.483 [0.477, 0.488] | 16 | 92.769 | -35.68 | -1.00 | — (—) | would read "not supported" |

### H6 — Do institutions have anything to do? (The Long Winter)

**Pilot** (development seeds) · 16 seeds (1–16) · 40 days · 48 of 48 runs finished

> Development seeds: these numbers size a study. They are not a test of any hypothesis, and the verdict column is only what the rule would say.
> Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: 7 contrasts with a p-value (ratio contrasts are read from their interval and have none).

| Condition | n | Survival | Welfare | Voluntary cooperation | Reciprocity | Specialization | Inequality of holdings | Commons health | Reached E2 (adopted) | Reached E4 (persistent) | Deliberations |
|---|---|---|---|---|---|---|---|---|---|---|---|
| institutions off | 16 | 0.636 [0.576, 0.696] | 0.415 [0.398, 0.431] | 0.0139 [0.0109, 0.0176] | 0.032 [0.007, 0.060] | 0.267 [0.260, 0.274] | 0.182 [0.179, 0.186] | 0.142 [0.124, 0.161] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 9005 [8335, 9869] |
| scripted control | 16 | 0.579 [0.531, 0.626] | 0.398 [0.384, 0.411] | 0.0166 [0.0134, 0.0200] | 0.317 [0.254, 0.380] | 0.273 [0.266, 0.281] | 0.180 [0.174, 0.185] | 0.155 [0.134, 0.176] | 0.81 [0.63, 1.00] | 0.00 [0.00, 0.00] | 8814 [8420, 9236] |
| grammar search | 16 | 0.595 [0.543, 0.643] | 0.403 [0.389, 0.416] | 0.0195 [0.0155, 0.0244] | 0.292 [0.221, 0.366] | 0.268 [0.262, 0.275] | 0.180 [0.176, 0.185] | 0.153 [0.133, 0.175] | 1.00 [1.00, 1.00] | 0.81 [0.63, 1.00] | 9060 [8705, 9394] |

| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |
|---|---|---|---|---|---|---|---|---|
| H6a | Positive control: a charter written by the designers raises survival. | -0.058 [-0.114, 0.000] | 16 | 0.123 | -0.47 | -0.27 | 0.0559 (0.2236) | would read "falsified" |
| H6b | Institutions found by non-LLM search change survival (no prediction of sign). | -0.041 [-0.101, 0.016] | 16 | 0.125 | -0.33 | -0.14 | 0.1816 (0.5447) | would read "reported" |

### Sizing the confirmatory batch (precision before power)

Seeds needed for a 95% interval on each paired difference to be 0.35 standard deviations of that difference wide on each side, from the spread seen in this pilot (capped at 96).

| Contrast | Measure | SD of paired differences | Half-width in this pilot | Target half-width | Seeds |
|---|---|---|---|---|---|
| h1a | cooperation | 0.0121 | 0.0059 | 0.0042 | 32 |
| h1b | cooperation | 0.0123 | 0.0060 | 0.0043 | 32 |
| h2 | specialization | 0.0171 | 0.0084 | 0.0060 | 32 |
| h3 | e2 | 0.6191 | 0.3034 | 0.2167 | 32 |
| h4 | survival | 0.0089 | 0.0043 | 0.0031 | 32 |
| h6a | survival | 0.1226 | 0.0601 | 0.0429 | 32 |
| h6b | survival | 0.1249 | 0.0612 | 0.0437 | 32 |
