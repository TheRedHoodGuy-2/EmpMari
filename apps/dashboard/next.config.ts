import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@mariabelle/parser', '@mariabelle/identifier'],
  serverExternalPackages: ['tesseract.js'],
  webpack: (config) => {
    // The parser package uses `.js` extensions on its TypeScript imports
    // (required for Node/tsx). Webpack can't resolve `.js` → `.ts` on its
    // own, so we tell it to try `.ts`/`.tsx` first when it sees `.js`.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default config;
