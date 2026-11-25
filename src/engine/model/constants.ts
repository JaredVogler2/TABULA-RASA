/**
 * Static vocabulary of the world: time, items, resource nodes, biomes, structures, skills.
 * Numeric ids are part of the save format — never renumber, only append.
 *
 * All simulation quantities are integers. Needs use a 0..1000 "permille" scale.
 */

// ───────────────────────── time
export const TICKS_PER_DAY = 96; // 15 simulated minutes per tick; tick-of-day 0 is 06:00
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

// ───────────────────────── items
export const ITEMS = [
  "berry",
  "root",
  "fish",
  "ration",
  "wood",
  "stone",
  "fiber",
  "clay",
  "water",
  "axe",
  "spear",
  "basket",
  "pot",
] as const;
export type ItemName = (typeof ITEMS)[number];
export const ITEM_COUNT = ITEMS.length;

export const Item = {
  berry: 0,
  root: 1,
  fish: 2,
  ration: 3,
  wood: 4,
  stone: 5,
  fiber: 6,
  clay: 7,
  water: 8,
  axe: 9,
  spear: 10,
  basket: 11,
  pot: 12,
} as const satisfies Record<ItemName, number>;
export type ItemId = (typeof Item)[ItemName];

export type ItemClass = "food" | "material" | "water" | "tool";

export interface ItemSpec {
  id: number;
  name: ItemName;
  cls: ItemClass;
  /** Carry weight per unit. */
  weight: number;
  /** Energy restored per unit eaten (0 for non-food). */
  energy: number;
  /** Hydration restored per unit consumed. */
  hydration: number;
  /** Chance per unit per day, in permille, that a unit spoils when carried or on the ground. */
  spoil: number;
  /** Uses before a tool breaks (0 for non-tools). */
  uses: number;
  /**
   * Food-equivalent value used only by metrics (inequality) and by baseline agents' utility
   * estimates. It is NOT a price: nothing in the engine trades at this rate.
   */
  worth: number;
}

export const ITEM_SPECS: readonly ItemSpec[] = [
  { id: 0, name: "berry", cls: "food", weight: 1, energy: 110, hydration: 20, spoil: 170, uses: 0, worth: 10 },
  { id: 1, name: "root", cls: "food", weight: 2, energy: 170, hydration: 0, spoil: 35, uses: 0, worth: 15 },
  { id: 2, name: "fish", cls: "food", weight: 3, energy: 260, hydration: 0, spoil: 330, uses: 0, worth: 22 },
  { id: 3, name: "ration", cls: "food", weight: 2, energy: 230, hydration: 0, spoil: 10, uses: 0, worth: 26 },
  { id: 4, name: "wood", cls: "material", weight: 4, energy: 0, hydration: 0, spoil: 0, uses: 0, worth: 8 },
  { id: 5, name: "stone", cls: "material", weight: 6, energy: 0, hydration: 0, spoil: 0, uses: 0, worth: 10 },
  { id: 6, name: "fiber", cls: "material", weight: 1, energy: 0, hydration: 0, spoil: 0, uses: 0, worth: 4 },
  { id: 7, name: "clay", cls: "material", weight: 5, energy: 0, hydration: 0, spoil: 0, uses: 0, worth: 8 },
  { id: 8, name: "water", cls: "water", weight: 2, energy: 0, hydration: 400, spoil: 0, uses: 0, worth: 3 },
  { id: 9, name: "axe", cls: "tool", weight: 5, energy: 0, hydration: 0, spoil: 0, uses: 70, worth: 45 },
  { id: 10, name: "spear", cls: "tool", weight: 4, energy: 0, hydration: 0, spoil: 0, uses: 60, worth: 40 },
  { id: 11, name: "basket", cls: "tool", weight: 2, energy: 0, hydration: 0, spoil: 0, uses: 0, worth: 30 },
  { id: 12, name: "pot", cls: "tool", weight: 4, energy: 0, hydration: 0, spoil: 0, uses: 0, worth: 35 },
];

