import { dev } from '$app/env';

// we don't need any JS on this page, though we'll load
// it in dev so that we get hot module replacement
export const csr = dev;

// Deliberately NOT prerendered: the root layout load exposes `locals.user` to the header. A
// prerendered page would bake in `user: null` at build time and show signed-in visitors as
// signed out. `/about` is public through the access policy in `lib/auth/roles.ts`.
