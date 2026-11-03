/**
 * @fileoverview Server-only image import boundary. It validates and decodes raster
 * images, sanitizes standalone SVGs, and downloads through a DNS-pinned direct
 * connection. The caller owns persistence and must serve the returned MIME type.
 * SVG uses the same 10 MiB input limit as rasters, with additional structural,
 * text, geometry, reference and rendering-work budgets. Safe local gradients,
 * masks and clip paths are supported with namespaced IDs; XML comments are
 * validated and removed. CSS styles, links, filters, nested definition
 * references and external resources are not supported. All formats are limited
 * to 16 million decoded pixels including frames.
 */
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, Agent as HttpAgent } from 'node:http';
import { request as httpsRequest, Agent as HttpsAgent } from 'node:https';
import { BlockList, isIP } from 'node:net';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const MAX_SVG_RENDER_WORK = 250_000_000;
const TIMEOUT_MS = 15_000;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** A deliberately non-sensitive message suitable for displaying to an importer. */
export class ImageImportError extends Error {
	/** @param message - A non-sensitive explanation appropriate for users. */
	constructor(message: string) {
		super(message);
		this.name = 'ImageImportError';
	}
}

/**
 * Validated image bytes and their content-derived storage metadata.
 * SVG bytes are sanitized and may differ from the input.
 */
export interface ImportedImage {
	/** Validated raster bytes, or the sanitized SVG document. */
	data: Buffer;
	/** Content-derived MIME type, never copied from HTTP headers. */
	mimeType: string;
	/** Content-derived filename extension without a leading dot. */
	extension: string;
}

const blocked = new BlockList();
for (const [address, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.31.196.0', 24],
	['192.52.193.0', 24],
	['192.88.99.0', 24],
	['192.168.0.0', 16],
	['192.175.48.0', 24],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
] as const)
	blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
	['2001::', 23],
	['2001:db8::', 32],
	['2002::', 16],
	['3fff::', 20]
] as const)
	blocked.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

/**
 * Test whether an address is eligible for a direct outbound image request.
 * IPv4-mapped IPv6, transition networks and non-global IPv6 ranges fail closed.
 * @param address - A numeric IPv4 or IPv6 address, without a zone identifier.
 * @returns Whether the address is permitted.
 * @example isPublicImageAddress('127.0.0.1') // false
 */
export function isPublicImageAddress(address: string): boolean {
	const family = isIP(address);
	if (address.includes('%')) return false;
	if (family === 4) return !blocked.check(address, 'ipv4');
	if (family === 6) return globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
	return false;
}

const svgTags = [
	'svg',
	'g',
	'defs',
	'linearGradient',
	'radialGradient',
	'stop',
	'clipPath',
	'mask',
	'path',
	'rect',
	'circle',
	'ellipse',
	'line',
	'polyline',
	'polygon',
	'text',
	'tspan',
	'title',
	'desc'
];
const svgAttributes = [
	'xmlns',
	'id',
	'viewBox',
	'width',
	'height',
	'x',
	'y',
	'x1',
	'x2',
	'y1',
	'y2',
	'cx',
	'cy',
	'r',
	'rx',
	'ry',
	'fx',
	'fy',
	'fr',
	'd',
	'points',
	'gradientUnits',
	'gradientTransform',
	'spreadMethod',
	'offset',
	'stop-color',
	'stop-opacity',
	'clipPathUnits',
	'clip-path',
	'clip-rule',
	'mask',
	'maskUnits',
	'maskContentUnits',
	'mask-type',
	'fill',
	'fill-opacity',
	'fill-rule',
	'stroke',
	'stroke-width',
	'stroke-opacity',
	'stroke-linecap',
	'stroke-linejoin',
	'stroke-dasharray',
	'stroke-dashoffset',
	'opacity',
	'transform',
	'font-size',
	'font-family',
	'font-weight',
	'text-anchor',
	'dominant-baseline',
	'preserveAspectRatio'
];

function parseXml(window: JSDOM['window'], text: string): Document {
	const document = new window.DOMParser().parseFromString(text, 'image/svg+xml');
	if (
		document.documentElement.localName !== 'svg' ||
		document.documentElement.namespaceURI !== SVG_NS
	)
		throw new ImageImportError('Invalid SVG image.');
	return document;
}

