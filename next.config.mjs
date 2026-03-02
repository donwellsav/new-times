// When building for Electron, export a fully static bundle.
const isElectronBuild = process.env.NEXT_ELECTRON_BUILD === '1'

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isElectronBuild ? { output: 'export' } : {}),
  // Silence transitive webpack config warnings under Turbopack
  turbopack: {},
  env: {
    NEXT_PUBLIC_APP_VERSION: '1.0.0',
  },
  images: {
    unoptimized: true,
  },
  onDemandEntries: {
    maxInactiveAge: 15 * 1000,
    pagesBufferLength: 5,
  },
}

export default nextConfig

