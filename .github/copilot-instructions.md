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

The `/component-editor` route edits native `.svelte` files part by part. When changing it, keep these module responsibilities and documentation expectations:

- `src/lib/svelte-parts.ts` – pure split/join of a `.svelte` file into Script / Module script / Markup / Style, with indentation preservation and a line map (`PartMap`) that translates whole-file compiler positions into part editor positions (`distributeDiagnostics`). Lines are 1-based, columns 0-based.
- `src/lib/svelte-diagnostics.ts` – `checkSvelteSource` wraps `svelte/compiler` (`generate: false`); isomorphic, used live in the browser and again on the server before writing.
- `src/lib/server/component-files.ts` – the only place that touches the file system for this feature (path validation, symlink refusal, size limits, overwrite protection, server-side compile check). Never bypass it.
- `src/routes/component-editor/api/+server.ts` – thin JSON action endpoint (`list`/`read`/`save`/`create`).
- `src/lib/components/CodeEditor.svelte` – reusable CodeMirror 6 wrapper (`value`, `language`, `diagnostics`, `api`); the view is created once in an attachment and props are pushed in through Compartments/transactions.
- `src/routes/component-editor/+page.svelte` – composes the above; documents the data flow in its `@component` block.

Document any change to these modules in the matching `@fileoverview` / `@component` block, and keep the position conventions (1-based lines, 0-based columns) explicit in new types.

## Composite Components Architecture Map

A **Composite Component** is a named, reusable group of widgets edited on a visual canvas (`/composites`) exactly like a page. Terminology: "parts" are the Script/Markup/Style pieces of a `.svelte` file in the code editor; "sections" no longer exist as a concept.

- `src/lib/editor.ts` – `EditorComposite`, `EditorSite.composites`, `composite:<Name>` block kinds, `parseComposites`, `findCompositeCycle`, `compositeLimits`. Imported project components keep the `custom:` kind.
- `src/lib/composite-seeds.ts` / `src/lib/site-migration.ts` – starter composites and the one-time rewrite of legacy section kinds (`hero`, `quote`, …) when a site is read (`getSavedSite`).
- `src/lib/composite-context.ts` + `BlockContent.svelte` – render context and recursive rendering (children positioned in % of the composite size, depth-limited).
- `src/lib/components/SiteEditor.svelte` – the shared canvas editor; `mode="pages"` (`/editor`) or `mode="composites"` (`/composites`). The other document kind is stashed and merged on save.
- `src/lib/svelte-pages.ts` / `src/lib/server/project.ts` – generate/parse pages and composites (`src/lib/components/editor/<Name>.svelte`, marked with `data-editor-composite`).

## Authentication, Admin & Database Architecture Map

Sign-in, roles, user management and the selectable database backend follow these module responsibilities. Keep them intact and document changes in the matching `@fileoverview` / `@component` block.

- **Database layer** (`src/lib/server/database/`) – `types.ts` defines the `SqlClient` contract and the portable SQL dialect (`?` placeholders, TEXT/INTEGER columns only, ISO-string timestamps, 0/1 booleans). `schema.ts` holds all DDL (`ensureSchema`, `copyOrder`). `sqlite-client.ts` and `postgres-client.ts` are the two adapters. `manager.ts` owns backend selection (config file `.data/db-config.json` > `DATABASE_URL` > `local.db`), the lazy singleton `getDatabase()`, `testConnection`, and `switchBackend` (copy / replace / keep). Never import `node:sqlite` or `pg` anywhere else. The Postgres URL is a secret and must only reach the browser masked.
- **Legacy facade** – `src/lib/server/db/index.ts` keeps the editor's `getSavedSite`/`saveSite` on top of `getDatabase()`. Drizzle files only describe the original SQLite schema.
- **Roles & access policy** – `src/lib/auth/roles.ts` is the single source of truth (`guest < user < poweruser < admin`, `requiredRoleFor`). Paths are canonicalised (decoded, dot segments removed) and fail closed. `src/hooks.server.ts` enforces it for every request, adds the CSRF origin check, loads the session into `event.locals.user` and sets security headers. Load functions and actions of privileged pages still call `requireRole` (defence in depth). Prerendered pages bypass hooks, so only public pages may be prerendered.
- **Auth services** (`src/lib/server/auth/`) – `passwords.ts` (Argon2id), `sessions.ts` (opaque token, SHA-256 stored, sliding expiry), `users.ts` (CRUD, identities, last-admin guards, `verifyCredentials` with rate limiting), `flow.ts` (`signInWithProfile`: find → link by _verified_ email → register), `wallet.ts` (EIP-4361 SIWE, single-use nonces), `oauth.ts` / `oauth-config.ts` / `runtime-config.ts` (GitHub, Google, LinkedIn via `arctic`; providers are enabled by env vars), `settings.ts`, `audit.ts`, `login.ts` (`establishSession`, `safeNext`, `clientIp`), `errors.ts` (`AuthError`, user-presentable).
- **Routes** – `/login`, `/register`, `/setup` (first admin), `/account`, `/logout`, `/auth/<provider>[/callback]`, `/auth/wallet/{nonce,verify}`, `/admin` (backend, settings, providers, audit), `/admin/users`. Shared UI lives in `src/lib/components/auth/` and `src/lib/components/admin/`; navigation labels in `src/lib/navigation-trail.ts`.
- **Testing** – services are tested against `openSqliteClient(':memory:')`; the Postgres adapter runs against PGlite through the `PgPoolLike` interface; OAuth uses an injected `fetch`; wallets sign with `viem/accounts`.

## App Shell: Navigation & Shared Form Controls

- **One navigation bar** – `src/lib/components/AppNav.svelte` is mounted exactly once in `src/routes/+layout.svelte` and appears on every route (builder pages, `/admin`, `/account`, sign-in pages). It contains brand link, Back/Forward, breadcrumbs, role-filtered tabs (Pages / Editor / Components / Admin / About), the "Open page" switcher, the History menu and `UserMenu.svelte`. Do **not** add per-route headers or a second top bar; the old SVG-styled `routes/Header.svelte` was removed.
- **Route context instead of props** – because the bar lives in the layout, a route publishes its context with `useNavContext(() => ({ pages, activePageId, unsavedChanges }))` from `src/lib/navigation.svelte.ts` (call once during component init; it resets on destroy). The layout's `beforeNavigate` reads `nav.unsavedChanges` for the leave confirmation. Routes without pages (admin, about, login) simply publish nothing and the switcher is hidden.
- **JavaScript is required on every route** (the bar is interactive), so no route may set `csr = false`.
- **Password inputs** – every password field uses `src/lib/components/PasswordInput.svelte` (pale-yellow field + eye reveal button, forwards native input attributes, `bind:value` / `bind:revealed`). Do not use a raw `<input type="password">`; wrappers such as `admin/PasswordField.svelte` (adds "Generate") and `auth/NewPasswordFields.svelte` (new + confirm, shared reveal) build on it. Its selectors are deliberately doubled (`.pw-input.pw-input`, `.eye.eye`) so host stylesheets such as `.auth-card button` cannot restyle it.
