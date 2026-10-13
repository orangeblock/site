import { getCollection } from 'astro:content';

export const SITE_NAME = 'dan';

export async function getPosts() {
	const posts = await getCollection('blog');
	return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getProjects() {
	const projects = await getCollection('projects');
	return projects.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function formatDate(date: Date) {
	return date.toISOString().slice(0, 10);
}

export function formatMonth(date: Date) {
	return date.toISOString().slice(0, 7);
}

export function tagSlug(tag: string) {
	return tag
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

export function tagUrl(tag: string) {
	return `/blog/tags/${tagSlug(tag)}/`;
}
