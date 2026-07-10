/** @type {import('next').NextConfig} */

// Content-Security-Policy —
//   script:  self + GA (googletagmanager) + Vercel Analytics。Next.js の
//            インラインブートストラップと gtag インラインのため 'unsafe-inline'。
//   style:   Tailwind / React の style 属性のため 'unsafe-inline'。
//   img:     自サイト + data: + https (GA ビーコン・外部ロゴ等)。
//   connect: GA collect / Supabase / Vercel / Google Maps(住所検証)。
//   frame-ancestors 'none' でクリックジャッキング防止 (X-Frame-Options 相当)。
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://va.vercel-scripts.com",
  "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.supabase.co https://va.vercel-scripts.com https://vitals.vercel-insights.com https://maps.googleapis.com",
  "frame-src 'self'",
  "upgrade-insecure-requests",
].join("; ")

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
]

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
