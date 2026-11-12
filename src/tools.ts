import type { ComponentType } from 'react'
import { AspectResizeTool } from '@/components/AspectResizeTool'
import { UuidGeneratorTool } from '@/components/UuidGeneratorTool'
import { ClockTool } from '@/components/ClockTool'
import { DateMathTool } from '@/components/DateMathTool'
import { ImageCompressionTool } from '@/components/ImageCompressionTool'
import { PdfCompressionTool } from '@/components/PdfCompressionTool'
import { EdgeAiStudioTool } from '@/components/EdgeAiStudioTool'

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
  {
    id: 'clock',
    name: 'Clock',
    description: 'All-in-one clock tool with alarm, stopwatch, timer, and world timezones.',
    component: ClockTool,
  },
  {
    id: 'date-math',
    name: 'DateMath',
    description: 'Calculate date differences, add/subtract days and weekdays.',
    component: DateMathTool,
  },
  {
    id: 'image-compression',
    name: 'Image Compression',
    description: 'Compress images with quality control. Real-time size preview.',
    component: ImageCompressionTool,
  },
  {
    id: 'pdf-compression',
    name: 'PDF Compression',
    description: 'Compress PDFs with quality control. Real-time size preview.',
    component: PdfCompressionTool,
  },
  {
    id: 'edge-ai-studio',
    name: 'Edge AI Studio',
    description: 'Tool calling, speech-to-text and image understanding with tiny AI models running fully in your browser.',
    component: EdgeAiStudioTool,
  },
]
