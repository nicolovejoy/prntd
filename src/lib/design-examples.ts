/**
 * Example design prompts shared by the landing hero chips (tap = navigate to
 * /design?prompt= and generate immediately) and the in-chat empty-state chips
 * (tap = prefill the composer). One library, two jobs. Each entry is also the
 * literal generation prompt, so every entry keeps a subject + style — "A
 * wolf" is not acceptable, "Geometric wolf head" is.
 *
 * `EXAMPLE_CATEGORIES` groups the 300 prompts into 12 categories of 25 so a
 * shown trio can be drawn from 3 distinct categories (never three animals in
 * a row). `EXAMPLES` is the flattened list — kept as a named export so
 * existing imports (tests, the exact-text e2e assertion) don't break.
 *
 * `pickExamplePrompts` is pure and takes an injectable `rand`, so callers can
 * get a deterministic pick in tests and a real random pick at runtime. See
 * `src/components/use-example-prompts.ts` for how the hero/composer avoid a
 * hydration mismatch by picking deterministically on first render and only
 * randomizing after mount.
 */

export interface ExampleCategory {
  name: string;
  prompts: string[];
}

export const EXAMPLE_CATEGORIES: ExampleCategory[] = [
  {
    name: "Animals & creatures",
    prompts: [
      "Geometric wolf head",
      "Watercolor fox portrait",
      "Line art hummingbird",
      "Origami paper crane",
      "Chibi cartoon panda",
      "Vintage lion engraving",
      "Minimalist owl silhouette",
      "Stencil elephant portrait",
      "Pixel art cat",
      "Ink wash koi fish",
      "Bold tiger stripe pattern",
      "Woodcut bear illustration",
      "Cute cartoon sloth",
      "Realistic howling wolf",
      "Abstract butterfly wings",
      "Retro cartoon dinosaur",
      "Silhouette flying raven",
      "Geometric deer antlers",
      "Cartoon axolotl smiling",
      "Vintage badge with falcon",
      "Sketchy hedgehog doodle",
      "Bold graphic rooster",
      "Minimalist hare outline",
      "Tribal pattern eagle",
      "Doodle style corgi",
    ],
  },
  {
    name: "Nature & landscapes",
    prompts: [
      "Minimalist mountain landscape",
      "Retro palm sunset gradient",
      "Foggy pine forest sketch",
      "Desert cactus line art",
      "Watercolor cherry blossoms",
      "Bold sunflower field",
      "Geometric canyon layers",
      "Ink wash bamboo grove",
      "Silhouette lone oak tree",
      "Vintage postcard waterfall",
      "Minimalist single pine tree",
      "Stencil autumn maple leaf",
      "Line art desert dunes",
      "Abstract lightning storm",
      "Woodcut redwood forest",
      "Cartoon rainbow over hills",
      "Vintage botanical fern",
      "Geometric snowy peaks",
      "Watercolor lavender field",
      "Silhouette windmill sunset",
      "Bold graphic tornado",
      "Sketchy meadow wildflowers",
      "Minimalist northern lights",
      "Vintage countryside barn",
      "Line art rolling hills",
    ],
  },
  {
    name: "Typography & lettering",
    prompts: [
      '"HELLO" in graffiti letters',
      '"STAY WILD" bold serif type',
      '"GOOD VIBES" bubble letters',
      '"COFFEE FIRST" script font',
      '"NO BAD DAYS" hand lettering',
      '"WANDERLUST" varsity type',
      '"BE KIND" retro block letters',
      '"SUNSHINE" neon sign style',
      '"OUTLAW" western wood type',
      '"DREAM BIG" cursive script',
      '"CHAOS" distressed grunge type',
      '"RISE UP" stencil letters',
      '"SLOW DOWN" minimalist type',
      '"WILD HEART" tattoo script',
      '"MADE WITH LOVE" chalk font',
      '"NIGHT OWL" gothic lettering',
      '"ADVENTURE" vintage badge type',
      '"STAY SALTY" beach script',
      '"PURE ENERGY" bold graffiti',
      '"KEEP GOING" hand drawn type',
      '"LUCKY" retro circus font',
      '"NOMAD" rugged serif type',
      '"FRESH START" bubble font',
      '"TRUE NORTH" compass script',
      '"GOLDEN HOUR" retro type',
    ],
  },
  {
    name: "Space & astronomy",
    prompts: [
      "Retro rocket ship poster",
      "Minimalist Saturn rings",
      "Geometric constellation map",
      "Watercolor nebula burst",
      "Line art crescent moon",
      "Vintage space explorer badge",
      "Bold graphic comet trail",
      "Abstract galaxy swirl",
      "Silhouette astronaut floating",
      "Stencil UFO with stars",
      "Cartoon smiling planet",
      "Ink wash meteor shower",
      "Geometric solar system",
      "Retro alien spaceship",
      "Minimalist shooting star",
      "Vintage lunar lander",
      "Bold graphic sun rays",
      "Watercolor starry sky",
      "Sketchy telescope doodle",
      "Woodcut moon phases",
      "Abstract black hole swirl",
      "Cartoon rocket launch",
      "Geometric star cluster",
      "Vintage cosmonaut badge",
      "Minimalist orbiting rings",
    ],
  },
  {
    name: "Food & drink",
    prompts: [
      "Bold graphic donut stack",
      "Retro diner milkshake",
      "Watercolor avocado slice",
      "Cartoon taco with legs",
      "Minimalist coffee cup",
      "Vintage pizza slice badge",
      "Line art ramen bowl",
      "Geometric ice cream cone",
      "Sketchy croissant doodle",
      "Bold graphic hot sauce",
      "Retro soda pop bottle",
      "Cartoon dancing pancake",
      "Watercolor watermelon slice",
      "Vintage bakery bread loaf",
      "Minimalist sushi roll",
      "Stencil chili pepper",
      "Cartoon happy egg character",
      "Ink wash cup of tea",
      "Bold graphic burger stack",
      "Retro popcorn box",
      "Geometric honeycomb drip",
      "Watercolor cherry cluster",
      "Vintage lemonade stand sign",
      "Cartoon smiling strawberry",
      "Minimalist teapot silhouette",
    ],
  },
  {
    name: "Music",
    prompts: [
      "Retro cassette tape badge",
      "Bold graphic electric guitar",
      "Minimalist vinyl record",
      "Watercolor saxophone player",
      "Geometric sound wave pattern",
      "Vintage boombox illustration",
      "Line art grand piano",
      "Cartoon dancing headphones",
      "Stencil microphone silhouette",
      "Retro concert poster stars",
      "Abstract music notes swirl",
      "Bold graphic drum set",
      "Vintage jazz trumpet badge",
      "Minimalist treble clef",
      "Sketchy violin doodle",
      "Woodcut acoustic guitar",
      "Cartoon singing bird notes",
      "Retro radio dial badge",
      "Geometric speaker stack",
      "Watercolor DJ turntables",
      "Bold graphic tambourine",
      "Vintage banjo illustration",
      "Minimalist equalizer bars",
      "Line art harmonica sketch",
      "Retro punk rock badge",
    ],
  },
  {
    name: "Sport & motion",
    prompts: [
      "Bold graphic basketball hoop",
      "Retro skateboard deck art",
      "Minimalist running shoe",
      "Watercolor surfboard wave",
      "Geometric soccer ball burst",
      "Vintage boxing gloves badge",
      "Line art tennis racket",
      "Cartoon jumping athlete",
      "Stencil baseball diamond",
      "Retro roller skates badge",
      "Bold graphic mountain bike",
      "Abstract sprinter silhouette",
      "Vintage bowling pin badge",
      "Minimalist yoga pose",
      "Watercolor kayak paddle",
      "Sketchy climbing rope doodle",
      "Woodcut snowboard jump",
      "Cartoon golf swing",
      "Retro football helmet badge",
      "Geometric volleyball spike",
      "Bold graphic hockey stick",
      "Vintage track and field badge",
      "Minimalist swimmer diving",
      "Line art archer aiming",
      "Retro fitness weights badge",
    ],
  },
  {
    name: "Retro & vintage",
    prompts: [
      "Vintage rotary telephone",
      "Retro arcade game cabinet",
      "80s neon grid sunset",
      "Vintage typewriter keys",
      "Retro drive-in movie sign",
      "Vintage record store facade",
      "Vintage polaroid camera",
      "Retro roller rink disco ball",
      "Retro gas station pump",
      "70s groovy flower pattern",
      "Retro TV static pattern",
      "Neon diner sign glow",
      "Old school phone booth sketch",
      "Vintage carousel horse badge",
      "Vintage postage stamp frame",
      "80s VHS tape badge",
      "Retro checkered flag pattern",
      "Vintage soda fountain counter",
      "Old school pixel game controller",
      "Retro pinball machine badge",
      "Vintage travel trailer badge",
      "70s sunburst clock design",
      "Retro jukebox illustration",
      "Vintage film reel badge",
      "Old school skate ramp badge",
    ],
  },
  {
    name: "Geometric & abstract",
    prompts: [
      "Bold triangle mosaic pattern",
      "Minimalist line art circles",
      "Abstract color block grid",
      "Geometric hexagon pattern",
      "Bauhaus inspired shapes",
      "Op art spiral illusion",
      "Abstract fluid gradient blob",
      "Pointillism dot cluster art",
      "Geometric diamond lattice",
      "Bold abstract zigzag stripes",
      "Symmetrical mandala pattern",
      "Abstract crumpled paper fold",
      "Geometric pyramid stack",
      "Minimalist negative space form",
      "Bold color field squares",
      "Abstract broken glass shards",
      "Geometric chevron stripe pattern",
      "Op art checkerboard swirl",
      "Abstract paint splatter swirl",
      "Minimalist floating square frame",
      "Bold concentric square rings",
      "Geometric spiral labyrinth",
      "Abstract torn paper collage",
      "Symmetrical kaleidoscope burst",
      "Minimalist single arc line",
    ],
  },
  {
    name: "Myth & folklore",
    prompts: [
      "Bold graphic phoenix rising",
      "Watercolor dragon silhouette",
      "Geometric griffin emblem",
      "Vintage mermaid illustration",
      "Minimalist unicorn outline",
      "Woodcut viking longship",
      "Line art centaur running",
      "Cartoon friendly gnome",
      "Stencil kraken tentacles",
      "Retro werewolf howling badge",
      "Abstract chimera silhouette",
      "Vintage fairy tale castle",
      "Bold graphic minotaur head",
      "Watercolor forest spirit",
      "Geometric thunderbird emblem",
      "Sketchy goblin doodle",
      "Woodcut dragon scale pattern",
      "Cartoon mischievous sprite",
      "Vintage sea serpent badge",
      "Minimalist witch hat outline",
      "Bold graphic valkyrie shield",
      "Retro yeti footprint badge",
      "Line art pegasus flying",
      "Geometric ouroboros circle",
      "Vintage genie lamp badge",
    ],
  },
  {
    name: "Ocean & marine",
    prompts: [
      "Watercolor jellyfish glow",
      "Geometric whale silhouette",
      "Bold graphic octopus curl",
      "Minimalist wave line pattern",
      "Vintage anchor illustration",
      "Line art sea turtle swim",
      "Retro lighthouse postcard",
      "Cartoon smiling narwhal",
      "Woodcut sailing ship badge",
      "Abstract coral reef pattern",
      "Stencil seahorse silhouette",
      "Bold graphic hammerhead shark",
      "Vintage nautical rope knot",
      "Watercolor starfish cluster",
      "Minimalist crab outline",
      "Geometric wave crest pattern",
      "Retro surf shack badge",
      "Cartoon dancing crab claw",
      "Line art pufferfish sketch",
      "Bold graphic pearl in shell",
      "Bold graphic dolphin leap",
      "Woodcut fishing boat badge",
      "Abstract tidal wave swirl",
      "Minimalist tide pool rocks",
      "Retro deep sea diver badge",
    ],
  },
  {
    name: "Machines & vehicles",
    prompts: [
      "Retro muscle car silhouette",
      "Bold graphic robot head",
      "Vintage motorcycle badge",
      "Geometric jet engine pattern",
      "Minimalist bicycle outline",
      "Line art vintage tractor",
      "Watercolor hot air balloon",
      "Retro camper van postcard",
      "Cartoon friendly go-kart",
      "Stencil gear mechanism pattern",
      "Bold graphic race car badge",
      "Vintage biplane illustration",
      "Geometric submarine emblem",
      "Woodcut steam locomotive",
      "Abstract circuit board pattern",
      "Retro scooter delivery badge",
      "Minimalist sailboat outline",
      "Cartoon happy forklift",
      "Line art vintage sewing machine",
      "Bold graphic monster truck",
      "Vintage fire engine badge",
      "Geometric drone silhouette",
      "Retro convertible cruiser",
      "Woodcut old pickup truck",
      "Minimalist crane machine",
    ],
  },
];

