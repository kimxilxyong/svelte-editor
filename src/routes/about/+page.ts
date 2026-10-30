// Deliberately NOT prerendered: the root layout load exposes `locals.user` to the navigation bar.
// A prerendered page would bake in `user: null` at build time and show signed-in visitors as
// signed out. `/about` is public through the access policy in `lib/auth/roles.ts`.
//
// Client-side rendering stays enabled (the SvelteKit default): the app-wide `AppNav` (Back,
// Forward, History, user menu) is interactive and needs JavaScript on every route.
