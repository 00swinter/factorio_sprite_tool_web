export const FACTORIO_MAX_SIZE = 8192

export type Align = 'start' | 'center' | 'end'
export type CellMode = 'auto' | 'square' | 'custom'
export type FillOrder = 'row' | 'column'
export type ExportMode = 'single' | 'split'
/** Which axis holds one complete animation (one turret angle). */
export type SplitAxis = 'row' | 'column'

export type Sprite = {
  id: string
  name: string
  width: number
  height: number
  image: HTMLImageElement
  objectUrl: string
}

export type LayoutOptions = {
  columns: number
  rows: number
  compact: boolean
  fillOrder: FillOrder
  cellMode: CellMode
  customWidth: number
  customHeight: number
  alignX: Align
  alignY: Align
  scale: number
  pixelated: boolean
}

export type SheetLayout = {
  columns: number
  rows: number
  cellWidth: number
  cellHeight: number
  sheetWidth: number
  sheetHeight: number
  frameCount: number
  nativeMaxWidth: number
  nativeMaxHeight: number
  exceedsLimit: boolean
  mixedSizes: boolean
}

const IMAGE_TYPES = new Set([
  'image/png',
  'image/webp',
  'image/gif',
  'image/jpeg',
  'image/jpg',
  'image/bmp',
  'image/avif',
])

const IMAGE_EXT = /\.(png|webp|gif|jpe?g|bmp|avif)$/i

export function isImageFile(file: File): boolean {
  return IMAGE_TYPES.has(file.type) || IMAGE_EXT.test(file.name)
}

export function naturalNameCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export function sortSpritesByName(sprites: Sprite[]): Sprite[] {
  return [...sprites].sort((a, b) => naturalNameCompare(a.name, b.name))
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load image'))
    image.src = url
  })
}

export async function loadSprite(file: File): Promise<Sprite> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)
    return {
      id: crypto.randomUUID(),
      name: file.name,
      width: image.naturalWidth,
      height: image.naturalHeight,
      image,
      objectUrl,
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

export async function loadSprites(files: File[]): Promise<Sprite[]> {
  const images = files.filter(isImageFile)
  const loaded = await Promise.all(images.map((file) => loadSprite(file)))
  return loaded.sort((a, b) => naturalNameCompare(a.name, b.name))
}

export function revokeSprite(sprite: Sprite): void {
  URL.revokeObjectURL(sprite.objectUrl)
}

export async function filesFromDataTransfer(data: DataTransfer): Promise<File[]> {
  const items = [...data.items]
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry))

  if (entries.length > 0) {
    const nested = await Promise.all(entries.map(readEntry))
    return nested.flat().filter(isImageFile)
  }

  return [...data.files].filter(isImageFile)
}

async function readEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      ;(entry as FileSystemFileEntry).file(resolve, reject)
    })
    return [file]
  }

  if (!entry.isDirectory) return []

  const reader = (entry as FileSystemDirectoryEntry).createReader()
  const files: File[] = []

  const readBatch = (): Promise<void> =>
    new Promise((resolve, reject) => {
      reader.readEntries(async (batch) => {
        if (batch.length === 0) {
          resolve()
          return
        }
        for (const child of batch) {
          files.push(...(await readEntry(child)))
        }
        await readBatch()
        resolve()
      }, reject)
    })

  await readBatch()
  return files
}

function alignOffset(align: Align, cell: number, size: number): number {
  if (align === 'center') return Math.floor((cell - size) / 2)
  if (align === 'end') return cell - size
  return 0
}

function positiveInt(value: number, fallback = 1): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n >= 1 ? n : fallback
}

export function compactGrid(
  frameCount: number,
  cellWidth = 1,
  cellHeight = 1,
): { columns: number; rows: number } {
  const n = Math.max(0, frameCount)
  if (n <= 1) return { columns: 1, rows: 1 }

  const cellW = Math.max(1, cellWidth)
  const cellH = Math.max(1, cellHeight)
  let columns = n
  let rows = 1
  let best = Number.POSITIVE_INFINITY

  for (let cols = 1; cols <= n; cols++) {
    const nextRows = Math.ceil(n / cols)
    const diff = Math.abs(cols * cellW - nextRows * cellH)
    const empty = cols * nextRows - n
    const score = diff * 1000 + empty
    if (score <= best) {
      best = score
      columns = cols
      rows = nextRows
    }
  }

  return { columns, rows }
}