/** Flattened 300-entry library. Kept as a named export for existing imports. */
export const EXAMPLES: string[] = EXAMPLE_CATEGORIES.flatMap(
  (category) => category.prompts
);

/**
 * Pure. Picks `count` prompts drawn from `count` distinct categories (so a
 * shown trio is never three animals) using an injectable `rand` — defaults
 * to `Math.random`, but tests inject a deterministic one. Falls back to
 * allowing repeat categories when `count` exceeds the category count, rather
 * than throwing.
 */
export function pickExamplePrompts(
  count: number,
  rand: () => number = Math.random
): string[] {
  const categories = EXAMPLE_CATEGORIES;
  if (categories.length === 0 || count <= 0) return [];

  const categoryIndices: number[] = [];
  if (count <= categories.length) {
    // Distinct categories: draw without replacement from an index pool.
    const pool = categories.map((_, i) => i);
    for (let i = 0; i < count; i++) {
      const pick = Math.floor(rand() * pool.length);
      categoryIndices.push(pool[pick]);
      pool.splice(pick, 1);
    }
  } else {
    // More picks requested than categories exist: allow repeats.
    for (let i = 0; i < count; i++) {
      categoryIndices.push(Math.floor(rand() * categories.length));
    }
  }

  return categoryIndices.map((categoryIndex) => {
    const prompts = categories[categoryIndex].prompts;
    const promptIndex = Math.floor(rand() * prompts.length);
    return prompts[promptIndex];
  });
}
