import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, loadEnv } from 'vite';
import { futuresDevTransport } from './lib/futures-dev';
import { accountDev } from './lib/account-dev';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
};

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    resolve: { dedupe: ['react', 'react-dom'] },
    optimizeDeps: {
      include: [
        'react',
        'react-dom/client',
        '@base-ui/react/checkbox',
        '@base-ui/react/select',
        '@base-ui/react/tabs',
        '@base-ui/react/progress',
      ],
    },
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: true,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      ...(command === 'serve'
        ? [
            futuresDevTransport(
              loadEnv(mode, process.cwd(), 'BINANCE_').BINANCE_HTTP_PROXY || '',
            ),
          ]
        : []),
      ...(command === 'serve'
        ? [
            accountDev(
              loadEnv(mode, process.cwd(), 'BINANCE_').BINANCE_HTTP_PROXY || '',
              process.cwd(),
            ),
          ]
        : []),
      vinext(),
      ...(command === 'build'
        ? [
            cloudflare({
              viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
              config: localBindingConfig,
            }),
          ]
        : []),
    ],
  };
});
