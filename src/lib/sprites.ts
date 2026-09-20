export const FACTORIO_MAX_SIZE = 8192

export type Align = 'start' | 'center' | 'end'
export type CellMode = 'auto' | 'square' | 'custom'

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

export function computeLayout(sprites: Sprite[], options: LayoutOptions): SheetLayout {
  const frameCount = sprites.length
  const columns = positiveInt(options.columns)
  const neededRows = Math.max(1, Math.ceil(frameCount / columns) || 1)
  const rows = Math.max(positiveInt(options.rows), neededRows)
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
    cellWidth = Math.max(1, Math.round(nativeMaxWidth * scale))
    cellHeight = Math.max(1, Math.round(nativeMaxHeight * scale))
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
    const col = index % layout.columns
    const row = Math.floor(index / layout.columns)
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

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename.endsWith('.png') ? filename : `${filename}.png`
    link.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}
