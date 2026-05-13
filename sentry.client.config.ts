// Sentry — browser/client side init.
//
// Runs on every page in the browser. Captures unhandled errors, promise
// rejections, console.error calls, and a slice of page-load performance.
//
// Safe-by-default: if NEXT_PUBLIC_SENTRY_DSN isn't set we never call init,
// so this code does nothing in environments where Sentry hasn't been wired
// up yet. Set the env var in Vercel (Settings → Environment Variables) to
// turn it on.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Sample 10% of normal page loads for perf traces. Crank up in dev or
    // when investigating a regression; back down for cost reasons in prod.
    tracesSampleRate: 0.1,
    // Capture only errored sessions for replay — keeps usage well under the
    // free tier's 50/day cap while still giving us repro video on failures.
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0,
    integrations: [Sentry.replayIntegration()],
    // Tag the deploy with the Vercel git commit + env so traces are
    // sortable in the Sentry UI.
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  });
}
