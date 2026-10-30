import type { ComponentType } from 'react'
import { AspectResizeTool } from '@/components/AspectResizeTool'

export interface Tool {
  id: string
  name: string
  description: string
  component: ComponentType
}

export const TOOLS: Tool[] = [
  {
    id: 'aspect-resize',
    name: 'Aspect Ratio Resize',
    description: 'Crop, pad, or stretch an image to a chosen aspect ratio.',
    component: AspectResizeTool,
  },
]
