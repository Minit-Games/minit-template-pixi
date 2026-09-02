import { defineConfig } from 'vite';

/* ==========================================================================
   Two settings here are not defaults, and both are about surviving the app.
   ========================================================================== */
export default defineConfig({
	// Vite emits absolute asset URLs (`/assets/index-abc.js`) by default. The
	// app does not serve the game from a domain root -- on iOS it is behind the
	// minitlocal:// custom scheme -- so an absolute path resolves to nothing
	// and the page loads blank. Relative is the only portable choice, and it
	// keeps `npx vite preview` and a plain file server honest too.
	base: './',

	build: {
		// Safari 15 is the realistic floor for the WebView this ships into.
		target: ['es2020', 'safari15'],
		assetsInlineLimit: 4096,

		// Vite ships a <link rel="modulepreload"> polyfill that calls fetch().
		// With a single inlined chunk there is nothing to preload, and the
		// platform's validation sweep greps for fetch( -- so the polyfill is
		// pure cost: a forbidden API in the bundle to support a tag we do not
		// emit.
		modulePreload: false,
		rollupOptions: {
			output: {
				// One chunk. The bundle is small, and a single file means one
				// less path for the app's scheme handler to resolve.
				manualChunks: undefined,
				inlineDynamicImports: true,
			},
		},
	},

	plugins: [
		{
			// Vite marks the entry script `crossorigin`, which turns loading it
			// into a CORS-checked fetch. Under minitlocal:// the document has an
			// opaque origin, so that check has nothing to succeed against and
			// the script can simply never run -- a blank game with no error
			// worth reading. Same-origin is the only case here, so the
			// attribute buys nothing and is removed.
			name: 'minit-strip-crossorigin',
			enforce: 'post',
			transformIndexHtml(html) {
				return html.replace(/\s+crossorigin(=["'][^"']*["'])?/g, '');
			},
		},
	],
});
