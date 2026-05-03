import type { MetadataRoute } from 'next';

const BASE_URL = 'https://sports-collective.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/privacy', '/terms', '/login'],
        disallow: [
          '/admin',
          '/admin/',
          '/api/',
          '/home',
          '/listings',
          '/marketplace',
          '/profile/',
          '/purchases',
          '/fb-auctions',
          '/fb-claim-sales',
          '/set/',
          '/share/',
          '/members',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
