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
