/**
 * The field journal: things an observer might hope to see, entered when — and only when —
 * the engine logs that they happened in this world.
 *
 * Nothing here is an objective the citizens are told about, and nothing is scored. Each
 * page starts as a question; the first logged event of that kind turns it into an entry
 * with the day, the people and the place. A world in which nobody ever lights a fire simply
 * keeps that question open.
 */
import type { SimEvent } from "@/engine";
import type { ChronicleEntry } from "./text";

export interface JournalDef {
  id: string;
  /** What the observer is waiting to find out. */
  question: string;
  /** The page's title once it has been seen. */
  title: string;
  /** Why an observer would care; a description of the thing, never a claim about what it proves. */
  why: string;
  /** True for a page that can only be seen in a world with crafts: it is not asked anywhere else. */
  crafts?: true;
}

export interface JournalEntry {
  id: string;
  tick: number;
  /** The engine's own account of the event that was seen. */
  text: string;
  agents: number[];
  x?: number;
  y?: number;
}

export const JOURNAL: readonly JournalDef[] = [
  { id: "fire", question: "Will anyone light a fire?", title: "A first fire", why: "A fire outlasts the work of making it, and warms whoever sits by it, whoever built it." },
  { id: "shelter", question: "Will anyone raise a roof?", title: "A roof", why: "A shelter is labour spent today on nights that have not come yet." },
  { id: "store", question: "Will anything be put by for later?", title: "Something put by", why: "A store holds goods apart from anyone's hands, which raises the question of whose they are." },
  { id: "plot", question: "Will anyone plant?", title: "Seed in the ground", why: "Planting is a wager on a harvest weeks away, and on still being there to take it." },
  { id: "tool", question: "Will anyone make a tool?", title: "A made thing", why: "A tool is time spent on not gathering, in order to gather better." },
  { id: "gift", question: "Will anyone give something away?", title: "A gift", why: "Nothing obliges it. What follows a gift is worth watching: a return, a habit, or nothing." },
  { id: "told", question: "Will knowledge pass from one person to another?", title: "Told, not seen", why: "From here on, some of what people believe about the island is second-hand, and may be out of date or wrong." },
  { id: "kept", question: "Will a promise be kept?", title: "A promise kept", why: "A promise binds only as far as the people involved let it." },
  { id: "broken", question: "Will a promise be broken?", title: "A promise broken", why: "The one it was made to remembers." },
  { id: "trade", question: "Will two people exchange one thing for another?", title: "An exchange", why: "Each gave up something they had for something they wanted more." },
  { id: "proposed", question: "Will anyone put a standing agreement to the others?", title: "An agreement put forward", why: "How it came to be proposed is recorded with it, and decides what may be said about it." },
  { id: "ratified", question: "Will enough people sign one for it to take force?", title: "An agreement in force", why: "From this moment the engine applies its rules to the people who signed, and to nobody else." },
  { id: "breach", question: "Will a rule be broken, and seen to be?", title: "A rule broken", why: "A rule matters as far as someone notices when it is broken, and something follows." },
  { id: "ended", question: "Will an agreement come to an end?", title: "An agreement ended", why: "Whether an arrangement lasts is as much a finding as whether it appears." },
  { id: "depleted", question: "Will a place be stripped bare?", title: "A place stripped bare", why: "Whoever took the last of it paid no more than whoever took the first." },
  { id: "recovered", question: "…and will it come back?", title: "And it came back", why: "Left alone, some things renew themselves; how long they are left alone is up to the people." },
  { id: "path", question: "Will feet wear a path?", title: "A beaten path", why: "Nobody planned it. Enough people walked the same way that the ground now shows it, and walking there is easier." },
  { id: "death", question: "Will everyone live?", title: "The first death", why: "The cause is recorded. A cairn marks the place." },
  { id: "arrival", question: "Will strangers come ashore?", title: "Strangers ashore", why: "They know nothing of the island or of the people already on it." },
  { id: "winter", question: "Will they see a winter?", title: "First winter", why: "Days are short, the cold costs warmth every hour, and little grows." },
  { id: "spring", question: "…and come through it?", title: "Through the winter", why: "Who is still here, and what they built to get here, is the record of that winter." },
  // worlds with crafts
  { id: "craft", question: "Will anyone work out something nobody showed them?", title: "A craft found", why: "It came from that person's own practice. Until someone else takes it in, it is theirs alone, and dies with them.", crafts: true },
  { id: "watched", question: "…and will it pass to anyone else?", title: "Taken in by watching", why: "A craft spreads by being practised where others can see. Who gets to stand near is not written anywhere.", crafts: true },
  { id: "field", question: "Will anyone dig a field?", title: "A field", why: "A field bears again and again for whoever sows it — and for whoever reaps it, which need not be the same person.", crafts: true },
  { id: "granary", question: "Will a harvest be kept?", title: "A granary", why: "Food that keeps is food that can be counted on, hoarded, shared or fought over.", crafts: true },
  { id: "house", question: "Will anyone build in stone?", title: "Walls of stone", why: "A stone house outlasts many winters and takes many hands to raise.", crafts: true },
  { id: "healing", question: "Will the sick be given a house?", title: "A house for the sick", why: "It mends only as far as someone lays up care in it, which costs them food they could have eaten.", crafts: true },
  { id: "mill", question: "Will a stream be put to work?", title: "A mill", why: "The first work on the island that nobody's arms do. What comes out of it is anyone's who gets there first, unless an agreement says otherwise.", crafts: true },
  { id: "written", question: "Will anything be written down?", title: "Something written down", why: "From here on a craft can outlive everyone who knows it.", crafts: true },
  { id: "drawn", question: "Will a thriving island draw others to it?", title: "Drawn by plenty", why: "Beds to spare and a full larder bring newcomers. They arrive hungry and knowing nothing.", crafts: true },
];

