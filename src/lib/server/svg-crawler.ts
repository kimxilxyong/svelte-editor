/**
 * @fileoverview Web SVG Crawler for discovering, previewing and importing `.svg` icons/images from
 * any web page or collection URL (such as `https://www.svgrepo.com/collection/...`).
 *
 * Workflow:
 * 1. {@link crawlWebPageForSvgs} fetches a web URL (falling back to the Jina reader mirror when a
 *    collection page is behind a bot challenge), extracts all linked `.svg` assets and inline
 *    `<svg>` elements, and returns a list of {@link CrawledSvgCandidate} items for user preview
 *    alongside the suggested target folder derived from the URL's last path element.
 * 2. The user previews the discovered SVGs in the UI, optionally deselecting/removing individual
 *    SVGs or cancelling the whole import.
 * 3. {@link importCrawledSvgs} downloads/validates the chosen SVGs, writes them into
 *    `static/images/<folder>/<slug>.svg` and registers them in the `images` database table.
 */

import path from 'node:path';
import {
	extractUrlLastPathElement,
	normalizeImageName,
	type ImageCategory,
	type ManagedImage
} from '../images.js';
import type { SqlClient } from './database/types.js';
import {
	ImageFileError,
	slugifyImageFile,
	storeImageFile,
	storeInlineImage,
	validateSvgContent
} from './image-files.js';
import { createManagedImage, listImages } from './project-store.js';

/** Maximum number of SVG candidates returned from a single web page crawl. */
export const maxCrawlCandidates = 80;

/** A single SVG discovered by the web crawler and returned for user preview before importing. */
export type CrawledSvgCandidate = {
	/** Temporary identifier for selection/removal in the preview UI. */
	id: string;
	/** Suggested human-readable display name. */
	name: string;
	/** Source `.svg` URL (or `'inline'` when extracted from an inline `<svg>` tag). */
	sourceUrl: string;
	/** URL or `data:image/svg+xml` URI used by `<img src>` in the preview grid. */
	previewUrl: string;
	/** Raw `<svg>...</svg>` markup when the candidate was extracted inline or pre-fetched. */
	inlineSvg?: string;
};

/** Result of scanning a URL for SVGs. */
export type CrawlPreviewResult = {
	/** Source URL that was scanned. */
	sourceUrl: string;
	/** Suggested folder name derived from the last path element of `sourceUrl`. */
	folder: string;
	/** Discovered SVG candidates ready for preview. */
	candidates: CrawledSvgCandidate[];
};

const browserUserAgent =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * Checks that a target URL is a public `http:` or `https:` URL (rejecting loopback, link-local and
 * private network addresses to prevent SSRF).
 *
 * @param rawUrl - Untrusted URL string.
 * @returns Parsed `URL` instance.
 * @throws {ImageFileError} When the URL is invalid or points to a restricted host.
 */
export function validateCrawlTargetUrl(rawUrl: unknown): URL {
	if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
		throw new ImageFileError('Enter a web URL to scan for SVGs.');
	}
	let parsed: URL;
	try {
		parsed = new URL(rawUrl.trim());
	} catch {
		throw new ImageFileError('Enter a valid http:// or https:// URL.');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new ImageFileError('Only http:// and https:// URLs can be crawled.');
	}
	const host = parsed.hostname.toLowerCase();
	if (
		host === 'localhost' ||
		host === '127.0.0.1' ||
		host === '0.0.0.0' ||
		host === '[::1]' ||
		host.endsWith('.local') ||
		/^10\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^169\.254\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
	) {
		throw new ImageFileError('Crawling private or local network addresses is not allowed.');
	}
	return parsed;
}

/** Converts a filename or slug into a clean human-readable title. */
function humanizeSlug(raw: string): string {
	const cleaned = raw
		.replace(/\.[a-z0-9]+$/i, '')
		.replace(/-svgrepo-com$/i, '')
		.replace(/\b(svg|file|icon|vector|image)\b/gi, '')
		.replace(/[-_]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!cleaned) return 'SVG Icon';
	return cleaned.replace(/\b[a-z]/g, (ch) => ch.toUpperCase()).slice(0, 70);
}

/** Resolves a potentially relative URL against the page URL and strips hash fragments. */
function resolveCandidateUrl(rawHref: string, baseUrl: URL): string | null {
	const trimmed = rawHref.trim().replace(/&amp;/g, '&');
	if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:')) return null;
	try {
		const resolved = new URL(trimmed, baseUrl);
		if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
		resolved.hash = '';
		return resolved.toString();
	} catch {
		return null;
	}
}

/**
 * Extracts SVG candidates from HTML or Markdown text.
 *
 * Recognises:
 * - Markdown images `![alt](https://.../*.svg)`
 * - HTML `<img src="...svg" alt="...">`
 * - HTML `href="...svg"`, `data="...svg"`, `src="...svg"`, `srcset="...svg"`
 * - SVG Repo detail links (`https://www.svgrepo.com/svg/<id>/<slug>`) converted to
 *   `https://www.svgrepo.com/show/<id>/<slug>.svg`
 * - Inline `<svg ...>...</svg>` elements
 *
 * @param text - HTML or Markdown response text.
 * @param baseUrl - Base URL of the crawled page.
 * @returns Deduplicated array of {@link CrawledSvgCandidate} items.
 */
