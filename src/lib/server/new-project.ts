/**
 * @fileoverview Creates a complete, buildable SvelteKit application from an editor site.
 *
 * Counterpart of `exportSite` in `project.ts`: where the export only writes pages and components
 * into an *existing* SvelteKit project, `createProject` first scaffolds a brand-new one in an
 * empty folder and then delegates to `exportSite` for the pages, composites, widgets and theme.
 *
 * Guarantees:
 * - **Empty target only.** The folder must not exist yet (its parent must) or be empty (a `.git`
 *   folder and `.DS_Store` are tolerated). Nothing the user owns is ever overwritten.
 * - **Visual parity with the editor.** `src/app.css` carries the same Tailwind/Flowbite setup,
 *   primary colour scale and element defaults as the editor's own `routes/layout.css`, because the
 *   widgets were designed (and the previews are rendered) on top of those rules.
 * - **Compatible dependencies.** Dependency ranges are read from the editor's own `package.json`,
 *   so the generated project uses exactly the SvelteKit/Svelte/Tailwind/Flowbite generation the
 *   exported widgets were written against.
 * - **No shell.** The optional `npm install` runs through `spawn` with a fixed argument list.
 *
 * Interacts with:
 * - `project.ts` – `exportSite`, `ProjectError`, `ExportResult`.
 * - `routes/editor/api/project/+server.ts` – the `create` action.
 * - `routes/+page.svelte` – the "Create new project" button.
 */

import { spawn } from 'node:child_process';
import { lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultSiteTheme, type SiteTheme } from '../theme.js';
import type { EditorSite } from '../editor.js';
import { exportSite, ProjectError, type ExportResult } from './project.js';

/** Raw `package.json` of the editor itself; the source of the dependency version ranges. */
const editorManifest = (
	import.meta.glob('../../../package.json', {
		query: '?raw',
		import: 'default',
		eager: true
	}) as Record<string, string>
)['../../../package.json'];

/** Packages the generated project needs at build time, with fallback ranges. */
const requiredPackages: Record<string, string> = {
	'@sveltejs/adapter-node': '^6.0.0',
	'@sveltejs/kit': '^3.0.0',
	'@sveltejs/vite-plugin-svelte': '^7.2.0',
	'@tailwindcss/forms': '^0.5.11',
	'@tailwindcss/typography': '^0.5.19',
	'@tailwindcss/vite': '^4.3.0',
	flowbite: '^4.0.2',
	'flowbite-svelte': '^1.33.1',
	svelte: '^5.57.1',
	'svelte-check': '^4.6.0',
	tailwindcss: '^4.3.0',
	typescript: '^6.0.3',
	vite: '^8.3.0'
};

/** Entries that may already exist in a folder that still counts as "empty". */
const tolerableEntries = new Set(['.git', '.DS_Store']);

/** Outcome of {@link createProject}: the export report plus scaffold and install details. */
export type CreateProjectResult = ExportResult & {
	/** Canonical absolute path of the new project. */
	root: string;
	/** Name written to `package.json`. */
	name: string;
	/** Whether `npm install` was requested and completed successfully. */
	installed: boolean;
};

/** Options of {@link createProject}. */
export type CreateProjectOptions = {
	/** Run `npm install` after writing the files (slow, needs network access). */
	install?: boolean;
};

/**
 * Derives a valid npm package name from a folder name.
 *
 * @param folder - Last segment of the project path.
 * @returns Lower-case `[a-z0-9-]` name, `my-site` when nothing usable is left.
 * @example
 * packageNameFor('My Great Site!'); // 'my-great-site'
 */
export function packageNameFor(folder: string): string {
	const name = folder
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	return name || 'my-site';
}

/**
 * Resolves and validates the target folder, creating it when it does not exist yet.
 *
 * @param root - Absolute path chosen by the user.
 * @returns Canonical absolute path of the (now existing, empty) folder.
 * @throws {ProjectError} If the path is invalid, unreachable or the folder is not empty.
 */
async function prepareTarget(root: unknown): Promise<string> {
	if (typeof root !== 'string' || root.trim() === '' || root.length > 500 || root.includes('\0')) {
		throw new ProjectError('Enter the absolute path of an empty folder.');
	}
	if (!path.isAbsolute(root)) throw new ProjectError('The project path must be absolute.');
	const wanted = path.resolve(root);

	const existing = await lstat(wanted).catch(() => null);
	if (!existing) {
		// Only the last segment is created: typos in a deep path must not litter the disk.
		const parent = await realpath(path.dirname(wanted)).catch(() => null);
		if (!parent || !(await lstat(parent)).isDirectory()) {
			throw new ProjectError('The parent folder does not exist.');
		}
		await mkdir(path.join(parent, path.basename(wanted))).catch(() => {
			throw new ProjectError('The folder could not be created.');
		});
		return realpath(path.join(parent, path.basename(wanted)));
	}

	const real = await realpath(wanted);
	if (!(await lstat(real)).isDirectory()) throw new ProjectError('That path is not a folder.');
	const entries = (await readdir(real)).filter((entry) => !tolerableEntries.has(entry));
	if (entries.length > 0) {
		throw new ProjectError(
			'That folder is not empty. Choose an empty folder, or use Export for an existing project.'
		);
	}
	return real;
}

