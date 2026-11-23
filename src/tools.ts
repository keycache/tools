import type { ComponentType } from 'react'
import { AspectResizeTool } from '@/components/AspectResizeTool'
import { UuidGeneratorTool } from '@/components/UuidGeneratorTool'
import { ClockTool } from '@/components/ClockTool'
import { DateMathTool } from '@/components/DateMathTool'
import { ImageCompressionTool } from '@/components/ImageCompressionTool'
import { PdfCompressionTool } from '@/components/PdfCompressionTool'
import { EdgeAiStudioTool } from '@/components/EdgeAiStudioTool'
import { PocketChatTool } from '@/components/PocketChatTool'
import { WatermarkRemovalTool } from '@/components/WatermarkRemovalTool'
import { ImageUpscalingTool } from '@/components/ImageUpscalingTool'

export interface Tool {
  id: string
  name: string
  description: string
  component: ComponentType
  layout?: 'full-height'
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
    id: 'watermark-removal',
    name: 'Watermark Removal',
    description: 'Experimental local AI watermark removal with 1-5 passes. Aspect-ratio-preserving output within 256 x 256.',
    component: WatermarkRemovalTool,
  },
  {
    id: 'image-upscaling',
    name: 'Image Upscaling',
    description: 'Upscale photos by 2x, 3x, or 4x using AI on your device. Preserve aspect ratio and download a PNG.',
    component: ImageUpscalingTool,
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
    description: 'Speech-to-text, image understanding, tool calling and speech synthesis — AI models running fully in your browser, offline once downloaded.',
    component: EdgeAiStudioTool,
  },
  {
    id: 'pocket-chat',
    name: 'Pocket Chat',
    description: 'Chat with a multimodal Gemma model running entirely in your browser, with image and audio input.',
    component: PocketChatTool,
    layout: 'full-height',
  },
]