export function extractSvgsFromContent(text: string, baseUrl: URL): CrawledSvgCandidate[] {
	const candidates: CrawledSvgCandidate[] = [];
	const seenUrls = new Set<string>();

	const addRemote = (rawUrl: string, rawLabel?: string) => {
		if (candidates.length >= maxCrawlCandidates) return;
		const resolved = resolveCandidateUrl(rawUrl, baseUrl);
		if (!resolved) return;
		const key = resolved.toLowerCase();
		if (seenUrls.has(key)) return;
		seenUrls.add(key);

		const urlPath = new URL(resolved).pathname;
		const fileStem = path.basename(urlPath, '.svg');
		const cleanedLabel = rawLabel
			? rawLabel
					.replace(/^Image\s+\d+:\s*/i, '')
					.replace(/\bSVG\s+(File|Icon|Vector)\b/gi, '')
					.replace(/\s+/g, ' ')
					.trim()
			: '';
		const name = normalizeImageName(cleanedLabel || humanizeSlug(fileStem)) ?? 'SVG Icon';
		candidates.push({
			id: `crawl-${candidates.length + 1}`,
			name,
			sourceUrl: resolved,
			previewUrl: resolved
		});
	};

	// 1. Markdown image syntax: ![Alt](https://.../*.svg)
	for (const match of text.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+\.svg)\)/gi)) {
		addRemote(match[2], match[1]);
	}

	// 2. HTML <img> tags referencing .svg
	for (const match of text.matchAll(/<img\b([^>]+)>/gi)) {
		const attrs = match[1];
		const srcMatch = /\b(?:src|data-src)\s*=\s*["']([^"']+\.svg(?:\?[^"']*)?)["']/i.exec(attrs);
		if (!srcMatch) continue;
		const altMatch = /\b(?:alt|title)\s*=\s*["']([^"']*)["']/i.exec(attrs);
		addRemote(srcMatch[1], altMatch?.[1]);
	}

	// 3. Any other src/href/data attribute ending in .svg
	for (const match of text.matchAll(
		/\b(?:src|href|data-src|data)\s*=\s*["']([^"']+\.svg(?:\?[^"']*)?)["']/gi
	)) {
		addRemote(match[1]);
	}

	// 4. SVG Repo page links `/svg/<id>/<slug>` -> `https://www.svgrepo.com/show/<id>/<slug>.svg`
	for (const match of text.matchAll(
		/(?:https?:\/\/www\.svgrepo\.com)?\/svg\/(\d+)\/([a-z0-9-]+)\b/gi
	)) {
		const [, id, slug] = match;
		addRemote(`https://www.svgrepo.com/show/${id}/${slug}.svg`, humanizeSlug(slug));
	}

	// 5. Direct `https://.../*.svg` URLs in JSON/script payloads
	for (const match of text.matchAll(/https?:\/\/[^\s"'<>\\)]+\.svg\b/gi)) {
		addRemote(match[0]);
	}

	// 6. Inline <svg> elements
	for (const match of text.matchAll(/<svg\b[\s\S]*?<\/svg\s*>/gi)) {
		if (candidates.length >= maxCrawlCandidates) break;
		const rawSvg = match[0];
		try {
			const cleanSvg = validateSvgContent(rawSvg);
			// Skip tiny decorative UI chevrons/arrows that have no paths or are < 80 chars
			if (cleanSvg.length < 80) continue;
			const titleMatch =
				/<title[^>]*>([^<]+)<\/title>/i.exec(cleanSvg) ??
				/\baria-label\s*=\s*["']([^"']+)["']/i.exec(cleanSvg);
			const index = candidates.length + 1;
			const name =
				normalizeImageName(titleMatch?.[1]?.trim() || `Inline SVG ${index}`) ??
				`Inline SVG ${index}`;
			const previewUrl = `data:image/svg+xml;utf8,${encodeURIComponent(cleanSvg)}`;
			candidates.push({
				id: `crawl-${index}`,
				name,
				sourceUrl: 'inline',
				previewUrl,
				inlineSvg: cleanSvg
			});
		} catch {
			// Ignore malformed or script-bearing inline SVGs.
		}
	}

	return candidates;
}

/**
 * Crawls a web URL and returns discovered SVG candidates for user preview without writing to disk.
 *
 * @param rawUrl - Web page or SVG collection URL.
 * @param fetchFn - Fetch implementation (injectable for tests).
 * @returns Suggested folder name (last path element) and discovered SVG candidates.
 */
export async function crawlWebPageForSvgs(
	rawUrl: unknown,
	fetchFn: typeof fetch = fetch
): Promise<CrawlPreviewResult> {
	const targetUrl = validateCrawlTargetUrl(rawUrl);
	const rawFolder = extractUrlLastPathElement(targetUrl.toString());
	// Shorten `isometric-3d-interface-icons` to `isometric` if it starts with `isometric-` and user
	// crawls the default collection, or keep the last path segment as-is.
	const folder = rawFolder === 'isometric-3d-interface-icons' ? 'isometric' : rawFolder;

	let bodyText = '';
	let contentType = '';
	let directOk = false;

	try {
		const response = await fetchFn(targetUrl.toString(), {
			headers: {
				'user-agent': browserUserAgent,
				accept: 'text/html,application/xhtml+xml,image/svg+xml,application/xml;q=0.9,*/*;q=0.8'
			}
		});
		if (response.ok) {
			contentType = response.headers.get('content-type') ?? '';
			bodyText = await response.text();
			directOk = true;
		}
	} catch {
		// Fall through to reader fallback below.
	}

	// Direct single .svg URL
	if (
		directOk &&
		(contentType.includes('image/svg+xml') || targetUrl.pathname.toLowerCase().endsWith('.svg')) &&
		/<svg[\s>]/i.test(bodyText)
	) {
		const cleanSvg = validateSvgContent(bodyText);
		const stem = path.basename(targetUrl.pathname, '.svg') || folder;
		return {
			sourceUrl: targetUrl.toString(),
			folder,
			candidates: [
				{
					id: 'crawl-1',
					name: humanizeSlug(stem),
					sourceUrl: targetUrl.toString(),
					previewUrl: `data:image/svg+xml;utf8,${encodeURIComponent(cleanSvg)}`,
					inlineSvg: cleanSvg
				}
			]
		};
	}

	let candidates = directOk ? extractSvgsFromContent(bodyText, targetUrl) : [];

	// Fallback for Cloudflare/Vercel-gated collection pages (such as svgrepo.com/collection/...)
	if (candidates.length === 0) {
		try {
			const readerUrl = `https://r.jina.ai/${targetUrl.toString()}`;
			const fallbackRes = await fetchFn(readerUrl, {
				headers: { 'user-agent': browserUserAgent }
			});
			if (fallbackRes.ok) {
				const fallbackText = await fallbackRes.text();
				candidates = extractSvgsFromContent(fallbackText, targetUrl);
			}
		} catch {
			// Ignore fallback errors.
		}
	}

	if (candidates.length === 0) {
		throw new ImageFileError('No SVG images were found at that URL.');
	}

	return {
		sourceUrl: targetUrl.toString(),
		folder,
		candidates
	};
}

/**
 * Downloads and stores the user-approved subset of crawled SVGs into `static/images/<folder>/`
 * and registers them in the `images` database table.
 *
 * @param db - Database client.
 * @param options - Target folder (last path element), category, approved items and optional `fetchFn`.
 * @returns Newly created {@link ManagedImage} entries.
 */
export async function importCrawledSvgs(
	db: SqlClient,
	options: {
		folder: string;
		category: ImageCategory;
		items: { name: string; sourceUrl?: string; inlineSvg?: string }[];
		fetchFn?: typeof fetch;
	}
): Promise<ManagedImage[]> {
	const fetchFn = options.fetchFn ?? fetch;
	const folder = slugifyImageFile(options.folder || 'crawled');
	if (!Array.isArray(options.items) || options.items.length === 0) {
		throw new ImageFileError('Select at least one SVG to import.');
	}

	const current = await listImages(db);
	const takenNames = new Set(current.map((img) => img.name.toLowerCase()));
	const imported: ManagedImage[] = [];

	for (const item of options.items.slice(0, maxCrawlCandidates)) {
		const baseName = normalizeImageName(item.name) ?? 'Crawled SVG';
		let uniqueName = baseName;
		let suffix = 2;
		while (takenNames.has(uniqueName.toLowerCase())) {
			uniqueName = `${baseName.slice(0, 72)} ${suffix++}`;
		}

		let storedUrl = '';
		if (typeof item.inlineSvg === 'string' && item.inlineSvg.trim().length > 0) {
			storedUrl = await storeInlineImage({
				name: uniqueName,
				category: options.category,
				folder,
				content: item.inlineSvg
			});
		} else if (typeof item.sourceUrl === 'string' && item.sourceUrl.trim().length > 0) {
			const remoteUrl = validateCrawlTargetUrl(item.sourceUrl);
			const res = await fetchFn(remoteUrl.toString(), {
				headers: { 'user-agent': browserUserAgent }
			}).catch(() => null);
			if (!res || !res.ok) continue;
			const bytes = new Uint8Array(await res.arrayBuffer());
			storedUrl = await storeImageFile({
				filename: `${slugifyImageFile(uniqueName)}.svg`,
				category: options.category,
				folder,
				bytes
			});
		} else {
			continue;
		}

		takenNames.add(uniqueName.toLowerCase());
		const created = await createManagedImage(db, {
			name: uniqueName,
			url: storedUrl,
			category: options.category
		});
		imported.push(created);
	}

	if (imported.length === 0) {
		throw new ImageFileError('None of the selected SVGs could be downloaded.');
	}

	return imported;
}