export const FOOD_ITEMS: readonly number[] = [Item.berry, Item.root, Item.fish, Item.ration];

/** Extra carrying capacity granted by holding a basket. */
export const BASKET_CAPACITY = 25;
/** Units of water a pot can hold. */
export const POT_WATER_CAPACITY = 5;

// ───────────────────────── terrain
export const Water = { none: 0, sea: 1, stream: 2, pond: 3 } as const;
export const BIOMES = ["sea", "shore", "wetland", "meadow", "forest", "scrub", "highland"] as const;
export type BiomeName = (typeof BIOMES)[number];
export const Biome = {
  sea: 0,
  shore: 1,
  wetland: 2,
  meadow: 3,
  forest: 4,
  scrub: 5,
  highland: 6,
} as const satisfies Record<BiomeName, number>;

/** Base ticks to enter a tile of each biome (0 = impassable). Scaled by config.movementCost. */
export const BIOME_MOVE_COST: readonly number[] = [0, 2, 4, 2, 3, 2, 4];
export const STREAM_MOVE_COST = 4;

// ───────────────────────── resource nodes
export const NODE_KINDS = [
  "berry_bush",
  "root_patch",
  "tree",
  "reed_bed",
  "stone_outcrop",
  "clay_bank",
  "fishing_water",
] as const;
export type NodeKindName = (typeof NODE_KINDS)[number];
export const NodeKind = {
  berry_bush: 0,
  root_patch: 1,
  tree: 2,
  reed_bed: 3,
  stone_outcrop: 4,
  clay_bank: 5,
  fishing_water: 6,
} as const satisfies Record<NodeKindName, number>;

export interface NodeSpec {
  kind: number;
  name: NodeKindName;
  yields: number;
  /** Ticks of work per gather action. */
  work: number;
  /** Units obtained per action at zero skill, before tools. */
  baseYield: number;
  /** Skill exercised. */
  skill: number;
  /** Tool that doubles the yield, or -1. */
  tool: number;
  /** Capacity range at generation (before richness scaling). */
  capMin: number;
  capMax: number;
  /** Renewable? Finite nodes never regrow. */
  renewable: boolean;
  /**
   * Logistic growth rate per day in permille, by season [spring, summer, autumn, winter].
   */
  growth: readonly [number, number, number, number];
  /** Fraction (permille) of standing stock lost per day in winter (die-back). */
  winterLoss: number;
  /**
   * Dormant reserve, permille of capacity: winter die-back never takes a node below it
   * (the plant outlives its fruit). Foragers still can, and then spring starts from nothing.
   */
  dormant: number;
  /**
   * Base productivity, permille of capacity: growth is rate · (stock + base) · (1 − stock/K).
   * A bush fruits from the plant, not from last week's berries, so picking it bare slows it
   * without killing it (base > 0); a shoal or a root bed reproduces from what is left (base ≈ 0),
   * which is what makes those two a commons that can be destroyed.
   */
  base: number;
  /**
   * Collapse threshold as a permille of capacity: below it, growth is multiplied by
   * `collapseFactor` permille (an Allee effect). 0 disables it.
   */
  collapseBelow: number;
  collapseFactor: number;
  /** Permille chance per day that an empty node re-seeds one unit in a growing season. */
  reseed: number;
  /** Whether the agent stands on the tile (true) or next to it (false, e.g. water). */
  standOn: boolean;
}

export const Skill = { forage: 0, fish: 1, wood: 2, mine: 3, craft: 4, build: 5, farm: 6 } as const;
export const SKILLS = ["forage", "fish", "wood", "mine", "craft", "build", "farm"] as const;
export type SkillName = (typeof SKILLS)[number];
export const SKILL_COUNT = SKILLS.length;
export const SKILL_MAX = 1000;

