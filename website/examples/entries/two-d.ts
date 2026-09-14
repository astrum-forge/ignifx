/**
 * 2D examples: sprites, tilemaps, parallax, pixel-perfect cameras.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleAsset, ExampleOf } from "../catalogue.ts";

/** Kenney's Tiny Town pack, which the village is built from. */
const TINY_TOWN: ExampleAsset = {
  name: "Tiny Town tileset",
  licence: "CC0 1.0",
  author: "Kenney",
  source: "https://kenney.nl/assets/tiny-town",
};

/** The repository's own generated top-down character sheet. */
const VILLAGER: ExampleAsset = {
  name: "Villager sprite sheet",
  licence: "Apache-2.0",
  author: "Astrum Forge Studios",
  source: "https://github.com/astrum-forge/ignifx/tree/main/tests/fixtures/assets/2d-templates",
};

/** The repository's own generated side-on character and terrain sheets. */
const RUNNER: ExampleAsset = {
  name: "Runner sprite sheet and side-on terrain",
  licence: "Apache-2.0",
  author: "Astrum Forge Studios",
  source: "https://github.com/astrum-forge/ignifx/tree/main/tests/fixtures/assets/2d-templates",
};

/** The 2D examples, in display order. */
export const TWO_D: readonly ExampleOf<"2D">[] = [
  {
    slug: "tilemap",
    title: "Tilemap",
    category: "2D",
    dimension: "2D",
    priority: "P0",
    status: "ready",
    line: "Explore a layered pixel-art village with solid walls and a following camera.",
    paragraph:
      "Walk through a village loaded from a Tiled map. Walls, fences and trees block movement, while roofs and treetops appear in front of the character. The camera follows the villager, and the renderer skips map sections outside the view.",
    tries: [
      "Turn off Cull chunks and watch the tile count double: the whole map is materialised instead of the part you can see.",
      "Walk into the fence, the tree trunks and the house fronts; every one of them is a collider the map file described.",
      "Follow a lane to the edge of the village: the camera stops at the map bounds rather than showing you the void.",
    ],
    uses: [
      "Tilemap",
      "TilemapRenderer",
      "TilemapCollider2D",
      "Camera2D",
      "Camera2DFollow",
      "CharacterController2D",
      "SpriteAnimator",
      "importTiledMap",
    ],
    assets: [TINY_TOWN, VILLAGER],
    controls: ["keyboard", "gamepad", "touch"],
    posterAlt:
      "A pixel-art village seen from above: a wide dirt lane crossing the frame with a spur running north, red and " +
      "grey cottages with tiled roofs along it, autumn and pine trees, mushrooms and a fenced paddock, and a small " +
      "villager in a red tunic standing on the lane.",
    sourceFiles: ["main.ts", "villager.ts", "village.tmj.json"],
    guide: "load-a-tilemap-with-collision",
  },
  {
    slug: "sprite-animation",
    title: "Sprite animation",
    category: "2D",
    dimension: "2D",
    priority: "P0",
    status: "ready",
    line: "Play sprite clips, change their speed and flip the character’s direction.",
    paragraph:
      "A sprite sheet supplies the frames for idle, run, jump and fall animations. Use the large character to try each clip, change its speed and flip its direction. The smaller characters show the clips side by side.",
    tries: [
      "Switch clips and watch the frame counter: idle is four frames at six a second, run is eight at fourteen.",
      "Turn Flip on. One set of frames, mirrored — a walk cycle is never drawn twice.",
      "Pull Speed to a quarter and then to three: the animator scales the clip's own frame rate, not the game's.",
    ],
    uses: ["SpriteRenderer", "SpriteAnimator", "SpriteAtlasAsset", "Camera2D", "gridAtlas"],
    assets: [RUNNER],
    controls: ["mouse", "touch"],
    posterAlt:
      "Five copies of the same pixel-art runner on a strip of grass and earth against a dusk-blue sky: a large one " +
      "on the left mid-stride, and four smaller ones in a row, each frozen in a different pose — standing, " +
      "running, jumping and falling.",
    sourceFiles: ["main.ts"],
    guide: "animate-a-sprite-from-an-atlas",
  },
];
