/* ==========================================================================
   The world, drawn with PixiJS: a ball on grass, under a sun and some clouds.

   Everything is built from Graphics primitives and two small gradient
   textures generated in code. Nothing is loaded from a file, which keeps the
   bundle to the engine plus a few hundred bytes and, more importantly, means
   the game makes no network request at all -- the sandboxed WebView has no
   network, and the platform's rules forbid fetch and XMLHttpRequest outright.

   Nothing here knows about the SDK or scoring. It reports what happened
   through the callbacks given to create(), and main.js decides what that is
   worth.
   ========================================================================== */
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';

const GRAVITY = 2600;          // px/s^2 at unit scale 1
const RESTITUTION = 0.62;
const AIR_DRAG = 0.4;
const TAP_IMPULSE = 1150;
const REST_SPEED = 40;
const HORIZON = 0.62;          // sky above, grass below

/** A soft radial glow. It has to be a real 2D texture: a vertical gradient
 *  stretched into a square renders as a hard-edged rectangle, which is exactly
 *  what the sun looked like before this existed. */
function radialTexture(inner, outer) {
	const c = document.createElement('canvas');
	c.width = c.height = 128;
	const ctx = c.getContext('2d');
	const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
	g.addColorStop(0, inner);
	g.addColorStop(1, outer);
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 128, 128);
	return Texture.from(c);
}

/** A vertical gradient as a 1px-wide texture; Pixi stretches it for free. */
function gradientTexture(stops) {
	const c = document.createElement('canvas');
	c.width = 1;
	c.height = 256;
	const ctx = c.getContext('2d');
	const g = ctx.createLinearGradient(0, 0, 0, 256);
	for (const [at, color] of stops) { g.addColorStop(at, color); }
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 1, 256);
	return Texture.from(c);
}

