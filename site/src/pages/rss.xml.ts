import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { render } from 'astro:content';
import { getContainerRenderer } from '@astrojs/mdx/container-renderer';
import { SITE_NAME, getPosts } from '../lib';

export async function GET(context: APIContext) {
	const site = context.site!;
	const container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
	const posts = await getPosts();

	const items = await Promise.all(
		posts.map(async (post) => {
			const { Content } = await render(post);
			const html = await container.renderToString(Content);
			return {
				title: post.data.title,
				pubDate: post.data.date,
				link: `/blog/${post.id}/`,
				categories: post.data.tags,
				// Feed readers can't resolve root-relative URLs, so make them absolute.
				content: html
					.replace(/(src|href)="\//g, `$1="${site.origin}/`)
					.replace(/srcset="([^"]*)"/g, (_, value: string) => `srcset="${value.replace(/(^|,\s*)\//g, `$1${site.origin}/`)}"`),
			};
		}),
	);

	return rss({
		title: SITE_NAME,
		description: `Writing and projects by ${SITE_NAME}`,
		site,
		items,
	});
}
