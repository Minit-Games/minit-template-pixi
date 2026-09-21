# minit-template-pixi

> **Learn page:** [Building with AI tools](https://minit.studio/docs/build-with-ai-tools) — the official guide this template implements, and where these four starter templates are listed.

A complete, working Minit game on [PixiJS](https://pixijs.com) — fast 2D sprite
work, with the whole scene built from `Graphics` primitives and two gradient
textures generated in code.

**The game.** A ball sits on the grass. Tap it and it bounces, and every tap
scores. Hit it again in mid-air to build a rally; let it land and the rally
resets. A 30 second clock ends the run and posts the result.

Built with Vite and the official
[`@minit-games/sdk`](https://www.npmjs.com/package/@minit-games/sdk). There are
matching templates for plain Canvas/DOM, PixiJS, Phaser and Three.js, plus
Defold, Godot, Unity and PlayCanvas — same game, so the parts around it are
easy to compare.

```bash
npm install
npm run dev        # local dev server
npm run package    # build, verify, and write dist/minit-template-pixi.zip
```

Upload `dist/minit-template-pixi.zip` at [console.minit.games](https://console.minit.games).

**Size.** ~880 KB built (385 KB gzipped), most of it the engine and the music.

## Tools and configuration

Everything in `tools/` needs **Node 22 or newer** and a Chromium-based browser.
There is nothing else to install — the scripts use only Node built-ins.

**The browser.** The audio gate drives a real browser over the DevTools
protocol, so it needs one present. It takes the first that exists on disk, which
on most machines means there is nothing to configure:

| OS | Tried, in order |
|---|---|
| macOS | Google Chrome, Microsoft Edge, Chromium |
| Windows | Google Chrome, Microsoft Edge *(Edge ships with Windows)* |
| Linux | `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge` |

Set `CHROME` to override it with any Chromium build. On macOS and Linux:

```bash
CHROME="/path/to/chrome" npm run package
```

and on Windows, from `cmd`:

```
set CHROME=C:\path\to\msedge.exe
npm run package
```

If none is found the run stops immediately and lists every path it tried.
Opera is deliberately *not* tried: it is Chromium, but several builds refuse
remote debugging and then fail exactly like a missing browser.

### On Windows, use `cmd` rather than PowerShell

PowerShell's execution policy blocks `npm.ps1`, so any `npm run …` fails with
*"running scripts is disabled on this system"* before this template runs at all.
That is a Windows security setting rather than anything here, and you do not
need to weaken it — use `cmd`, or call Node directly:

```
node tools/package.mjs
```
## Layout

```
index.html            page shell + the Minit audio repair (read the comment)
src/main.js           SDK lifecycle, scoring, HUD — the part worth copying
src/scene.js          the world: Pixi display objects, physics and layout
src/layout.js         fixed 960×1480 design surface, scaled to the viewport
src/audio.js          one AudioContext: the music loop and synthesised effects
src/assets/music.js   generated — the loop, as inlined mu-law bytes
public/meta.json      title, controls, logic, description, config knobs
tools/                build, validation, and the offline + audio gates
```

`public/` is copied verbatim to the root of `dist/`, which is what puts
`meta.json` and the notices at the root of the ZIP where the console reads them.

## Two Pixi notes

**Nothing is loaded.** No `Assets.load`, no spritesheet, no texture file. The
sky, ground and sun are 1×256 and 128×128 gradient textures drawn into an
offscreen canvas at startup; everything else is `Graphics`. That is not
minimalism for its own sake — the sandboxed WebView has no network, and Pixi's
loader would reach for `fetch`.

**A radial glow needs a real 2D texture.** The sun's halo was first a vertical
gradient stretched into a square, which renders as a hard-edged rectangle
rather than a glow. `radialTexture()` draws an actual `createRadialGradient`.

## The three calls that matter

A Minit drop is one session: load → play → result. There is no title screen, no
"tap to begin", and no replay menu — the host owns both ends, and the run ends
itself on a 30 second clock rather than asking the player to press a button.

| Call | When | Where |
| --- | --- | --- |
| `initializeSDK()` | once, at startup | top of `src/main.js` |
| `loadingDone()` | the first interactive frame is on screen | in the update handler |
| `reportResult(score, { flavorText, userData })` | once, when the clock runs out | `endGame()` |

Until `loadingDone()` fires the app holds its own loading screen over the
WebView, so it goes as soon as there is a real frame. After `reportResult` the
app overlays its result screen and takes focus, so the loop stops rather than
animating for nobody.

`flavorText` is a session moment rendered by the host, never in-game, and never
the score again — this template sends the best rally.

## Config values

Declared once in `public/meta.json`, read at runtime with `getConfigValue`.
They are what let other creators post mods of the game without touching code.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `pointsPerTap` | number, 1–100 | `10` | Points per tap on the ball |
| `sound` | boolean | `true` | Sound effects |
| `music` | boolean | `true` | Background music loop |

**Values always arrive as strings**, including `"false"`, so coerce every one:
`Number(...)` or `=== 'true'`. Test locally by appending them yourself:

```
http://localhost:5173/?pointsPerTap=25&music=false
```

`npm run build` cross-checks the declared keys against the ones the bundle
actually reads, in both directions.

## Audio, and why index.html is the way it is

A game can be perfectly healthy — context running, engine mixing, buffers
queued — and completely inaudible inside the Minit app. The app replaces every
game's `AudioContext` with a subclass whose `destination` is a mute gain it
owns, seeded at `0`, then states the real volume. Two defects can stop that
landing (both tracked in DROP-8164), and the repair for both is inline at the
top of `index.html`:

1. **On iOS the volume message is thrown away.** The game is served from
   `minitlocal://`, a custom scheme with an opaque origin, and the app posts the
   volume with `postMessage(payload, window.location.origin)` — which for an
   opaque origin is the string `"null"`, and `postMessage` *throws* rather than
   ignoring it. Retrying the same-window post with `'*'` delivers the app's own
   message, so its real intent still decides the volume.
2. **The volume is stated once, at document load.** A game whose `AudioContext`
   appears later is constructed into a `0` nobody chose, and nothing restates it
   until the next foreground transition — the "no sound until I background the
   app and come back" symptom.

The second is why the repair tracks whether the app ever spoke *at all*. From
inside the page a deliberate mute and a silence nobody asked for are identical:
both are a mute gain at `0`. An explicit `0` is honoured untouched; a `0` we
were never addressed about is repaired, and only after a real gesture.

The game's own half is in `src/audio.js`: never start audio before a gesture has
resumed the context — audio played into a suspended context is *discarded*, not
queued — and hand the context to `registerAudioContext` so the SDK suspends and
resumes it with the page.

### Verify it, don't assume it

`npm run package` will not produce a ZIP for a silent build.
`tools/verify-audio.mjs` boots the built bundle behind a test double for the
app's audio injection, with autoplay disabled so the context starts suspended
exactly as it does in a WKWebView, taps the ball, and measures peak RMS off an
`AnalyserNode` spliced in after the mute gain. Two cases, both of which must
hold:

```
host never states a volume : audible   (the bug fixed)
host explicitly mutes      : 0.00000   (a real mute still mutes)
```

An engine flag like `isPlaying` is **not** evidence here — a game mixing happily
into a gain node held at zero reports exactly the same thing as one you can
hear. Measure the graph.

## Platform rules this template is built around

Most are enforced by `tools/check-meta.mjs`, which runs on every build.

- **Relative asset paths** (`base: './'`). Vite's default absolute `/assets/...`
  resolves to nothing under the app's custom scheme and the page loads blank.
- **No `crossorigin`** on the entry script — its CORS check cannot pass on an
  opaque origin, and the script silently never runs.
- **No network.** The forbidden-API sweep runs against `src/`, not the bundle:
  a bundled engine ships its own asset loader containing `fetch` and
  `XMLHttpRequest` whether or not a single asset is loaded, so grepping the
  bundle would fail every engine-based game while proving nothing.
  `tools/verify-offline.mjs` measures what the running game actually requests
  instead, and fails on anything off-origin.
- **Touch only.** Pointer events throughout, tap targets past 44 px, no hover
  and no keyboard.
- **Portrait, one fixed 960×1480 design surface, scaled to fit.** The app's
  slot is nearer 2:3 than the 9:18 a phone screen suggests, and differs again
  on the web player, so `src/scene.js` authors every position against a
  single fixed surface and `src/layout.js` scales the whole thing uniformly
  with one CSS `transform: scale(...)` on `#wrapper`, rather than deriving
  gameplay coordinates from the viewport. Crop is capped at 5% per axis before it
  falls back from cover to letterboxed fit, must-see content stays inside the
  central 90% of the surface, and tap targets stay ≥44 CSS px after the
  scale-down. The scaler re-runs on resize, orientation change, the visual
  viewport, and a `ResizeObserver` — not on every frame. This is the Minit
  Games **recommended** layout convention, not an unconditional platform
  requirement; the canonical source is the `@minit-games/sdk` package
  README's own "Screen, viewport, and scaling" section:
  [Minit-Games/minit-sdk § "Screen, viewport, and scaling"](https://github.com/Minit-Games/minit-sdk#screen-viewport-and-scaling).

## Regenerating the music

```bash
npm run gen:music
```

Downloads the CC0 source pack (cached in `.cache/`), resamples to mono 16 kHz,
encodes as G.711 mu-law, and writes `src/assets/music.js`. The bytes travel
inside the JS bundle rather than being fetched, because the platform forbids
`fetch` and `XMLHttpRequest` outright.