/** The pages asked in a world: every page, or without those that only a world with crafts can answer. */
export function journalOf(crafts: boolean): readonly JournalDef[] {
  return crafts ? JOURNAL : JOURNAL.filter((d) => !d.crafts);
}

const CAMPFIRE = 0;
const SHELTER = 1;
const STORE = 2;

/** The journal page, if any, that this logged event is the first sight of. */
export function pageFor(e: SimEvent): string | null {
  const kind = (e.d as { kind?: number } | undefined)?.kind;
  switch (e.k) {
    case "built":
      return kind === CAMPFIRE ? "fire" : kind === SHELTER ? "shelter" : kind === STORE ? "store" : kind === 4 ? "field" : kind === 5 ? "granary" : kind === 6 ? "house" : kind === 7 ? "healing" : kind === 8 ? "mill" : null;
    case "discovered":
      return "craft";
    case "learned":
      return e.r === "watching" ? "watched" : null;
    case "inscribed":
      return "written";
    case "plant":
      return "plot";
    case "craft":
      return "tool";
    case "give":
      return "gift";
    case "say": {
      const act = (e.d as { act?: { k?: unknown } } | undefined)?.act?.k;
      return typeof act === "string" && act.startsWith("inform") ? "told" : null;
    }
    case "promise_kept":
      return "kept";
    case "promise_broken":
      return "broken";
    case "pact_done":
      return "trade";
    case "proposal":
      return "proposed";
    case "ratified":
      return "ratified";
    case "breach":
      return "breach";
    case "dissolved":
    case "lapsed":
      return "ended";
    case "depleted":
      return "depleted";
    case "recovered":
      return "recovered";
    case "death":
      return "death";
    case "arrival":
      // someone drawn by a thriving settlement is its own page; the first stranger of any kind is the older one
      return e.r === "drawn" ? "drawn" : "arrival";
    case "season":
      return e.q === 3 ? "winter" : e.q === 0 && e.t > 96 ? "spring" : null;
    default:
      return null;
  }
}

/** Turn a logged event into a journal entry, using the Chronicle's own sentence for it. */
export function entryFrom(id: string, e: SimEvent, line: ChronicleEntry | null): JournalEntry {
  return {
    id,
    tick: e.t,
    text: line?.text ?? "",
    agents: line?.agents ?? (e.a >= 0 ? [e.a] : []),
    ...(line?.x !== undefined && line.y !== undefined ? { x: line.x, y: line.y } : {}),
  };
}
