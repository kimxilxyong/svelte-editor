# Copilot Workspace Instructions

## Source Code Documentation Standards

Whenever creating, modifying, or refactoring code in this repository, always add extensive human- and machine-readable documentation according to industry standards:

1. **JSDoc / TSDoc Standards**:
   - Every TypeScript module must start with a `/** @fileoverview ... */` block explaining its purpose, role within the application architecture, and interactions with other modules.
   - All exported functions, types, and interfaces must have detailed TSDoc blocks documenting `@param`, `@returns`, `@throws`, and `@example` where relevant.
   - Document domain data structures (such as coordinate mappings, percentage vs. pixel constraints, and state structures).

2. **Svelte Component Documentation**:
   - Every `.svelte` component must contain a JSDoc block at the top of its `<script>` tag describing:
     - `@component <Name>`: A clear summary of the component's UI role.
     - `@prop`: Detailed documentation for all props, their types, default values, and two-way `$bindable()` expectations.
     - Event and callback contracts (e.g. `onchange`, `onnavigate`).

3. **Architectural & Design Decisions**:
   - Provide inline explanatory comments for non-trivial logic, such as:
     - AST parsing and node manipulation using `svelte/compiler`.
     - File system safety checks, canonical path resolution, and overwrite protection.
     - Undo/redo state snapshots and debounced history management.
     - Drag-and-drop coordinate conversions and pointer interaction handling.
     - Database backward-compatibility layers.

4. **Formatting & Validation**:
   - Keep comments cleanly formatted and compliant with Prettier (`npx prettier --write`).
   - Ensure documentation additions introduce zero linting warnings or TypeScript errors (`npm run check`).

## Component Editor Architecture Map

The `/component-editor` route edits native `.svelte` files section by section. When changing it, keep these module responsibilities and documentation expectations:

- `src/lib/svelte-sections.ts` – pure split/join of a `.svelte` file into Script / Module script / Markup / Style, with indentation preservation and a line map (`SectionMap`) that translates whole-file compiler positions into section editor positions (`distributeDiagnostics`). Lines are 1-based, columns 0-based.
- `src/lib/svelte-diagnostics.ts` – `checkSvelteSource` wraps `svelte/compiler` (`generate: false`); isomorphic, used live in the browser and again on the server before writing.
- `src/lib/server/component-files.ts` – the only place that touches the file system for this feature (path validation, symlink refusal, size limits, overwrite protection, server-side compile check). Never bypass it.
- `src/routes/component-editor/api/+server.ts` – thin JSON action endpoint (`list`/`read`/`save`/`create`).
- `src/lib/components/CodeEditor.svelte` – reusable CodeMirror 6 wrapper (`value`, `language`, `diagnostics`, `api`); the view is created once in an attachment and props are pushed in through Compartments/transactions.
- `src/routes/component-editor/+page.svelte` – composes the above; documents the data flow in its `@component` block.

Document any change to these modules in the matching `@fileoverview` / `@component` block, and keep the position conventions (1-based lines, 0-based columns) explicit in new types.
