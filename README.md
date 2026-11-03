# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@1.1.1 create --template demo --types ts --add prettier eslint vitest="usages:unit,component" playwright="demo:yes" tailwindcss="plugins:forms,typography" enhanced-img sveltekit-adapter="adapter:node" ai-tools="ide:vscode+tools:mcp,svelte-code-writer,svelte-core-bestpractices,svelte-file-editor+mcpSetup:remote" drizzle="database:sqlite+sqlite:node-sqlite" --install npm ./
```

## Adding features

Add features to your project with `sv add`:

```sh
npx sv add
```

For example, to add Tailwind CSS:

```sh
npx sv add tailwindcss
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

### Project images

The Images page manages the active project's image library. Add an existing HTTP(S) URL, upload
a PNG, JPEG, GIF, WebP or SVG file, or import an image from a public HTTP(S) URL. Imported files
are limited to 10 MiB and SVGs are sanitized before storage. A project can contain up to 500
images (including starter links) and 50 MiB of managed image data. Guests can browse the library;
editors can change it. Images referenced by saved pages or composite components cannot be deleted
until those references are removed. A URL change updates recognized saved references; drafts in
other tabs must be reloaded or reconciled before saving.

Remote downloads reject redirects and private or reserved network addresses. Decoded images are
limited to 16 million pixels. SVG sanitization retains common geometry, gradients, masks and clip
paths, but removes scripts, external resources, CSS and other unsupported features.

Each project starts with linked icons from SVG Repo's
[Isometric 3D Interface Icons collection](https://www.svgrepo.com/collection/isometric-3d-interface-icons/).
The collection identifies the icons as CC0; the links remain dependent on SVG Repo's availability.
Removing a starter image does not cause it to be added again.

Project export copies managed images into the target project's `static/media` directory and includes
library metadata for re-import. URLs embedded in arbitrary hand-written components are outside the
editor's reference tracking. Remote images linked rather than imported remain hosted by their source.
In an adapter-node production deployment, set `BODY_SIZE_LIMIT` to at least `11M` to permit 10 MiB
uploads; the application also enforces its own smaller file-content limit.

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.
