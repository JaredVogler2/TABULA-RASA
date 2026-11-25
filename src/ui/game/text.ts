/**
 * Plain-language renderings of simulation facts for the HUD.
 *
 * Every sentence here is a fixed rendering of fields from a logged event, a validated
 * intent or an agent's recorded goal code. Nothing is generated, embellished or inferred.
 */
import { ITEMS, NODE_KINDS, RECIPES, SEASONS, STRUCTURE_KINDS, WEATHER, type SimEvent } from "@/engine";
import { ITEM_LABEL, NODE_LABEL, STRUCTURE_LABEL } from "@/worker/describe";
import type { StaticAgentView, StaticWorldView } from "@/worker/protocol";

export type ChronicleGroup = "people" | "nature" | "making" | "observer" | "institutions";

export interface ChronicleEntry {
  id: number;
  tick: number;
  kind: string;
  group: ChronicleGroup;
  text: string;
  /** Agents involved (for jump-to and filtering). */
  agents: number[];
  /** Tile to look at, if the event has a place. */
  x?: number;
  y?: number;
  /** Causal parents recorded by the engine. */
  parents: number[];
  weight: 1 | 2 | 3;
}

export function itemName(id: number | undefined, qty = 2): string {
  const key = ITEMS[id ?? -1];
  if (!key) return "something";
  const label = ITEM_LABEL[key] ?? key;
  if (qty === 1) {
    if (label === "berries") return "berry";
    if (label === "roots") return "root";
    if (label === "smoked rations") return "smoked ration";
  }
  return label;
}

export function nodeName(world: StaticWorldView | null, node: number | undefined): string {
  const kind = world && node !== undefined ? NODE_KINDS[world.nodeKind[node] ?? -1] : undefined;
  return kind ? (NODE_LABEL[kind] ?? kind) : "resource";
}

export function structureName(kind: number | undefined): string {
  const key = STRUCTURE_KINDS[kind ?? -1];
  return key ? (STRUCTURE_LABEL[key] ?? key) : "structure";
}

const CAUSES: Record<string, string> = { hunger: "hunger", thirst: "thirst", cold: "cold", exhaustion: "exhaustion", unknown: "unknown causes" };

const SHOCKS: Record<string, string> = {
  drought: "A drought set in: streams shrink to pools and bushes stop bearing",
  cold_snap: "A cold snap arrived",
  blight: "Blight struck berry bushes and root patches",
  rain: "Steady rain set in",
  bounty: "Wild resources were replenished",
  windfall: "A windfall of fish and driftwood washed ashore",
  newcomers: "Newcomers landed on the shore",
  hush: "Voices carry less far",
};

function speechText(act: Record<string, unknown> | undefined, world: StaticWorldView | null, name: (id: number) => string): string {
  const t = act?.t;
  switch (t) {
    case "greet":
      return "a greeting";
    case "inform_node":
      return `where to find a ${nodeName(world, act?.node as number)}`;
    case "inform_structure":
      return "where a structure stands";
    case "inform_agent": {
      const claim = act?.claim;
      const who = name(act?.about as number);
      return claim === "gave" ? `that ${who} gave freely` : claim === "helped" ? `that ${who} helped` : claim === "took" ? `that ${who} took what was not theirs` : claim === "kept" ? `that ${who} kept a promise` : `that ${who} broke a promise`;
    }
    case "request":
      return `a request for ${String(act?.qty)} ${itemName(act?.item as number, act?.qty as number)}`;
    case "offer":
      return `an offer of ${String(act?.giveQty)} ${itemName(act?.give as number, act?.giveQty as number)} for ${String(act?.wantQty)} ${itemName(act?.want as number, act?.wantQty as number)}`;
    case "accept":
      return "acceptance";
    case "decline":
      return "a refusal";
    case "promise":
      return `a promise of ${String(act?.qty)} ${itemName(act?.item as number, act?.qty as number)}`;
    case "announce":
      return "news of a proposal";
    case "invite":
      return "an invitation";
    case "warn":
      return "a warning that a place is stripped bare";
    default:
      return "something";
  }
}

