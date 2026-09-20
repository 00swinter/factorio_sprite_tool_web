<script lang="ts">
  import { tick, untrack } from 'svelte'
  import {
    computeLayout,
    downloadCanvas,
    filesFromDataTransfer,
    loadSprites,
    luaSnippet,
    renderSpritesheet,
    revokeSprite,
    sortSpritesByName,
    type Align,
    type CellMode,
    type Sprite,
  } from './lib/sprites'

  const ZOOM_MIN = 0.05
  const ZOOM_MAX = 3
  const PREVIEW_MIN = 180
  const FRAME_ZOOM_MIN = 0.5
  const FRAME_ZOOM_MAX = 4

  const ALIGN_OPTIONS: { x: Align; y: Align; title: string }[] = [
    { x: 'start', y: 'start', title: 'Top left' },
    { x: 'center', y: 'start', title: 'Top' },
    { x: 'end', y: 'start', title: 'Top right' },
    { x: 'start', y: 'center', title: 'Left' },
    { x: 'center', y: 'center', title: 'Center' },
    { x: 'end', y: 'center', title: 'Right' },
    { x: 'start', y: 'end', title: 'Bottom left' },
    { x: 'center', y: 'end', title: 'Bottom' },
    { x: 'end', y: 'end', title: 'Bottom right' },
  ]

  let sprites: Sprite[] = $state([])
  let columns = $state(2)
  let rows = $state(1)
  let cellMode: CellMode = $state('auto')
  let customWidth = $state(64)
  let customHeight = $state(64)
  let alignX: Align = $state('center')
  let alignY: Align = $state('center')
  let scale = $state(1)
  let pixelated = $state(false)
  let showGrid = $state(true)
  let showIndexes = $state(true)
  let zoom = $state(1)
  let panX = $state(0)
  let panY = $state(0)
  let panning = $state(false)
  let panLastX = 0
  let panLastY = 0
  let previewHeight = $state(420)
  let frameZoom = $state(1)
  let resizingPreview = $state(false)
  let resizeStartY = 0
  let resizeStartHeight = 0
  let filename = $state('spritesheet.png')
  let draggingOver = $state(false)
  let loading = $state(false)
  let errorMessage = $state('')
  let copied = $state(false)
  let selectedIds: string[] = $state([])
  let selectionAnchor = $state<string | null>(null)
  let dragFrom = $state<number | null>(null)
  let dragOverIndex = $state<number | null>(null)
  let sheetCanvas: HTMLCanvasElement | undefined = $state()
  let boardWrap: HTMLDivElement | undefined = $state()
  let fileInput: HTMLInputElement | undefined = $state()
  let folderInput: HTMLInputElement | undefined = $state()

  const layout = $derived(
    computeLayout(sprites, {
      columns,
      rows,
      cellMode,
      customWidth,
      customHeight,
      alignX,
      alignY,
      scale,
      pixelated,
    }),
  )

  const lua = $derived(luaSnippet(filename, layout))
  const emptyCells = $derived(Math.max(0, layout.columns * layout.rows - sprites.length))

  $effect(() => {
    const cols = Math.max(1, Math.round(columns) || 1)
    const needed = Math.max(1, Math.ceil(sprites.length / cols) || 1)
    if (rows < needed) rows = needed
  })

  $effect(() => {
    if (!sheetCanvas) return
    renderSpritesheet(sheetCanvas, sprites, layout, {
      columns,
      rows,
      cellMode,
      customWidth,
      customHeight,
      alignX,
      alignY,
      scale,
      pixelated,
    })
  })

  $effect(() => {
    const wrap = boardWrap
    if (!wrap) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = wrap.getBoundingClientRect()
      applyZoom(
        untrack(() => zoom) * Math.exp(-event.deltaY * 0.0018),
        event.clientX - rect.left,
        event.clientY - rect.top,
      )
    }

    const preventMiddleAutoscroll = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault()
    }

    wrap.addEventListener('wheel', onWheel, { passive: false })
    wrap.addEventListener('mousedown', preventMiddleAutoscroll)
    return () => {
      wrap.removeEventListener('wheel', onWheel)
      wrap.removeEventListener('mousedown', preventMiddleAutoscroll)
    }
  })

  function applyZoom(nextZoom: number, originX: number, originY: number) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextZoom))
    const prev = zoom
    if (next === prev) return
    panX = originX - ((originX - panX) / prev) * next
    panY = originY - ((originY - panY) / prev) * next
    zoom = next
  }

  function centerPreview() {
    const wrap = boardWrap
    if (!wrap) return
    panX = (wrap.clientWidth - layout.sheetWidth * zoom) / 2
    panY = (wrap.clientHeight - layout.sheetHeight * zoom) / 2
  }

  function onPreviewPointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    panning = true
    panLastX = event.clientX
    panLastY = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPreviewPointerMove(event: PointerEvent) {
    if (!panning) return
    panX += event.clientX - panLastX
    panY += event.clientY - panLastY
    panLastX = event.clientX
    panLastY = event.clientY
  }

  function onPreviewPointerUp(event: PointerEvent) {
    if (!panning) return
    panning = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function onZoomSlider(event: Event) {
    const wrap = boardWrap
    applyZoom(
      Number((event.currentTarget as HTMLInputElement).value),
      wrap ? wrap.clientWidth / 2 : 0,
      wrap ? wrap.clientHeight / 2 : 0,
    )
  }

  function onResizePointerDown(event: PointerEvent) {
    event.preventDefault()
    event.stopPropagation()
    resizingPreview = true
    resizeStartY = event.clientY
    resizeStartHeight = previewHeight
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onResizePointerMove(event: PointerEvent) {
    if (!resizingPreview) return
    const max = Math.max(window.innerHeight - 120, PREVIEW_MIN)
    previewHeight = Math.min(max, Math.max(PREVIEW_MIN, resizeStartHeight + (event.clientY - resizeStartY)))
  }

  function onResizePointerUp(event: PointerEvent) {
    if (!resizingPreview) return
    resizingPreview = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  async function addFiles(files: File[]) {
    if (files.length === 0) return
    loading = true
    errorMessage = ''
    try {
      const next = await loadSprites(files)
      if (next.length === 0) {
        errorMessage = 'No image files found. Use PNG, WebP, GIF, or JPEG.'
        return
      }
      const wasEmpty = sprites.length === 0
      sprites = [...sprites, ...next]
      const cols = Math.max(1, Math.round(columns) || 1)
      rows = Math.max(rows, Math.ceil(sprites.length / cols) || 1)
      if (cellMode !== 'custom') {
        customWidth = Math.max(...sprites.map((sprite) => sprite.width), 1)
        customHeight = Math.max(...sprites.map((sprite) => sprite.height), 1)
      }
      if (wasEmpty) {
        await tick()
        centerPreview()
      }
    } catch {
      errorMessage = 'Could not load one or more images.'
    } finally {
      loading = false
    }
  }

  async function onFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    await addFiles([...(input.files ?? [])])
    input.value = ''
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault()
    draggingOver = false
    if (!event.dataTransfer) return
    const files = await filesFromDataTransfer(event.dataTransfer)
    await addFiles(files)
  }

  function removeSprite(id: string) {
    const sprite = sprites.find((item) => item.id === id)
    if (sprite) revokeSprite(sprite)
    sprites = sprites.filter((item) => item.id !== id)
    selectedIds = selectedIds.filter((item) => item !== id)
    if (selectionAnchor === id) selectionAnchor = selectedIds[0] ?? null
  }

  function removeSelected() {
    for (const id of [...selectedIds]) removeSprite(id)
  }

  function clearAll() {
    sprites.forEach(revokeSprite)
    sprites = []
    selectedIds = []
    selectionAnchor = null
    zoom = 1
    panX = 0
    panY = 0
  }

  function sortByName() {
    sprites = sortSpritesByName(sprites)
  }

  function selectFrame(id: string, event: MouseEvent) {
    const index = sprites.findIndex((sprite) => sprite.id === id)
    if (index < 0) return

    if (event.shiftKey) {
      const anchorIndex = selectionAnchor
        ? sprites.findIndex((sprite) => sprite.id === selectionAnchor)
        : 0
      const from = Math.min(anchorIndex < 0 ? 0 : anchorIndex, index)
      const to = Math.max(anchorIndex < 0 ? 0 : anchorIndex, index)
      selectedIds = sprites.slice(from, to + 1).map((sprite) => sprite.id)
      if (!selectionAnchor) selectionAnchor = id
      return
    }

    if (event.ctrlKey || event.metaKey) {
      if (selectedIds.includes(id)) {
        selectedIds = selectedIds.filter((item) => item !== id)
        if (selectionAnchor === id) selectionAnchor = selectedIds.at(-1) ?? null
      } else {
        selectedIds = [...selectedIds, id]
        selectionAnchor = id
      }
      return
    }

    selectedIds = [id]
    selectionAnchor = id
  }

  function moveSelected(delta: number) {
    if (selectedIds.length !== 1) return
    const index = sprites.findIndex((sprite) => sprite.id === selectedIds[0])
    if (index < 0) return
    const next = index + delta
    if (next < 0 || next >= sprites.length) return
    const copy = [...sprites]
    const [item] = copy.splice(index, 1)
    copy.splice(next, 0, item)
    sprites = copy
  }

  function onFrameDragStart(index: number, event: DragEvent) {
    if (event.ctrlKey || event.shiftKey || event.metaKey) {
      event.preventDefault()
      return
    }
    dragFrom = index
    event.dataTransfer?.setData('text/plain', String(index))
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  function onFrameDrop(index: number) {
    if (dragFrom === null || dragFrom === index) {
      dragFrom = null
      dragOverIndex = null
      return
    }
    const copy = [...sprites]
    const [item] = copy.splice(dragFrom, 1)
    copy.splice(index, 0, item)
    sprites = copy
    dragFrom = null
    dragOverIndex = null
  }

  function downloadSheet() {
    if (!sheetCanvas || sprites.length === 0) return
    downloadCanvas(sheetCanvas, filename)
  }

  async function copyLua() {
    try {
      await navigator.clipboard.writeText(lua)
      copied = true
      setTimeout(() => {
        copied = false
      }, 1600)
    } catch {
      errorMessage = 'Could not copy Lua to clipboard.'
    }
  }

</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Delete' && selectedIds.length > 0) {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      event.preventDefault()
      removeSelected()
    }
    if (event.key === 'ArrowLeft' && selectedIds.length === 1) {
      event.preventDefault()
      moveSelected(-1)
    }
    if (event.key === 'ArrowRight' && selectedIds.length === 1) {
      event.preventDefault()
      moveSelected(1)
    }
  }}