export function computeLayout(sprites: Sprite[], options: LayoutOptions): SheetLayout {
  const frameCount = sprites.length
  const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1

  const nativeMaxWidth = sprites.reduce((max, sprite) => Math.max(max, sprite.width), 0)
  const nativeMaxHeight = sprites.reduce((max, sprite) => Math.max(max, sprite.height), 0)
  const mixedSizes = sprites.some(
    (sprite) => sprite.width !== nativeMaxWidth || sprite.height !== nativeMaxHeight,
  )

  let cellWidth: number
  let cellHeight: number

  if (options.cellMode === 'custom') {
    cellWidth = Math.max(1, Math.round(options.customWidth))
    cellHeight = Math.max(1, Math.round(options.customHeight))
  } else if (options.cellMode === 'square') {
    const size = Math.max(1, Math.round(Math.max(nativeMaxWidth, nativeMaxHeight) * scale))
    cellWidth = size
    cellHeight = size
  } else {
    cellWidth = Math.max(1, Math.round(nativeMaxWidth * scale) || 1)
    cellHeight = Math.max(1, Math.round(nativeMaxHeight * scale) || 1)
  }

  let columns: number
  let rows: number
  if (options.compact) {
    const packed = compactGrid(frameCount, cellWidth, cellHeight)
    columns = packed.columns
    rows = packed.rows
  } else if (options.fillOrder === 'column') {
    rows = positiveInt(options.rows)
    const neededCols = Math.max(1, Math.ceil(frameCount / rows) || 1)
    columns = Math.max(positiveInt(options.columns), neededCols)
  } else {
    columns = positiveInt(options.columns)
    const neededRows = Math.max(1, Math.ceil(frameCount / columns) || 1)
    rows = Math.max(positiveInt(options.rows), neededRows)
  }

  const sheetWidth = columns * cellWidth
  const sheetHeight = rows * cellHeight

  return {
    columns,
    rows,
    cellWidth,
    cellHeight,
    sheetWidth,
    sheetHeight,
    frameCount,
    nativeMaxWidth,
    nativeMaxHeight,
    exceedsLimit: sheetWidth > FACTORIO_MAX_SIZE || sheetHeight > FACTORIO_MAX_SIZE,
    mixedSizes,
  }
}

export function cellIndexToPos(
  index: number,
  layout: SheetLayout,
  order: FillOrder,
): { col: number; row: number } {
  if (order === 'column') {
    return {
      col: Math.floor(index / layout.rows),
      row: index % layout.rows,
    }
  }
  return {
    col: index % layout.columns,
    row: Math.floor(index / layout.columns),
  }
}

export function posToFrameIndex(
  col: number,
  row: number,
  layout: SheetLayout,
  order: FillOrder,
): number | null {
  const index = order === 'column' ? col * layout.rows + row : row * layout.columns + col
  if (index < 0 || index >= layout.frameCount) return null
  return index
}

export function renderSpritesheet(
  canvas: HTMLCanvasElement,
  sprites: Sprite[],
  layout: SheetLayout,
  options: LayoutOptions,
): void {
  canvas.width = Math.max(1, layout.sheetWidth)
  canvas.height = Math.max(1, layout.sheetHeight)

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = !options.pixelated
  ctx.imageSmoothingQuality = options.pixelated ? 'low' : 'high'

  const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1

  sprites.forEach((sprite, index) => {
    const { col, row } = cellIndexToPos(index, layout, options.fillOrder)
    const cellX = col * layout.cellWidth
    const cellY = row * layout.cellHeight
    const drawWidth = Math.max(1, Math.round(sprite.width * scale))
    const drawHeight = Math.max(1, Math.round(sprite.height * scale))
    const x = cellX + alignOffset(options.alignX, layout.cellWidth, drawWidth)
    const y = cellY + alignOffset(options.alignY, layout.cellHeight, drawHeight)

    ctx.save()
    ctx.beginPath()
    ctx.rect(cellX, cellY, layout.cellWidth, layout.cellHeight)
    ctx.clip()
    ctx.drawImage(sprite.image, x, y, drawWidth, drawHeight)
    ctx.restore()
  })
}

export function luaSnippet(filename: string, layout: SheetLayout): string {
  const safeName = filename.trim() || 'spritesheet.png'
  return `{
  filename = "${safeName}",
  width = ${layout.cellWidth},
  height = ${layout.cellHeight},
  frame_count = ${layout.frameCount},
  line_length = ${layout.columns},
}`
}

export type SplitSheet = {
  index: number
  filename: string
  groups: number
  columns: number
  rows: number
  sheetWidth: number
  sheetHeight: number
  frameCount: number
  startGroup: number
  exceedsLimit: boolean
}

export type SplitPlan = {
  axis: SplitAxis
  animationLength: number
  directionCount: number
  leftoverFrames: number
  groupsPerSheet: number
  maxGroupsThatFit: number
  sheetCount: number
  cellWidth: number
  cellHeight: number
  animationFits: boolean
  sheets: SplitSheet[]
}

export type SplitOptions = {
  axis: SplitAxis
  animationLength: number
  /** Null packs as many complete animations as the 8192px limit allows. */
  customGroupsPerSheet: number | null
  filename: string
}

export function pngBasename(filename: string): string {
  const trimmed = filename.trim() || 'spritesheet.png'
  return trimmed.toLowerCase().endsWith('.png') ? trimmed.slice(0, -4) : trimmed
}

function lastNumberInName(name: string): { start: number; digits: string } | null {
  const match = name.match(/(\d+)(?!.*\d)/)
  if (!match || match.index === undefined) return null
  return { start: match.index, digits: match[1] }
}

