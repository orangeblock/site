// Shiki theme matching the site palette. Colours are listed in docs/design.md.
const amber = '#e0a458';
const sage = '#a9c4b0';
const sand = '#d8c08a';
const olive = '#b8bb8a';
const rose = '#d3869b';
const clay = '#c9886a';
const faint = '#8a8378';
const muted = '#9a948a';

/** @type {import('shiki').ThemeRegistration} */
export default {
	name: 'graphite',
	type: 'dark',
	colors: {
		'editor.background': '#23221f',
		'editor.foreground': '#e4ded2',
	},
	tokenColors: [
		{ scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: faint, fontStyle: 'italic' } },
		{ scope: ['punctuation', 'keyword.operator'], settings: { foreground: muted } },
		{
			scope: ['keyword', 'storage.type', 'storage.modifier', 'keyword.operator.logical', 'keyword.operator.word', 'keyword.operator.new'],
			settings: { foreground: amber },
		},
		{ scope: ['string', 'punctuation.definition.string'], settings: { foreground: olive } },
		{ scope: ['constant.numeric', 'constant.language'], settings: { foreground: rose } },
		{
			scope: ['entity.name.function', 'support.function', 'meta.function-call.generic', 'entity.name.tag', 'support.type.property-name'],
			settings: { foreground: sage },
		},
		{
			scope: ['entity.name.type', 'entity.name.class', 'entity.other.inherited-class', 'support.type', 'support.class', 'support.function.builtin'],
			settings: { foreground: sand },
		},
		{
			scope: ['entity.name.function.decorator', 'meta.function.decorator', 'punctuation.definition.decorator'],
			settings: { foreground: clay },
		},
	],
};
