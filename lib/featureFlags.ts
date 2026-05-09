// Feature flags. Set to control gates that should be easy to toggle without
// hunting through the codebase. Each flag should be documented in place.

// REQUIRE_APPLICATION
// -------------------
// When true (legacy behavior), new signups must complete the /apply form and
// wait for an admin to approve them on /admin before they can use the site.
//
// When false (current pilot behavior), new signups are auto-approved and land
// directly on /home. The /apply and /pending pages still exist — they early-
// return to /home so the code is preserved and re-enabling is a one-line flip.
//
// Re-enabling: change to true, then re-run the build. Existing approved users
// keep working; existing pending users will see /pending the next time they
// hit the route.
export const REQUIRE_APPLICATION = false;
