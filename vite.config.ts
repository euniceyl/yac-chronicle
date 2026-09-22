import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: './',
  // PCX tables in data/ are served as static files in dev (left out of build)
  // dist/ is a static site and one carrying patient-level rows puts them on whichever server it lands on
  publicDir: command === 'serve' ? 'data' : false,
  server: { port: 5184 },
}));
