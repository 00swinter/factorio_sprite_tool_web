import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // GitHub Pages serves project sites from /<repo>/, not the domain root.
  base: process.env.GITHUB_PAGES === 'true' ? '/factorio_sprite_tool_web/' : '/',
})
