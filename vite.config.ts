import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Project site: https://nikitaroz.github.io/change-graph/
  // Dev stays at `/` so local `npm run dev` is unchanged.
  base: process.env.NODE_ENV === 'production' ? '/change-graph/' : '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['web-tree-sitter'],
  },
  assetsInclude: ['**/*.wasm'],
})
