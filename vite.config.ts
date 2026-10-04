import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    alias: {
      'figma:asset/d4e8bf048fd7b1c3ccad484ef4486e30f0bbeb29.png': path.resolve(__dirname, './src/assets/d4e8bf048fd7b1c3ccad484ef4486e30f0bbeb29.png'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2020',
    outDir: 'build',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 3000,
    open: true,
  },
});