import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Optional fixed URL slug. When set, it replaces the path-based ID, so the URL survives moving or renaming the file.
const slug = z
	.string()
	.regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/, 'slug must be lowercase letters, digits, hyphens and slashes')
	.optional();

const blog = defineCollection({
	loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
	schema: z.object({
		title: z.string(),
		date: z.coerce.date(),
		tags: z.array(z.string()).default([]),
		slug,
	}),
});

const projects = defineCollection({
	loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
	schema: z.object({
		title: z.string(),
		date: z.coerce.date(),
		description: z.string(),
		slug,
	}),
});

export const collections = { blog, projects };
