/**
 * @fileoverview Tests for the typed page/composite boundary used by the shared visual editor.
 */

import { describe, expect, it } from 'vitest';
import {
	editorDocumentLabel,
	editorDocumentsForMode,
	isEditorPage,
	linkPagesForMode,
	mergeEditorDocuments,
	type EditorDocument
} from './editor-mode.js';
import type { EditorComposite, EditorPage, EditorSite } from './editor.js';

const page: EditorPage = {
	id: 'home',
	name: 'Home',
	slug: 'home',
	width: 1280,
	height: 720,
	blocks: []
};

const composite: EditorComposite = {
	id: 'hero',
	name: 'Hero',
	width: 960,
	height: 360,
	blocks: []
};

const site: EditorSite = { pages: [page], composites: [composite] };

describe('editorDocumentsForMode', () => {
	it('selects original page and composite documents without converting them', () => {
		expect(editorDocumentsForMode('pages', site)).toEqual([page]);
		expect(editorDocumentsForMode('pages', site)[0]).toBe(page);
		expect(editorDocumentsForMode('composites', site)).toEqual([composite]);
		expect(editorDocumentsForMode('composites', site)[0]).toBe(composite);
	});
});

describe('editorDocumentLabel', () => {
	it('shows a page route but keeps a composite name route-free', () => {
		expect(editorDocumentLabel(page)).toBe('Home · /home');
		expect(editorDocumentLabel(composite)).toBe('Hero');
		expect(isEditorPage(page)).toBe(true);
		expect(isEditorPage(composite)).toBe(false);
	});
});

describe('linkPagesForMode', () => {
	it('uses the edited pages in page mode and stashed pages in composite mode', () => {
		const editedPage: EditorPage = { ...page, slug: 'edited' };
		expect(linkPagesForMode('pages', [editedPage], [])).toEqual([editedPage]);
		expect(linkPagesForMode('composites', [composite], [page])).toEqual([page]);
	});

	it('rejects composite documents in page mode', () => {
		expect(() => linkPagesForMode('pages', [composite], [])).toThrow(TypeError);
	});
});

describe('mergeEditorDocuments', () => {
	it('saves edited pages while preserving the stashed composites', () => {
		const editedPage: EditorPage = { ...page, name: 'Updated home' };
		const stashedComposites = [composite];
		const result = mergeEditorDocuments('pages', [editedPage], [], stashedComposites);
		expect(result.pages).toEqual([editedPage]);
		expect(result.composites).toEqual([composite]);
		expect(result.composites).not.toBe(stashedComposites);
	});

	it('saves edited composites while preserving the stashed pages', () => {
		const editedComposite: EditorComposite = { ...composite, name: 'UpdatedHero' };
		const result = mergeEditorDocuments('composites', [editedComposite], [page], []);
		expect(result.pages).toEqual([page]);
		expect(result.composites).toEqual([editedComposite]);
	});

	it('rejects documents from the other mode instead of dropping them', () => {
		const pageDocument: EditorDocument = page;
		const compositeDocument: EditorDocument = composite;
		expect(() => mergeEditorDocuments('pages', [compositeDocument], [], [])).toThrow(TypeError);
		expect(() => mergeEditorDocuments('composites', [pageDocument], [], [])).toThrow(TypeError);
	});
});