function removeSvgComments(source: string): { withoutComments: string; commentCount: number } {
	const pieces: string[] = [];
	let scan = 0;
	let fragmentStart = 0;
	let commentCount = 0;
	while ((scan = source.indexOf('<', scan)) !== -1) {
		if (source.startsWith('<!--', scan)) {
			// XML forbids "--" inside a comment. The first occurrence must be
			// its terminator; otherwise a malformed comment could hide a DTD.
			const end = source.indexOf('--', scan + 4);
			if (end === -1 || source[end + 2] !== '>') throw new ImageImportError('Invalid SVG image.');
			if (++commentCount > 20_001) throw new ImageImportError('SVG image is too complex.');
			pieces.push(source.slice(fragmentStart, scan));
			scan = end + 3;
			fragmentStart = scan;
		} else {
			if (
				source.startsWith('<!', scan) ||
				(source.startsWith('<?', scan) && !/^<\?xml\s/i.test(source.slice(scan, scan + 6)))
			)
				throw new ImageImportError('Invalid SVG image.');
			scan++;
		}
	}
	pieces.push(source.slice(fragmentStart));
	return { withoutComments: pieces.join(''), commentCount };
}

function sanitizeSvg(input: Buffer): { data: Buffer; renderUnits: number } {
	let source: string;
	try {
		source = new TextDecoder('utf-8', { fatal: true }).decode(input);
	} catch {
		throw new ImageImportError('Invalid SVG image.');
	}
	// DTDs and processing instructions cannot reach an XML parser. Comments are
	// removed only after validating their delimiters; the original is still
	// parsed below so removing one cannot make malformed XML appear valid.
	const { withoutComments, commentCount } = removeSvgComments(source);
	// Bound XML node creation before parsing, not just after allocating the DOM.
	let markupCount = commentCount;
	let attributeCount = 0;
	let entityCount = 0;
	let inTag = false;
	let quote = '';
	let quoteLength = 0;
	for (const character of withoutComments) {
		if (character === '<' && ++markupCount > 20_001)
			throw new ImageImportError('SVG image is too complex.');
		if (character === '&' && ++entityCount > 80_000)
			throw new ImageImportError('SVG image is too complex.');
		if (quote) {
			if (character === quote) quote = '';
			else if (++quoteLength > 65_536) throw new ImageImportError('SVG image is too complex.');
		} else if (character === '<') inTag = true;
		else if (character === '>') inTag = false;
		else if (inTag && (character === '"' || character === "'")) {
			quote = character;
			quoteLength = 0;
		} else if (inTag && character === '=' && ++attributeCount > 80_000)
			throw new ImageImportError('SVG image is too complex.');
	}
	const dom = new JSDOM('');
	try {
		const window = dom.window;
		const original = parseXml(window, source);
		const pending: { element: Element; depth: number }[] = [
			{ element: original.documentElement, depth: 1 }
		];
		let elementCount = 0;
		let attributeBytes = 0;
		let renderedText = 0;
		while (pending.length) {
			const { element, depth } = pending.pop()!;
			if (++elementCount > 10_000 || depth > 128)
				throw new ImageImportError('SVG image is too complex.');
			for (const attribute of element.attributes) attributeBytes += attribute.value.length;
			if (attributeBytes > 1024 * 1024) throw new ImageImportError('SVG image is too complex.');
			if (element.localName === 'text' || element.localName === 'tspan') {
				for (const child of element.childNodes)
					if (child.nodeType === 3) renderedText += child.nodeValue?.length ?? 0;
				if (renderedText > 65_536) throw new ImageImportError('SVG image is too complex.');
			}
			for (const child of element.children) pending.push({ element: child, depth: depth + 1 });
		}
		const purifier = createDOMPurify(dom.window);
		const cleaned = purifier.sanitize(withoutComments, {
			ALLOWED_TAGS: svgTags,
			ALLOWED_ATTR: svgAttributes,
			ALLOW_DATA_ATTR: false,
			ALLOW_ARIA_ATTR: false,
			KEEP_CONTENT: false
		});
		const parsed = parseXml(window, cleaned);
		const elements = [parsed.documentElement, ...parsed.querySelectorAll('*')];
		const ids = new Map<string, { normalized: string; element: Element }>();
		const normalizedIds = new Set<string>();
		for (const element of elements) {
			if (element.namespaceURI !== SVG_NS) throw new ImageImportError('Invalid SVG image.');
			const id = element.getAttribute('id');
			if (id !== null) {
				// Strip our own prefix before hashing, so re-importing sanitized
				// bytes is idempotent and long original IDs remain usable.
				const normalized = id.replace(/^(?:image-[a-f0-9]{64}-)+/, '');
				if (id.length > 256 || !/^[a-zA-Z_][a-zA-Z0-9_.-]{0,127}$/.test(normalized)) {
					element.removeAttribute('id');
				} else {
					if (ids.has(id) || normalizedIds.has(normalized))
						throw new ImageImportError('Invalid SVG image.');
					ids.set(id, { normalized, element });
					normalizedIds.add(normalized);
					element.setAttribute('id', normalized);
				}
			}
		}
		let referenceCount = 0;
		let referenceCost = 0;
		let renderUnits = 0;
		for (const element of elements) {
			if (
				[
					'path',
					'rect',
					'circle',
					'ellipse',
					'line',
					'polyline',
					'polygon',
					'text',
					'tspan'
				].includes(element.localName)
			)
				renderUnits +=
					1 +
					Math.ceil(
						((element.getAttribute('d')?.length ?? 0) +
							(element.getAttribute('points')?.length ?? 0)) /
							128
					);
			if (element.localName === 'text' || element.localName === 'tspan') {
				for (const child of element.childNodes)
					if (child.nodeType === 3) renderUnits += Math.ceil((child.nodeValue?.length ?? 0) / 16);
			}
			for (const attribute of [...element.attributes]) {
				if (attribute.name === 'xmlns' && attribute.value === SVG_NS) continue;
				if (attribute.name === 'id') continue;
				if (['fill', 'stroke', 'mask', 'clip-path'].includes(attribute.name)) {
					const reference = /^url\(\s*#([a-zA-Z_][a-zA-Z0-9_.-]{0,255})\s*\)$/i.exec(
						attribute.value
					);
					if (reference) {
						const target = ids.get(reference[1]);
						const allowed =
							attribute.name === 'mask'
								? ['mask']
								: attribute.name === 'clip-path'
									? ['clipPath']
									: ['linearGradient', 'radialGradient'];
						// No definition may reference another definition: this prevents
						// cycles and exponential rendering. Mask/clip nesting is also
						// disallowed, and total referenced geometry has a fixed budget.
						let parent = element.parentElement;
						let nested = ['defs', 'mask', 'clipPath'].includes(element.localName);
						while (parent) {
							if (
								['defs', 'mask', 'clipPath'].includes(parent.localName) ||
								((attribute.name === 'mask' || attribute.name === 'clip-path') &&
									(parent.hasAttribute('mask') || parent.hasAttribute('clip-path')))
							)
								nested = true;
							parent = parent.parentElement;
						}
						if (!target || !allowed.includes(target.element.localName) || nested) {
							element.removeAttributeNode(attribute);
							continue;
						}
						referenceCount++;
						referenceCost +=
							(1 + target.element.querySelectorAll('*').length) *
							(1 + element.querySelectorAll('*').length);
						if (referenceCount > 256 || referenceCost > 50_000)
							throw new ImageImportError('SVG image is too complex.');
						element.setAttribute(attribute.name, `url(#${target.normalized})`);
						continue;
					}
				}
				// Paint and geometry attributes can be CSS-parsed by browsers. Exclude
				// escapes, functions and punctuation that could introduce a URL or CSS.
				if (
					attribute.namespaceURI ||
					!/^[a-zA-Z0-9\s.,%#()\-+]*$/.test(attribute.value) ||
					/url\s*\(/i.test(attribute.value) ||
					/\\/.test(attribute.value)
				)
					element.removeAttributeNode(attribute);
			}
		}
		const serializer = new window.XMLSerializer();
		const canonical = serializer.serializeToString(parsed.documentElement);
		const prefix = `image-${createHash('sha256').update(canonical).digest('hex')}-`;
		for (const element of elements) {
			const id = element.getAttribute('id');
			if (id !== null) element.setAttribute('id', prefix + id);
			for (const name of ['fill', 'stroke', 'mask', 'clip-path']) {
				const value = element.getAttribute(name);
				const reference = value && /^url\(#([a-zA-Z_][a-zA-Z0-9_.-]{0,127})\)$/.exec(value);
				if (reference) element.setAttribute(name, `url(#${prefix}${reference[1]})`);
			}
		}
		const output = Buffer.from(serializer.serializeToString(parsed.documentElement));
		if (output.length > MAX_BYTES) throw new ImageImportError('SVG image is too large.');
		return { data: output, renderUnits: Math.max(1, renderUnits + referenceCost) };
	} catch (error) {
		if (error instanceof ImageImportError) throw error;
		throw new ImageImportError('Invalid SVG image.');
	} finally {
		dom.window.close();
	}
}

/**
 * Validate actual bytes, fully decode bounded raster images and sanitize SVG.
 * @param input - Untrusted image bytes, at most 10 MiB.
 * @returns Sanitized or validated bytes with a MIME type and extension (no dot).
 * @throws ImageImportError for unsupported, invalid, oversized or unsafe images.
 * @example await validateImageFile(new Uint8Array(bytes))
 */
export async function validateImageFile(input: Uint8Array): Promise<ImportedImage> {
	if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > MAX_BYTES)
		throw new ImageImportError('Image must be between 1 byte and 10 MiB.');
	const bytes = Buffer.from(input);
	const signatures: [boolean, string, string, string][] = [
		[
			bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
			'png',
			'image/png',
			'png'
		],
		[bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, 'jpeg', 'image/jpeg', 'jpg'],
		[/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')), 'gif', 'image/gif', 'gif'],
		[
			bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
				bytes.subarray(8, 12).toString('ascii') === 'WEBP',
			'webp',
			'image/webp',
			'webp'
		]
	];
	const signature = signatures.find(([matches]) => matches);
	if (!signature) {
		// Treat text as SVG only after strict XML parsing; arbitrary text fails closed.
		const { data, renderUnits } = sanitizeSvg(bytes);
		await decodeImage(data, 'svg', renderUnits);
		return { data, mimeType: 'image/svg+xml', extension: 'svg' };
	}
	const [, format, mimeType, extension] = signature;
	await decodeImage(bytes, format);
	return { data: bytes, mimeType, extension };
}

async function decodeImage(data: Buffer, format: string, renderUnits = 0): Promise<void> {
	try {
		const image = sharp(data, { failOn: 'warning', limitInputPixels: MAX_PIXELS, animated: true });
		const metadata = await image.metadata();
		if (
			metadata.format !== format ||
			!metadata.width ||
			!metadata.height ||
			metadata.width * metadata.height > MAX_PIXELS ||
			metadata.width * metadata.height * renderUnits > MAX_SVG_RENDER_WORK
		)
			throw new ImageImportError('Invalid or excessively large image.');
		// Full decode, including all animation frames, detects truncated/corrupt
		// payloads. The pixel limit also bounds decompression memory.
		await image.raw().toBuffer();
	} catch (error) {
		if (error instanceof ImageImportError) throw error;
		throw new ImageImportError('Invalid or excessively large image.');
	}
}

/**
 * Download an HTTP(S) image without redirects, proxy use or DNS rebinding.
 * Every resolved address must be public, and the connection is pinned to one
 * checked address while TLS still verifies the original hostname.
 * @param url - An absolute HTTP(S) URL with no credentials.
 * @returns Validated image bytes and content-derived metadata.
 * @throws ImageImportError for unsafe URLs, network failures or invalid images.
 * @example await downloadImage('https://example.com/image.png')
 */
export async function downloadImage(url: string): Promise<ImportedImage> {
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		throw new ImageImportError('Invalid image URL.');
	}
	if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
		throw new ImageImportError('Invalid image URL.');
	const hostname = target.hostname.replace(/^\[|\]$/g, '');
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				controller.abort();
				reject(new ImageImportError('Image download timed out.'));
			}, TIMEOUT_MS);
		});
		const operation = (async () => {
			const addresses = await lookup(hostname, { all: true, verbatim: true });
			if (
				addresses.length === 0 ||
				addresses.some(
					({ address, family }) => !isPublicImageAddress(address) || isIP(address) !== family
				)
			)
				throw new ImageImportError('Image URL resolves to a prohibited address.');
			if (controller.signal.aborted) throw new ImageImportError('Image download timed out.');
			const selected = addresses[0];
			const secure = target.protocol === 'https:';
			const agent = secure
				? new HttpsAgent({ keepAlive: false })
				: new HttpAgent({ keepAlive: false });
			try {
				const data = await new Promise<Buffer>((resolve, reject) => {
					const request = (secure ? httpsRequest : httpRequest)(
						target,
						{
							agent,
							signal: controller.signal,
							family: selected.family,
							lookup: (_host, _options, callback) =>
								callback(null, selected.address, selected.family),
							headers: { 'accept-encoding': 'identity' }
						},
						(response) => {
							const length = response.headers['content-length'];
							const encoding = response.headers['content-encoding'];
							if (
								response.statusCode !== 200 ||
								(encoding && encoding.toLowerCase() !== 'identity') ||
								(length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
							) {
								response.destroy();
								reject(new ImageImportError('Image download was rejected.'));
								return;
							}
							const chunks: Buffer[] = [];
							let size = 0;
							response.on('data', (chunk: Buffer) => {
								size += chunk.length;
								if (size > MAX_BYTES) {
									response.destroy();
									reject(new ImageImportError('Image is too large.'));
								} else chunks.push(chunk);
							});
							response.once('error', reject);
							response.once('aborted', () =>
								reject(new ImageImportError('Image download was interrupted.'))
							);
							response.once('end', () => resolve(Buffer.concat(chunks, size)));
						}
					);
					request.once('error', reject);
					request.end();
				});
				return await validateImageFile(data);
			} finally {
				agent.destroy();
			}
		})();
		return await Promise.race([operation, timeout]);
	} catch (error) {
		if (error instanceof ImageImportError) throw error;
		throw new ImageImportError('Unable to download image.');
	} finally {
		if (timer) clearTimeout(timer);
	}
}