const MOTION: Record<string, string> = {
  amend: "change the rules",
  admit: "admit a new member",
  expel: "put a member out",
  assign: "give someone a role",
  grant: "grant a member something from the common stock",
  bind: "place a structure under common control",
  release: "release a structure",
  dissolve: "dissolve the institution",
};

/** Turn a logged event into a Chronicle entry, or null if the Chronicle does not show that kind. */
export function chronicle(e: SimEvent, world: StaticWorldView | null, roster: StaticAgentView[]): ChronicleEntry | null {
  const name = (id: number) => roster[id]?.name ?? "Someone";
  const base = { id: e.id, tick: e.t, kind: e.k, parents: e.p ?? [], agents: e.a >= 0 ? [e.a] : [] as number[] };
  const place = e.x !== undefined && e.y !== undefined ? { x: e.x, y: e.y } : {};
  const nodePlace = world && e.n !== undefined ? { x: world.nodeX[e.n] as number, y: world.nodeY[e.n] as number } : {};
  switch (e.k) {
    case "death":
      return { ...base, ...place, group: "people", weight: 3, text: `${name(e.a)} died of ${CAUSES[e.r ?? "unknown"] ?? e.r}.` };
    case "arrival":
      return { ...base, ...place, group: "people", weight: 2, text: `${name(e.a)} came ashore.` };
    case "ill":
      return { ...base, group: "people", weight: 1, text: `${name(e.a)} fell ill.` };
    case "recover":
      return { ...base, group: "people", weight: 1, text: `${name(e.a)} recovered.` };
    case "give":
      return { ...base, agents: [e.a, e.b ?? -1].filter((x) => x >= 0), group: "people", weight: 2, text: `${name(e.a)} gave ${e.q} ${itemName(e.i, e.q)} to ${name(e.b ?? -1)}.` };
    case "say": {
      const d = e.d as { act?: Record<string, unknown>; text?: string } | undefined;
      const what = speechText(d?.act, world, name);
      const quoted = d?.text ? ` “${d.text}”` : "";
      return {
        ...base,
        ...place,
        agents: [e.a, e.b ?? -1].filter((x) => x >= 0),
        group: "people",
        weight: 1,
        text: e.b !== undefined ? `${name(e.a)} told ${name(e.b)} ${what}.${quoted}` : `${name(e.a)} called out ${what}.${quoted}`,
      };
    }
    case "found":
      return { ...base, ...place, group: "making", weight: 2, text: `${name(e.a)} began a ${structureName((e.d as { kind?: number } | undefined)?.kind)}.` };
    case "built": {
      const d = e.d as { kind?: number; contributors?: number[] } | undefined;
      const others = (d?.contributors ?? []).filter((c) => c !== e.a);
      const withText = others.length === 0 ? "" : others.length === 1 ? ` with ${name(others[0] as number)}` : ` with ${others.length} others`;
      return { ...base, ...place, agents: [e.a, ...others], group: "making", weight: 3, text: `${name(e.a)} finished a ${structureName(d?.kind)}${withText}.` };
    }
    case "plant":
      return { ...base, ...place, group: "making", weight: 2, text: `${name(e.a)} planted a plot.` };
    case "harvest": {
      const mine = e.b === undefined || e.b === e.a;
      return { ...base, agents: [e.a, ...(mine ? [] : [e.b as number])], group: "making", weight: 2, text: mine ? `${name(e.a)} harvested ${e.q} roots from a plot they planted.` : `${name(e.a)} harvested ${e.q} roots from a plot that ${name(e.b as number)} planted.` };
    }
    case "craft": {
      const recipe = RECIPES[(e.d as { recipe?: number } | undefined)?.recipe ?? -1];
      const made = recipe && recipe.outQty > 1 ? `${recipe.outQty} ${itemName(e.i, recipe.outQty)}` : `a ${itemName(e.i, 1)}`;
      return { ...base, group: "making", weight: 2, text: `${name(e.a)} made ${made}.` };
    }
    case "tool_broke":
      return { ...base, group: "making", weight: 1, text: `${name(e.a)}'s ${itemName(e.i, 1)} wore out.` };
    case "deposit":
      return { ...base, group: "making", weight: 1, text: `${name(e.a)} stored ${e.q} ${itemName(e.i, e.q)}.` };
    case "withdraw":
      return { ...base, group: "making", weight: 1, text: `${name(e.a)} took ${e.q} ${itemName(e.i, e.q)} from a store.` };
    case "depleted":
      return { ...base, ...nodePlace, group: "nature", weight: 2, text: `A ${nodeName(world, e.n)} was stripped bare.` };
    case "recovered":
      return { ...base, ...nodePlace, group: "nature", weight: 1, text: `A ${nodeName(world, e.n)} began to recover.` };
    case "fire_out":
      return { ...base, ...place, group: "nature", weight: 1, text: "A fire burned out." };
    case "collapse":
      return { ...base, ...place, group: "nature", weight: 2, text: "A structure fell into ruin." };
    case "weather":
      return { ...base, group: "nature", weight: 1, text: `The weather turned ${e.r === "clear" ? "clear" : e.r === "overcast" ? "overcast" : e.r === "rain" ? "to rain" : e.r === "storm" ? "stormy" : "to snow"}.` };
    case "season": {
      const s = SEASONS[e.q ?? 0] ?? "spring";
      return { ...base, group: "nature", weight: 3, text: `${s[0]!.toUpperCase()}${s.slice(1)} began.` };
    }
    case "proposal": {
      const d = e.d as { name?: string; origin?: string } | undefined;
      const how = d?.origin === "scripted" ? " (a scripted control charter)" : d?.origin === "grammar_search" ? " (found by searching the rule grammar)" : d?.origin === "mock" ? " (MOCK)" : "";
      return { ...base, ...place, group: "institutions", weight: 3, text: `${name(e.a)} proposed a charter, “${d?.name ?? "unnamed"}”${how}.` };
    }
    case "proposal_rejected":
      return { ...base, group: "institutions", weight: 1, text: `${name(e.a)} proposed something the rule grammar cannot express (${String(e.r ?? "invalid").replace(/_/g, " ")}); nothing came of it.` };
    case "endorse":
      return { ...base, agents: [e.a, ...(e.b !== undefined ? [e.b] : [])], group: "institutions", weight: 1, text: `${name(e.a)} signed ${e.b !== undefined ? `${name(e.b)}'s` : "a"} charter.` };
    case "ratified": {
      const d = e.d as { name?: string; members?: number[] } | undefined;
      return { ...base, ...place, agents: d?.members ?? base.agents, group: "institutions", weight: 3, text: `“${d?.name ?? "A charter"}” came into force with ${d?.members?.length ?? 0} founders.` };
    }
    case "lapsed":
      return { ...base, group: "institutions", weight: 1, text: `${name(e.a)}'s charter lapsed for want of founders.` };
    case "joined":
      return (e.d as { founder?: boolean } | undefined)?.founder ? null : { ...base, group: "institutions", weight: 1, text: `${name(e.a)} joined an institution.` };
    case "left":
      return { ...base, group: "institutions", weight: 2, text: `${name(e.a)} left an institution and took back their bond.` };
    case "expelled":
      return { ...base, group: "institutions", weight: 2, text: `${name(e.a)} was put out of an institution.` };
    case "motion": {
      const d = e.d as { m?: string } | undefined;
      return { ...base, group: "institutions", weight: 1, text: `${name(e.a)} moved to ${MOTION[d?.m ?? ""] ?? "change something"}.` };
    }
    case "motion_result": {
      const d = e.d as { m?: string; yes?: number; no?: number } | undefined;
      return { ...base, group: "institutions", weight: 2, text: `A motion to ${MOTION[d?.m ?? ""] ?? "change something"} ${e.r === "passed" ? "passed" : "failed"}, ${d?.yes ?? 0} for and ${d?.no ?? 0} against.` };
    }
    case "breach":
      return { ...base, agents: [e.a, ...(e.b !== undefined ? [e.b] : [])], group: "institutions", weight: 2, text: e.b !== undefined ? `${name(e.b)} saw ${name(e.a)} break a rule they had both agreed to.` : `${name(e.a)} did not do what their charter required.` };
    case "sanction":
      return { ...base, group: "institutions", weight: 2, text: e.r === "forfeit" ? `${name(e.a)} forfeited ${e.q ?? 0} of their bond.` : e.r === "suspend" ? `${name(e.a)} was suspended from the common stock.` : `${name(e.a)} was put out for breaking the rules.` };
    case "dissolved": {
      const d = e.d as { name?: string } | undefined;
      return { ...base, ...place, group: "institutions", weight: 3, text: `“${d?.name ?? "An institution"}” came to an end (${String(e.r ?? "").replace(/_/g, " ")}).` };
    }
    case "pact_done": {
      const d = e.d as { gave?: number; gaveQty?: number; got?: number; gotQty?: number } | undefined;
      return { ...base, ...place, agents: [e.a, ...(e.b !== undefined ? [e.b] : [])], group: "institutions", weight: 2, text: `${name(e.a)} gave ${name(e.b ?? -1)} ${d?.gaveQty ?? 0} ${itemName(d?.gave, d?.gaveQty)} for ${d?.gotQty ?? 0} ${itemName(d?.got, d?.gotQty)}.` };
    }
    case "promise_kept":
      return { ...base, agents: [e.a, ...(e.b !== undefined ? [e.b] : [])], group: "people", weight: 2, text: `${name(e.a)} kept a promise to ${name(e.b ?? -1)}.` };
    case "promise_broken":
      return { ...base, agents: [e.a, ...(e.b !== undefined ? [e.b] : [])], group: "people", weight: 2, text: `${name(e.a)} broke a promise to ${name(e.b ?? -1)}.` };
    case "shock":
    case "intervention": {
      const d = e.d as { kind?: string; days?: number; x?: number; y?: number } | undefined;
      const what = SHOCKS[d?.kind ?? ""] ?? "The world changed";
      const dur = d?.days && ["drought", "cold_snap", "rain", "hush"].includes(d.kind ?? "") ? ` for ${d.days} days` : "";
      const xy = d?.x !== undefined && d?.y !== undefined ? { x: d.x, y: d.y } : {};
      return { ...base, ...xy, group: "observer", weight: 3, text: e.k === "intervention" ? `You intervened. ${what}${dur}.` : `${what}${dur}.` };
    }
    default:
      return null;
  }
}

/** Sentence for an agent's recorded goal code and reason code. */
export function goalSentence(goal: string, why: string): string {
  const reasons: Record<string, string> = {
    thirsty: "is thirsty",
    parched: "is dangerously thirsty",
    passing_water: "is beside fresh water",
    top_up: "has water nearby",
    no_water_known: "knows of no fresh water",
    hungry: "is hungry",
    starving: "is starving",
    peckish: "has food in hand",
    found_food: "found food on the ground",
    buffer: "wants a little food in reserve",
    no_food_known: "knows of no food",
    by_fire: "is warming up by a fire",
    go_to_fire: "is cold and knows of a lit fire",
    relight: "the fire has gone out",
    // reasons recorded by the planning layer
    stock: "wants more food in hand than today needs",
    cold_coming: "the days are getting colder",
    fish_spoils: "fresh fish will not keep",
    carry_more: "could carry more with a basket",
    fish_better: "would catch more with a spear",
    need_wood: "expects to need a lot of wood",
    finish_fire: "a hearth nearby is unfinished",
    feed_for_night: "the night will be cold",
    hearth: "wants a fire to cook and gather at",
    join_work: "someone has started one nearby",
    cold_nights: "has been cold at night",
    keep_food: "has more food than can be carried safely",
    keeps_longer: "food keeps longer in a store",
    sow_for_later: "one root sown returns several",
    my_crop: "planted it",
    others_crop: "is hungry, and someone else's crop is ripe",
    promised: "gave their word",
    asked: "was asked",
    they_look_hungry: "someone nearby looks hungry",
    was_helped: "was fed when in need",
    warn_about_someone: "someone let them down",
    speak_well: "someone did right by them",
    it_is_bare: "found a place stripped bare",
    food_is_there: "knows where food is plentiful",
    from_my_store: "has food put by in a store they built",
    from_a_store: "knows a store with food in it",
    found_on_ground: "saw food lying on the ground",
    hungry_and_empty_handed: "is hungry, with nothing in hand and no food known",
    night_is_coming: "the light is failing",
    undertook_to: "undertook to when they signed",
    hungry_and_entitled: "is hungry and the charter allows it",
    entitled: "the charter allows it",
    seeking_founders: "it needs more signatures to come into force",
    seeking_members: "it is open to new members",
    not_worth_it: "rates its rules as not worth living under",
    for: "judges it would be better off",
    against: "judges it would be worse off",
    was_taken_from: "someone took what they had put by",
    has_gone_hungry: "has gone hungry",
    found_places_bare: "keeps finding places stripped bare",
    has_been_cold: "has been cold at night",
    food_when_hungry: "it would feed them when hungry",
    safe_keeping: "food keeps better behind a lock",
    a_roof: "it offers a roof",
    a_kept_fire: "it promises a fire that does not go out",
    others_restraint: "others would hold back too",
    nothing_in_it: "sees nothing against it",
    build_fire: "is cold and carries wood and stone",
    shelter: "is cold and knows a shelter",
    fetch_wood: "is cold and needs wood for a fire",
    fetch_stone: "is cold and needs stone for a hearth",
    night: "it is night",
    tired: "is exhausted",
    curious: "has nothing pressing to do",
    content: "has no pressing need",
  };
  const goals: Record<string, string> = {
    drink: "Going to drink",
    seek_water: "Searching for fresh water",
    eat: "Eating",
    forage: "Foraging",
    seek_food: "Searching for food",
    warm: "Getting warm",
    sleep: "Sleeping",
    explore: "Exploring",
    idle: "Idling",
    start: "Just arrived",
    provision: "Gathering food",
    preserve: "Smoking fish over a fire",
    make_basket: "Making a basket",
    make_spear: "Making a spear",
    make_axe: "Making an axe",
    build_fire: "Building a hearth",
    tend_fire: "Tending a fire",
    build_shelter: "Building a shelter",
    build_store: "Building a store",
    stash: "Putting food by",
    plant: "Planting",
    reap: "Harvesting",
    give: "Giving food away",
    repay: "Keeping a promise",
    pledge: "Promising to repay",
    tell: "Telling others",
    ask: "Asking for food",
    go_home: "Heading home",
    own_plan: "Following a plan of their own",
    vote: "Voting",
    pay_dues: "Paying dues into the common stock",
    draw_ration: "Drawing a ration",
    sign: "Signing a charter",
    announce: "Telling others about a charter",
    propose: "Proposing a charter",
    leave: "Leaving an institution",
    feed_hearth: "Bringing wood to the common hearth",
    build_together: "Working on a shared building",
  };
  const g = goals[goal] ?? goal.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const r = reasons[why];
  if (r) return `${g} — ${r}.`;
  // an externally driven mind states its reason in its own words; it is shown as a quotation, unedited
  if (why && /\s/.test(why)) return `${g}. Stated reason: “${why}”`;
  return `${g}.`;
}

export const MEMORY_TEXT: Record<string, string> = {
  found: "found a resource",
  empty: "found a place stripped bare",
  got: "was given",
  gave: "gave",
  refused: "was refused",
  took: "saw someone take",
  kept: "a promise was kept",
  broke: "a promise was broken",
  hungry: "went hungry",
  thirsty: "went thirsty",
  cold: "was cold",
  exhausted: "was exhausted",
  death: "saw a death",
  heard: "was told something",
  built: "helped build",
  proposal: "heard a proposal",
  joined: "joined a group",
  spoiled: "lost food to rot",
};

export function clock(tickOfDay: number): string {
  // tick 0 is 06:00; four ticks per hour
  const minutes = (6 * 60 + tickOfDay * 15) % (24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function seasonName(season: number): string {
  const s = SEASONS[season] ?? "spring";
  return s[0]!.toUpperCase() + s.slice(1);
}

export function weatherName(weather: number): string {
  const w = WEATHER[weather] ?? "clear";
  return w[0]!.toUpperCase() + w.slice(1);
}

export function tickLabel(tick: number): string {
  const day = Math.floor(tick / 96);
  return `Day ${day + 1}, ${clock(tick % 96)}`;
}
