/**
 * @fileoverview Built-in starter composite components.
 *
 * The former fixed "section" blocks (hero, text, call to action, features, image, testimonial)
 * are ordinary {@link EditorComposite}s built from widgets, so users can open and change them on
 * the visual canvas like any composite they create themselves. {@link seedComposites} provides
 * them for new sites and for the one-time data migration in `site-migration.ts`.
 *
 * Geometry is in pixels relative to the composite canvas top-left corner.
 */

import {
	compositeKind,
	type BuilderBlock,
	type EditorComposite,
	type WidgetKind
} from './editor.js';

/** Stable ids of the seed composites (migration maps the legacy kinds onto these names). */
export const seedCompositeNames = [
	'Hero',
	'TextBlock',
	'CallToAction',
	'FeatureCards',
	'ImageBlock',
	'Testimonial'
] as const;

/** Legacy block kind (before composites existed) → name of the seed composite replacing it. */
export const legacySectionComposites: Record<string, (typeof seedCompositeNames)[number]> = {
	hero: 'Hero',
	text: 'TextBlock',
	button: 'CallToAction',
	features: 'FeatureCards',
	image: 'ImageBlock',
	quote: 'Testimonial'
};

/** Creates a fully populated, positioned widget block. */
function widget(
	composite: string,
	index: number,
	kind: WidgetKind,
	geometry: Pick<BuilderBlock, 'x' | 'y' | 'width' | 'height'>,
	content: Partial<Pick<BuilderBlock, 'title' | 'body' | 'action' | 'href'>> = {}
): BuilderBlock {
	return {
		id: `seed-${composite.toLowerCase()}-${index}`,
		kind,
		title: '',
		body: '',
		action: '',
		theme: 'light',
		positioned: true,
		value: '',
		checked: false,
		level: 60,
		href: '',
		newTab: false,
		...geometry,
		...content
	};
}

/**
 * Creates the starter composites.
 *
 * @returns A fresh array (never shared) of the six seed composites, each valid for
 * `parseComposites`.
 * @example
 * seedComposites().map((c) => c.name); // ['Hero', 'TextBlock', …]
 */
export function seedComposites(): EditorComposite[] {
	return [
		{
			id: 'seed-hero',
			name: 'Hero',
			width: 720,
			height: 220,
			blocks: [
				widget(
					'Hero',
					0,
					'widget-card',
					{ x: 0, y: 0, width: 720, height: 220 },
					{
						title: 'Make room for your next big idea.',
						body: 'A thoughtful space to share what you do and why it matters.',
						action: 'Explore what we do'
					}
				)
			]
		},
		{
			id: 'seed-textblock',
			name: 'TextBlock',
			width: 720,
			height: 160,
			blocks: [
				widget(
					'TextBlock',
					0,
					'widget-card',
					{ x: 0, y: 0, width: 720, height: 160 },
					{
						title: 'A little about us',
						body: 'We believe the best work starts with curiosity, good people, and the freedom to try something new.'
					}
				)
			]
		},
		{
			id: 'seed-calltoaction',
			name: 'CallToAction',
			width: 720,
			height: 160,
			blocks: [
				widget(
					'CallToAction',
					0,
					'widget-card',
					{ x: 0, y: 0, width: 720, height: 160 },
					{ title: 'Ready when you are', body: 'Take the first step. We’ll take it from here.' }
				),
				widget(
					'CallToAction',
					1,
					'widget-button',
					{ x: 24, y: 104, width: 140, height: 36 },
					{ action: 'Get started' }
				)
			]
		},
		{
			id: 'seed-featurecards',
			name: 'FeatureCards',
			width: 720,
			height: 260,
			blocks: [
				widget(
					'FeatureCards',
					0,
					'widget-card',
					{ x: 0, y: 0, width: 224, height: 260 },
					{ title: 'Simple tools', body: 'Everything you need, nothing you don’t.' }
				),
				widget(
					'FeatureCards',
					1,
					'widget-card',
					{ x: 248, y: 0, width: 224, height: 260 },
					{ title: 'Considered design', body: 'Details that make the difference.' }
				),
				widget(
					'FeatureCards',
					2,
					'widget-card',
					{ x: 496, y: 0, width: 224, height: 260 },
					{ title: 'A team that cares', body: 'People who answer when you call.' }
				)
			]
		},
		{
			id: 'seed-imageblock',
			name: 'ImageBlock',
			width: 720,
			height: 260,
			blocks: [
				widget(
					'ImageBlock',
					0,
					'widget-avatar',
					{ x: 0, y: 0, width: 260, height: 260 },
					{ title: 'Image' }
				),
				widget(
					'ImageBlock',
					1,
					'widget-card',
					{ x: 284, y: 0, width: 436, height: 260 },
					{
						title: 'A brighter way to build',
						body: 'Made for the moments that move you forward.'
					}
				)
			]
		},
		{
			id: 'seed-testimonial',
			name: 'Testimonial',
			width: 720,
			height: 200,
			blocks: [
				widget(
					'Testimonial',
					0,
					'widget-card',
					{ x: 0, y: 0, width: 720, height: 200 },
					{
						title: '“It just feels like us.”',
						body: 'The whole process felt easy, and the result is something we’re genuinely proud to share.'
					}
				),
				widget(
					'Testimonial',
					1,
					'widget-badge',
					{ x: 24, y: 150, width: 220, height: 28 },
					{ title: 'Maya Chen · Studio founder' }
				)
			]
		}
	];
}

/**
 * Looks up the block kind of a seed composite by its legacy section kind.
 *
 * @param legacyKind - Pre-composite kind such as `hero` or `quote`.
 * @returns `composite:<Name>`, or `undefined` when the kind was never a section.
 */
export function legacyKindToComposite(legacyKind: string) {
	const name = legacySectionComposites[legacyKind];
	return name ? compositeKind(name) : undefined;
}
