// Patch os.networkInterfaces BEFORE Next.js loads it.
// On Alpine/proot (Termux), uv_interface_addresses throws EACCES.
// Next.js calls this to detect its LAN hostname; we force an empty result.
const os = require('os');
const originalNetworkInterfaces = os.networkInterfaces;
try {
  os.networkInterfaces();
} catch (e) {
  os.networkInterfaces = () => ({});
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
