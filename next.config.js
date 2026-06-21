/** @type {import('next').NextConfig} */
const nextConfig = {
  // Files of this size (SAP exports) need a higher body size limit on the import API route
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
}

module.exports = nextConfig
