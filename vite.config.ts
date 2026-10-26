import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { SPECTRUM_BLUE_TO_AMBER } from './src/lib/spectrumAmber';

const isSpectrum = (id?: string) => !!id && /@react-spectrum[\\/]s2/.test(id);

// Spectrum 2's Provider renders an internal <Fonts> that preloads Adobe Clean
// from use.typekit.net (licensed for Adobe products only) and imports
// @font-faces pointing there. Swap it for nothing, in the app build and in the
// dev server's dependency pre-bundling alike. README "Spectrum 2".
const fontsStub = fileURLToPath(new URL('./src/lib/spectrumNoAdobeFonts.ts', import.meta.url));
const noAdobeFonts = {
  name: 'kaamos-no-adobe-fonts',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (isSpectrum(importer) && /^\.\/Fonts\.(mjs|cjs)$/.test(source)) return fontsStub;
    return null;
  },
};

// Spectrum's blue scale, compiled into its CSS as hex, becomes Kaamos amber of
// equal luminance (src/lib/spectrumAmber.ts).
// A blue hex, optionally followed by two alpha digits (kept), and no further hex digit.
const blueHex = new RegExp(`(${Object.keys(SPECTRUM_BLUE_TO_AMBER).join('|')})(?=(?:[0-9a-f]{2})?(?![0-9a-f]))`, 'gi');
const spectrumAmber = {
  name: 'kaamos-spectrum-amber',
  transform(code: string, id: string) {
    if (!isSpectrum(id) || !/\.css($|\?)/.test(id)) return null;
    return code.replace(blueHex, (hex) => SPECTRUM_BLUE_TO_AMBER[hex.toLowerCase()] ?? hex);
  },
};

export default defineConfig({
  plugins: [noAdobeFonts, spectrumAmber, react(), tailwindcss()],
  optimizeDeps: { rolldownOptions: { plugins: [noAdobeFonts] } },
  server: { port: 5173 },
  build: {
    target: 'es2022',
    // Never publish source maps: they would hand out the original source.
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
