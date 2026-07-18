import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Web Serial requires a secure context; localhost qualifies.
    host: 'localhost',
  },
});
