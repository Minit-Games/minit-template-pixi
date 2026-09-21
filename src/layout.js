/* ==========================================================================
   Viewport scaling.

   Minit Games' recommended convention -- not an unconditional platform
   requirement -- is to author every game against one fixed design surface
   and scale that whole surface uniformly to whatever viewport the host
   hands you, rather than deriving gameplay coordinates from the viewport
   every frame. The canonical write-up (the full rationale, the crop/fit
   math, and why the viewport meta and re-run hooks matter) lives in the
   @minit-games/sdk package README, "Screen, viewport, and scaling":
   https://github.com/Minit-Games/minit-sdk#screen-viewport-and-scaling

   The design surface is 960x1480 (SURFACE_WIDTH/SURFACE_HEIGHT below, and
   mirrored in scene.js's own constants). #wrapper in index.html is the one
   element scaled, via a single uniform CSS transform recomputed here
   whenever the real viewport changes.
   ========================================================================== */

export const SURFACE_WIDTH = 960;
export const SURFACE_HEIGHT = 1480;

/** Cap the crop at 5% per axis before falling back from cover to fit. */
const MAX_CROP = 0.05;

/** Attach the scaler to `wrapper` and run it immediately + on every event
 *  that can change the real viewport. Idempotent and cheap -- safe to call
 *  as often as it fires. */
export function attachViewportScaler(wrapper) {
	function layout() {
		const vw = window.innerWidth, vh = window.innerHeight;
		if (vw < 1 || vh < 1) return;

		const cover = Math.max(vw / SURFACE_WIDTH, vh / SURFACE_HEIGHT);
		const cropX = (SURFACE_WIDTH * cover - vw) / (SURFACE_WIDTH * cover);
		const cropY = (SURFACE_HEIGHT * cover - vh) / (SURFACE_HEIGHT * cover);
		let scale = cover;
		if (cropX > MAX_CROP || cropY > MAX_CROP) {
			scale = Math.min(vw / (1 - MAX_CROP) / SURFACE_WIDTH, vh / (1 - MAX_CROP) / SURFACE_HEIGHT);
		}

		wrapper.style.transform = `scale(${scale})`;
		wrapper.style.left = `${(vw - SURFACE_WIDTH * scale) / 2}px`;
		wrapper.style.top = `${(vh - SURFACE_HEIGHT * scale) / 2}px`;
		wrapper.style.visibility = 'visible';
	}

	window.addEventListener('resize', layout);
	window.addEventListener('orientationchange', layout);
	window.addEventListener('load', layout);
	window.visualViewport?.addEventListener('resize', layout);
	new ResizeObserver(layout).observe(document.documentElement);
	layout();
}
