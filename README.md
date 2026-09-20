# Factorio Sprite Tool

A browser-based assembler for Factorio spritesheets. Drop a sequence of frames, lay them out on a grid, and download a PNG plus the Lua fields Factorio expects.

**Live:** [00swinter.github.io/factorio_sprite_tool_web](https://00swinter.github.io/factorio_sprite_tool_web/)

## Privacy

Everything runs locally in your browser. Images never leave your machine — nothing is uploaded, shared, or transmitted.

## What it does

- Loads PNG, WebP, GIF, JPEG, and similar image files (or a whole folder)
- Sorts frames by filename with natural order (`frame_1`, `frame_2`, `frame_10`)
- Packs them left-to-right then down (row-major / Z) or top-to-bottom then right (column-major / N), either as a near-square compact grid or on a custom column × row layout
- Pads mixed sizes into a shared cell with 9-point alignment
- Exports a transparent PNG and a Factorio Lua snippet (`width`, `height`, `frame_count`, `line_length`)
- Warns if the sheet goes over Factorio’s **8192px** input limit

## Using the tool

1. Drop frames onto the preview, or use **Add images** / **Add folder**.
2. The sheet packs itself as square as possible. Check **Set columns and rows individually** only if you want a custom grid. Factorio `line_length` is the column count. Extra cells stay empty and transparent.
3. Pick **Row-major (Z)** or **Column-major (N)** fill order. Factorio animations still read left-to-right first, so keep Z unless you specifically want N packing.
4. Adjust cell size (**Auto**, **Square**, or **Custom**), scale (including 0.5× for HR → normal), and alignment.
5. Check the live preview, then **Download PNG** and **Copy Lua**.

Example Lua:

```lua
{
  filename = "spritesheet.png",
  width = 64,
  height = 64,
  frame_count = 16,
  line_length = 2,
}
```

Put that next to your entity or animation prototype and point `filename` at the downloaded sheet.

### Preview

- Scroll to zoom toward the cursor
- Left-drag or middle-drag to pan
- Bottom-right grip resizes the preview pane
- Grid, index, and **Visualise order** path overlays can be toggled (order path is off by default)

### Frames

- Drag thumbnails to reorder
- **Sort by name** restores filename order
- **Ctrl-click** (Strg) adds or removes frames from the selection
- **Shift-click** selects the range between the first and last
- **Delete** or **Delete (n)** removes the selected chunk
- Thumbnail zoom slider enlarges the frame strip

## Run locally

Needs Node.js 22+.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build     # production build
npm run preview   # serve the production build
npm run check     # typecheck
```

## Deploy

Pushing to `master` builds and publishes to GitHub Pages via `.github/workflows/deploy.yml`. The Pages site is served from `/factorio_sprite_tool_web/`.

## Stack

Svelte 5, TypeScript, and Vite. No backend.
