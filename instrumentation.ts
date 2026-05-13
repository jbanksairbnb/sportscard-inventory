// Next.js instrumentation hook — runs once per server runtime to wire up
// Sentry on the Node and Edge runtimes. Replaces the deprecated
// sentry.server.config.ts auto-loading.

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
