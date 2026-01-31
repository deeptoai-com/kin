import { intlayer, intlayerProxy } from 'vite-intlayer';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig, loadEnv, type ConfigEnv, type ViteDevServer } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';
import browserEcho from '@browser-echo/vite';
import Icons from 'unplugin-icons/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';

export default ({ mode }: ConfigEnv) => {
  // Regression in TanStack Start RC1: loadEnv now keeps the VITE_ prefix, so we
  // manually clear the prefix until upstream restores the previous behaviour.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return defineConfig({
    server: {
      port: 3000,
      allowedHosts: ['db15f87f452b.ngrok-free.app'],
    },
    ssr: {
      // Externalize pg and @mastra/pg to avoid ESM/CJS interop TDZ errors
      // The 'pg' package is CommonJS, and bundling it causes "Cannot access 'pg' before initialization"
      external: ['pg', '@mastra/pg'],
    },
    build: {
      // Reduce memory pressure by lowering chunk size limit
      chunkSizeWarningLimit: 1000, // 1MB instead of default 500KB
      rollupOptions: {
        // Exclude standalone scripts from the build (they have shebangs that break esbuild)
        external: [/ws-server\.mjs$/, /ws-query-worker\.mjs$/],
        output: {
          // Manual chunk splitting to reduce memory pressure during build
          manualChunks: {
            // Split large vendor libraries
            'vendor-react': ['react', 'react-dom'],
            'vendor-router': ['@tanstack/react-router', '@tanstack/react-start'],
            'vendor-ui': ['@assistant-ui/react'],
          },
        },
        // Reduce parallelism to save memory
        maxParallelFileOps: 5,
        // Use less memory for treeshaking
        treeshake: {
          moduleSideEffects: false,
        },
      },
      // Reduce build parallelism
      minify: 'esbuild',
      // Use fewer workers for esbuild
      target: 'esnext',
    },
    plugins: [
      intlayerProxy(),
      nitro(),
      tsConfigPaths({
        projects: ['./tsconfig.json'],
      }),
      intlayer(),
      // WebSocket server: handled by Nitro plugin (server/plugins/websocket.mjs)
      // Dev mode: start manually with "node ws-server.mjs"
      tanstackStart({
        router: {
          routeFileIgnorePattern:
            '.content.(ts|tsx|js|mjs|cjs|jsx|json|jsonc|json5)$',
        },
      }),
      viteReact(),
      Icons({
        compiler: 'jsx',
        jsx: 'react',
        autoInstall: true,
      }),
      tailwindcss(),
      browserEcho({
        // TanStack Start specific configuration
        injectHtml: false, // TanStack Start doesn't use index.html
        stackMode: 'condensed', // Better stack traces
        colors: true,
        fileLog: {
          enabled: false, // Enable file logging to logs/frontend
        },
        networkLogs: {
          enabled: true,
          bodies: {
            request: true,
            response: true,
          },
        },
      }),
    ],
  });
};