export const NODE_SPECS: readonly NodeSpec[] = [
  {
    kind: 0, name: "berry_bush", yields: Item.berry, work: 4, baseYield: 2, skill: Skill.forage, tool: -1,
    capMin: 8, capMax: 14, renewable: true, growth: [320, 380, 140, 0], winterLoss: 250, dormant: 250, base: 150,
    collapseBelow: 150, collapseFactor: 300, reseed: 200, standOn: true,
  },
  {
    kind: 1, name: "root_patch", yields: Item.root, work: 6, baseYield: 1, skill: Skill.forage, tool: -1,
    capMin: 5, capMax: 9, renewable: true, growth: [140, 160, 120, 20], winterLoss: 0, dormant: 0, base: 30,
    collapseBelow: 0, collapseFactor: 1000, reseed: 120, standOn: true,
  },
  {
    kind: 2, name: "tree", yields: Item.wood, work: 6, baseYield: 1, skill: Skill.wood, tool: Item.axe,
    capMin: 10, capMax: 22, renewable: true, growth: [45, 55, 25, 0], winterLoss: 0, dormant: 0, base: 40,
    collapseBelow: 0, collapseFactor: 1000, reseed: 40, standOn: true,
  },
  {
    kind: 3, name: "reed_bed", yields: Item.fiber, work: 4, baseYield: 2, skill: Skill.forage, tool: -1,
    capMin: 8, capMax: 14, renewable: true, growth: [240, 280, 120, 0], winterLoss: 80, dormant: 250, base: 150,
    collapseBelow: 0, collapseFactor: 1000, reseed: 150, standOn: true,
  },
  {
    kind: 4, name: "stone_outcrop", yields: Item.stone, work: 8, baseYield: 1, skill: Skill.mine, tool: -1,
    capMin: 30, capMax: 70, renewable: false, growth: [0, 0, 0, 0], winterLoss: 0, dormant: 0, base: 0,
    collapseBelow: 0, collapseFactor: 1000, reseed: 0, standOn: true,
  },
  {
    kind: 5, name: "clay_bank", yields: Item.clay, work: 6, baseYield: 1, skill: Skill.mine, tool: -1,
    capMin: 20, capMax: 45, renewable: false, growth: [0, 0, 0, 0], winterLoss: 0, dormant: 0, base: 0,
    collapseBelow: 0, collapseFactor: 1000, reseed: 0, standOn: true,
  },
  {
    kind: 6, name: "fishing_water", yields: Item.fish, work: 8, baseYield: 1, skill: Skill.fish, tool: Item.spear,
    capMin: 14, capMax: 26, renewable: true, growth: [260, 280, 220, 110], winterLoss: 0, dormant: 0, base: 0,
    collapseBelow: 200, collapseFactor: 200, reseed: 120, standOn: false,
  },
];

// ───────────────────────── structures
export const STRUCTURE_KINDS = ["campfire", "shelter", "store", "plot"] as const;
export type StructureKindName = (typeof STRUCTURE_KINDS)[number];
export const StructureKind = { campfire: 0, shelter: 1, store: 2, plot: 3 } as const satisfies Record<
  StructureKindName,
  number
>;

export interface StructureSpec {
  kind: number;
  name: StructureKindName;
  /** Materials required: [item, qty] pairs. */
  materials: readonly (readonly [number, number])[];
  /** Labour ticks required after materials are delivered. */
  labor: number;
  /** Maximum simultaneous occupants / storage units, depending on kind. */
  capacity: number;
}

export const STRUCTURE_SPECS: readonly StructureSpec[] = [
  { kind: 0, name: "campfire", materials: [[Item.wood, 3], [Item.stone, 2]], labor: 6, capacity: 0 },
  { kind: 1, name: "shelter", materials: [[Item.wood, 8], [Item.fiber, 6]], labor: 28, capacity: 4 },
  { kind: 2, name: "store", materials: [[Item.wood, 5], [Item.fiber, 4], [Item.stone, 2]], labor: 18, capacity: 240 },
  { kind: 3, name: "plot", materials: [[Item.root, 1]], labor: 4, capacity: 0 },
];

