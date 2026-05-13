// Sentry — Node.js server runtime init (loaded via instrumentation.ts).
// Captures errors thrown inside server components, route handlers, and any
// other Node.js code path on Vercel.
//
// No-ops when SENTRY_DSN is unset so the PR can ship before the Sentry
// project exists.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.VERCEL_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  });
}
