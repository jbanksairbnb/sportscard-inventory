// Sentry — Edge runtime init (middleware + edge route handlers).
// Loaded via instrumentation.ts on the edge runtime.

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