/** Version range for `name`, taken from the editor's manifest when it lists the package. */
function versionOf(name: string): string {
	try {
		const manifest = JSON.parse(editorManifest) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		return (
			manifest.devDependencies?.[name] ?? manifest.dependencies?.[name] ?? requiredPackages[name]
		);
	} catch {
		return requiredPackages[name];
	}
}

/** Builds the generated `package.json`. */
function renderPackageJson(name: string): string {
	const devDependencies = Object.fromEntries(
		Object.keys(requiredPackages)
			.sort()
			.map((pkg) => [pkg, versionOf(pkg)])
	);
	return `${JSON.stringify(
		{
			name,
			private: true,
			version: '0.0.1',
			type: 'module',
			scripts: {
				dev: 'vite dev',
				build: 'vite build',
				preview: 'vite preview',
				prepare: "svelte-kit sync || echo ''",
				check: 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json'
			},
			devDependencies
		},
		null,
		'\t'
	)}\n`;
}

/** Vite config: Tailwind first, then SvelteKit with the Node adapter and runes mode. */
const viteConfig = `import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\\\]/).includes('node_modules') ? undefined : true
			},
			// Exported pages import via $lib, which SvelteKit 3 only honours as an explicit alias.
			alias: { $lib: 'src/lib' },
			adapter: adapter()
		})
	]
});
`;

const tsconfig = `{
	"extends": "$app/tsconfig",
	"compilerOptions": {
		"strict": true,
		"types": ["$app/types", "node"]
	},
	"include": ["src", "vite.config.ts"]
}
`;

const appHtml = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<link rel="icon" href="%sveltekit.assets%/favicon.svg" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		%sveltekit.head%
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display: contents">%sveltekit.body%</div>
	</body>
</html>
`;

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#7c3aed"/><path d="M9 21h14M9 16h14M9 11h8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>
`;

const gitignore = `node_modules
/.svelte-kit
/build
.env
.env.*
!.env.example
.DS_Store
`;

/**
 * Global stylesheet. The Tailwind/Flowbite setup, the `primary` scale and the element defaults
 * mirror `src/routes/layout.css` of the editor, so exported pages look like the editor previews.
 */
const appCss = `@import 'tailwindcss';
@plugin '@tailwindcss/forms';
@plugin '@tailwindcss/typography';
@plugin 'flowbite/plugin';
@source '../node_modules/flowbite-svelte/dist';
@source '../node_modules/flowbite';
@custom-variant dark (&:where(.dark, .dark *));

@theme {
	--color-primary-50: #f5f3ff;
	--color-primary-100: #ede9fe;
	--color-primary-200: #ddd6fe;
	--color-primary-300: #c4b5fd;
	--color-primary-400: #a78bfa;
	--color-primary-500: #8b5cf6;
	--color-primary-600: #7c3aed;
	--color-primary-700: #6d28d9;
	--color-primary-800: #5b21b6;
	--color-primary-900: #4c1d95;
	--color-secondary-50: #f0f9ff;
	--color-secondary-100: #e0f2fe;
	--color-secondary-200: #bae6fd;
	--color-secondary-300: #7dd3fc;
	--color-secondary-400: #38bdf8;
	--color-secondary-500: #0ea5e9;
	--color-secondary-600: #0284c7;
	--color-secondary-700: #0369a1;
	--color-secondary-800: #075985;
	--color-secondary-900: #0c4a6e;
}

:root {
	--font-body:
		Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell,
		'Open Sans', 'Helvetica Neue', sans-serif;
	--font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
	--color-theme-1: #ff3e00;
	--color-text: rgba(0, 0, 0, 0.7);
	font-family: var(--font-body);
	color: var(--color-text);
}

body {
	min-height: 100vh;
	margin: 0;
	background-color: #fff;
}

/* Element defaults live in the base layer so Flowbite's utility classes win over them. */
@layer base {
	h1,
	h2,
	p {
		font-weight: 400;
	}

	p {
		line-height: 1.5;
	}

	a {
		color: var(--site-link, var(--color-theme-1));
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}

	h1 {
		font-size: 2rem;
		text-align: center;
	}

	h2 {
		font-size: 1rem;
	}

	pre {
		font-size: 16px;
		font-family: var(--font-mono);
		background-color: rgba(255, 255, 255, 0.45);
		border-radius: 3px;
		box-shadow: 2px 2px 6px rgb(255 255 255 / 25%);
		padding: 0.5em;
		overflow-x: auto;
		color: var(--color-text);
	}

	input,
	button {
		font-size: inherit;
		font-family: inherit;
	}

	button:focus:not(:focus-visible) {
		outline: none;
	}

	@media (min-width: 720px) {
		h1 {
			font-size: 2.4rem;
		}
	}
}
`;

