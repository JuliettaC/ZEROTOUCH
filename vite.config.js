import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  root: mode === 'desktop' ? '.' : 'prototype',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  base: mode === 'desktop' ? './' : '/ZEROTOUCH/',
  build: {
    outDir: fileURLToPath(new URL(mode === 'desktop' ? './dist-app' : './dist', import.meta.url)),
    emptyOutDir: true,
  },
  plugins: [react()],
}))
