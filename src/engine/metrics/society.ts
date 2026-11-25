/**
 * Society measures computed from the ledger.
 *
 * Every number here is derived from logged events (and, where stated, from world state at
 * the moment of the report) — never from what any agent says about itself. They are
 * descriptive. None of them is a score: more exchange, more inequality or more institutions
 * is not "better", and the interface never presents them as if it were.
 *
 * Definitions follow docs/EXPERIMENT_PROTOCOL.md §4–5; where the protocol left a choice open
 * the choice made is written next to the code that makes it.
 */
import { TICKS_PER_DAY } from "../model/constants";
import type { SimEvent, WorldState } from "../model/types";
import { giniPermille } from "./accumulate";

/** Transfers between the same two people this far apart or closer count as reciprocated. */
export const RECIPROCITY_WINDOW = 5 * TICKS_PER_DAY;
/** An institution is "used" (E3) after this many rule-governed events by at least two members. */
export const E3_EVENTS = 10;
/** … and "persistent" (E4) after this many days in force. */
export const E4_DAYS = 10;

export interface LadderCount {
  E1: number;
  E2: number;
  E3: number;
  E4: number;
}

export interface InstitutionRecord {
  id: number;
  origin: string;
  proposer: number;
  proposedTick: number;
  ratifiedTick: number;
  endedTick: number;
  founders: number;
  /** Rule-governed events after ratification, and the distinct members who caused them. */
  uses: number;
  users: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface SocietyReport {
  ticks: number;
  /** Living agent-days over the run (the denominator of every "per agent-day" rate). */
  agentDays: number;
  gifts: number;
  giftUnits: number;
  exchanges: number;
  exchangeUnits: number;
  /** Voluntary cooperation: gifts + executed pacts + draws from a common stock, per 1,000 living agent-days. */
  cooperation: number;
  /** Permille of directed dyads with a transfer that is answered by one the other way within five days. */
  reciprocity: number;
  /** Units in executed pacts plus units in reciprocated gift pairs, per 1,000 living agent-days. */
  tradeVolume: number;
  network: { people: number; ties: number; weight: number; communities: number; modularity: number };
  promises: { kept: number; broken: number };
  institutions: {
    proposals: number;
    refused: number;
    ratified: number;
    activeAtEnd: number;
    memberDays: number;
    /** How many institutions reached each rung, in total and by how they came to be proposed. */
    ladder: LadderCount;
    byOrigin: Record<string, LadderCount>;
    records: InstitutionRecord[];
  };
  /** Completed ÷ started, permille, among building projects that more than one person put work or materials into. */
  collectiveAction: { started: number; completed: number; success: number };
  /** Gini (permille) across agents of ratified proposals authored plus passed motions moved. 0 when there are none. */
  influenceConcentration: number;
  /** Times a door did not open: refused withdrawals, the distinct people refused, and the rate per 1,000 agent-days. */
  exclusion: { refusals: number; people: number; rate: number };
}

interface Transfer {
  t: number;
  from: number;
  to: number;
  units: number;
  gift: boolean;
}

const RULE_GOVERNED = new Set(["obligation", "breach", "sanction", "motion", "vote"]);

/**
 * Feed events in ledger order with `push`, then call `report`. One tracker per world.
 * Memory is proportional to the number of transfers and institutions, not to the ledger.
 */
export class SocietyTracker {
  private transfers: Transfer[] = [];
  private ties = new Map<number, number>();
  private kept = 0;
  private broken = 0;
  private proposals = 0;
  private refused = 0;
  private records = new Map<number, InstitutionRecord>();
  private usersOf = new Map<number, Set<number>>();
  private membersOf = new Map<number, Set<number>>();
  private memberTicks = 0;
  private lastTick = 0;
  private boundTo = new Map<number, number>();
  private motionBy = new Map<number, number>();
  private influence = new Map<number, number>();
  private refusals = 0;
  private refusedPeople = new Set<number>();
  private deaths = new Map<number, number>();
  private arrivals = new Map<number, number>();

  constructor(private readonly population: number) {}

  private tie(a: number, b: number, w: number): void {
    if (a === b || a < 0 || b < 0) return;
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    this.ties.set(key, (this.ties.get(key) ?? 0) + w);
  }

