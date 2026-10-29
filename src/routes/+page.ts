/**
 * @fileoverview Home page options.
 *
 * Deliberately **not** prerendered: prerendered pages are static files that bypass
 * `hooks.server.ts`, so the sign-in requirement for `/` could not be enforced. Only the public
 * `/about` page is prerendered.
 */
export {};