const layoutSvelte = `<script lang="ts">
	import type { Snippet } from 'svelte';
	import '../app.css';

	let { children }: { children: Snippet } = $props();
</script>

{@render children()}
`;

/** Root route: forwards to the first exported page, or explains that there are none yet. */
function renderRootRoute(site: EditorSite): { file: string; content: string } {
	const first = site.pages[0];
	if (first) {
		return {
			file: 'src/routes/+page.ts',
			content: `import { redirect } from '@sveltejs/kit';

// Generated by the editor: the home route shows the first page of the site.
export const load = () => {
	redirect(307, '/${first.slug}');
};
`
		};
	}
	return {
		file: 'src/routes/+page.svelte',
		content: `<svelte:head>
	<title>New site</title>
</svelte:head>

<p style="padding: 2rem; text-align: center">
	This site has no pages yet. Add pages in the editor and export them to this project.
</p>
`
	};
}

/** Builds the README of the generated project. */
function renderReadme(name: string): string {
	return `# ${name}

Created by Svelte Editor.

\`\`\`sh
npm install
npm run dev      # development server
npm run build    # production build (Node adapter)
npm run preview  # serve the production build
\`\`\`

- Pages: \`src/routes/<route>/+page.svelte\`
- Composites and widgets: \`src/lib/components/editor/\`
- Theme: \`src/lib/site-theme.ts\`, \`src/app.css\`

Files that start with \`<!-- @svelte-editor\` or \`// @svelte-editor generated\` are regenerated by
the editor's Export; remove that first line from a file to take it over by hand.
`;
}

/** Runs \`npm install\` in `cwd` without a shell and rejects with the tail of its output on failure. */
function npmInstall(cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('npm', ['install', '--no-audit', '--no-fund'], {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let output = '';
		const collect = (chunk: Buffer) => {
			output = (output + chunk.toString()).slice(-2000);
		};
		child.stdout.on('data', collect);
		child.stderr.on('data', collect);
		const timer = setTimeout(() => child.kill(), 10 * 60_000);
		child.on('error', (error) => {
			clearTimeout(timer);
			reject(new ProjectError(`npm could not be started: ${error.message}`));
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new ProjectError(`npm install failed (exit ${code}):\n${output.trim()}`));
		});
	});
}

/**
 * Creates a new, buildable SvelteKit project containing the whole editor site.
 *
 * @param rootInput - Absolute path of an empty (or not yet existing) folder.
 * @param site - Pages and composites to export into the new project.
 * @param theme - Site theme written to `src/lib/site-theme.ts`.
 * @param options - See {@link CreateProjectOptions}.
 * @returns Export report extended with the project root, name and install state.
 * @throws {ProjectError} If the folder is unsuitable, a page/composite name is invalid or
 *   `npm install` fails (the files stay in place in that case).
 * @example
 * await createProject('/home/me/new-site', site, theme, { install: false });
 */
export async function createProject(
	rootInput: unknown,
	site: EditorSite,
	theme: SiteTheme = defaultSiteTheme,
	options: CreateProjectOptions = {}
): Promise<CreateProjectResult> {
	const root = await prepareTarget(rootInput);
	const name = packageNameFor(path.basename(root));

	const rootRoute = renderRootRoute(site);
	const scaffold: Record<string, string> = {
		'package.json': renderPackageJson(name),
		'vite.config.ts': viteConfig,
		'tsconfig.json': tsconfig,
		'README.md': renderReadme(name),
		'.gitignore': gitignore,
		'src/app.html': appHtml,
		'src/app.css': appCss,
		'src/routes/+layout.svelte': layoutSvelte,
		'static/favicon.svg': favicon,
		[rootRoute.file]: rootRoute.content
	};
	for (const [relative, content] of Object.entries(scaffold)) {
		const file = path.join(root, relative);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, content, { flag: 'wx' });
	}

	const result = await exportSite(root, site, theme);
	const written = [...Object.keys(scaffold), ...result.written];

	let installed = false;
	if (options.install) {
		await npmInstall(root);
		installed = true;
	}
	return { ...result, written, root, name, installed };
}
