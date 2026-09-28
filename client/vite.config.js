import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5199,
      strictPort: true,
      // Send every /api request to our Express server.
      // The browser thinks the API is on the same site, so the login cookie just works.
      proxy: {
        '/api': env.API_PROXY_TARGET || 'http://localhost:5000',
      },
    },
  };
});