export async function createScene(canvas, { onTap, onBounce }) {
	const app = new Application();
	// resizeTo keeps the renderer matched to the window on every rotation and
	// keyboard event, which is the only honest source for a slot whose shape
	// the host decides.
	await app.init({ canvas, resizeTo: window, antialias: true, background: 0x1b4a8f });

	const world = new Container();
	app.stage.addChild(world);

	const sky = new Sprite(gradientTexture([[0, '#1b4a8f'], [0.55, '#4b9fd6'], [1, '#9fd8ee']]));
	const ground = new Sprite(gradientTexture([[0, '#5fbf4a'], [0.25, '#3f9c35'], [1, '#1f5c22']]));
	const sunGlow = new Sprite(radialTexture('rgba(255,241,168,0.85)', 'rgba(255,241,168,0)'));
	world.addChild(sky, sunGlow, ground);

	const sun = new Graphics().circle(0, 0, 1).fill(0xfff4bd);
	world.addChild(sun);

	const clouds = [];
	for (let i = 0; i < 5; i++) {
		const g = new Graphics();
		g.circle(0, 0, 3.2).circle(3.4, 0.5, 2.4).circle(-3.1, 0.7, 2.1).fill({ color: 0xffffff, alpha: 0.82 });
		world.addChild(g);
		clouds.push({ g, x: 0, y: 0, scale: 0.6 + Math.random() * 0.8, speed: 4 + Math.random() * 7 });
	}

	const blades = new Graphics();
	world.addChild(blades);

	const shadow = new Graphics().ellipse(0, 0, 1, 0.3).fill(0x0c3010);
	const ball = new Container();
	const ballBody = new Graphics();
	world.addChild(shadow, ball);
	ball.addChild(ballBody);

	const particles = new Container();
	world.addChild(particles);
	const pool = [];

	let W = 0, H = 0, horizon = 0, unit = 1, ballRadius = 1, groundY = 0;
	const state = { x: 0, y: 0, vx: 0, vy: 0, squash: 0, spin: 0 };
	let started = false;
	// Whether the ball has settled. Without this the ball never stops bouncing:
	// gravity adds GRAVITY * dt to vy every frame -- about 43 px/s at 60 fps,
	// 130 at the clamped 20 fps floor -- which is already above REST_SPEED, so
	// the settle test passes, then fails again on the very next frame. The
	// result is a permanent micro-bounce that fires the impact sound and throws
	// a burst of grass on every single frame. Raising the threshold cannot fix
	// it, because the number to beat depends on the frame rate; latching the
	// state and switching gravity off does, at any frame rate.
	// Starts true: the ball begins already at rest on the grass, and letting
	// gravity run on frame one fires a bounce -- sound and all -- before the
	// player has touched anything.
	let resting = true;

	function layout() {
		const vv = window.visualViewport;
		W = Math.round(vv ? vv.width : document.documentElement.clientWidth);
		H = Math.round(vv ? vv.height : document.documentElement.clientHeight);
		horizon = Math.round(H * HORIZON);
		// The short edge drives scale, so a tall narrow slot and a squat wide
		// one both get a ball that fits and reads at the same size.
		unit = Math.min(W, H * 0.62) / 100;
		ballRadius = Math.max(22, unit * 11);
		groundY = horizon - ballRadius * 0.35;

		sky.position.set(0, 0);
		sky.width = W; sky.height = horizon;
		ground.position.set(0, horizon);
		ground.width = W; ground.height = H - horizon;

		const sunR = unit * 7;
		sun.position.set(W * 0.78, horizon * 0.24);
		sun.scale.set(sunR);
		sunGlow.position.set(W * 0.78 - sunR * 3.4, horizon * 0.24 - sunR * 3.4);
		sunGlow.width = sunR * 6.8; sunGlow.height = sunR * 6.8;

		for (const c of clouds) {
			if (!c.placed) { c.x = Math.random() * W; c.y = horizon * (0.12 + Math.random() * 0.55); c.placed = true; }
			c.g.scale.set(c.scale * unit);
		}

		// Blades sit ON the horizon line, which is what sells it as a surface
		// the ball rests on rather than a colour change.
		blades.clear();
		const count = Math.round(W / 7);
		for (let i = 0; i < count; i++) {
			const x = Math.random() * W;
			const h = unit * (1.6 + Math.random() * 3.4);
			const lean = (Math.random() - 0.5) * 0.5;
			blades.moveTo(x, horizon + unit * 0.5)
				.quadraticCurveTo(x + lean * h, horizon - h * 0.55, x + lean * h * 1.8, horizon - h)
				.stroke({ width: Math.max(1, unit * 0.35), color: Math.random() > 0.5 ? 0x7ee060 : 0x2b782c, alpha: 0.9 });
		}

		ballBody.clear();
		ballBody.circle(0, 0, ballRadius).fill(0xd6323f);
		ballBody.circle(-ballRadius * 0.32, -ballRadius * 0.36, ballRadius * 0.30).fill({ color: 0xfff1f1, alpha: 0.85 });
		ballBody.arc(0, 0, ballRadius * 0.62, -0.6, 1.5)
			.stroke({ width: ballRadius * 0.16, color: 0xffffff, alpha: 0.9 });

		if (!started) { state.x = W / 2; state.y = groundY; }
	}

	function spawn(x, y, n, color) {
		for (let i = 0; i < n; i++) {
			let p = pool.find((q) => !q.g.visible);
			if (!p) {
				p = { g: new Graphics().circle(0, 0, 1).fill(0xffffff) };
				particles.addChild(p.g);
				pool.push(p);
			}
			const a = Math.random() * Math.PI * 2;
			const speed = (60 + Math.random() * 200) * (unit / 3.9);
			Object.assign(p, {
				x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 60,
				life: 0.45 + Math.random() * 0.35, age: 0, size: unit * (0.6 + Math.random() * 1.1),
			});
			p.g.visible = true;
			p.g.tint = color;
		}
	}

	function step(dt) {
		const scale = unit / 3.9;
		if (!resting) { state.vy += GRAVITY * scale * dt; }
		state.vx -= state.vx * AIR_DRAG * dt;
		state.x += state.vx * dt;
		state.y += state.vy * dt;
		state.spin += state.vx * dt * 0.02;

		// Walls, so a hard sideways tap cannot lose the ball off-screen.
		if (state.x < ballRadius) { state.x = ballRadius; state.vx = Math.abs(state.vx) * 0.6; }
		if (state.x > W - ballRadius) { state.x = W - ballRadius; state.vx = -Math.abs(state.vx) * 0.6; }
		// And a ceiling: a tap SETS the upward velocity, so a rally climbs, and
		// without this the ball leaves the top of the screen exactly when the
		// player is doing well -- where it cannot be tapped.
		if (state.y < ballRadius) { state.y = ballRadius; state.vy = Math.abs(state.vy) * 0.5; }

		if (state.y >= groundY) {
			state.y = groundY;
			if (!resting && state.vy > REST_SPEED * scale) {
				const impact = state.vy;
				state.vy = -state.vy * RESTITUTION;
				state.vx *= 0.86;
				state.squash = Math.min(0.5, impact / (900 * scale));
				spawn(state.x, groundY + ballRadius * 0.55, 8, 0x8ee06a);
				onBounce(impact / (1400 * scale));
			} else {
				state.vy = 0;
				state.vx *= 0.9;
				resting = true;          // a tap wakes it again
			}
		}
		state.squash += (0 - state.squash) * Math.min(1, dt * 11);

		for (const c of clouds) {
			c.x += c.speed * dt;
			if (c.x - 120 * c.scale > W) { c.x = -120 * c.scale; }
			c.g.position.set(c.x, c.y);
		}

		for (const p of pool) {
			if (!p.g.visible) { continue; }
			p.age += dt;
			if (p.age >= p.life) { p.g.visible = false; continue; }
			p.vy += 900 * scale * dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			const t = 1 - p.age / p.life;
			p.g.position.set(p.x, p.y);
			p.g.scale.set(p.size * t);
			p.g.alpha = t;
		}

		// Squash and stretch, volume-preserving, so impacts read at a glance.
		ball.position.set(state.x, state.y);
		ball.scale.set(1 + state.squash, 1 - state.squash);
		ballBody.rotation = state.spin;

		const drop = Math.max(0, Math.min(1, (groundY - state.y) / (H * 0.4)));
		shadow.position.set(state.x, groundY + ballRadius * 0.62);
		shadow.scale.set(ballRadius * (1.05 - drop * 0.4), ballRadius * (1.05 - drop * 0.4));
		shadow.alpha = 0.34 - drop * 0.22;
	}

	function tryHit(x, y) {
		// A fingertip is about 44 px and the ball is a moving target, so the
		// hit area is deliberately larger than the ball looks.
		const reach = Math.max(ballRadius * 1.45, 30);
		const dx = x - state.x, dy = y - state.y;
		if (dx * dx + dy * dy > reach * reach) { return false; }

		started = true;
		resting = false;
		const scale = unit / 3.9;
		// Capped by the headroom left above the ball: low down it is the full
		// pop, near the top a small hop that keeps the ball hanging where it is
		// easiest to hit, so a rally can run as long as the player keeps up.
		const headroom = Math.max(0, state.y - ballRadius * 1.2);
		state.vy = -Math.min(TAP_IMPULSE * scale, Math.sqrt(2 * GRAVITY * scale * headroom));
		state.vx += (dx / reach) * 320 * scale;
		state.spin += (dx / reach) * 6;
		state.squash = -0.45;
		spawn(state.x, state.y + ballRadius * 0.3, 14, 0xfff6b0);
		onTap();
		return true;
	}

	layout();
	window.addEventListener('resize', layout);
	window.visualViewport?.addEventListener('resize', layout);

	return {
		app, step, tryHit, layout,
		get ballScreen() { return { x: state.x, y: state.y }; },
	};
}
