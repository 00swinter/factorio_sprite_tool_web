<script lang="ts">
  import { tick, untrack } from 'svelte'
  import {
    computeLayout,
    canvasToPngBlob,
    downloadBlob,
    downloadCanvas,
    filesFromDataTransfer,
    loadSprites,
    luaSnippet,
    luaStripesSnippet,
    planSplitSheets,
    posToFrameIndex,
    renderSpritesheet,
    revokeSprite,
    sortSpritesByName,
    cellIndexToPos,
    pngBasename,
    spritesForSplitSheet,
    splitLayoutOptions,
    zipFilename,
    type Align,
    type CellMode,
    type ExportMode,
    type FillOrder,
    type SplitAxis,
    type Sprite,
  } from './lib/sprites'
  import { zipBlobs } from './lib/zip'

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
  let exportMode = $state<ExportMode>('single')
  let splitAxis = $state<SplitAxis>('row')
  let animationLength = $state(2)
  let splitAutoPack = $state(true)
  let splitGroups = $state(16)
  let previewSheet = $state(0)
  let exporting = $state(false)
  let columns = $state(2)
  let rows = $state(1)
  let customGrid = $state(false)
  let fillOrder: FillOrder = $state('row')
  let cellMode: CellMode = $state('auto')
  let customWidth = $state(64)
  let customHeight = $state(64)
  let alignX: Align = $state('center')
  let alignY: Align = $state('center')
  let scale = $state(1)
  let pixelated = $state(false)
  let showGrid = $state(true)
  let showIndexes = $state(true)
  let showOrder = $state(false)
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

  const layoutOptions = $derived({
    columns,
    rows,
    compact: !customGrid,
    fillOrder,
    cellMode,
    customWidth,
    customHeight,
    alignX,
    alignY,
    scale,
    pixelated,
  })

  const splitPlan = $derived(
    planSplitSheets(sprites, layoutOptions, {
      axis: splitAxis,
      animationLength,
      customGroupsPerSheet: splitAutoPack ? null : splitGroups,
      filename,
    }),
  )

  const activeSheet = $derived(splitPlan.sheets[previewSheet] ?? null)
  const previewSprites = $derived(
    exportMode === 'split' ? spritesForSplitSheet(sprites, splitPlan, previewSheet) : sprites,
  )
  const previewOptions = $derived(
    exportMode === 'split' && activeSheet
      ? splitLayoutOptions(layoutOptions, splitPlan, activeSheet)
      : layoutOptions,
  )
  const layout = $derived(computeLayout(previewSprites, previewOptions))
  const lua = $derived(
    exportMode === 'split' ? luaStripesSnippet(splitPlan) : luaSnippet(filename, layout),
  )
  const sheetRange = $derived.by(() => {
    if (exportMode !== 'split' || !activeSheet) return null
    const start = activeSheet.startGroup * splitPlan.animationLength
    return { start, end: start + activeSheet.frameCount }
  })
  const canExportSplit = $derived(
    exportMode === 'split' && splitPlan.animationFits && splitPlan.sheetCount > 0 && sprites.length > 0,
  )
  const overlayCells = $derived.by(() => {
    const cells: { col: number; row: number; index: number | null; id: string | null }[] = []
    const order = previewOptions.fillOrder
    const origin = sheetRange?.start ?? 0
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.columns; col++) {
        const local = posToFrameIndex(col, row, layout, order)
        cells.push({
          col,
          row,
          index: local === null ? null : origin + local,
          id: local === null ? null : previewSprites[local]?.id ?? null,
        })
      }
    }
    return cells
  })
  const orderDots = $derived.by(() =>
    previewSprites.map((_, index) => {
      const { col, row } = cellIndexToPos(index, layout, previewOptions.fillOrder)
      return {
        index,
        x: (col + 0.5) * layout.cellWidth,
        y: (row + 0.5) * layout.cellHeight,
      }
    }),
  )
  const orderPath = $derived(orderDots.map((dot) => `${dot.x},${dot.y}`).join(' '))
  const orderStroke = $derived(Math.max(2, Math.min(layout.cellWidth, layout.cellHeight) * 0.045))

  $effect(() => {
    const last = Math.max(0, splitPlan.sheetCount - 1)
    if (previewSheet > last) previewSheet = last
  })

  $effect(() => {
    if (exportMode === 'split') return
    if (!customGrid) {
      columns = layout.columns
      rows = layout.rows
      return
    }
    if (fillOrder === 'column') {
      const nextRows = Math.max(1, Math.round(rows) || 1)
      const neededCols = Math.max(1, Math.ceil(sprites.length / nextRows) || 1)
      if (columns < neededCols) columns = neededCols
      return
    }
    const cols = Math.max(1, Math.round(columns) || 1)
    const needed = Math.max(1, Math.ceil(sprites.length / cols) || 1)
    if (rows < needed) rows = needed
  })

  $effect(() => {
    if (!sheetCanvas) return
    renderSpritesheet(sheetCanvas, previewSprites, layout, previewOptions)
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

  function capturePointer(event: PointerEvent) {
    const target = event.currentTarget
    if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId)
  }

  function releasePointer(event: PointerEvent) {
    const target = event.currentTarget
    if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }
  }

  function onPreviewPointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    panning = true
    panLastX = event.clientX
    panLastY = event.clientY
    capturePointer(event)
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
    releasePointer(event)
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
    capturePointer(event)
  }

  function onResizePointerMove(event: PointerEvent) {
    if (!resizingPreview) return
    const max = Math.max(window.innerHeight - 120, PREVIEW_MIN)
    previewHeight = Math.min(max, Math.max(PREVIEW_MIN, resizeStartHeight + (event.clientY - resizeStartY)))
  }

  function onResizePointerUp(event: PointerEvent) {
    if (!resizingPreview) return
    resizingPreview = false
    releasePointer(event)
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
      if (customGrid) {
        if (fillOrder === 'column') {
          const nextRows = Math.max(1, Math.round(rows) || 1)
          columns = Math.max(columns, Math.ceil(sprites.length / nextRows) || 1)
        } else {
          const cols = Math.max(1, Math.round(columns) || 1)
          rows = Math.max(rows, Math.ceil(sprites.length / cols) || 1)
        }
      }
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

    if (exportMode === 'split' && splitPlan.animationLength > 0) {
      const group = Math.floor(index / splitPlan.animationLength)
      const sheetIndex = splitPlan.sheets.findIndex(
        (sheet) => group >= sheet.startGroup && group < sheet.startGroup + sheet.groups,
      )
      if (sheetIndex >= 0) previewSheet = sheetIndex
    }

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
    if (exportMode === 'split') {
      void downloadSplitSheets()
      return
    }
    if (!sheetCanvas || sprites.length === 0) return
    downloadCanvas(sheetCanvas, filename)
  }

  async function downloadSplitSheets() {
    if (!canExportSplit || exporting) return
    exporting = true
    errorMessage = ''
    try {
      const files: { name: string; blob: Blob }[] = []
      for (const sheet of splitPlan.sheets) {
        const sheetSprites = spritesForSplitSheet(sprites, splitPlan, sheet.index)
        const options = splitLayoutOptions(layoutOptions, splitPlan, sheet)
        const sheetLayout = computeLayout(sheetSprites, options)
        const canvas = document.createElement('canvas')
        renderSpritesheet(canvas, sheetSprites, sheetLayout, options)
        files.push({ name: sheet.filename, blob: await canvasToPngBlob(canvas) })
      }
      files.push({
        name: `${pngBasename(filename)}.lua`,
        blob: new Blob([lua], { type: 'text/plain' }),
      })
      const zip = await zipBlobs(files)
      downloadBlob(zip, zipFilename(filename))
    } catch {
      errorMessage = 'Could not export the split spritesheets.'
    } finally {
      exporting = false
    }
  }

  function setExportMode(mode: ExportMode) {
    if (mode === exportMode) return
    if (mode === 'split' && customGrid) {
      animationLength = Math.max(1, splitAxis === 'column' ? rows : columns)
    }
    previewSheet = 0
    exportMode = mode
  }

  async function showSheet(index: number) {
    previewSheet = Math.max(0, Math.min(index, Math.max(0, splitPlan.sheetCount - 1)))
    await tick()
    centerPreview()
  }

  function setSplitAxis(axis: SplitAxis) {
    if (axis === splitAxis) return
    splitAxis = axis
    previewSheet = 0
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
      {#if exportMode === 'split'}
        Import a full turret animation, keep every angle complete, and export as many sheets as needed under Factorio’s 8192px limit.
      {:else}
        Drop frames, set any column × row grid, and export a PNG Factorio can read as
        <code>line_length</code>.
      {/if}
    </p>
    <div class="top-actions">
      <button type="button" class="ghost" onclick={copyLua} disabled={sprites.length === 0 || (exportMode === 'split' && !canExportSplit)}>
        {copied ? 'Copied Lua' : 'Copy Lua'}
      </button>
      <button
        type="button"
        class="primary"
        onclick={downloadSheet}
        disabled={sprites.length === 0 || exporting || (exportMode === 'split' && !canExportSplit)}
      >
        {#if exporting}
          Exporting…
        {:else if exportMode === 'split'}
          Download ZIP
        {:else}
          Download PNG
        {/if}
      </button>
    </div>
  </header>

  <div class="workspace">
    <aside class="side">
      <section class="card">
        <h2>Layout</h2>
        <div class="presets">
          <button type="button" class:active={exportMode === 'single'} onclick={() => setExportMode('single')}>
            Single sheet
          </button>
          <button type="button" class:active={exportMode === 'split'} onclick={() => setExportMode('split')}>
            Split sheets
          </button>
        </div>

        {#if exportMode === 'split'}
          <p class="hint">
            For turret shooting and other long directional animations. Each complete angle stays on one sheet; extra angles go to the next file.
          </p>

          <span class="field-label">Each complete animation is</span>
          <div class="presets">
            <button
              type="button"
              class:active={splitAxis === 'row'}
              onclick={() => setSplitAxis('row')}
              title="Vanilla Factorio: frames go left to right, next angle on the next row"
            >
              A row (one angle)
            </button>
            <button
              type="button"
              class:active={splitAxis === 'column'}
              onclick={() => setSplitAxis('column')}
              title="Frames go top to bottom, next angle in the next column"
            >
              A column (one angle)
            </button>
          </div>
          {#if splitAxis === 'row'}
            <p class="hint">
              Columns are animation frames. Rows are turret angles. This matches Factorio <code>stripes</code> and gun-turret shooting sheets.
            </p>
          {:else}
            <p class="note">
              Factorio still reads left-to-right first. Use rows as complete angles unless you specifically want vertical animations.
            </p>
          {/if}

          <label class="field">
            <span>Animation length (frames)</span>
            <input type="number" min="1" max="512" bind:value={animationLength} />
          </label>
          <p class="hint">
            {splitAxis === 'row' ? 'This is the column count on every sheet.' : 'This is the row count on every sheet.'}
            An angle is never split across files.
          </p>

          <label class="check">
            <input type="checkbox" bind:checked={splitAutoPack} />
            Pack as many complete angles as fit under 8192px
          </label>
          {#if !splitAutoPack}
            <label class="field">
              <span>Angles per sheet</span>
              <input type="number" min="1" max="512" bind:value={splitGroups} />
            </label>
            <p class="hint">
              Capped at {splitPlan.maxGroupsThatFit || 0} so the sheet stays within 8192px
              ({splitPlan.cellWidth}×{splitPlan.cellHeight} cells).
            </p>
          {/if}

          <dl class="stats">
            <div>
              <dt>Frames</dt>
              <dd>{sprites.length}</dd>
            </div>
            <div>
              <dt>Angles</dt>
              <dd>{splitPlan.directionCount}</dd>
            </div>
            <div>
              <dt>Sheets</dt>
              <dd>{splitPlan.sheetCount}</dd>
            </div>
            <div>
              <dt>This sheet</dt>
              <dd>
                {#if activeSheet}
                  {activeSheet.columns} × {activeSheet.rows}
                {:else}
                  —
                {/if}
              </dd>
            </div>
            <div>
              <dt>Cell</dt>
              <dd>{splitPlan.cellWidth}×{splitPlan.cellHeight}</dd>
            </div>
            <div>
              <dt>Sheet px</dt>
              <dd>
                {#if activeSheet}
                  {activeSheet.sheetWidth}×{activeSheet.sheetHeight}
                {:else}
                  —
                {/if}
              </dd>
            </div>
          </dl>

          {#if sprites.length > 0 && animationLength > sprites.length}
            <p class="warn">Animation length is longer than the imported frame count.</p>
          {:else if splitPlan.leftoverFrames > 0}
            <p class="warn">
              {splitPlan.leftoverFrames} leftover frame{splitPlan.leftoverFrames === 1 ? '' : 's'} — {sprites.length} does not divide by {splitPlan.animationLength}. Incomplete angles are omitted.
            </p>
          {/if}
          {#if sprites.length > 0 && !splitPlan.animationFits && splitPlan.maxGroupsThatFit === 0}
            <p class="warn">
              Even one complete animation is over Factorio's 8192px limit. Shorten the animation, use a smaller cell, or scale down.
            </p>
          {:else if sprites.length > 0 && splitPlan.directionCount === 0}
            <p class="warn">Need at least one complete animation to export.</p>
          {/if}
          {#if activeSheet?.exceedsLimit}
            <p class="warn">This sheet is over Factorio's 8192px input limit.</p>
          {/if}
          {#if layout.mixedSizes}
            <p class="note">Frame sizes differ. Smaller ones are aligned inside the largest cell.</p>
          {/if}
        {:else}
          <p class="hint">Frames fill in filename order unless you drag them. Choose Z (row) or N (column) fill below.</p>

          <label class="check">
            <input type="checkbox" bind:checked={customGrid} />
            Set columns and rows individually
          </label>

          <div class="ratio">
            <label class="field">
              <span>Columns</span>
              <input type="number" min="1" max="512" bind:value={columns} disabled={!customGrid} />
            </label>
            <span class="times" aria-hidden="true">×</span>
            <label class="field">
              <span>Rows</span>
              <input type="number" min="1" max="512" bind:value={rows} disabled={!customGrid} />
            </label>
          </div>
          {#if customGrid}
            <p class="hint">Factorio <code>line_length</code> is the column count. Extra cells stay empty and transparent.</p>
          {:else}
            <p class="hint">Auto compact: columns and rows are chosen so the sheet stays close to square.</p>
          {/if}

          <label class="field">
            <span>Fill order</span>
            <select bind:value={fillOrder}>
              <option value="row">Row-major (Z) — left to right, then down</option>
              <option value="column">Column-major (N) — top to bottom, then right</option>
            </select>
          </label>
          {#if fillOrder === 'column'}
            <p class="note">Factorio still reads files left-to-right first. Use row-major unless you need N-order packing.</p>
          {/if}

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
        {#if exportMode === 'split'}
          <p class="hint">
            Downloads one ZIP with {splitPlan.sheetCount || 0} PNG{splitPlan.sheetCount === 1 ? '' : 's'}
            named like <code>{activeSheet?.filename ?? 'spritesheet-1.png'}</code> plus the Lua <code>stripes</code> snippet.
          </p>
        {/if}
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
            {#if exportMode === 'split' && splitPlan.sheetCount > 0}
              <div class="sheet-nav">
                <button
                  type="button"
                  class="ghost compact"
                  disabled={previewSheet <= 0}
                  onclick={() => showSheet(previewSheet - 1)}
                >
                  Prev
                </button>
                <span>
                  Sheet {previewSheet + 1}/{splitPlan.sheetCount}
                  {#if activeSheet}
                    · {activeSheet.groups} angle{activeSheet.groups === 1 ? '' : 's'}
                  {/if}
                </span>
                <button
                  type="button"
                  class="ghost compact"
                  disabled={previewSheet >= splitPlan.sheetCount - 1}
                  onclick={() => showSheet(previewSheet + 1)}
                >
                  Next
                </button>
              </div>
            {/if}
            <label class="check compact">
              <input type="checkbox" bind:checked={showGrid} />
              Grid
            </label>
            <label class="check compact">
              <input type="checkbox" bind:checked={showIndexes} />
              Index
            </label>
            <label class="check compact">
              <input type="checkbox" bind:checked={showOrder} />
              Visualise order
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
                {#if showGrid || showIndexes}
                  <div
                    class="grid"
                    class:no-lines={!showGrid}
                    style:grid-template-columns="repeat({layout.columns}, 1fr)"
                    style:grid-template-rows="repeat({layout.rows}, 1fr)"
                  >
                    {#each overlayCells as cell (cell.row + ':' + cell.col)}
                      <div
                        class="cell"
                        class:empty-cell={cell.index === null}
                        class:selected={cell.id !== null && selectedIds.includes(cell.id)}
                      >
                        {#if showIndexes && cell.index !== null}<span>{cell.index}</span>{/if}
                      </div>
                    {/each}
                  </div>
                {/if}
                {#if showOrder && orderDots.length > 0}
                  <svg
                    class="order-path"
                    viewBox="0 0 {layout.sheetWidth} {layout.sheetHeight}"
                    aria-hidden="true"
                  >
                    <defs>
                      <marker
                        id="order-arrow"
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="5"
                        markerHeight="5"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                      </marker>
                    </defs>
                    {#if orderDots.length > 1}
                      <polyline
                        points={orderPath}
                        fill="none"
                        stroke="currentColor"
                        stroke-width={orderStroke}
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        marker-end="url(#order-arrow)"
                      />
                    {/if}
                    {#each orderDots as dot (dot.index)}
                      <circle cx={dot.x} cy={dot.y} r={orderStroke * 0.85} fill="currentColor" />
                    {/each}
                  </svg>
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
          <p class="hint">
            {#if exportMode === 'split'}
              No frames yet. Drop the full animation (every angle, every frame, filename order).
            {:else}
              No frames yet. Drop a sequence and they will assemble as {layout.columns} × {layout.rows}.
            {/if}
          </p>
        {:else}
          <p class="hint">
            Ctrl-click to add frames. Shift-click to select a range. Delete removes the selection.
            {#if exportMode === 'split' && activeSheet}
              Highlighted frames are on sheet {previewSheet + 1}.
            {/if}
          </p>
          <ol
            class="strip"
            class:split-strip={exportMode === 'split'}
            style:--thumb-min="{Math.round(96 * frameZoom)}px"
            style:--thumb-height="{Math.round(72 * frameZoom)}px"
          >
            {#each sprites as sprite, index (sprite.id)}
              <li
                class:selected={selectedIds.includes(sprite.id)}
                class:over={dragOverIndex === index}
                class:on-sheet={sheetRange !== null && index >= sheetRange.start && index < sheetRange.end}
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

  .field-label {
    display: block;
    margin-top: 14px;
    margin-bottom: 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }

  .sheet-nav {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 12px;
  }

  .ghost.compact {
    min-height: 30px;
    padding: 4px 8px;
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

  input:disabled {
    opacity: 0.45;
    cursor: not-allowed;
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

  .grid.no-lines .cell {
    border-color: transparent;
  }

  .order-path {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    color: rgba(245, 166, 35, 0.22);
    overflow: visible;
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

  .strip.split-strip li {
    opacity: 0.42;
  }

  .strip.split-strip li.on-sheet,
  .strip.split-strip li.selected,
  .strip.split-strip li.over {
    opacity: 1;
  }

  .strip.split-strip li.on-sheet {
    outline: 1px solid rgba(245, 166, 35, 0.45);
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
