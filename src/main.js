/* ==========================================================================
   Lifecycle and scoring -- the part of the template worth copying.

   The host wraps every game in the same three-call contract:

     initializeSDK()   once, at startup
     loadingDone()     once the first interactive frame is on screen
     reportResult()    once, when the run ends

   A Minit drop is one session: load, play, result. No title screen, no "tap to
   begin", no replay menu -- the host owns both ends.
   ========================================================================== */
import { initializeSDK, getConfigValue, reportResult, loadingDone } from '@minit-games/sdk';
import {
	createHeaderBar, showPositiveFeedback, showNeutralFeedback, preloadFeedbackFont,
	spawnRewards, shouldShowTutorial, createTutorialOverlay,
} from '@minit-games/sdk/ui';

import { createScene } from './scene.js';
import { createAudio } from './audio.js';

initializeSDK();

/* ---- config ----------------------------------------------------------
   Config values always arrive as strings -- the host appends every declared
   key to the game URL. Coerce, and keep a default so `npm run dev` and a
   direct URL still work. The keys are declared in public/meta.json. */
const POINTS_PER_TAP = Math.max(1, Number(getConfigValue('pointsPerTap', '10')) || 10);
const SOUND_ON = getConfigValue('sound', 'true') === 'true';
const MUSIC_ON = getConfigValue('music', 'true') === 'true';

/* How long a run lasts. The host owns everything either side of the run, so
   the game ends itself on a clock rather than offering a button to press --
   a drop is one session, and asking the player to declare it over is a menu
   by another name. */
const ROUND_SECONDS = 30;

const canvas = document.getElementById('game');
const audio = createAudio({ sound: SOUND_ON, music: MUSIC_ON });

let score = 0;
let rally = 0;          // taps since the ball last touched the grass
let bestRally = 0;
let bounces = 0;
let finished = false;

/* ---- HUD -------------------------------------------------------------
   Layout only: position with y/padding, Score on the right, secondary stats
   on the left. The SDK ships the styling and it is meant to look the same
   across drops, so no colours or sizes are passed. */
const header = createHeaderBar({ y: 28, padding: 22 });
const timePanel = header.addPanel({ label: 'Time', value: ROUND_SECONDS });
const scorePanel = header.addPanel({ label: 'Score', value: 0, align: 'right' });

preloadFeedbackFont();

/* Creating the Pixi application is asynchronous, and top-level await is not
   available at the Safari 15 target this builds for, so startup lives here. */
async function boot() {
	const scene = await createScene(canvas, {
		onTap() {
			rally++;
			if (rally > bestRally) { bestRally = rally; }
			audio.tap();

			// One flying icon per point, not one per scoring event -- spawnRewards
			// clusters big payouts into 5 / 25 / 125 denominations so the HUD stays
			// readable. The score only moves when the icons land.
			const at = scene.ballScreen;
			spawnRewards(POINTS_PER_TAP, {
				start: { x: at.x, y: at.y },
				target: scorePanel.getPosition(),
				onAllArrive: () => {
					score += POINTS_PER_TAP;
					scorePanel.setValue(score, { animate: true });
				},
			});

			// Feedback belongs on moments the player feels, not on every tap.
			if (rally === 3) { showPositiveFeedback('Rally x3!'); }
			else if (rally === 6) { showPositiveFeedback('Rally x6!'); }
			else if (rally >= 10 && rally % 5 === 0) { showPositiveFeedback(`Rally x${rally}!`); }
		},

		onBounce(strength) {
			// A ball settling onto the grass produces a long tail of ever-smaller
			// bounces; counting all of them makes the end-of-run stat meaningless.
			if (strength > 0.12) { bounces++; }
			audio.bounce();
			if (rally >= 3) { showNeutralFeedback('Rally Lost'); }
			rally = 0;
		},
	});

	/* ---- input -------------------------------------------------------
	   Pointer events cover touch and mouse from one path, so the game is
	   testable on a desktop and correct on the phone it ships to. */
	canvas.addEventListener('pointerdown', (e) => {
		if (finished) { return; }
		// The gesture that starts the game is also the one that unlocks audio: a
		// context resumed outside a gesture stays suspended, and everything
		// played into it is discarded rather than queued.
		audio.unlock();
		const rect = canvas.getBoundingClientRect();
		scene.tryHit(e.clientX - rect.left, e.clientY - rect.top);
	}, { passive: true });

	function endGame() {
		if (finished) { return; }
		finished = true;
		timePanel.setValue(0);
		audio.finish();

		// flavorText is a session moment rendered by the host beneath the score
		// -- never the score again, and never drawn in-game.
		const flavorText = bestRally >= 3
			? `Best rally: ${bestRally} taps without a bounce`
			: `${bounces} bounce${bounces === 1 ? '' : 's'} off the grass`;

		reportResult(score, { flavorText, userData: 'played' });
		// The host overlays its result screen and takes focus, so there is
		// nothing left worth rendering.
		scene.app.ticker.stop();
	}

	/* ---- tutorial ----------------------------------------------------
	   Gated by the host's userData: a returning player has a value stored and
	   never sees it again. Gesture over text. */
	let tutorial = null;
	let finger = null;
	if (shouldShowTutorial()) {
		tutorial = createTutorialOverlay({ container: document.body });
		finger = tutorial.showFinger({ x: scene.ballScreen.x, y: scene.ballScreen.y + 40 });
		canvas.addEventListener('pointerdown', () => {
			if (tutorial) { tutorial.destroy(); tutorial = null; finger = null; }
		}, { once: true, passive: true });
	}

	let ready = false;
	let remaining = ROUND_SECONDS;
	let shownSecond = ROUND_SECONDS;

	scene.app.ticker.add((ticker) => {
		const raw = ticker.deltaMS / 1000;
		// Physics gets a hard clamp: a backgrounded tab returns with a huge
		// delta, which would teleport the ball through the ground.
		scene.step(Math.min(raw, 1 / 20));

		if (ready && !finished) {
			// The clock gets a looser one. Sharing the physics clamp donates
			// every slow frame back to the player, and a 30 s round overruns.
			remaining -= Math.min(raw, 0.5);
			const whole = Math.max(0, Math.ceil(remaining));
			if (whole !== shownSecond) {
				shownSecond = whole;
				timePanel.setValue(whole);
				if (whole === 10) { showNeutralFeedback('10s Left!'); }
			}
			if (remaining <= 0) { endGame(); }
		}

		if (finger) { finger.setPosition(scene.ballScreen.x, scene.ballScreen.y + 40); }

		if (!ready) {
			ready = true;
			// The app holds a loading screen over the WebView until this fires,
			// so it goes as soon as there is a real frame.
			loadingDone();
		}
	});
}

boot();