/>

<div class="shell">
  <p class="privacy" role="note">
    Private by design. Everything runs locally in your browser — nothing is uploaded, shared, or transmitted.
  </p>
  <header class="topbar">
    <div class="brand">
      <div class="mark" aria-hidden="true">
        <span></span><span></span><span></span><span></span>
      </div>
      <div>
        <p class="eyebrow">Factorio graphics</p>
        <h1>Sprite Assembler</h1>
      </div>
    </div>
    <p class="lede">
      Drop frames, set any column × row grid, and export a PNG Factorio can read as
      <code>line_length</code>.
    </p>
    <div class="top-actions">
      <button type="button" class="ghost" onclick={copyLua} disabled={sprites.length === 0}>
        {copied ? 'Copied Lua' : 'Copy Lua'}
      </button>
      <button type="button" class="primary" onclick={downloadSheet} disabled={sprites.length === 0}>
        Download PNG
      </button>
    </div>
  </header>

  <div class="workspace">
    <aside class="side">
      <section class="card">
        <h2>Layout</h2>
        <p class="hint">Type any grid ratio. Frames fill left to right, then wrap, in filename order unless you drag them.</p>

        <div class="ratio">
          <label class="field">
            <span>Columns</span>
            <input type="number" min="1" max="512" bind:value={columns} />
          </label>
          <span class="times" aria-hidden="true">×</span>
          <label class="field">
            <span>Rows</span>
            <input type="number" min="1" max="512" bind:value={rows} />
          </label>
        </div>
        <p class="hint">Factorio <code>line_length</code> is the column count. Extra cells stay empty and transparent.</p>

        <dl class="stats">
          <div>
            <dt>Frames</dt>
            <dd>{layout.frameCount}</dd>
          </div>
          <div>
            <dt>Grid</dt>
            <dd>{layout.columns} × {layout.rows}</dd>
          </div>
          <div>
            <dt>Cell</dt>
            <dd>{layout.cellWidth}×{layout.cellHeight}</dd>
          </div>
          <div>
            <dt>Sheet</dt>
            <dd>{layout.sheetWidth}×{layout.sheetHeight}</dd>
          </div>
        </dl>

        {#if layout.exceedsLimit}
          <p class="warn">Sheet is over Factorio's 8192px input limit. Use fewer columns or a smaller cell.</p>
        {/if}
        {#if layout.mixedSizes}
          <p class="note">Frame sizes differ. Smaller ones are aligned inside the largest cell.</p>
        {/if}
      </section>

      <section class="card">
        <h2>Cell</h2>
        <div class="presets">
          <button type="button" class:active={cellMode === 'auto'} onclick={() => (cellMode = 'auto')}>Auto</button>
          <button type="button" class:active={cellMode === 'square'} onclick={() => (cellMode = 'square')}>Square</button>
          <button type="button" class:active={cellMode === 'custom'} onclick={() => (cellMode = 'custom')}>Custom</button>
        </div>

        <div class="row">
          <label class="field">
            <span>Width</span>
            <input type="number" min="1" bind:value={customWidth} disabled={cellMode !== 'custom'} />
          </label>
          <label class="field">
            <span>Height</span>
            <input type="number" min="1" bind:value={customHeight} disabled={cellMode !== 'custom'} />
          </label>
        </div>

        <label class="field">
          <span>Scale</span>
          <select
            value={String(scale)}
            onchange={(event) => {
              scale = Number((event.currentTarget as HTMLSelectElement).value)
            }}
          >
            <option value="1">1× native</option>
            <option value="0.5">0.5× (HR → normal)</option>
            <option value="2">2×</option>
          </select>
        </label>

        <label class="check">
          <input type="checkbox" bind:checked={pixelated} />
          Nearest-neighbor (pixel art)
        </label>

        <div class="align-block">
          <span>Align in cell</span>
          <div class="align">
            {#each ALIGN_OPTIONS as option}
              <button
                type="button"
                title={option.title}
                class:active={alignX === option.x && alignY === option.y}
                onclick={() => {
                  alignX = option.x
                  alignY = option.y
                }}
                aria-label={option.title}
              ></button>
            {/each}
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Export</h2>
        <label class="field">
          <span>Filename</span>
          <input type="text" bind:value={filename} />
        </label>
        <pre class="lua">{lua}</pre>
      </section>
    </aside>

    <main class="stage">
      <section
        class="preview card"
        class:drop={draggingOver}
        role="region"
        aria-label="Spritesheet preview"
        ondragover={(event) => {
          event.preventDefault()
          draggingOver = true
        }}
        ondragleave={() => (draggingOver = false)}
        ondrop={onDrop}
      >
        <div class="preview-bar">
          <h2>Preview</h2>
          <div class="preview-tools">
            <label class="check compact">
              <input type="checkbox" bind:checked={showGrid} />
              Grid
            </label>
            <label class="check compact">
              <input type="checkbox" bind:checked={showIndexes} />
              Index
            </label>
            <label class="zoom">
              <span>{Math.round(zoom * 100)}%</span>
              <input
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step="0.05"
                value={zoom}
                oninput={onZoomSlider}
              />
            </label>
          </div>
        </div>

        <div class="preview-viewport" class:resizing={resizingPreview} style:height="{previewHeight}px">
          {#if sprites.length === 0}
            <button type="button" class="empty" onclick={() => fileInput?.click()}>
              <strong>Drop sprites here</strong>
              <span>or click to choose image files</span>
              <span class="empty-note">They will be sorted by filename, so frame_1, frame_2, frame_10 stay in order.</span>
            </button>
          {:else}
            <div
              class="board-wrap"
              class:panning
              bind:this={boardWrap}
              title="Scroll to zoom, drag with left or middle mouse to pan"
              onpointerdown={onPreviewPointerDown}
              onpointermove={onPreviewPointerMove}
              onpointerup={onPreviewPointerUp}
              onpointercancel={onPreviewPointerUp}
            >
              <div
                class="board"
                style:width="{layout.sheetWidth}px"
                style:height="{layout.sheetHeight}px"
                style:transform="translate({panX}px, {panY}px) scale({zoom})"
              >
                <canvas bind:this={sheetCanvas} class:pixelated></canvas>
                {#if showGrid}
                  <div
                    class="grid"
                    style:grid-template-columns="repeat({layout.columns}, 1fr)"
                    style:grid-template-rows="repeat({layout.rows}, 1fr)"
                  >
                    {#each sprites as sprite, index}
                      <div class="cell" class:selected={selectedIds.includes(sprite.id)}>
                        {#if showIndexes}<span>{index}</span>{/if}
                      </div>
                    {/each}
                    {#each Array.from({ length: emptyCells }) as _empty, emptyIndex (emptyIndex)}
                      <div class="cell empty-cell"></div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {/if}
          <button
            type="button"
            class="resize-handle"
            aria-label="Resize preview"
            title="Drag to resize preview"
            onpointerdown={onResizePointerDown}
            onpointermove={onResizePointerMove}
            onpointerup={onResizePointerUp}
            onpointercancel={onResizePointerUp}
          ></button>
        </div>

        {#if loading}
          <p class="status">Loading images…</p>
        {/if}
        {#if errorMessage}
          <p class="warn">{errorMessage}</p>
        {/if}
      </section>

      <section class="frames card">
        <div class="preview-bar">
          <h2>Frames</h2>
          <div class="preview-tools">
            <label class="zoom">
              <span>{Math.round(frameZoom * 100)}%</span>
              <input
                type="range"
                min={FRAME_ZOOM_MIN}
                max={FRAME_ZOOM_MAX}
                step="0.1"
                bind:value={frameZoom}
              />
            </label>
            <button type="button" class="ghost" onclick={() => fileInput?.click()}>Add images</button>
            <button type="button" class="ghost" onclick={() => folderInput?.click()}>Add folder</button>
            <button type="button" class="ghost" onclick={sortByName} disabled={sprites.length < 2}>Sort by name</button>
            <button
              type="button"
              class="ghost danger"
              onclick={removeSelected}
              disabled={selectedIds.length === 0}
            >
              Delete{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
            </button>
            <button type="button" class="ghost danger" onclick={clearAll} disabled={sprites.length === 0}>Clear</button>
          </div>
        </div>

        <input bind:this={fileInput} class="sr" type="file" accept="image/*" multiple onchange={onFileChange} />
        <input
          bind:this={folderInput}
          class="sr"
          type="file"
          webkitdirectory
          multiple
          onchange={onFileChange}
        />

        {#if sprites.length === 0}
          <p class="hint">No frames yet. Drop a sequence and they will assemble as {layout.columns} × {layout.rows}.</p>
        {:else}
          <p class="hint">Ctrl-click to add frames. Shift-click to select a range. Delete removes the selection.</p>
          <ol
            class="strip"
            style:--thumb-min="{Math.round(96 * frameZoom)}px"
            style:--thumb-height="{Math.round(72 * frameZoom)}px"
          >
            {#each sprites as sprite, index (sprite.id)}
              <li
                class:selected={selectedIds.includes(sprite.id)}
                class:over={dragOverIndex === index}
                draggable="true"
                onclick={(event) => selectFrame(sprite.id, event)}
                ondragstart={(event) => onFrameDragStart(index, event)}
                ondragover={(event) => {
                  event.preventDefault()
                  dragOverIndex = index
                }}
                ondrop={() => onFrameDrop(index)}
                ondragend={() => {
                  dragFrom = null
                  dragOverIndex = null
                }}
              >
                <button type="button" class="thumb">
                  <img src={sprite.objectUrl} alt={sprite.name} />
                  <span class="idx">{index}</span>
                </button>
                <p title={sprite.name}>{sprite.name}</p>
                <button
                  type="button"
                  class="remove"
                  onclick={(event) => {
                    event.stopPropagation()
                    removeSprite(sprite.id)
                  }}
                  aria-label="Remove {sprite.name}"
                >×</button>
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    </main>
  </div>
</div>

<style>
  .shell {
    max-width: 1440px;
    margin: 0 auto;
    padding: 24px 20px 40px;
  }

  .privacy {
    margin: 0 0 16px;
    padding: 9px 14px;
    background: rgba(143, 191, 90, 0.12);
    border: 1px solid rgba(143, 191, 90, 0.38);
    color: var(--green);
    font-size: 13px;
    letter-spacing: 0.02em;
  }

  .topbar {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 24px;
    align-items: center;
    margin-bottom: 22px;
  }

  .brand {
    display: flex;
    gap: 14px;
    align-items: center;
  }

  .mark {
    width: 44px;
    height: 44px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 5px;
    background: #1b1a17;
    border: 1px solid var(--orange-2);
    box-shadow: inset 0 0 0 1px #000, var(--shadow);
  }

  .mark span {
    background: var(--orange);
  }

  .mark span:nth-child(2),
  .mark span:nth-child(3) {
    background: var(--orange-2);
  }

  .eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 11px;
    color: var(--orange);
  }

  h1,
  h2 {
    margin: 0;
    color: var(--text-h);
    font-weight: 650;
  }

  h1 {
    font-size: 28px;
    letter-spacing: -0.04em;
    line-height: 1.1;
  }

  h2 {
    font-size: 13px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--orange);
  }

  .lede {
    margin: 0;
    color: var(--text-dim);
    max-width: 52ch;
  }

  .lede code {
    color: var(--orange);
    font-family: var(--mono);
    font-size: 0.92em;
  }

  .top-actions,
  .preview-tools,
  .presets,
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  .workspace {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 16px;
    align-items: start;
  }

  .side {
    display: grid;
    gap: 12px;
  }

  .stage {
    display: grid;
    gap: 12px;
    min-width: 0;
  }

  .card {
    background: linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);
    border: 1px solid #000;
    box-shadow:
      inset 1px 1px 0 var(--highlight),
      var(--shadow);
    padding: 16px;
  }

  .hint,
  .note,
  .status {
    color: var(--text-dim);
    font-size: 13px;
    margin: 8px 0 0;
  }

  .warn {
    color: var(--red);
    font-size: 13px;
    margin: 10px 0 0;
  }

  .field {
    display: grid;
    gap: 6px;
    margin-top: 12px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }

  .ratio {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 10px;
    align-items: end;
  }

  .ratio .field {
    margin-top: 12px;
  }

  .times {
    color: var(--orange);
    font-size: 22px;
    font-weight: 700;
    line-height: 1;
    padding-bottom: 8px;
  }

  .hint code {
    color: var(--orange);
    font-family: var(--mono);
    font-size: 0.92em;
  }

  input,
  select,
  .ghost,
  .primary,
  .presets button {
    background: var(--slot);
    border: 1px solid #000;
    box-shadow: inset 1px 1px 0 #000, 0 1px 0 var(--highlight);
    color: var(--text-h);
    padding: 8px 10px;
  }

  input[type='number'],
  input[type='text'],
  select {
    width: 100%;
  }

  .presets {
    margin-top: 10px;
  }

  .presets button {
    flex: 1 1 0;
    min-width: 52px;
    padding: 7px 6px;
    font-size: 12px;
  }

  .presets button.active,
  .primary,
  .align button.active {
    background: var(--orange);
    color: #1b1408;
    box-shadow: inset 0 1px 0 #ffd27a;
    font-weight: 700;
  }

  .ghost,
  .primary {
    min-height: 38px;
  }

  .ghost:disabled,
  .primary:disabled,
  .presets button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .ghost.danger:hover:not(:disabled) {
    color: var(--red);
  }

  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 14px 0 0;
  }

  .stats div {
    background: var(--slot);
    padding: 8px 10px;
    border: 1px solid #000;
  }

  dt {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }

  dd {
    margin: 2px 0 0;
    font-family: var(--mono);
    color: var(--text-h);
  }

  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 12px;
    color: var(--text);
  }

  .check.compact {
    margin: 0;
    font-size: 13px;
  }

  .align-block {
    margin-top: 14px;
    display: grid;
    gap: 8px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }

  .align {
    width: 90px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  .align button {
    width: 26px;
    height: 26px;
    padding: 0;
    background: var(--slot);
    border: 1px solid #000;
  }

  .lua {
    margin: 12px 0 0;
    padding: 12px;
    background: var(--bg-deep);
    border: 1px solid #000;
    color: var(--green);
    font-family: var(--mono);
    font-size: 12px;
    overflow: auto;
  }

  .preview {
    min-height: 0;
    display: grid;
    grid-template-rows: auto 1fr;
  }

  .preview.drop {
    outline: 2px dashed var(--orange);
    outline-offset: -8px;
    background: var(--orange-dim);
  }

  .preview-bar {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    margin-bottom: 12px;
  }

  .zoom {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 12px;
  }

  .empty {
    display: grid;
    place-content: center;
    text-align: center;
    gap: 6px;
    height: 100%;
    min-height: 0;
    border: 1px dashed var(--line);
    background:
      linear-gradient(45deg, #1f1e1a 25%, transparent 25%) 0 0 / 18px 18px,
      linear-gradient(-45deg, #1f1e1a 25%, transparent 25%) 0 9px / 18px 18px,
      linear-gradient(45deg, transparent 75%, #1f1e1a 75%) 9px -9px / 18px 18px,
      linear-gradient(-45deg, transparent 75%, #1f1e1a 75%) -9px 0 / 18px 18px,
      var(--slot);
    cursor: pointer;
  }

  .empty {
    width: 100%;
    color: inherit;
    box-shadow: none;
  }

  .empty strong {
    color: var(--text-h);
    font-size: 20px;
  }

  .empty-note {
    color: var(--text-dim);
    font-size: 13px;
    max-width: 42ch;
    margin: 8px auto 0;
  }

  .preview-viewport {
    position: relative;
    min-height: 180px;
  }

  .preview-viewport.resizing {
    user-select: none;
  }

  .resize-handle {
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 18px;
    height: 18px;
    padding: 0;
    z-index: 3;
    cursor: nwse-resize;
    background:
      linear-gradient(135deg, transparent 0 42%, var(--orange-2) 42% 50%, transparent 50% 62%, var(--orange-2) 62% 70%, transparent 70% 82%, var(--orange) 82% 90%, transparent 90%);
    border: 0;
    box-shadow: none;
    opacity: 0.85;
  }

  .resize-handle:hover,
  .preview-viewport.resizing .resize-handle {
    opacity: 1;
  }

  .board-wrap {
    overflow: hidden;
    position: relative;
    height: 100%;
    background: var(--slot);
    border: 1px solid #000;
    overscroll-behavior: contain;
    touch-action: none;
    cursor: grab;
    user-select: none;
  }

  .board-wrap.panning {
    cursor: grabbing;
  }

  .board-wrap.panning * {
    pointer-events: none;
  }

  .board {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    will-change: transform;
    background:
      linear-gradient(45deg, #2a2925 25%, transparent 25%) 0 0 / 16px 16px,
      linear-gradient(-45deg, #2a2925 25%, transparent 25%) 0 8px / 16px 16px,
      linear-gradient(45deg, transparent 75%, #2a2925 75%) 8px -8px / 16px 16px,
      linear-gradient(-45deg, transparent 75%, #2a2925 75%) -8px 0 / 16px 16px,
      #201f1c;
    box-shadow: 0 0 0 1px #000;
  }

  canvas {
    width: 100%;
    height: 100%;
    display: block;
    image-rendering: auto;
  }

  canvas.pixelated {
    image-rendering: pixelated;
  }

  .grid {
    position: absolute;
    inset: 0;
    display: grid;
    pointer-events: none;
  }

  .cell {
    border: 1px solid rgba(245, 166, 35, 0.35);
    position: relative;
  }

  .cell span {
    position: absolute;
    top: 6px;
    left: 8px;
    font-size: 32px;
    font-weight: 700;
    line-height: 1;
    font-family: var(--mono);
    color: var(--orange);
    opacity: 0.5;
    background: none;
    padding: 0;
  }

  .empty-cell {
    background: rgba(217, 106, 79, 0.08);
  }

  .strip {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--thumb-min, 96px), 1fr));
    gap: 8px;
    margin: 8px 0 0;
    padding: 0;
    user-select: none;
  }

  .strip li {
    position: relative;
    background: var(--slot);
    border: 1px solid #000;
    padding: 6px;
  }

  .strip li.selected,
  .strip li.over {
    outline: 2px solid var(--orange);
  }

  .thumb {
    width: 100%;
    padding: 0;
    background: transparent;
    border: 0;
    box-shadow: none;
    position: relative;
  }

  .thumb img {
    width: 100%;
    height: var(--thumb-height, 72px);
    object-fit: contain;
    background:
      linear-gradient(45deg, #2a2925 25%, transparent 25%) 0 0 / 12px 12px,
      #201f1c;
  }

  .idx {
    position: absolute;
    top: 4px;
    left: 4px;
    font-size: 11px;
    font-family: var(--mono);
    background: #000;
    color: var(--orange);
    padding: 0 4px;
  }

  .strip p {
    margin: 6px 0 0;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-dim);
  }

  .remove {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 20px;
    height: 20px;
    padding: 0;
    background: #000;
    color: var(--text);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  @media (max-width: 980px) {
    .topbar,
    .workspace {
      grid-template-columns: 1fr;
    }

    .top-actions {
      justify-content: flex-start;
    }
  }
</style>
