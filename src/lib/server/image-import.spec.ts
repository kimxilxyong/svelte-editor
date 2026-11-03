/**
 * @fileoverview Focused import-boundary tests for decoded image formats, SVG
 * sanitization, SSRF address classification and pinned HTTP(S) downloads.
 */
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('node:http', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:http')>()),
	request: network.request
}));
vi.mock('node:https', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:https')>()),
	request: network.request
}));

import {
	downloadImage,
	ImageImportError,
	isPublicImageAddress,
	validateImageFile
} from './image-import.js';

const svg = (body: string) =>
	Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${body}</svg>`);
const pixel = () => sharp({ create: { width: 1, height: 1, channels: 3, background: '#ff0000' } });

afterEach(() => {
	vi.clearAllMocks();
	vi.useRealTimers();
});

describe('validateImageFile', () => {
	it.each([
		['png', 'image/png', 'png'],
		['jpeg', 'image/jpeg', 'jpg'],
		['gif', 'image/gif', 'gif'],
		['webp', 'image/webp', 'webp']
	] as const)('decodes valid %s bytes', async (format, mimeType, extension) => {
		const input = await pixel().toFormat(format).toBuffer();
		expect(await validateImageFile(input)).toEqual({ data: input, mimeType, extension });
	});

	it('copies the input and identifies the content, not an external filename', async () => {
		const input = await pixel().png().toBuffer();
		const result = await validateImageFile(input);
		input.fill(0);
		expect(result.mimeType).toBe('image/png');
		expect(result.data[0]).toBe(0x89);
	});

	it.each([
		Buffer.alloc(0),
		Buffer.from('not an image'),
		Buffer.from('89504e470d0a1a0a', 'hex'),
		Buffer.from('ffd8ff', 'hex'),
		Buffer.from('GIF89a'),
		Buffer.from('RIFF0000WEBP')
	])('rejects unsupported, empty and truncated content', async (input) => {
		await expect(validateImageFile(input)).rejects.toBeInstanceOf(ImageImportError);
	});

	it('enforces input and decoded pixel limits', async () => {
		await expect(validateImageFile(Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toThrow(/10 MiB/);
		const huge = await sharp({
			create: { width: 4001, height: 4000, channels: 3, background: 'white' }
		})
			.png()
			.toBuffer();
		await expect(validateImageFile(huge)).rejects.toThrow(/large/);
	});

	it('accepts a raster exactly at the input byte limit', async () => {
		const png = await pixel().png().toBuffer();
		const input = Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024 - png.length)]);
		expect((await validateImageFile(input)).mimeType).toBe('image/png');
	});

	it('accepts an SVG exactly at 10 MiB and rejects one byte more', async () => {
		const start = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect></rect>';
		const end = '</svg>';
		const input = Buffer.from(
			start + ' '.repeat(10 * 1024 * 1024 - start.length - end.length) + end
		);
		expect(input.length).toBe(10 * 1024 * 1024);
		expect((await validateImageFile(input)).mimeType).toBe('image/svg+xml');
		await expect(validateImageFile(Buffer.concat([input, Buffer.from(' ')]))).rejects.toThrow(
			/10 MiB/
		);
	}, 30_000);

	it('rejects deeply nested or excessively numerous SVG elements', async () => {
		await expect(validateImageFile(svg('<g>'.repeat(129) + '</g>'.repeat(129)))).rejects.toThrow(
			/complex/
		);
		await expect(validateImageFile(svg('<rect/>'.repeat(10_001)))).rejects.toThrow(/complex/);
	});

	it('rejects excessive SVG geometry and rendered text despite the 10 MiB byte allowance', async () => {
		await expect(validateImageFile(svg(`<path d="${'M0 0 '.repeat(14_000)}"/>`))).rejects.toThrow(
			/complex/
		);
		await expect(validateImageFile(svg(`<text>${'a'.repeat(65_537)}</text>`))).rejects.toThrow(
			/complex/
		);
	});

	it('bounds rendering work for large viewports with many shapes', async () => {
		const input = Buffer.from(
			`<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="4000">${'<rect width="4000" height="4000"/>'.repeat(16)}</svg>`
		);
		await expect(validateImageFile(input)).rejects.toThrow(/large/);
	});

	it('bounds the number of local definition references', async () => {
		const input = svg(
			`<defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs>` +
				'<rect width="1" height="1" clip-path="url(#c)"/>'.repeat(257)
		);
		await expect(validateImageFile(input)).rejects.toThrow(/complex/);
	});

	it.each(['png', 'jpeg', 'gif', 'webp'] as const)(
		'rejects truncated %s payloads',
		async (format) => {
			const input = await pixel().toFormat(format).toBuffer();
			await expect(
				validateImageFile(input.subarray(0, Math.ceil(input.length / 2)))
			).rejects.toBeInstanceOf(ImageImportError);
		}
	);

	it('removes active content, external references, CSS and event handlers from SVG', async () => {
		const result = await validateImageFile(
			svg(`<script>alert(1)</script><style>@import url(https://evil.test/a)</style>
			<foreignObject><iframe src="https://evil.test"></iframe></foreignObject>
			<image href="https://evil.test/x"/><a href="javascript:alert(1)"><rect/></a>
			<rect x="1" width="5" height="5" onclick="alert(1)" style="fill:url(https://evil.test)"
				fill="url(https://evil.test/x)" stroke="red"/>
			<path d="M0 0 L1 1" onload="alert(1)"/>`)
		);
		const clean = result.data.toString();
		expect(result.mimeType).toBe('image/svg+xml');
		expect(result.extension).toBe('svg');
		expect(clean).toContain('<rect');
		expect(clean).toContain('stroke="red"');
		expect(clean).not.toMatch(
			/script|style|foreignObject|iframe|href|onclick|onload|https:|url\(/i
		);
	});

	it('accepts and removes well-formed comments, including declaration-like text', async () => {
		const input = Buffer.from(`<?xml version="1.0"?>
			<!-- <!DOCTYPE svg [<!ENTITY x "boom">]> <?xml-stylesheet href="https://evil.test"?> -->
			<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
				<!----><!-- <script>alert(1)</script> &unknown; < > " ' -->
				<rect width="10" height="10" fill="red"/><g><!-- between --><circle r="2"/></g>
			</svg><!-- after document -->`);
		const result = await validateImageFile(input);
		const markup = result.data.toString();
		expect(result.mimeType).toBe('image/svg+xml');
		expect(markup).toContain('<rect');
		expect(markup).toContain('fill="red"');
		expect(markup).toContain('<circle');
		expect(markup).not.toMatch(/<!--|DOCTYPE|ENTITY|xml-stylesheet|evil|script|unknown/i);
	});

	it.each([
		'<!-- unclosed',
		'<!-- bad -- comment -->',
		'<!-- bad --!>',
		'<!-- trailing dash --->',
		'<!-- outer <!-- nested --> -->'
	])('rejects malformed or unclosed SVG comment: %s', async (comment) => {
		await expect(
			validateImageFile(svg(`${comment}<rect width="1" height="1"/>`))
		).rejects.toBeInstanceOf(ImageImportError);
	});

	it.each([
		`<!-- safe --><!DOCTYPE svg [<!ENTITY x "boom">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>`,
		`<!-- safe --><?xml-stylesheet href="https://evil.test/x"?><svg xmlns="http://www.w3.org/2000/svg"/>`,
		`<!-- malformed -- <!DOCTYPE svg [<!ENTITY x "boom">]> --><svg xmlns="http://www.w3.org/2000/svg"/>`,
		`<svg xmlns="http://www.w3.org/2000/svg" width="1<!--x-->0"/>`,
		`<sv<!--x-->g xmlns="http://www.w3.org/2000/svg"/>`
	])('rejects declarations after comments and XML made invalid by comments: %s', async (input) => {
		await expect(validateImageFile(Buffer.from(input))).rejects.toBeInstanceOf(ImageImportError);
	});

	it('counts comments against the XML node creation budget', async () => {
		await expect(validateImageFile(svg('<!---->'.repeat(20_001)))).rejects.toThrow(/complex/);
	});

	it.each([
		'<!DOCTYPE svg [<!ENTITY x "boom">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
		'<?xml-stylesheet href="https://evil.test/a"?><svg xmlns="http://www.w3.org/2000/svg"/>',
		'<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
		'<svg xmlns="http://evil.test"><rect/></svg>',
		'<html><svg xmlns="http://www.w3.org/2000/svg"/></html>'
	])('rejects malformed or unsafe XML: %s', async (input) => {
		await expect(validateImageFile(Buffer.from(input))).rejects.toBeInstanceOf(ImageImportError);
	});

	it('removes entity-encoded and escaped external paint references', async () => {
		const result = await validateImageFile(
			svg('<rect width="1" height="1" fill="u&#114;l(https://evil.test)"/>')
		);
		expect(result.data.toString()).not.toMatch(/fill=|evil/i);
	});

	it('renders local linear and radial gradients, masks and clip paths after sanitization', async () => {
		const cases = [
			`<defs><linearGradient id="grad"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>
			 <rect width="10" height="10" fill="url(#grad)"/>`,
			`<defs><radialGradient id="grad"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient></defs>
			 <rect width="10" height="10" fill="url(#grad)"/>`,
			`<defs><clipPath id="clip"><rect width="5" height="10"/></clipPath></defs>
			 <rect width="10" height="10" fill="red" clip-path="url(#clip)"/>`,
			`<defs><mask id="mask"><rect width="5" height="10" fill="white"/></mask></defs>
			 <rect width="10" height="10" fill="red" mask="url(#mask)"/>`
		];
		for (const source of cases) {
			const imported = await validateImageFile(svg(source));
			const markup = imported.data.toString();
			expect(markup).toMatch(/url\(#image-[a-f0-9]{64}-/);
			const pixels = await sharp(imported.data).ensureAlpha().raw().toBuffer();
			expect(pixels[(5 * 10 + 2) * 4 + 3]).toBeGreaterThan(0);
			if (source.includes('clipPath') || source.includes('<mask'))
				expect(pixels[(5 * 10 + 8) * 4 + 3]).toBe(0);
			else expect(pixels[(5 * 10 + 2) * 4]).not.toBe(pixels[(5 * 10 + 8) * 4]);
		}
	});

	it('strips external, missing, wrong-kind, nested, and linked references', async () => {
		const imported = await validateImageFile(
			svg(`
			<defs>
				<linearGradient id="g" href="https://evil.test/g" xlink:href="https://evil.test/g" xmlns:xlink="http://www.w3.org/1999/xlink">
					<stop offset="0" stop-color="red"/>
				</linearGradient>
				<mask id="m"><rect width="10" height="10" fill="url(#g)" mask="url(#m)"/></mask>
				<clipPath id="c"><rect width="5" height="5"/></clipPath>
			</defs>
			<rect width="10" height="10" fill="url(https://evil.test/g)" mask="url(#c)" clip-path="url(#missing)"/>
			<g mask="url(#m)"><rect width="3" height="3" clip-path="url(#c)"/></g>
			<rect width="1" height="1" fill="url(#g) red" stroke="u&#114;l(https://evil.test)"/>
		`)
		);
		const markup = imported.data.toString();
		expect(markup).not.toMatch(/evil|href|xlink|url\(#missing\)/i);
		expect(markup.match(/url\(/g)).toHaveLength(1);
		expect(markup).toContain('mask="url(#image-');
	});

	it('rejects duplicate IDs so local references cannot be ambiguous', async () => {
		await expect(
			validateImageFile(svg('<defs><mask id="x"/><clipPath id="x"/></defs>'))
		).rejects.toThrow(/Invalid SVG/);
	});

	it('keeps reference IDs stable when sanitized SVG is re-imported', async () => {
		const id = 'a'.repeat(128);
		const original =
			svg(`<defs><linearGradient id="${id}"><stop stop-color="red"/></linearGradient></defs>
			<rect width="10" height="10" fill="url(#${id})"/>`);
		const first = await validateImageFile(original);
		const second = await validateImageFile(first.data);
		expect(second.data).toEqual(first.data);
		expect(second.data.toString()).toContain(`-${id})`);
	});
});

describe('isPublicImageAddress', () => {
	it.each([
		'0.0.0.0',
		'10.0.0.1',
		'100.64.0.1',
		'127.1.2.3',
		'169.254.169.254',
		'172.31.0.1',
		'192.168.1.1',
		'192.0.2.1',
		'198.18.0.1',
		'203.0.113.1',
		'224.0.0.1',
		'255.255.255.255',
		'::',
		'::1',
		'fc00::1',
		'fe80::1',
		'ff02::1',
		'::ffff:127.0.0.1',
		'::ffff:8.8.8.8',
		'2002:0808:0808::1',
		'2001:db8::1',
		'64:ff9b::808:808',
		'fe80::1%eth0',
		'not-an-ip'
	])('rejects %s', (address) => expect(isPublicImageAddress(address)).toBe(false));
	it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts %s', (address) =>
		expect(isPublicImageAddress(address)).toBe(true)
	);
});

function respond(status: number, headers: Record<string, string>, chunks: Buffer[]) {
	network.request.mockImplementation((_url, _options, callback) => {
		const request = new EventEmitter() as EventEmitter & { end: () => void };
		request.end = () => {
			const response = Readable.from(chunks) as Readable & {
				statusCode: number;
				headers: Record<string, string>;
			};
			response.statusCode = status;
			response.headers = headers;
			callback(response);
		};
		return request;
	});
}

describe('downloadImage', () => {
	it('pins checked DNS while preserving the original HTTPS URL and ignores a false content type', async () => {
		network.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
		const png = await pixel().png().toBuffer();
		respond(200, { 'content-type': 'image/jpeg' }, [png]);
		expect(await downloadImage('https://images.example/file.jpg')).toEqual({
			data: png,
			mimeType: 'image/png',
			extension: 'png'
		});
		expect(network.lookup).toHaveBeenCalledWith('images.example', { all: true, verbatim: true });
		const [url, options] = network.request.mock.calls[0];
		expect(url.hostname).toBe('images.example');
		expect(options.headers['accept-encoding']).toBe('identity');
		expect(options.agent).toBeTruthy();
		const callback = vi.fn();
		options.lookup('images.example', {}, callback);
		expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
	});

	it.each([
		'http://127.0.0.1/x',
		'http://user:pass@example.com/x',
		'file:///etc/passwd',
		'http://[::ffff:127.0.0.1]/x'
	])('rejects unsafe URL %s', async (url) => {
		network.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
		await expect(downloadImage(url)).rejects.toBeInstanceOf(ImageImportError);
		expect(network.request).not.toHaveBeenCalled();
	});

	it('rejects mixed public and private DNS answers rather than selecting a safe one', async () => {
		network.lookup.mockResolvedValue([
			{ address: '8.8.8.8', family: 4 },
			{ address: '::ffff:127.0.0.1', family: 6 }
		]);
		await expect(downloadImage('http://example.test/')).rejects.toThrow(/prohibited/);
		expect(network.request).not.toHaveBeenCalled();
	});

	it.each([
		[302, { location: 'http://127.0.0.1/' }],
		[200, { 'content-encoding': 'gzip' }],
		[200, { 'content-length': String(10 * 1024 * 1024 + 1) }],
		[404, {}]
	])('rejects redirects, compressed and oversized or failed responses', async (status, headers) => {
		network.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
		respond(status, headers, []);
		await expect(downloadImage('http://example.test/')).rejects.toBeInstanceOf(ImageImportError);
		expect(network.request).toHaveBeenCalledTimes(1);
	});

	it('enforces the streaming byte limit without trusting Content-Length', async () => {
		network.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
		respond(200, {}, [Buffer.alloc(10 * 1024 * 1024), Buffer.alloc(1)]);
		await expect(downloadImage('http://example.test/')).rejects.toThrow(/too large/);
	});

	it('times out DNS resolution without opening a connection later', async () => {
		vi.useFakeTimers();
		let resolveDns!: (addresses: { address: string; family: number }[]) => void;
		network.lookup.mockReturnValue(
			new Promise((resolve) => {
				resolveDns = resolve;
			})
		);
		const download = downloadImage('http://example.test/');
		const assertion = expect(download).rejects.toThrow(/timed out/);
		await vi.advanceTimersByTimeAsync(15_000);
		await assertion;
		resolveDns([{ address: '8.8.8.8', family: 4 }]);
		await Promise.resolve();
		expect(network.request).not.toHaveBeenCalled();
	});

	it('aborts an in-progress request at the overall deadline', async () => {
		vi.useFakeTimers();
		network.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
		network.request.mockImplementation(() => {
			const request = new EventEmitter() as EventEmitter & { end: () => void };
			request.end = () => {};
			return request;
		});
		const download = downloadImage('http://example.test/');
		const assertion = expect(download).rejects.toThrow(/timed out/);
		await Promise.resolve();
		const options = network.request.mock.calls[0][1];
		await vi.advanceTimersByTimeAsync(15_000);
		await assertion;
		expect(options.signal.aborted).toBe(true);
	});
});
