export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Size {
  w: number
  h: number
}

export type FitMode = 'crop' | 'pad' | 'stretch'

export interface RenderPlan {
  width: number
  height: number
  source: Rect
  dest: Rect
}

export const PRESETS = [
  { label: '1:1', w: 1, h: 1 },
  { label: '9:16', w: 9, h: 16 },
  { label: '16:9', w: 16, h: 9 },
  { label: '4:3', w: 4, h: 3 },
  { label: '3:4', w: 3, h: 4 },
] as const

export function isValidRatio(w: number, h: number): boolean {
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
}

// Largest rect with the given ratio (w/h) that fits in the image, centered.
export function centeredRect(img: Size, ratio: number): Rect {
  let w: number
  let h: number
  if (img.w / img.h > ratio) {
    h = img.h
    w = Math.round(img.h * ratio)
  } else {
    w = img.w
    h = Math.round(img.w / ratio)
  }
  return { x: Math.round((img.w - w) / 2), y: Math.round((img.h - h) / 2), w, h }
}

export function moveRect(rect: Rect, dx: number, dy: number, bounds: Size): Rect {
  const x = Math.min(Math.max(rect.x + dx, 0), bounds.w - rect.w)
  const y = Math.min(Math.max(rect.y + dy, 0), bounds.h - rect.h)
  return { ...rect, x, y }
}

// The corner opposite the dragged handle stays fixed; the ratio stays locked.
export function resizeFromCorner(
  anchor: { x: number; y: number },
  pointer: { x: number; y: number },
  ratio: number,
  bounds: Size,
  minW = 16,
): Rect {
  const dirX = pointer.x >= anchor.x ? 1 : -1
  const dirY = pointer.y >= anchor.y ? 1 : -1
  const availW = dirX > 0 ? bounds.w - anchor.x : anchor.x
  const availH = dirY > 0 ? bounds.h - anchor.y : anchor.y
  const maxW = Math.min(availW, availH * ratio)
  const wantW = Math.max(
    Math.abs(pointer.x - anchor.x),
    Math.abs(pointer.y - anchor.y) * ratio,
  )
  const w = Math.max(Math.min(wantW, maxW), Math.min(minW, maxW))
  const h = w / ratio
  return {
    x: dirX > 0 ? anchor.x : anchor.x - w,
    y: dirY > 0 ? anchor.y : anchor.y - h,
    w,
    h,
  }
}

// Describes how to draw the source image onto the output canvas.
export function planRender(
  img: Size,
  ratio: number,
  box: Rect | null,
  fit: FitMode,
): RenderPlan {
  const full: Rect = { x: 0, y: 0, w: img.w, h: img.h }

  if (box) {
    const source = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.max(1, Math.round(box.w)),
      h: Math.max(1, Math.round(box.h)),
    }
    return {
      width: source.w,
      height: source.h,
      source,
      dest: { x: 0, y: 0, w: source.w, h: source.h },
    }
  }

  if (fit === 'crop') {
    const source = centeredRect(img, ratio)
    return {
      width: source.w,
      height: source.h,
      source,
      dest: { x: 0, y: 0, w: source.w, h: source.h },
    }
  }

  if (fit === 'pad') {
    const wide = img.w / img.h > ratio
    const width = wide ? img.w : Math.round(img.h * ratio)
    const height = wide ? Math.round(img.w / ratio) : img.h
    return {
      width,
      height,
      source: full,
      dest: {
        x: Math.round((width - img.w) / 2),
        y: Math.round((height - img.h) / 2),
        w: img.w,
        h: img.h,
      },
    }
  }

  // stretch: keep the width, derive the height
  const height = Math.max(1, Math.round(img.w / ratio))
  return {
    width: img.w,
    height,
    source: full,
    dest: { x: 0, y: 0, w: img.w, h: height },
  }
}