  private use(inst: number, agent: number): void {
    const r = this.records.get(inst);
    if (!r || r.ratifiedTick < 0 || r.endedTick >= 0) return;
    r.uses++;
    if (agent >= 0) {
      let set = this.usersOf.get(inst);
      if (!set) this.usersOf.set(inst, (set = new Set()));
      set.add(agent);
    }
  }

  private advance(t: number): void {
    if (t <= this.lastTick) return;
    let members = 0;
    for (const set of this.membersOf.values()) members += set.size;
    this.memberTicks += members * (t - this.lastTick);
    this.lastTick = t;
  }

  push(e: SimEvent): void {
    this.advance(e.t);
    const d = e.d as Record<string, unknown> | undefined;
    const inst = typeof d?.inst === "number" ? d.inst : -1;
    switch (e.k) {
      case "give":
        if (e.b !== undefined) {
          this.transfers.push({ t: e.t, from: e.a, to: e.b, units: e.q ?? 1, gift: true });
          this.tie(e.a, e.b, e.q ?? 1);
        }
        break;
      case "pact_done": {
        // the acceptor (a) gave `gaveQty` and received `gotQty` from the offerer (b)
        if (e.b === undefined) break;
        const gave = typeof d?.gaveQty === "number" ? d.gaveQty : 1;
        const got = typeof d?.gotQty === "number" ? d.gotQty : 1;
        this.transfers.push({ t: e.t, from: e.a, to: e.b, units: gave, gift: false });
        this.transfers.push({ t: e.t, from: e.b, to: e.a, units: got, gift: false });
        this.tie(e.a, e.b, gave + got);
        break;
      }
      case "say":
        // only speech addressed to one person is a tie between two people; what is called out to
        // whoever is near is logged without its hearers and is not counted here
        if (e.b !== undefined) this.tie(e.a, e.b, 1);
        break;
      case "promise_kept":
        this.kept++;
        if (e.b !== undefined) this.tie(e.a, e.b, 2);
        break;
      case "promise_broken":
        this.broken++;
        break;
      case "death":
        this.deaths.set(e.a, e.t);
        for (const set of this.membersOf.values()) set.delete(e.a);
        break;
      case "arrival":
        this.arrivals.set(e.a, e.t);
        break;
      case "proposal":
        this.proposals++;
        if (inst >= 0) {
          this.records.set(inst, { id: inst, origin: typeof d?.origin === "string" ? d.origin : "unknown", proposer: e.a, proposedTick: e.t, ratifiedTick: -1, endedTick: -1, founders: 0, uses: 0, users: 0, level: 1 });
        }
        break;
      case "proposal_rejected":
        this.refused++;
        break;
      case "ratified": {
        const r = this.records.get(inst);
        const members = Array.isArray(d?.members) ? (d.members as number[]) : [];
        if (r) {
          r.ratifiedTick = e.t;
          r.founders = members.length;
        }
        this.membersOf.set(inst, new Set(members));
        this.influence.set(e.a, (this.influence.get(e.a) ?? 0) + 1);
        for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) this.tie(members[i] as number, members[j] as number, 1);
        break;
      }
      case "joined":
        if (inst >= 0) {
          let set = this.membersOf.get(inst);
          if (!set) this.membersOf.set(inst, (set = new Set()));
          set.add(e.a);
        }
        break;
      case "left":
      case "expelled":
        this.membersOf.get(inst)?.delete(e.a);
        break;
      case "dissolved": {
        const r = this.records.get(inst);
        if (r) r.endedTick = e.t;
        this.membersOf.delete(inst);
        for (const [s, i] of this.boundTo) if (i === inst) this.boundTo.delete(s);
        break;
      }
      case "rule":
        if (e.s !== undefined && inst >= 0) {
          if (e.r === "bound") this.boundTo.set(e.s, inst);
          else if (e.r === "released") this.boundTo.delete(e.s);
        }
        break;
      case "deposit":
      case "withdraw": {
        const owner = e.s !== undefined ? this.boundTo.get(e.s) : undefined;
        if (owner !== undefined && this.membersOf.get(owner)?.has(e.a)) this.use(owner, e.a);
        break;
      }
      case "motion":
        if (typeof d?.motion === "number") this.motionBy.set(d.motion, e.a);
        this.use(inst, e.a);
        break;
      case "motion_result":
        if (e.r === "passed" && typeof d?.motion === "number") {
          const by = this.motionBy.get(d.motion);
          if (by !== undefined) this.influence.set(by, (this.influence.get(by) ?? 0) + 1);
        }
        break;
      case "rejected":
        if (e.r === "not_permitted" && (d as { k?: string } | undefined)?.k === "withdraw") {
          this.refusals++;
          this.refusedPeople.add(e.a);
        }
        break;
      default:
        if (RULE_GOVERNED.has(e.k)) this.use(inst, e.a);
    }
  }

