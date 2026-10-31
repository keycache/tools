import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, PDFImage } from 'pdf-lib'

// Set up PDF.js worker 
// Point to the worker that gets bundled by Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

export type PDFCompressionFormat = 'jpeg' | 'png' | 'webp'

interface CompressPdfOptions {
  quality: number
  format: PDFCompressionFormat
  onProgress?: (page: number, total: number) => void
}

export async function compressPdf(
  pdfBuffer: ArrayBuffer,
  options: CompressPdfOptions,
): Promise<Blob> {
  const { quality, format, onProgress } = options

  // Load PDF document
  const pdfDoc = await pdfjsLib.getDocument({ data: pdfBuffer }).promise
  const numPages = pdfDoc.numPages

  // Create new PDF
  const newPdf = await PDFDocument.create()

  // Process each page
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale: 2 }) // 2x scale for better quality

    // Render page to canvas
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height

    const context = canvas.getContext('2d')
    if (!context) throw new Error('Failed to get canvas context')

    const renderTask = page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    })

    await renderTask.promise

    // Compress canvas to target format
    const compressedBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error('Failed to compress page'))
          else resolve(blob)
        },
        format === 'jpeg' ? 'image/jpeg' : format === 'png' ? 'image/png' : 'image/webp',
        quality / 100,
      )
    })

    // Convert blob to bytes for pdf-lib
    const imageBytes = await compressedBlob.arrayBuffer()

    // Embed image in PDF
    let pdfImage: PDFImage
    if (format === 'jpeg') {
      pdfImage = await newPdf.embedJpg(imageBytes as any)
    } else if (format === 'png') {
      pdfImage = await newPdf.embedPng(imageBytes as any)
    } else {
      pdfImage = await newPdf.embedPng(imageBytes as any) // WebP not directly supported, fallback to PNG
    }

    // Add page with image
    const pdfPage = newPdf.addPage([viewport.width, viewport.height])
    pdfPage.drawImage(pdfImage, {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    })

    onProgress?.(pageNum, numPages)
  }

  // Get final PDF bytes
  const pdfBytes = await newPdf.save()
  return new Blob([pdfBytes as any], { type: 'application/pdf' })
}

export async function estimatePdfSize(
  pdfBuffer: ArrayBuffer,
  quality: number,
  format: PDFCompressionFormat,
): Promise<number> {
  // Load PDF document
  const pdfDoc = await pdfjsLib.getDocument({ data: pdfBuffer }).promise
  const numPages = pdfDoc.numPages

  // Sample first page to estimate compression ratio
  const page = await pdfDoc.getPage(1)
  const viewport = page.getViewport({ scale: 2 })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Failed to get canvas context')

  const renderTask = page.render({
    canvasContext: context,
    viewport: viewport,
    canvas: canvas,
  })

  await renderTask.promise

  // Get sample compressed page size
  const sampleSize = await new Promise<number>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Failed to estimate size'))
        else resolve(blob.size)
      },
      format === 'jpeg' ? 'image/jpeg' : format === 'png' ? 'image/png' : 'image/webp',
      quality / 100,
    )
  })

  // Estimate total size by multiplying sample page size by number of pages
  // Add ~5% overhead for PDF structure
  const estimatedSize = sampleSize * numPages * 1.05
  return Math.round(estimatedSize)
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

export function calculateCompressionRatio(original: number, compressed: number): number {
  if (original === 0) return 0
  return Math.round(((original - compressed) / original) * 100)
}
