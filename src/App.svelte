<script lang="ts">
  import { tick, untrack } from 'svelte'
  import {
    computeLayout,
    canvasToPngBlob,
    downloadBlob,
    downloadCanvas,
    filesFromDataTransfer,
    loadSprites,
    formatLuaNumber,
    luaSnippet,
    luaStripesSnippet,
    planSplitSheets,
    posToFrameIndex,
    drawIngamePreview,
    renderSpritesheet,
    revokeSprite,
    sortSpritesByName,
    cellIndexToPos,
    pngBasename,
    spritesForSplitSheet,
    splitLayoutOptions,
    trimmedShift,
    wireOffset,
    zipFilename,
    type Align,
    type CellMode,
    type ExportMode,
    type FillOrder,
    type LuaSpriteExtra,
    type SplitAxis,
    type Sprite,
  } from './lib/sprites'
  import {
    buildingInsideTrim,
    measureImageBounds,
    sharedTrim,
    sizesMixParity,
    trimSize,
    type CenterBox,
  } from './lib/trim'
  import HelpTip from './lib/HelpTip.svelte'
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
  let trimEnabled = $state(false)
  let trimAlpha = $state(0)
  let trimMargin = $state(0)
  let asDirections = $state(false)
  let drawAsShadow = $state(false)
  let showCenter = $state(true)
  let measuredFrames = $state<{ id: string; bounds: CenterBox | null }[]>([])
  let gameScale = $state(1)
  let wireShiftX = $state(0)
  let wireShiftY = $state(0)
  let wireShiftManual = $state(false)
  let hoverPoint = $state<{ frame: number; px: number; py: number } | null>(null)
  let copiedWire = $state('')
  let showGrid = $state(true)
  let showIndexes = $state(true)
  let showOrder = $state(false)
  let zoom = $state(1)
  let panX = $state(0)
  let panY = $state(0)
  let panning = $state(false)
  let worldZoom = $state(1)
  let worldPanX = $state(0)
  let worldPanY = $state(0)
  let worldPanning = $state(false)
  let panLastX = 0
  let panLastY = 0
  let worldPanLastX = 0
  let worldPanLastY = 0
  let worldFittedKey = ''
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
  let worldCanvas: HTMLCanvasElement | undefined = $state()
  let worldView: HTMLDivElement | undefined = $state()
  let boardWrap: HTMLDivElement | undefined = $state()
  let fileInput: HTMLInputElement | undefined = $state()
  let folderInput: HTMLInputElement | undefined = $state()

  const measuredReady = $derived(
    measuredFrames.length === sprites.length &&
      measuredFrames.every((frame, index) => frame.id === sprites[index]?.id),
  )

  const contentTrim = $derived.by(() => {
    if (!trimEnabled || !measuredReady) return null
    return sharedTrim(
      sprites.map((sprite, index) => ({
        width: sprite.width,
        height: sprite.height,
        bounds: measuredFrames[index]?.bounds ?? null,
      })),
      trimMargin,
    )
  })

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
    trim: contentTrim,
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
  const shift = $derived.by(() => {
    if (!contentTrim) return null
    const cellWidth = exportMode === 'split' ? splitPlan.cellWidth : layout.cellWidth
    const cellHeight = exportMode === 'split' ? splitPlan.cellHeight : layout.cellHeight
    return trimmedShift(contentTrim, cellWidth, cellHeight, alignX, alignY, scale)
  })
  const appliedScale = $derived(Number.isFinite(gameScale) ? gameScale : 1)
  const pictureShift = $derived.by(() => {
    if (wireShiftManual) {
      return {
        x: Number.isFinite(wireShiftX) ? wireShiftX : 0,
        y: Number.isFinite(wireShiftY) ? wireShiftY : 0,
      }
    }
    if (!shift) return { x: 0, y: 0 }
    return { x: shift.x * appliedScale, y: shift.y * appliedScale }
  })
  const luaExtra = $derived<LuaSpriteExtra | null>(
    trimEnabled || appliedScale !== 1 || pictureShift.x !== 0 || pictureShift.y !== 0
      ? {
          shift: trimEnabled || pictureShift.x !== 0 || pictureShift.y !== 0 ? pictureShift : null,
          scale: trimEnabled || appliedScale !== 1 ? appliedScale : null,
          directions: exportMode === 'single' && trimEnabled && asDirections,
          shadow: trimEnabled && drawAsShadow,
        }
      : null,
  )
  const worldSprite = $derived.by(() => {
    if (previewSprites.length === 0) return null
    return previewSprites.find((sprite) => selectedIds.includes(sprite.id)) ?? previewSprites[0]
  })
  const worldFrameIndex = $derived(worldSprite ? previewSprites.indexOf(worldSprite) : -1)
  const worldCaption = $derived.by(() => {
    if (!worldSprite) return ''
    const g = appliedScale > 0 ? appliedScale : 0
    const tilesWide = (layout.cellWidth * g) / 32
    const tilesTall = (layout.cellHeight * g) / 32
    return `Frame ${worldFrameIndex} · ${formatLuaNumber(tilesWide)} × ${formatLuaNumber(tilesTall)} tiles`
  })
  const lua = $derived(
    exportMode === 'split'
      ? luaStripesSnippet(splitPlan, luaExtra)
      : luaSnippet(filename, layout, luaExtra),
  )
  const trimParityMix = $derived(
    trimEnabled &&
      (sizesMixParity(sprites.map((sprite) => sprite.width)) ||
        sizesMixParity(sprites.map((sprite) => sprite.height))),
  )
  const sourceSizeLabel = $derived.by(() => {
    if (sprites.length === 0) return '—'
    const { width, height } = sprites[0]
    return sprites.every((sprite) => sprite.width === width && sprite.height === height)
      ? `${width}×${height}`
      : 'mixed'
  })
  const cropLabel = $derived.by(() => {
    if (!contentTrim) return '—'
    const { width, height } = trimSize(contentTrim)
    return `${formatLuaNumber(width)}×${formatLuaNumber(height)}`
  })
  const shiftLabel = $derived(
    contentTrim ? `${formatLuaNumber(pictureShift.x)} × ${formatLuaNumber(pictureShift.y)}` : '—',
  )
  const centerOutside = $derived(Boolean(contentTrim && !buildingInsideTrim(contentTrim)))
  const trimClipped = $derived.by(() => {
    if (!contentTrim) return false
    const { width, height } = trimSize(contentTrim)
    const safe = Number.isFinite(scale) && scale > 0 ? scale : 1
    const drawW = Math.max(1, Math.round(width * safe))
    const drawH = Math.max(1, Math.round(height * safe))
    const cellWidth = exportMode === 'split' ? splitPlan.cellWidth : layout.cellWidth
    const cellHeight = exportMode === 'split' ? splitPlan.cellHeight : layout.cellHeight
    return cellWidth < drawW || cellHeight < drawH
  })
  const orangeInCell = $derived.by(() => {
    if (!contentTrim) return null
    const mark = trimmedShift(
      contentTrim,
      layout.cellWidth,
      layout.cellHeight,
      previewOptions.alignX,
      previewOptions.alignY,
      previewOptions.scale,
    )
    return {
      x: layout.cellWidth / 2 - mark.x,
      y: layout.cellHeight / 2 - mark.y,
    }
  })
  const centerMarks = $derived.by(() => {
    if (!showCenter || !orangeInCell) return []
    const { x, y } = orangeInCell
    if (x < -0.5 || y < -0.5 || x > layout.cellWidth + 0.5 || y > layout.cellHeight + 0.5) return []
    return previewSprites.map((_, index) => {
      const pos = cellIndexToPos(index, layout, previewOptions.fillOrder)
      return {
        index,
        x: pos.col * layout.cellWidth + x,
        y: pos.row * layout.cellHeight + y,
      }
    })
  })
  const centerArm = $derived(Math.max(4, Math.min(layout.cellWidth, layout.cellHeight) * 0.12))
  const hoverWire = $derived.by(() => {
    if (!hoverPoint) return null
    return {
      frame: hoverPoint.frame,
      px: hoverPoint.px,
      py: hoverPoint.py,
      center: wireOffset(
        hoverPoint.px,
        hoverPoint.py,
        layout.cellWidth / 2,
        layout.cellHeight / 2,
        appliedScale,
        pictureShift.x,
        pictureShift.y,
      ),
      orange: orangeInCell
        ? wireOffset(hoverPoint.px, hoverPoint.py, orangeInCell.x, orangeInCell.y, appliedScale)
        : null,
    }
  })
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
    const canvas = worldCanvas
    if (!canvas) return
    const sprite = worldSprite
    const cell =
      sprite && layout.cellWidth > 0 && layout.cellHeight > 0
        ? document.createElement('canvas')
        : null
    if (cell && sprite) {
      renderSpritesheet(
        cell,
        [sprite],
        {
          ...layout,
          columns: 1,
          rows: 1,
          sheetWidth: layout.cellWidth,
          sheetHeight: layout.cellHeight,
          frameCount: 1,
        },
        previewOptions,
      )
    }
    const logical = drawIngamePreview(canvas, cell, {
      gameScale: appliedScale,
      shiftX: pictureShift.x,
      shiftY: pictureShift.y,
      pixelated,
      zoom: worldZoom,
    })
    const view = worldView
    const cssW = logical.width
    const cssH = logical.height
    const key = `${Math.round(cssW)}x${Math.round(cssH)}`
    if (view && cssW > 0 && cssH > 0 && key !== worldFittedKey) {
      worldFittedKey = key
      const z = untrack(() => worldZoom)
      worldPanX = (view.clientWidth - cssW * z) / 2
      worldPanY = (view.clientHeight - cssH * z) / 2
    }
  })

  $effect(() => {
    const view = worldView
    if (!view) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = view.getBoundingClientRect()
      applyWorldZoom(
        untrack(() => worldZoom) * Math.exp(-event.deltaY * 0.0018),
        event.clientX - rect.left,
        event.clientY - rect.top,
      )
    }

    const preventMiddleAutoscroll = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault()
    }

    view.addEventListener('wheel', onWheel, { passive: false })
    view.addEventListener('mousedown', preventMiddleAutoscroll)
    return () => {
      view.removeEventListener('wheel', onWheel)
      view.removeEventListener('mousedown', preventMiddleAutoscroll)
    }
  })

  $effect(() => {
    if (!trimEnabled) return
    const alpha = trimAlpha
    const list = sprites
    measuredFrames = list.map((sprite) => ({
      id: sprite.id,
      bounds: measureImageBounds(sprite.image, sprite.width, sprite.height, alpha),
    }))
  })

  $effect(() => {
    if (wireShiftManual) return
    if (!shift) {
      wireShiftX = 0
      wireShiftY = 0
      return
    }
    const g = Number.isFinite(gameScale) ? gameScale : 1
    wireShiftX = shift.x * g
    wireShiftY = shift.y * g
  })

  $effect(() => {
    if (sprites.length === 0) hoverPoint = null
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
    updateHover(event)
    if (!panning) return
    panX += event.clientX - panLastX
    panY += event.clientY - panLastY
    panLastX = event.clientX
    panLastY = event.clientY
  }

  function updateHover(event: PointerEvent) {
    const wrap = boardWrap
    if (!wrap || sprites.length === 0 || layout.cellWidth < 1 || layout.cellHeight < 1) {
      hoverPoint = null
      return
    }
    const board = wrap.querySelector('.board')
    if (!(board instanceof HTMLElement)) {
      hoverPoint = null
      return
    }
    const rect = board.getBoundingClientRect()
    const scaleX = rect.width / layout.sheetWidth
    const scaleY = rect.height / layout.sheetHeight
    if (scaleX <= 0 || scaleY <= 0) {
      hoverPoint = null
      return
    }
    const sheetX = (event.clientX - rect.left) / scaleX
    const sheetY = (event.clientY - rect.top) / scaleY
    if (sheetX < 0 || sheetY < 0 || sheetX >= layout.sheetWidth || sheetY >= layout.sheetHeight) {
      hoverPoint = null
      return
    }
    const col = Math.min(layout.columns - 1, Math.floor(sheetX / layout.cellWidth))
    const row = Math.min(layout.rows - 1, Math.floor(sheetY / layout.cellHeight))
    const index = posToFrameIndex(col, row, layout, previewOptions.fillOrder)
    if (index === null) {
      hoverPoint = null
      return
    }
    const px = sheetX - col * layout.cellWidth
    const py = sheetY - row * layout.cellHeight
    hoverPoint = {
      frame: (sheetRange?.start ?? 0) + index,
      px,
      py,
    }
  }

  function useCropShift() {
    wireShiftManual = false
  }

  function wireCall(point: { x: number; y: number }): string {
    return `util.by_pixel(${formatLuaNumber(point.x)}, ${formatLuaNumber(point.y)})`
  }

  async function copyWire(point: { x: number; y: number }, key: string) {
    const text = wireCall(point)
    try {
      await navigator.clipboard.writeText(text)
      copiedWire = key
      setTimeout(() => {
        if (copiedWire === key) copiedWire = ''
      }, 1200)
    } catch {
      errorMessage = 'Could not copy the wire coordinate.'
    }
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

  function applyWorldZoom(nextZoom: number, originX: number, originY: number) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextZoom))
    const prev = worldZoom
    if (next === prev) return
    worldPanX = originX - ((originX - worldPanX) / prev) * next
    worldPanY = originY - ((originY - worldPanY) / prev) * next
    worldZoom = next
  }

  function onWorldPointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    worldPanning = true
    worldPanLastX = event.clientX
    worldPanLastY = event.clientY
    capturePointer(event)
  }

  function onWorldPointerMove(event: PointerEvent) {
    if (!worldPanning) return
    worldPanX += event.clientX - worldPanLastX
    worldPanY += event.clientY - worldPanLastY
    worldPanLastX = event.clientX
    worldPanLastY = event.clientY
  }

  function onWorldPointerUp(event: PointerEvent) {
    if (!worldPanning) return
    worldPanning = false
    releasePointer(event)
  }

  function onWorldZoomSlider(event: Event) {
    const view = worldView
    applyWorldZoom(
      Number((event.currentTarget as HTMLInputElement).value),
      view ? view.clientWidth / 2 : 0,
      view ? view.clientHeight / 2 : 0,
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

  async function setTrimEnabled(enabled: boolean) {
    trimEnabled = enabled
    await tick()
    centerPreview()
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
  <header class="topbar">
    <div class="brand">
      <div class="mark" aria-hidden="true">
        <span></span><span></span><span></span><span></span>
      </div>
      <div>
        <p class="eyebrow">Factorio graphics</p>
        <h1>
          Sprite Assembler
          <HelpTip label="About Sprite Assembler">
            {#if exportMode === 'split'}
              <p>
                Import a full turret animation, keep every angle complete, and export as many sheets as needed under Factorio’s 8192px limit.
              </p>
            {:else}
              <p>
                Drop frames, set any column × row grid, and export a PNG Factorio can read as <code>line_length</code>.
              </p>
            {/if}
            <p>
              Private by design. Everything runs locally in your browser — nothing is uploaded, shared, or transmitted.
            </p>
          </HelpTip>
        </h1>
      </div>
    </div>
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
        <h2>
          Scale
          <HelpTip label="In-game scale">
            <p>Each square is one tile on the ground. The orange square is where the sprite is placed.</p>
            <p>
              Factorio draws the sprite at this size. The hover coordinates, the trim shift, and the Lua all use this number, so the center stays on the placement point.
            </p>
          </HelpTip>
        </h2>
        <div
          class="world-view"
          class:panning={worldPanning}
          bind:this={worldView}
          role="application"
          aria-label="In-game size. Scroll to zoom, drag to pan."
          title="Scroll to zoom, drag with left or middle mouse to pan"
          onpointerdown={onWorldPointerDown}
          onpointermove={onWorldPointerMove}
          onpointerup={onWorldPointerUp}
          onpointercancel={onWorldPointerUp}
        >
          <canvas
            bind:this={worldCanvas}
            style:transform="translate({worldPanX}px, {worldPanY}px)"
          ></canvas>
        </div>
        <div class="world-tools">
          {#if worldCaption}
            <p class="hint">{worldCaption}</p>
          {/if}
          <label class="zoom">
            <span>{Math.round(worldZoom * 100)}%</span>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step="0.05"
              value={worldZoom}
              aria-label="In-game preview zoom"
              oninput={onWorldZoomSlider}
            />
          </label>
        </div>
        <label class="field">
          <span>In-game scale</span>
          <input type="number" step="0.1" bind:value={gameScale} />
        </label>
      </section>

      <section class="card">
        <h2>
          Layout
          <HelpTip label="About layout">
            {#if exportMode === 'split'}
              <p>
                For turret shooting and other long directional animations. Each complete angle stays on one sheet; extra angles go to the next file.
              </p>
            {:else}
              <p>Frames fill in filename order unless you drag them. Choose Z (row) or N (column) fill below.</p>
            {/if}
          </HelpTip>
        </h2>
        <div class="presets">
          <button type="button" class:active={exportMode === 'single'} onclick={() => setExportMode('single')}>
            Single sheet
          </button>
          <button type="button" class:active={exportMode === 'split'} onclick={() => setExportMode('split')}>
            Split sheets
          </button>
        </div>

        {#if exportMode === 'split'}
          <span class="field-label">
            Each complete animation is
            <HelpTip label="Animation axis">
              {#if splitAxis === 'row'}
                <p>
                  Columns are animation frames. Rows are turret angles. This matches Factorio <code>stripes</code> and gun-turret shooting sheets.
                </p>
              {:else}
                <p>Frames go top to bottom, and the next angle is the next column.</p>
                <p>
                  Factorio still reads left-to-right first. Use rows as complete angles unless you specifically want vertical animations.
                </p>
              {/if}
            </HelpTip>
          </span>
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

          <div class="field">
            <span class="label-row">
              <label for="animation-length">Animation length (frames)</label>
              <HelpTip label="Animation length">
                <p>
                  {splitAxis === 'row' ? 'This is the column count on every sheet.' : 'This is the row count on every sheet.'}
                  An angle is never split across files.
                </p>
              </HelpTip>
            </span>
            <input id="animation-length" type="number" min="1" max="512" bind:value={animationLength} />
          </div>

          <label class="check">
            <input type="checkbox" bind:checked={splitAutoPack} />
            <span class="check-label">Pack as many complete angles as fit under 8192px</span>
          </label>
          {#if !splitAutoPack}
            <div class="field">
              <span class="label-row">
                <label for="angles-per-sheet">Angles per sheet</label>
                <HelpTip label="Angles per sheet">
                  <p>
                    Capped at {splitPlan.maxGroupsThatFit || 0} so the sheet stays within 8192px
                    ({splitPlan.cellWidth}×{splitPlan.cellHeight} cells).
                  </p>
                </HelpTip>
              </span>
              <span class="input-row">
                <input id="angles-per-sheet" type="number" min="1" max="512" bind:value={splitGroups} />
                <span class="affix">max {splitPlan.maxGroupsThatFit || 0}</span>
              </span>
            </div>
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
          <div class="check">
            <input id="custom-grid" type="checkbox" bind:checked={customGrid} />
            <span class="check-label">
              <label for="custom-grid">Set columns and rows individually</label>
              <HelpTip label="Columns and rows">
                {#if customGrid}
                  <p>Factorio <code>line_length</code> is the column count. Extra cells stay empty and transparent.</p>
                {:else}
                  <p>Auto compact: columns and rows are chosen so the sheet stays close to square.</p>
                {/if}
              </HelpTip>
            </span>
          </div>

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

          <div class="field">
            <span class="label-row">
              <label for="fill-order">Fill order</label>
              <HelpTip label="Fill order">
                <p>Row-major (Z) writes left to right, then down. Column-major (N) writes top to bottom, then right.</p>
                <p>Factorio still reads files left-to-right first. Use row-major unless you need N-order packing.</p>
              </HelpTip>
            </span>
            <select id="fill-order" bind:value={fillOrder}>
              <option value="row">Row-major (Z) — left to right, then down</option>
              <option value="column">Column-major (N) — top to bottom, then right</option>
            </select>
          </div>

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
          <span>Resize</span>
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
        <h2>
          Tight crop
          <HelpTip label="Tight crop">
            <p>
              Optional. Cuts one shared window out of every frame, locked to the building center, so the frames stay lined up. The Lua shift puts that center back on the entity. Set the cell to Auto and the sheet shrinks to that window.
            </p>
            <p>
              Crop the pole and the shadow as two separate sets if each picture should shrink to its own pixels. Each shift still meets at the building center. Load them together only when they share one sheet.
            </p>
          </HelpTip>
        </h2>
        <label class="check">
          <input
            type="checkbox"
            checked={trimEnabled}
            onchange={(event) => setTrimEnabled((event.currentTarget as HTMLInputElement).checked)}
          />
          Trim empty space
        </label>
        {#if trimEnabled}
          <div class="row">
            <div class="field">
              <span class="label-row">
                <label for="trim-alpha">Empty alpha</label>
                <HelpTip label="Empty alpha">
                  <p>Pixels at or below this alpha count as empty.</p>
                </HelpTip>
              </span>
              <input id="trim-alpha" type="number" min="0" max="255" bind:value={trimAlpha} />
            </div>
            <div class="field">
              <span class="label-row">
                <label for="trim-margin">Margin</label>
                <HelpTip label="Margin">
                  <p>Keeps a ring of pixels around the art.</p>
                </HelpTip>
              </span>
              <input id="trim-margin" type="number" min="0" max="512" bind:value={trimMargin} />
            </div>
          </div>

          {#if exportMode === 'single'}
            <div class="check">
              <input id="frame-directions" type="checkbox" bind:checked={asDirections} />
              <span class="check-label">
                <label for="frame-directions">Frames are directions</label>
                <HelpTip label="Frames are directions">
                  <p>
                    For a pole strip. Emits <code>direction_count</code> and <code>line_length</code> instead of <code>frame_count</code>. Keep row-major fill so the first frame is the left one.
                  </p>
                </HelpTip>
              </span>
            </div>
          {/if}
          <label class="check">
            <input type="checkbox" bind:checked={drawAsShadow} />
            Shadow layer
          </label>

          <dl class="stats">
            <div>
              <dt>Source</dt>
              <dd>{sourceSizeLabel}</dd>
            </div>
            <div>
              <dt>Cropped</dt>
              <dd>{cropLabel}</dd>
            </div>
            <div>
              <dt>Shift px</dt>
              <dd>{shiftLabel}</dd>
            </div>
            <div>
              <dt>Scale</dt>
              <dd>{formatLuaNumber(appliedScale)}</dd>
            </div>
          </dl>

          {#if sprites.length > 0 && measuredReady && !contentTrim}
            <p class="warn">Every frame is fully transparent, so there is nothing to trim.</p>
          {/if}
          {#if trimParityMix}
            <p class="note">Frame sizes mix odd and even. The center still lines up, but it can sit between pixels on some frames.</p>
          {/if}
          {#if centerOutside}
            <p class="note">The building center sits outside the trimmed pixels. The shift still puts it back on the entity.</p>
          {/if}
          {#if trimClipped}
            <p class="warn">The cell is smaller than the cropped frame, so the picture is clipped and the shift will not match.</p>
          {/if}
        {/if}
      </section>

      <section class="card">
        <h2>
          Export
          {#if exportMode === 'split'}
            <HelpTip label="Split export">
              <p>
                Downloads one ZIP with {splitPlan.sheetCount || 0} PNG{splitPlan.sheetCount === 1 ? '' : 's'}
                named like <code>{activeSheet?.filename ?? 'spritesheet-1.png'}</code> plus the Lua <code>stripes</code> snippet.
              </p>
            </HelpTip>
          {/if}
        </h2>
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
            {#if trimEnabled}
              <label class="check compact">
                <input type="checkbox" bind:checked={showCenter} />
                Center
              </label>
            {/if}
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
            <div class="empty">
              <button type="button" onclick={() => fileInput?.click()}>
                <strong>Drop sprites here</strong>
                <span>or click to choose image files</span>
              </button>
              <div class="empty-help">
                <HelpTip label="Import order">
                  <p>They will be sorted by filename, so frame_1, frame_2, frame_10 stay in order.</p>
                </HelpTip>
              </div>
            </div>
          {:else}
            <div class="hover-readout">
              <div class="hover-knobs">
                <label>
                  shift
                  <input type="number" step="any" bind:value={wireShiftX} oninput={() => (wireShiftManual = true)} />
                  <input type="number" step="any" bind:value={wireShiftY} oninput={() => (wireShiftManual = true)} />
                </label>
                {#if wireShiftManual && contentTrim}
                  <button type="button" class="wire-link" onclick={useCropShift}>use crop</button>
                {/if}
              </div>
              {#if hoverWire}
                <p class="hover-px">frame {hoverWire.frame} · px {formatLuaNumber(hoverWire.px)}, {formatLuaNumber(hoverWire.py)}</p>
                <button
                  type="button"
                  class="wire-line"
                  title="From the middle of this frame, times scale, plus the picture shift. Click to copy."
                  onclick={() => copyWire(hoverWire!.center, 'center')}
                >
                  center {copiedWire === 'center' ? 'copied' : wireCall(hoverWire.center)}
                </button>
                {#if hoverWire.orange}
                  <button
                    type="button"
                    class="wire-line orange"
                    title="From the orange cross, times scale. Click to copy."
                    onclick={() => hoverWire?.orange && copyWire(hoverWire.orange, 'orange')}
                  >
                    orange {copiedWire === 'orange' ? 'copied' : wireCall(hoverWire.orange)}
                  </button>
                {/if}
              {:else}
                <p class="hover-px">Hover a frame. −y is up.</p>
              {/if}
            </div>
            <div
              class="board-wrap"
              class:panning
              bind:this={boardWrap}
              title="Scroll to zoom, drag with left or middle mouse to pan"
              onpointerdown={onPreviewPointerDown}
              onpointermove={onPreviewPointerMove}
              onpointerup={onPreviewPointerUp}
              onpointercancel={onPreviewPointerUp}
              onpointerleave={(event) => {
                const next = event.relatedTarget
                const viewport = event.currentTarget
                if (
                  next instanceof Node &&
                  viewport instanceof HTMLElement &&
                  viewport.parentElement?.contains(next)
                ) {
                  return
                }
                hoverPoint = null
              }}
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
                {#if centerMarks.length > 0}
                  <svg
                    class="center-mark"
                    viewBox="0 0 {layout.sheetWidth} {layout.sheetHeight}"
                    aria-hidden="true"
                  >
                    {#each centerMarks as mark (mark.index)}
                      <line
                        x1={mark.x - centerArm}
                        y1={mark.y}
                        x2={mark.x + centerArm}
                        y2={mark.y}
                        stroke="#000"
                        stroke-width={Math.max(2, centerArm * 0.22)}
                      />
                      <line
                        x1={mark.x}
                        y1={mark.y - centerArm}
                        x2={mark.x}
                        y2={mark.y + centerArm}
                        stroke="#000"
                        stroke-width={Math.max(2, centerArm * 0.22)}
                      />
                      <line
                        x1={mark.x - centerArm}
                        y1={mark.y}
                        x2={mark.x + centerArm}
                        y2={mark.y}
                        stroke="#f5a623"
                        stroke-width={Math.max(1, centerArm * 0.1)}
                      />
                      <line
                        x1={mark.x}
                        y1={mark.y - centerArm}
                        x2={mark.x}
                        y2={mark.y + centerArm}
                        stroke="#f5a623"
                        stroke-width={Math.max(1, centerArm * 0.1)}
                      />
                    {/each}
                  </svg>
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
          <h2>
            Frames
            <HelpTip label="Frames">
              {#if sprites.length === 0}
                {#if exportMode === 'split'}
                  <p>Drop the full animation — every angle, every frame — in filename order.</p>
                {:else}
                  <p>Drop a sequence and it will assemble as {layout.columns} × {layout.rows}.</p>
                {/if}
              {:else}
                <p>Ctrl-click to add frames. Shift-click to select a range. Delete removes the selection. Drag a frame to reorder.</p>
                {#if exportMode === 'split' && activeSheet}
                  <p>Highlighted frames are on sheet {previewSheet + 1}. Dimmed frames are on the other sheets.</p>
                {/if}
              {/if}
            </HelpTip>
          </h2>
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
          <p class="hint">No frames yet.</p>
        {:else}
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

  .topbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 16px 24px;
    align-items: center;
    margin-bottom: 18px;
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
    display: flex;
    align-items: center;
    gap: 8px;
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

  .side h2,
  .frames h2 {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .side h2 {
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
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

  .world-view {
    position: relative;
    height: 168px;
    margin-top: 12px;
    overflow: hidden;
    background: #1a1916;
    border: 1px solid #000;
    box-shadow: inset 0 0 0 1px #3a3832;
    overscroll-behavior: contain;
    touch-action: none;
    cursor: default;
    user-select: none;
  }

  .world-view.panning {
    cursor: grabbing;
  }

  .world-view canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: auto;
    height: auto;
    max-width: none;
    transform-origin: 0 0;
  }

  .world-tools {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }

  .world-tools .hint {
    margin: 0;
    flex: 1;
    min-width: 0;
  }

  .world-tools .zoom {
    margin-left: auto;
  }

  .world-tools .zoom input {
    width: 72px;
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

  .field-label,
  .label-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .field-label {
    margin-top: 14px;
    margin-bottom: 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .input-row input {
    width: auto;
    flex: 1;
    min-width: 0;
  }

  .affix {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-dim);
    white-space: nowrap;
  }

  .check-label {
    flex: 1;
    min-width: 0;
  }

  .field label,
  .check-label label {
    cursor: pointer;
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
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px 12px;
    align-items: center;
    margin-bottom: 12px;
  }

  .frames .preview-tools {
    flex: 1 1 100%;
    justify-content: flex-start;
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
    position: relative;
    height: 100%;
    min-height: 0;
  }

  .empty button {
    display: grid;
    place-content: center;
    text-align: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: 16px;
    border: 1px dashed var(--line);
    background:
      linear-gradient(45deg, #1f1e1a 25%, transparent 25%) 0 0 / 18px 18px,
      linear-gradient(-45deg, #1f1e1a 25%, transparent 25%) 0 9px / 18px 18px,
      linear-gradient(45deg, transparent 75%, #1f1e1a 75%) 9px -9px / 18px 18px,
      linear-gradient(-45deg, transparent 75%, #1f1e1a 75%) -9px 0 / 18px 18px,
      var(--slot);
    color: inherit;
    box-shadow: none;
    cursor: pointer;
  }

  .empty strong {
    color: var(--text-h);
    font-size: 20px;
  }

  .empty-help {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
  }

  .preview-viewport {
    position: relative;
    min-height: 180px;
  }

  .hover-readout {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 4;
    max-width: min(280px, calc(100% - 16px));
    padding: 6px 8px;
    background: rgba(15, 14, 12, 0.9);
    border: 1px solid #000;
    box-shadow: var(--shadow);
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-h);
  }

  .hover-knobs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
    color: var(--text-dim);
  }

  .hover-knobs label {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .hover-readout input[type='number'] {
    width: 4.6em;
    margin: 0;
    padding: 2px 4px;
    font-family: var(--mono);
    font-size: 12px;
  }

  .hover-px {
    margin: 4px 0 0;
    color: var(--text-dim);
  }

  .hover-readout button.wire-line,
  .hover-readout button.wire-link {
    display: block;
    width: 100%;
    margin: 2px 0 0;
    padding: 0;
    min-height: 0;
    background: transparent;
    border: 0;
    box-shadow: none;
    text-align: left;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 650;
    color: var(--text-h);
  }

  .hover-readout button.wire-line.orange {
    color: var(--orange);
  }

  .hover-readout button.wire-link {
    width: auto;
    color: var(--orange);
    font-weight: 500;
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
    cursor: default;
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

  .order-path,
  .center-mark {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }

  .order-path {
    color: rgba(245, 166, 35, 0.22);
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
    .workspace {
      grid-template-columns: 1fr;
    }

    .top-actions {
      justify-content: flex-start;
    }
  }
</style>