/** Ticks of burning provided by one unit of wood. */
export const FIRE_TICKS_PER_WOOD = 16;
/** Maximum fuel a campfire holds, in ticks. */
export const FIRE_MAX_FUEL = FIRE_TICKS_PER_WOOD * 12;
/** Radius (Chebyshev tiles) warmed by a lit fire. */
export const FIRE_RADIUS = 2;
/** Days from planting to a ripe plot, and roots yielded. */
export const PLOT_GROW_DAYS = 12;
export const PLOT_YIELD = 5;
/** Spoilage multiplier (permille) for goods inside a built store. */
export const STORE_SPOIL_FACTOR = 350;

// ───────────────────────── crafting recipes (hand tools)
export interface RecipeSpec {
  id: number;
  name: string;
  out: number;
  outQty: number;
  inputs: readonly (readonly [number, number])[];
  work: number;
  /** Requires standing within range of a lit fire. */
  needsFire: boolean;
}
export const RECIPES: readonly RecipeSpec[] = [
  { id: 0, name: "axe", out: Item.axe, outQty: 1, inputs: [[Item.stone, 1], [Item.wood, 1], [Item.fiber, 2]], work: 10, needsFire: false },
  { id: 1, name: "spear", out: Item.spear, outQty: 1, inputs: [[Item.wood, 1], [Item.stone, 1], [Item.fiber, 1]], work: 8, needsFire: false },
  { id: 2, name: "basket", out: Item.basket, outQty: 1, inputs: [[Item.fiber, 5]], work: 10, needsFire: false },
  { id: 3, name: "pot", out: Item.pot, outQty: 1, inputs: [[Item.clay, 3], [Item.wood, 1]], work: 12, needsFire: true },
  { id: 4, name: "ration", out: Item.ration, outQty: 2, inputs: [[Item.fish, 2], [Item.wood, 1]], work: 6, needsFire: true },
  { id: 5, name: "ration_from_roots", out: Item.ration, outQty: 2, inputs: [[Item.root, 3], [Item.wood, 1]], work: 6, needsFire: true },
];

// ───────────────────────── needs
export const NEED_MAX = 1000;
export const NEEDS = ["energy", "hydration", "rest", "warmth"] as const;
export type NeedName = (typeof NEEDS)[number];

/** Coarse bands other agents can see ("looks hungry"). 0 fine · 1 uneasy · 2 suffering · 3 critical */
export function needBand(value: number): 0 | 1 | 2 | 3 {
  if (value >= 550) return 0;
  if (value >= 320) return 1;
  if (value >= 140) return 2;
  return 3;
}

// ───────────────────────── weather
export const WEATHER = ["clear", "overcast", "rain", "storm", "snow"] as const;
export type WeatherName = (typeof WEATHER)[number];
export const Weather = { clear: 0, overcast: 1, rain: 2, storm: 3, snow: 4 } as const satisfies Record<
  WeatherName,
  number
>;

// ───────────────────────── traits
export const TRAITS = [
  "industry",
  "sociability",
  "generosity",
  "prudence",
  "curiosity",
  "boldness",
  "conformity",
  "trustfulness",
  "patience",
] as const;
export type TraitName = (typeof TRAITS)[number];
export const Trait = {
  industry: 0,
  sociability: 1,
  generosity: 2,
  prudence: 3,
  curiosity: 4,
  boldness: 5,
  conformity: 6,
  trustfulness: 7,
  patience: 8,
} as const satisfies Record<TraitName, number>;
export const TRAIT_COUNT = TRAITS.length;

export const PHYS = ["strength", "stamina", "dexterity", "metabolism"] as const;
export const Phys = { strength: 0, stamina: 1, dexterity: 2, metabolism: 3 } as const;
export const PHYS_COUNT = PHYS.length;