  report(world: WorldState): SocietyReport {
    this.advance(world.tick);
    const ticks = world.tick;

    // living agent-days, from the ledger's own record of deaths and arrivals
    let aliveTicks = 0;
    for (let id = 0; id < world.agents.length; id++) {
      const from = this.arrivals.get(id) ?? 0;
      const to = this.deaths.get(id) ?? ticks;
      aliveTicks += Math.max(0, to - from);
    }
    const agentDays = aliveTicks / TICKS_PER_DAY;
    const per1000 = (n: number): number => (agentDays <= 0 ? 0 : Math.round((1000 * n) / agentDays));

    // ── transfers
    let gifts = 0;
    let giftUnits = 0;
    let exchangeUnits = 0;
    let exchangeLegs = 0;
    const byDyad = new Map<number, Transfer[]>();
    for (const tr of this.transfers) {
      if (tr.gift) {
        gifts++;
        giftUnits += tr.units;
      } else {
        exchangeLegs++;
        exchangeUnits += tr.units;
      }
      const key = tr.from * 65536 + tr.to;
      let list = byDyad.get(key);
      if (!list) byDyad.set(key, (list = []));
      list.push(tr);
    }
    let reciprocated = 0;
    let reciprocatedGiftUnits = 0;
    for (const [key, list] of byDyad) {
      const from = Math.floor(key / 65536);
      const to = key % 65536;
      const back = byDyad.get(to * 65536 + from);
      if (!back) continue;
      let answered = false;
      for (const tr of list) {
        const hit = back.some((o) => Math.abs(o.t - tr.t) <= RECIPROCITY_WINDOW);
        if (hit) {
          answered = true;
          if (tr.gift) reciprocatedGiftUnits += tr.units;
        }
      }
      if (answered) reciprocated++;
    }
    const exchanges = exchangeLegs / 2;
    const draws = world.metrics.institutionTransfers;

    // ── network: Newman modularity under greedy agglomeration (Clauset–Newman–Moore merges)
    const network = modularity(this.ties);

    // ── institutions and the registered ladder
    const ladder: LadderCount = { E1: 0, E2: 0, E3: 0, E4: 0 };
    const byOrigin: Record<string, LadderCount> = {};
    const records: InstitutionRecord[] = [];
    let activeAtEnd = 0;
    for (const r of this.records.values()) {
      r.users = this.usersOf.get(r.id)?.size ?? 0;
      let level: InstitutionRecord["level"] = 1;
      if (r.ratifiedTick >= 0 && r.founders >= 3) {
        level = 2;
        if (r.uses >= E3_EVENTS && r.users >= 2) level = 3;
        // an institution ends when fewer than two members remain, so one that has been in force for ten days has had two or more throughout
        const lived = (r.endedTick >= 0 ? r.endedTick : ticks) - r.ratifiedTick;
        if (level === 3 && lived >= E4_DAYS * TICKS_PER_DAY) level = 4;
      }
      r.level = level;
      if (r.ratifiedTick >= 0 && r.endedTick < 0) activeAtEnd++;
      const o = (byOrigin[r.origin] ??= { E1: 0, E2: 0, E3: 0, E4: 0 });
      for (const [rung, min] of [["E1", 1], ["E2", 2], ["E3", 3], ["E4", 4]] as const) {
        if (level >= min) {
          ladder[rung]++;
          o[rung]++;
        }
      }
      records.push({ ...r });
    }
    let ratified = 0;
    for (const r of records) if (r.ratifiedTick >= 0) ratified++;

    // ── collective action (from world state: who put work or materials into what)
    let started = 0;
    let completed = 0;
    for (const s of world.structures) {
      if (s.kind > 2 || s.builders.length < 2) continue; // plots are one person's work; shared means two or more builders
      started++;
      if (s.complete) completed++;
    }

    const influence: number[] = [];
    for (let id = 0; id < world.agents.length; id++) influence.push(this.influence.get(id) ?? 0);
    const anyInfluence = influence.some((v) => v > 0);

    return {
      ticks,
      agentDays: Math.round(agentDays * 10) / 10,
      gifts,
      giftUnits,
      exchanges,
      exchangeUnits,
      cooperation: per1000(gifts + exchanges + draws),
      reciprocity: byDyad.size === 0 ? 0 : Math.round((1000 * reciprocated) / byDyad.size),
      tradeVolume: per1000(exchangeUnits + reciprocatedGiftUnits),
      network,
      promises: { kept: this.kept, broken: this.broken },
      institutions: { proposals: this.proposals, refused: this.refused, ratified, activeAtEnd, memberDays: Math.round(this.memberTicks / TICKS_PER_DAY), ladder, byOrigin, records },
      collectiveAction: { started, completed, success: started === 0 ? 0 : Math.round((1000 * completed) / started) },
      influenceConcentration: anyInfluence ? giniPermille(influence) : 0,
      exclusion: { refusals: this.refusals, people: this.refusedPeople.size, rate: per1000(this.refusals) },
    };
  }
}