export function splitSheetFilename(filename: string, index: number): string {
  const base = pngBasename(filename) || 'spritesheet'
  const found = lastNumberInName(base)
  if (!found) return `${base}-${index + 1}.png`

  const next = String(Number(found.digits) + index).padStart(found.digits.length, '0')
  return `${base.slice(0, found.start)}${next}${base.slice(found.start + found.digits.length)}.png`
}

export function zipFilename(filename: string): string {
  const base = pngBasename(filename) || 'spritesheet'
  const found = lastNumberInName(base)
  if (!found) return `${base}.zip`
  const stem = base.slice(0, found.start).replace(/[-_]+$/, '')
  return `${stem || base}.zip`
}

function cellSizeFromSprites(sprites: Sprite[], options: LayoutOptions): {
  cellWidth: number
  cellHeight: number
} {
  const sized = computeLayout(sprites, {
    ...options,
    compact: true,
    columns: 1,
    rows: 1,
  })
  return { cellWidth: sized.cellWidth, cellHeight: sized.cellHeight }
}

export function maxCompleteGroups(
  axis: SplitAxis,
  animationLength: number,
  cellWidth: number,
  cellHeight: number,
): number {
  const length = positiveInt(animationLength)
  const cellW = Math.max(1, cellWidth)
  const cellH = Math.max(1, cellHeight)

  if (axis === 'row') {
    if (length * cellW > FACTORIO_MAX_SIZE || cellH > FACTORIO_MAX_SIZE) return 0
    return Math.floor(FACTORIO_MAX_SIZE / cellH)
  }

  if (length * cellH > FACTORIO_MAX_SIZE || cellW > FACTORIO_MAX_SIZE) return 0
  return Math.floor(FACTORIO_MAX_SIZE / cellW)
}

export function planSplitSheets(
  sprites: Sprite[],
  layoutOptions: LayoutOptions,
  split: SplitOptions,
): SplitPlan {
  const { cellWidth, cellHeight } = cellSizeFromSprites(sprites, layoutOptions)
  const animationLength = positiveInt(split.animationLength)
  const directionCount = Math.floor(sprites.length / animationLength)
  const leftoverFrames = sprites.length % animationLength
  const maxGroupsThatFit = maxCompleteGroups(split.axis, animationLength, cellWidth, cellHeight)
  const animationFits = maxGroupsThatFit > 0 && directionCount > 0
  const groupsPerSheet = animationFits
    ? Math.min(
        maxGroupsThatFit,
        directionCount,
        split.customGroupsPerSheet == null
          ? maxGroupsThatFit
          : positiveInt(split.customGroupsPerSheet),
      )
    : 0

  const sheets: SplitSheet[] = []
  if (groupsPerSheet > 0) {
    for (let startGroup = 0, index = 0; startGroup < directionCount; startGroup += groupsPerSheet, index++) {
      const groups = Math.min(groupsPerSheet, directionCount - startGroup)
      const columns = split.axis === 'row' ? animationLength : groups
      const rows = split.axis === 'row' ? groups : animationLength
      const sheetWidth = columns * cellWidth
      const sheetHeight = rows * cellHeight
      sheets.push({
        index,
        filename: splitSheetFilename(split.filename, index),
        groups,
        columns,
        rows,
        sheetWidth,
        sheetHeight,
        frameCount: groups * animationLength,
        startGroup,
        exceedsLimit: sheetWidth > FACTORIO_MAX_SIZE || sheetHeight > FACTORIO_MAX_SIZE,
      })
    }
  }

  return {
    axis: split.axis,
    animationLength,
    directionCount,
    leftoverFrames,
    groupsPerSheet,
    maxGroupsThatFit,
    sheetCount: sheets.length,
    cellWidth,
    cellHeight,
    animationFits,
    sheets,
  }
}

export function spritesForSplitSheet(sprites: Sprite[], plan: SplitPlan, sheetIndex: number): Sprite[] {
  const sheet = plan.sheets[sheetIndex]
  if (!sheet) return []
  const start = sheet.startGroup * plan.animationLength
  return sprites.slice(start, start + sheet.frameCount)
}

export function splitLayoutOptions(
  options: LayoutOptions,
  plan: SplitPlan,
  sheet: SplitSheet,
): LayoutOptions {
  return {
    ...options,
    compact: false,
    fillOrder: plan.axis,
    columns: sheet.columns,
    rows: sheet.rows,
  }
}

export function luaStripesSnippet(plan: SplitPlan): string {
  const stripes = plan.sheets
    .map(
      (sheet) => `    {
      filename = "${sheet.filename}",
      width_in_frames = ${sheet.columns},
      height_in_frames = ${sheet.rows},
    }`,
    )
    .join(',\n')

  return `{
  width = ${plan.cellWidth},
  height = ${plan.cellHeight},
  frame_count = ${plan.animationLength},
  direction_count = ${plan.directionCount},
  stripes = {
${stripes}
  },
}`
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Could not encode PNG'))
      else resolve(blob)
    }, 'image/png')
  })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  void canvasToPngBlob(canvas)
    .then((blob) => downloadBlob(blob, filename.endsWith('.png') ? filename : `${filename}.png`))
    .catch(() => {
      /* encoding failed; nothing to download */
    })
}
