/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output keeps the Docker runtime image small.
  output: 'standalone',
  // The shared package ships TypeScript source; let Next transpile it.
  transpilePackages: ['@notesetc/shared'],
  // simple-icons is large; keep it external (required at runtime) rather than
  // bundled into the icon API route.
  serverExternalPackages: ['simple-icons'],

  // Expose the Notes Etc API on the web app's own origin/port, so everything is
  // reachable at http://<host>:3100/api/v1/... (and /docs, /healthz) with no
  // second port. Next proxies these server-side to the API process; the app's
  // own route handlers (e.g. /api/bff) are matched first and are unaffected.
  async rewrites() {
    const api =
      process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4100';
    return [
      { source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` },
      { source: '/docs', destination: `${api}/docs` },
      { source: '/docs/:path*', destination: `${api}/docs/:path*` },
      { source: '/healthz', destination: `${api}/healthz` },
      { source: '/readyz', destination: `${api}/readyz` },
      // Pretty page URLs: /p/<slug>-<code> is served by the existing page routes.
      // The visible URL stays /p/...; the [id] param receives the handle and the
      // route resolves it by its trailing short code.
      { source: '/p/:handle', destination: '/pages/:handle' },
      { source: '/p/:handle/edit', destination: '/pages/:handle/edit' },
      { source: '/p/:handle/propose', destination: '/pages/:handle/propose' },
    ];
  },
};

export default nextConfig;