/**
 * Newman modularity (×1000) of a weighted undirected graph, with communities found by greedy
 * agglomeration: start with every connected person alone and repeatedly merge the pair of
 * communities whose merger raises Q most, until no merger raises it. People with no ties are
 * left out (they are not a community of one). Ties are keyed a·65536+b with a < b.
 */
export function modularity(ties: ReadonlyMap<number, number>): { people: number; ties: number; weight: number; communities: number; modularity: number } {
  if (ties.size === 0) return { people: 0, ties: 0, weight: 0, communities: 0, modularity: 0 };
  const index = new Map<number, number>();
  const edges: [number, number, number][] = [];
  let m = 0;
  for (const [key, w] of [...ties.entries()].sort((p, q) => p[0] - q[0])) {
    const a = Math.floor(key / 65536);
    const b = key % 65536;
    if (!index.has(a)) index.set(a, index.size);
    if (!index.has(b)) index.set(b, index.size);
    edges.push([index.get(a) as number, index.get(b) as number, w]);
    m += w;
  }
  const n = index.size;
  // e[i][j]: half the fraction of tie weight between communities i and j (i ≠ j); a[i]: fraction of tie ends in i
  const e: Map<number, number>[] = Array.from({ length: n }, () => new Map<number, number>());
  const a = new Array<number>(n).fill(0);
  const inside = new Array<number>(n).fill(0);
  for (const [i, j, w] of edges) {
    const f = w / (2 * m);
    e[i]!.set(j, (e[i]!.get(j) ?? 0) + f);
    e[j]!.set(i, (e[j]!.get(i) ?? 0) + f);
    a[i] = (a[i] as number) + f;
    a[j] = (a[j] as number) + f;
  }
  const alive = new Array<boolean>(n).fill(true);
  let communities = n;
  for (;;) {
    let best = 0;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      for (const [j, eij] of e[i]!) {
        if (j <= i || !alive[j]) continue;
        const dq = 2 * (eij - (a[i] as number) * (a[j] as number));
        if (dq > best + 1e-12) {
          best = dq;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) break;
    // merge bj into bi
    inside[bi] = (inside[bi] as number) + (inside[bj] as number) + 2 * (e[bi]!.get(bj) ?? 0);
    for (const [k, w] of e[bj]!) {
      if (k === bi) continue;
      e[bi]!.set(k, (e[bi]!.get(k) ?? 0) + w);
      e[k]!.set(bi, (e[k]!.get(bi) ?? 0) + w);
      e[k]!.delete(bj);
    }
    e[bi]!.delete(bj);
    e[bj]!.clear();
    a[bi] = (a[bi] as number) + (a[bj] as number);
    alive[bj] = false;
    communities--;
  }
  let q = 0;
  for (let i = 0; i < n; i++) if (alive[i]) q += (inside[i] as number) - (a[i] as number) * (a[i] as number);
  return { people: n, ties: edges.length, weight: m, communities, modularity: Math.round(q * 1000) };
}
