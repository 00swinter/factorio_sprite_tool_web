/** Opaque bounds in pixels, relative to each sprite's center. `right` and `bottom` are exclusive. */
export type CenterBox = {
  left: number
  top: number
  right: number
  bottom: number
}

export type ContentTrim = CenterBox

export type TrimFrame = {
  width: number
  height: number
  bounds: CenterBox | null
}

function clampByte(value: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 0
  return Math.min(255, Math.max(0, n))
}

export function opaqueBoundsFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number,
): CenterBox | null {
  const threshold = clampByte(alphaThreshold)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < 0) return null

  const centerX = width / 2
  const centerY = height / 2
  return {
    left: minX - centerX,
    top: minY - centerY,
    right: maxX + 1 - centerX,
    bottom: maxY + 1 - centerY,
  }
}

/** Fractional part of half the size: 0 when every size is even, 0.5 when every size is odd. */
function commonEdgeFrac(sizes: number[]): number | null {
  if (sizes.length === 0) return 0
  const frac = (sizes[0] / 2) % 1
  for (let i = 1; i < sizes.length; i++) {
    if (Math.abs((sizes[i] / 2) % 1 - frac) > 1e-6) return null
  }
  return frac
}

function snapDown(value: number, frac: number): number {
  return Math.floor(value - frac + 1e-8) + frac
}

function snapUp(value: number, frac: number): number {
  return Math.ceil(value - frac - 1e-8) + frac
}

export function sizesMixParity(sizes: number[]): boolean {
  return sizes.length > 1 && commonEdgeFrac(sizes) === null
}

/**
 * One crop for every frame. Bounds stay in center-space, so a pixel that was
 * 10px left of the building center is still 10px left of it after the crop.
 */
export function sharedTrim(frames: TrimFrame[], margin: number): ContentTrim | null {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY

  for (const frame of frames) {
    if (!frame.bounds) continue
    left = Math.min(left, frame.bounds.left)
    top = Math.min(top, frame.bounds.top)
    right = Math.max(right, frame.bounds.right)
    bottom = Math.max(bottom, frame.bounds.bottom)
  }

  if (!Number.isFinite(left)) return null

  const pad = Number.isFinite(margin) && margin > 0 ? margin : 0
  left -= pad
  top -= pad
  right += pad
  bottom += pad

  const xFrac = commonEdgeFrac(frames.map((frame) => frame.width)) ?? 0
  const yFrac = commonEdgeFrac(frames.map((frame) => frame.height)) ?? 0
  left = snapDown(left, xFrac)
  right = snapUp(right, xFrac)
  top = snapDown(top, yFrac)
  bottom = snapUp(bottom, yFrac)

  if (right <= left) right = left + 1
  if (bottom <= top) bottom = top + 1

  return { left, top, right, bottom }
}

export function trimSize(trim: ContentTrim): { width: number; height: number } {
  return {
    width: trim.right - trim.left,
    height: trim.bottom - trim.top,
  }
}

/** Building center in cropped-image pixels. May sit outside the picture. */
export function buildingInsideTrim(trim: ContentTrim): boolean {
  const x = -trim.left
  const y = -trim.top
  const { width, height } = trimSize(trim)
  return x >= -1e-6 && x <= width + 1e-6 && y >= -1e-6 && y <= height + 1e-6
}

export function measureImageBounds(
  image: CanvasImageSource,
  width: number,
  height: number,
  alphaThreshold: number,
): CenterBox | null {
  if (width < 1 || height < 1) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(image, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height).data
  return opaqueBoundsFromPixels(data, width, height, alphaThreshold)
}
