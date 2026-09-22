# Wool Flow 🧶🐱

A cosy kitten-and-yarn puzzle game. Tap balls of yarn, send kittens to unravel knitted pixel pictures, and never let every cushion clog.

Wool Flow is a wool-themed take on the "colour-box / slot" puzzle genre (think *Colony Flow*) with its own twist: **knitting unravels from the top down**, and some yarn balls are **tangled two-tone balls** that change colour halfway through.

Plain HTML5 + Canvas. No build step, no dependencies. Works on phones (portrait) and desktop.

## Play

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8765
```

then visit <http://localhost:8765>. If GitHub Pages is enabled for this repo, the game is live at the Pages URL.

## How it plays

- The **picture** is made of tiny yarn balls, one per cell, each in one colour.
- The **pile** holds yarn balls. Each ball shows a colour and a number: how many stitches of that colour it needs. Balls deeper in the pile unlock when the balls resting on them are gone.
- Tap an available ball and it hops into one of the **five cushions**. Three kittens of that colour set off for the picture. Kittens only ever **walk**: along the wooden frame, then down through the unravelled area to a loose ball. Each ball they pull rolls back to the cushion on its own while the kitten walks on to the next one. When a kitten reaches a ball it stops and bats at it; the ball only comes loose on the swipe, so a kitten never sets off for a ball that is not free yet. When their yarn is finished, kittens head for the nearest of the two wool **cat trees** flanking the picture, climb it with a climbing cycle, and slip out through the cat door on top. Every vertical stretch (frame rails, unravelled columns, trees) uses the climbing cycle.
- **A stitch is loose only when the stitch above it is gone** (or it is the top stitch of its column). This is the wool twist: the picture unravels top-down like real knitting, so lower colours have to wait for the rows above them.
- When a ball's count reaches zero it vanishes and the cushion frees.
- A ball whose colour has no loose stitches just sits there with sleeping kittens. If **every cushion** is clogged like that, the level is lost.
- **Tangled balls** (two-tone) unravel their first colour, then turn into the second colour and keep going.
- Clear every stitch to win. Win without boosters for three stars.

### Boosters (one of each per level)

| Booster | Effect |
| --- | --- |
| **+Cushion** | Adds a sixth cushion for this level. |
| **Hook** | Pulls a ball back out of its cushion into the pile (keeps its remaining count). |
| **Snip** | Splits a tangled ball in a cushion: its second colour becomes a separate ball in the top row. |

## Levels

Ten hand-drawn pictures, generated and verified by `tools/gen.js`:

| # | Picture | Grid | Stitches | Balls | Tangled | Random-play win rate |
| - | --- | --- | --- | --- | --- | --- |
| 1 | Heart | 10×9 | 62 | 9 | 0 | 100% (tutorial) |
| 2 | Apple | 11×11 | 77 | 11 | 0 | ~85% |
| 3 | Flower | 11×12 | 66 | 9 | 0 | ~75% |
| 4 | Tabby | 12×12 | 110 | 13 | 2 | ~31% |
| 5 | Sheep | 26×22 | 456 | 32 | 2 | ~30% |
| 6 | Mushroom | 24×26 | 456 | 30 | 3 | ~21% |
| 7 | Butterfly | 26×22 | 384 | 24 | 4 | ~27% |
| 8 | Rocket | 26×32 | 408 | 30 | 5 | ~17% |
| 9 | Cottage | 26×26 | 520 | 35 | 3 | ~10% |
| 10 | Sundae | 22×30 | 400 | 28 | 3 | ~3% |

"Random-play win rate" is how often a player tapping random available balls wins. Every level is proven solvable by the solver before it is written to `js/levels.js`, and a known solution is stored with each level.

## Project layout

```
index.html          page shell + menus
css/style.css       UI styling
js/engine.js        pure rules engine (shared by browser + tools): grid, loose rule, pile, slots, boosters, solver
js/levels.js        generated level data (do not edit by hand)
js/game.js          canvas renderer, kitten animation, input, sound, progress
tools/pictures.js   the 10 pixel pictures + generator settings
tools/gen.js        level generator: splits colours into balls, lays out the pile, solves, writes js/levels.js
assets/             art (see below)
```

### Regenerating levels

```bash
node tools/gen.js          # rebuild js/levels.js from tools/pictures.js
node tools/gen.js --check  # re-verify every level is solvable
```

To add a level: append a picture to `tools/pictures.js` (letters map to the palette in `js/engine.js`, `.` is empty), set `chunk` (ball size range), `tangled`, `target` (random-play win-rate band) and `scale`, then run the generator.

## Art

Sprites, icons, logo, the 4-frame kitten walk cycle (`assets/kitten_walk_sheet.png`), the 2-frame swipe and 4-frame climb sheets, and the wool cat tree (`assets/cat_tree.png`, drawn top cap + tiled posts + base so it stretches to any frame height) and the knitted background were generated with Higgsfield (GPT Image 2.5), then trimmed and cleaned. Sprites are white so the game tints them per yarn colour at runtime (`multiply` + `destination-in` on an offscreen canvas). The mini yarn balls in the picture are the tinted yarn sprite scaled down; the frame, shadows and all UI are drawn in code.

## Colour system

Colours follow the attention principles in [Attention Insight's eye-catching colours guide](https://attentioninsight.com/eye-catching-colors/), applied Sesame Street style:

- **Saliency through saturation.** The board and cards are a neutral cream so the yarn balls, in bold saturated primaries (Elmo red `#e4002b`, Big Bird yellow `#ffd23f`, Cookie Monster blue `#1f75fe`, Oscar green `#3cb44b`, Ernie orange `#ff7f11`, Count purple `#7b2cbf`, Abby pink `#ff5fa2`), pop out against it.
- **60-30-10.** ~60% neutral base (knit background, cream board, cards), ~30% warm wood (frame, baskets, boosters), ~10% saturated accents (yarn, badges, CTA).
- **Red for the call to action.** The Play / Next buttons and booster count badges are red, the highest-intensity colour in the article's testing, on white for contrast.
- **At most four UI accent colours**: red, yellow, blue, green. Everything else in the chrome is neutral.
- **Contrast.** Dark ink `#2f2a3a` on cream and white labels stays above the 4.5:1 body-text ratio; yellow and blue are used only as fills behind dark or white text.

Yarn colours live in `js/engine.js` (`PALETTE`), UI colours in the `:root` block of `css/style.css`.

## Pace

Kittens stroll at 250 px/s with a ping-pong 4-frame walk cycle and a soft bob, so a level plays like a slow ASMR unravelling. The speed button cycles x1 → x2 → x3 for players who want it brisk.

## Licence

MIT for the code. Art assets are for this project.
