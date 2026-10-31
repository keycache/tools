import type { ComponentType } from 'react'
import { AspectResizeTool } from '@/components/AspectResizeTool'
import { UuidGeneratorTool } from '@/components/UuidGeneratorTool'

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
  {
    id: 'uuid-generator',
    name: 'UUID Generator',
    description: 'Generate UUIDs of all versions (v1, v3, v4, v5, v6, v7) in your browser.',
    component: UuidGeneratorTool,
  },
]
