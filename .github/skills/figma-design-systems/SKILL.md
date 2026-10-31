---
name: figma-design-systems
description: "Use when working with Figma design systems, design tokens, variables, styles, reusable components, variants, libraries, library guidelines, or translating Figma systems into product UI."
---

# Figma Design Systems

Use this skill for questions and work involving Figma's design-system concepts. The linked Figma Help Center articles are the source of truth for current UI steps, feature availability, and plan requirements; consult them when an answer depends on current product behavior.

## Core model

- **Variables** store reusable values that can be applied to design properties and prototype behavior. Use them to represent design tokens and to express contextual values through collections and modes, such as light/dark themes, device sizes, or brands.
- **Styles** package reusable property settings, such as color, typography, effects, and layout guides. Applying a style applies its grouped properties; changing a published style can make an update available to its users.
- **Components** are reusable design elements. A main component defines the source; instances placed in designs stay connected and can receive changes. Use component properties and variants to expose intentional choices and states rather than duplicating near-identical components.
- **Libraries** make selected components, styles, and variables available across files. The source file owns the published assets; consuming files can use them and review updates.

Variables and styles are related but not interchangeable. Prefer variables for reusable values and token-like contexts; use styles when a reusable group of visual properties is the useful unit. A system can use both. Check Figma's current comparison guide for feature-specific differences.

## Building and maintaining a system

1. Establish naming and organization that helps people find assets and understand their purpose. Keep token names semantic where they express a role, and keep component names clear and consistent.
2. Create and reuse variables, styles, and components rather than repeating raw values or detached copies. Use collections and modes when the same design needs meaningful contexts.
3. Keep related component choices discoverable through variants and component properties. Consider slots when a component needs flexible nested content; check the current Figma docs for availability and behavior.
4. Publish the assets intended for reuse from their source file. Enable the library in files that need it, and use instances and shared styles or variables from that library.
5. Treat publishing as an explicit release step. Local edits do not automatically update the published library; publish changes when they are ready, then review and accept library updates in consuming files.
6. Document decisions that cannot be inferred from the assets themselves, especially where designers or agents tend to make inconsistent choices.

## Writing useful library guidelines

Figma library guidelines can provide the Figma agent with context beyond what it can infer from library assets. They are attached to a published design library and are provided when the agent is asked to create a design using that library.

- Prioritize decisions that are ambiguous, repeated, or easy to get wrong: which component or variant to choose, required tokens, composition order, and patterns to avoid.
- Give a clear recommendation. For each tricky scenario, explain the situation, what to do, what not to do, and why. Include exceptions where a rule is not universal.
- Cover concrete system values and semantics, such as color roles, spacing scale, and corner-radius usage. Identify disallowed raw values or combinations when the system has a rule against them.
- Use a small set of focused files (Figma recommends three to eight) with no repeated guidance. A combined size under 100 KB is recommended; the documented upload limit is 200 KB.
- Markdown, plain text, and JSON files are supported. Uploading guidelines is a manual action in the Figma library UI; producing a file does not attach it automatically.

Suggested file roles include `overview.md`, `guidelines.md`, `components.md`, `examples.md`, `anti-patterns.md`, and `best-practices.md`. Prefer the smallest set that fits the system.

## Applying Figma knowledge to this codebase

- Treat Figma variables, styles, and components as design-source concepts, not as automatic one-to-one mappings to CSS variables, CSS classes, or Svelte components. Inspect the actual design and project conventions before proposing implementation.
- Preserve semantic intent when translating tokens: identify the role and context of a value, then map it to the existing codebase's token/theme system where possible.
- Reuse existing UI primitives and shared styles when they represent the same system concept. Avoid creating a parallel token or component taxonomy without a concrete gap.
- Keep guidance tied to the source library and product context. Do not invent token values, component behavior, permissions, or feature availability; ask for the relevant Figma library/design or consult the linked official docs when the source is missing.

## Official references

- [Build design systems — Figma Help Center section](https://help.figma.com/hc/en-us/sections/23536356509975-Build-design-systems)
- [Guide to variables](https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma)
- [Overview of variables, collections, and modes](https://help.figma.com/hc/en-us/articles/14506821864087)
- [Create and manage variables and collections](https://help.figma.com/hc/en-us/articles/15145852043927)
- [The difference between variables and styles](https://help.figma.com/hc/en-us/articles/15871097384471)
- [Guide to styles](https://help.figma.com/hc/en-us/articles/360039238753-Guide-to-styles-in-Figma)
- [Guide to components](https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma)
- [Create and use variants](https://help.figma.com/hc/en-us/articles/360056440594)
- [Explore component properties](https://help.figma.com/hc/en-us/articles/5579474826519)
- [Create and use slots for flexible components](https://help.figma.com/hc/en-us/articles/38231200344599-Create-and-use-slots-to-build-flexible-components-in-Figma-Design)
- [Name and organize components](https://help.figma.com/hc/en-us/articles/360038663994)
- [Guide to libraries](https://help.figma.com/hc/en-us/articles/360041051154-Guide-to-libraries-in-Figma)
- [Publish a library](https://help.figma.com/hc/en-us/articles/360025508373)
- [Review and accept library updates](https://help.figma.com/hc/en-us/articles/360039234193)
- [Add guidelines files to a design library](https://help.figma.com/hc/en-us/articles/43509372175511-Add-guidelines-files-to-a-design-library)
