// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import mdx from '@astrojs/mdx';
import codeTheme from './src/code-theme.mjs';

export default defineConfig({
	// Used for absolute URLs in the RSS feed.
	site: 'https://example.com',
	integrations: [mdx()],
	markdown: {
		shikiConfig: { theme: codeTheme },
	},
	fonts: [
		{
			provider: fontProviders.fontsource(),
			name: 'IBM Plex Mono',
			cssVariable: '--font-mono',
			weights: [400, 500],
			styles: ['normal', 'italic'],
			subsets: ['latin'],
			fallbacks: ['monospace'],
		},
		{
			provider: fontProviders.fontsource(),
			name: 'Atkinson Hyperlegible Next',
			cssVariable: '--font-sans',
			weights: [400, 700],
			styles: ['normal', 'italic'],
			subsets: ['latin'],
			fallbacks: ['sans-serif'],
		},
	],
});
