import { describe, expect, it } from 'vitest';
import {
	advanceTrail,
	backTarget,
	breadcrumbsFor,
	describePath,
	emptyTrail,
	forwardTarget,
	maxTrailLength,
	parseTrail,
	splitPath,
	toPath
} from './navigation-trail.js';

describe('navigation trail', () => {
	it('starts a fresh trail on enter and keeps a matching restored trail', () => {
		const fresh = advanceTrail(emptyTrail, 'enter', '/');
		expect(fresh).toEqual({ entries: ['/'], index: 0 });

		const restored = { entries: ['/', '/editor?page=a'], index: 1 };
		expect(advanceTrail(restored, 'enter', '/editor?page=a')).toBe(restored);
		expect(advanceTrail(restored, 'enter', '/other')).toEqual({ entries: ['/other'], index: 0 });
	});

	it('pushes link navigations and discards forward entries', () => {
		let trail = advanceTrail(emptyTrail, 'enter', '/');
		trail = advanceTrail(trail, 'link', '/editor?page=a');
		trail = advanceTrail(trail, 'goto', '/editor?page=b');
		expect(trail).toEqual({ entries: ['/', '/editor?page=a', '/editor?page=b'], index: 2 });

		trail = advanceTrail(trail, 'popstate', '/editor?page=a', -1);
		expect(trail.index).toBe(1);
		expect(forwardTarget(trail)).toBe('/editor?page=b');

		trail = advanceTrail(trail, 'link', '/');
		expect(trail).toEqual({ entries: ['/', '/editor?page=a', '/'], index: 2 });
		expect(forwardTarget(trail)).toBeNull();
	});

	it('ignores navigations to the current path and the leave type', () => {
		const trail = { entries: ['/'], index: 0 };
		expect(advanceTrail(trail, 'goto', '/')).toBe(trail);
		expect(advanceTrail(trail, 'leave', '/elsewhere')).toBe(trail);
	});

	it('resyncs by path when a popstate delta does not match', () => {
		const trail = { entries: ['/', '/a', '/b', '/c'], index: 3 };
		expect(advanceTrail(trail, 'popstate', '/b', -5).index).toBe(2);
		expect(advanceTrail(trail, 'popstate', '/unknown', -1)).toEqual({
			entries: ['/unknown'],
			index: 0
		});
	});

	it('caps the trail length', () => {
		let trail = advanceTrail(emptyTrail, 'enter', '/p0');
		for (let i = 1; i < maxTrailLength + 10; i += 1) trail = advanceTrail(trail, 'link', `/p${i}`);
		expect(trail.entries).toHaveLength(maxTrailLength);
		expect(trail.entries[trail.index]).toBe(`/p${maxTrailLength + 9}`);
	});

	it('validates persisted trails', () => {
		expect(parseTrail({ entries: ['/', '/a'], index: 1 })).toEqual({
			entries: ['/', '/a'],
			index: 1
		});
		expect(parseTrail({ entries: ['/'], index: 3 })).toBeNull();
		expect(parseTrail({ entries: [1], index: 0 })).toBeNull();
		expect(parseTrail(null)).toBeNull();
	});

	it('chooses the back behaviour', () => {
		expect(backTarget({ entries: ['/', '/editor'], index: 1 }, '/editor')).toEqual({
			kind: 'history',
			path: '/',
			delta: -1
		});
		expect(backTarget({ entries: ['/editor?page=a'], index: 0 }, '/editor?page=a')).toEqual({
			kind: 'parent',
			path: '/'
		});
		expect(backTarget({ entries: ['/'], index: 0 }, '/')).toBeNull();
	});

	it('describes paths and builds breadcrumbs', () => {
		const names = { a: 'About' };
		expect(describePath('/', names)).toEqual({ label: 'Pages', section: 'pages' });
		expect(describePath('/editor?page=a', names).label).toBe('Editor · About');
		expect(describePath('/editor').label).toBe('Editor');
		expect(describePath('/about').label).toBe('About');
		expect(describePath('/component-editor')).toEqual({
			label: 'Component editor',
			section: 'components'
		});
		expect(breadcrumbsFor('/', names)).toEqual([{ label: 'Pages', path: null }]);
		expect(breadcrumbsFor('/editor?page=a', names)).toEqual([
			{ label: 'Pages', path: '/' },
			{ label: 'Editor · About', path: null }
		]);
	});

	it('splits and builds paths', () => {
		expect(splitPath('/editor?page=a%20b')).toEqual({ pathname: '/editor', pageId: 'a b' });
		expect(toPath({ pathname: '/editor', search: '?page=a' })).toBe('/editor?page=a');
	});
});
