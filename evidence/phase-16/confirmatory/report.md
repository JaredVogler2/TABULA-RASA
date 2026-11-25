# Study bundle — confirmatory (holdout seeds)

Engine 0.7.0 · schema 6 · affordances 2026.11-i · 448 of 448 runs finished · seeds 9000–9031 (32) · no model consulted, no cost.

Intervals are 95% percentile bootstrap intervals over seeds (10,000 resamples, fixed analysis seed). Conditions are paired by seed. Nothing here is a claim about human societies (protocol §1).

### H1 — Scarcity and cooperation (inverted U)

**Confirmatory** (holdout seeds) · 32 seeds (9000–9031) · 40 days · 96 of 96 runs finished

> Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: 7 contrasts with a p-value (ratio contrasts are read from their interval and have none).

| Condition | n | Survival | Welfare | Voluntary cooperation | Reciprocity | Specialization | Inequality of holdings | Commons health | Deliberations |
|---|---|---|---|---|---|---|---|---|---|
| richness 0.4 | 32 | 0.016 [0.011, 0.021] | 0.114 [0.109, 0.118] | 0.0060 [0.0046, 0.0077] | 0.000 [0.000, 0.000] | 0.328 [0.319, 0.338] | 0.177 [0.162, 0.195] | 0.015 [0.007, 0.025] | 7077 [5027, 9296] |
| richness 0.7 | 32 | 0.336 [0.235, 0.447] | 0.422 [0.398, 0.446] | 0.0169 [0.0139, 0.0199] | 0.014 [0.002, 0.031] | 0.246 [0.241, 0.251] | 0.204 [0.197, 0.210] | 0.024 [0.014, 0.036] | 13267 [11045, 15645] |
| richness 1.3 | 32 | 0.998 [0.995, 0.999] | 0.556 [0.554, 0.558] | 0.0018 [0.0015, 0.0023] | 0.000 [0.000, 0.000] | 0.316 [0.309, 0.322] | 0.188 [0.186, 0.191] | 0.266 [0.252, 0.279] | 10987 [10907, 11068] |

| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |
|---|---|---|---|---|---|---|---|---|
| H1 | Cooperation is higher at richness 0.7 than at 1.3. | 0.0151 [0.0122, 0.0179] | 32 | 0.0085 | 1.77 | 0.99 | 0.0001 (0.0007) | **supported** |
| H1 | Cooperation is higher at richness 0.7 than at 0.4. | 0.0109 [0.0079, 0.0138] | 32 | 0.0087 | 1.26 | 0.75 | 0.0001 (0.0007) | **supported** |

### H2 — Mobility and specialization

**Confirmatory** (holdout seeds) · 32 seeds (9000–9031) · 40 days · 64 of 64 runs finished

> Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: 7 contrasts with a p-value (ratio contrasts are read from their interval and have none).

| Condition | n | Survival | Welfare | Voluntary cooperation | Reciprocity | Specialization | Inequality of holdings | Commons health | Deliberations |
|---|---|---|---|---|---|---|---|---|---|
| movement cost 1.0 | 32 | 0.994 [0.989, 0.998] | 0.555 [0.552, 0.557] | 0.0027 [0.0021, 0.0033] | 0.071 [0.013, 0.149] | 0.283 [0.278, 0.288] | 0.193 [0.190, 0.195] | 0.180 [0.168, 0.192] | 10893 [10807, 10977] |
| movement cost 2.0 | 32 | 0.933 [0.914, 0.949] | 0.437 [0.430, 0.443] | 0.0144 [0.0128, 0.0159] | 0.024 [0.012, 0.038] | 0.339 [0.334, 0.344] | 0.249 [0.244, 0.255] | 0.268 [0.254, 0.281] | 8070 [7872, 8342] |

| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |
|---|---|---|---|---|---|---|---|---|
| H2 | Doubling the cost of movement raises the specialization index. | 0.056 [0.052, 0.060] | 32 | 0.012 | 4.82 | 1.00 | 0.0001 (0.0007) | **supported** |

### H3 — Communication range and adoption

**Confirmatory** (holdout seeds) · 32 seeds (9000–9031) · 40 days · 64 of 64 runs finished

> Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: 7 contrasts with a p-value (ratio contrasts are read from their interval and have none).

| Condition | n | Survival | Welfare | Voluntary cooperation | Reciprocity | Specialization | Inequality of holdings | Commons health | Reached E2 (adopted) | Reached E4 (persistent) | Deliberations |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hearing radius 2 | 32 | 0.998 [0.995, 0.999] | 0.555 [0.553, 0.557] | 0.0037 [0.0031, 0.0044] | 0.575 [0.468, 0.681] | 0.282 [0.278, 0.287] | 0.192 [0.189, 0.194] | 0.178 [0.165, 0.190] | 0.25 [0.09, 0.41] | 0.06 [0.00, 0.16] | 11217 [11141, 11290] |
| hearing radius 9 | 32 | 0.998 [0.995, 1.000] | 0.556 [0.553, 0.558] | 0.0065 [0.0054, 0.0078] | 0.781 [0.717, 0.838] | 0.285 [0.279, 0.291] | 0.191 [0.188, 0.194] | 0.186 [0.173, 0.198] | 0.56 [0.38, 0.72] | 0.09 [0.00, 0.22] | 11523 [11430, 11613] |

| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |
|---|---|---|---|---|---|---|---|---|
| H3 | More runs reach E2 when voices carry nine tiles than when they carry two. | 0.31 [0.06, 0.53] | 32 | 0.69 | 0.45 | 0.31 | 0.0141 (0.0564) | **supported** |

### H4 — Diversity and resilience

**Confirmatory** (holdout seeds) · 32 seeds (9000–9031) · 40 days · 64 of 64 runs finished

> Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: 7 contrasts with a p-value (ratio contrasts are read from their interval and have none).

| Condition | n | Survival | Welfare | Voluntary cooperation | Reciprocity | Specialization | Inequality of holdings | Commons health | Deliberations |
|---|---|---|---|---|---|---|---|---|---|
| diversity 0.2 | 32 | 0.999 [0.998, 1.000] | 0.551 [0.548, 0.554] | 0.0007 [0.0003, 0.0011] | 0.010 [0.000, 0.031] | 0.250 [0.246, 0.253] | 0.186 [0.184, 0.188] | 0.171 [0.159, 0.183] | 10999 [10901, 11098] |
| diversity 1.0 | 32 | 0.998 [0.996, 1.000] | 0.552 [0.549, 0.554] | 0.0038 [0.0029, 0.0048] | 0.120 [0.044, 0.209] | 0.253 [0.250, 0.256] | 0.194 [0.191, 0.197] | 0.135 [0.122, 0.147] | 10802 [10708, 10905] |

| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |
|---|---|---|---|---|---|---|---|---|
| H4 | After the same blight on day 16, more people survive where temperaments and skills vary more. | -0.001 [-0.003, 0.000] | 32 | 0.005 | -0.25 | -0.06 | 0.2689 (0.8066) | **falsified** |

### H5 — Cadence has diminishing returns

**Confirmatory** (holdout seeds) · 32 seeds (9000–9031) · 40 days · 64 of 64 runs finished

> Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: 7 contrasts with a p-value (ratio contrasts are read from their interval and have none).

| Condition | n | Survival | Welfare | Voluntary cooperation | Specialization | Inequality of holdings | Commons health | Deliberations |
|---|---|---|---|---|---|---|---|---|
| deliberate every 12 ticks | 32 | 0.996 [0.991, 0.999] | 0.552 [0.549, 0.554] | 0.0021 [0.0016, 0.0026] | 0.332 [0.327, 0.337] | 0.168 [0.166, 0.171] | 0.225 [0.209, 0.240] | 6415 [6376, 6452] |
| deliberate every 48 ticks | 32 | 0.998 [0.995, 1.000] | 0.583 [0.579, 0.587] | 0.0008 [0.0005, 0.0011] | 0.400 [0.396, 0.405] | 0.170 [0.166, 0.173] | 0.207 [0.191, 0.222] | 3104 [3092, 3116] |

| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |
|---|---|---|---|---|---|---|---|---|
| H5 | Welfare at cadence 48 is at least 90% of welfare at cadence 12. | ratio 1.056 [1.051, 1.062] | 32 | 0.009 | 3.63 | 0.99 | — (—) | **supported** |
| H5 | …with at most 35% as many deliberations (the check that the treatment was applied). | ratio 0.484 [0.482, 0.486] | 32 | 92.596 | -35.76 | -1.00 | — (—) | **not supported** |

### H6 — Do institutions have anything to do? (The Long Winter)

**Confirmatory** (holdout seeds) · 32 seeds (9000–9031) · 40 days · 96 of 96 runs finished

> Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: 7 contrasts with a p-value (ratio contrasts are read from their interval and have none).

| Condition | n | Survival | Welfare | Voluntary cooperation | Reciprocity | Specialization | Inequality of holdings | Commons health | Reached E2 (adopted) | Reached E4 (persistent) | Deliberations |
|---|---|---|---|---|---|---|---|---|---|---|---|
| institutions off | 32 | 0.604 [0.548, 0.658] | 0.403 [0.388, 0.418] | 0.0151 [0.0132, 0.0171] | 0.033 [0.015, 0.055] | 0.267 [0.261, 0.272] | 0.177 [0.174, 0.180] | 0.151 [0.133, 0.168] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 8644 [8247, 9071] |
| scripted control | 32 | 0.595 [0.538, 0.653] | 0.402 [0.386, 0.418] | 0.0186 [0.0165, 0.0206] | 0.304 [0.245, 0.366] | 0.270 [0.266, 0.275] | 0.180 [0.176, 0.183] | 0.154 [0.136, 0.171] | 0.91 [0.78, 1.00] | 0.00 [0.00, 0.00] | 8786 [8445, 9123] |
| grammar search | 32 | 0.624 [0.571, 0.675] | 0.410 [0.395, 0.424] | 0.0192 [0.0170, 0.0215] | 0.295 [0.247, 0.345] | 0.268 [0.263, 0.274] | 0.181 [0.177, 0.184] | 0.151 [0.133, 0.169] | 1.00 [1.00, 1.00] | 0.88 [0.75, 0.97] | 9289 [8910, 9637] |

| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |
|---|---|---|---|---|---|---|---|---|
| H6a | Positive control: a charter written by the designers raises survival. | -0.009 [-0.054, 0.037] | 32 | 0.132 | -0.07 | -0.07 | 0.7095 (0.8066) | **falsified** |
| H6b | Institutions found by non-LLM search change survival (no prediction of sign). | 0.021 [-0.026, 0.068] | 32 | 0.139 | 0.15 | 0.11 | 0.3954 (0.8066) | **reported** |
