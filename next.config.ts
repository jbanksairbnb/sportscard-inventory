import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

// Sentry wrapper. Source-map upload is skipped when SENTRY_AUTH_TOKEN is
// missing, so this is a safe no-op until the Sentry project is set up.
// See PR description for the env vars to add in Vercel.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Route Sentry events through our own domain to dodge ad blockers that
  // strip third-party telemetry. Adds /monitoring/* to the deployed app.
  tunnelRoute: "/monitoring",
});
