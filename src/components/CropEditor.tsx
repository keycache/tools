import { useEffect, useRef, useState } from 'react'
import { moveRect, resizeFromCorner, type Rect, type Size } from '@/lib/aspect'

interface Props {
  src: string
  size: Size
  ratio: number
  // Null means no crop box: the plain image is shown.
  rect: Rect | null
  onChange: (rect: Rect) => void
}

type Drag =
  | { kind: 'move'; startX: number; startY: number; start: Rect }
  | { kind: 'resize'; anchor: { x: number; y: number } }

const CORNERS = [
  { cx: 0, cy: 0, cursor: 'nwse-resize' },
  { cx: 1, cy: 0, cursor: 'nesw-resize' },
  { cx: 0, cy: 1, cursor: 'nesw-resize' },
  { cx: 1, cy: 1, cursor: 'nwse-resize' },
] as const

export function CropEditor({ src, size, ratio, rect, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setScale(el.clientWidth / size.w)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [size.w])

  // Pointer position in natural image pixels.
  function toImagePoint(e: React.PointerEvent) {
    const bounds = containerRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - bounds.left) / scale,
      y: (e.clientY - bounds.top) / scale,
    }
  }

  function startMove(e: React.PointerEvent) {
    if (!rect) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toImagePoint(e)
    dragRef.current = { kind: 'move', startX: p.x, startY: p.y, start: rect }
  }

  function startResize(e: React.PointerEvent, cx: number, cy: number) {
    if (!rect) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'resize',
      anchor: {
        x: cx ? rect.x : rect.x + rect.w,
        y: cy ? rect.y : rect.y + rect.h,
      },
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    const p = toImagePoint(e)
    if (drag.kind === 'move') {
      onChange(moveRect(drag.start, p.x - drag.startX, p.y - drag.startY, size))
    } else {
      onChange(resizeFromCorner(drag.anchor, p, ratio, size))
    }
  }

  function endDrag() {
    dragRef.current = null
  }

  return (
    <div
      ref={containerRef}
      className="relative mx-auto w-full touch-none overflow-hidden rounded-lg select-none"
      style={{
        aspectRatio: `${size.w} / ${size.h}`,
        maxWidth: `min(48rem, calc(70vh * ${size.w / size.h}))`,
      }}
    >
      <img src={src} alt="Uploaded" className="block size-full" draggable={false} />
      {rect && (
        <div
          onPointerDown={startMove}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
          style={{
            left: rect.x * scale,
            top: rect.y * scale,
            width: rect.w * scale,
            height: rect.h * scale,
          }}
        >
          {CORNERS.map(({ cx, cy, cursor }) => (
            <div
              key={`${cx}${cy}`}
              onPointerDown={(e) => startResize(e, cx, cy)}
              className="absolute size-4 rounded-sm border-2 border-white bg-primary"
              style={{
                left: cx ? undefined : -9,
                right: cx ? -9 : undefined,
                top: cy ? undefined : -9,
                bottom: cy ? -9 : undefined,
                cursor,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
