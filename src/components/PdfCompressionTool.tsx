import { useState, useRef, useEffect } from 'react'
import { Upload, Download, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  compressPdf,
  estimatePdfSize,
  formatBytes,
  calculateCompressionRatio,
  type PDFCompressionFormat,
} from '@/lib/pdfCompression'

export function PdfCompressionTool() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [originalSize, setOriginalSize] = useState<number>(0)
  const [compressedSize, setCompressedSize] = useState<number>(0)
  const [format, setFormat] = useState<PDFCompressionFormat>('jpeg')
  const [quality, setQuality] = useState(75)
  const [isCompressing, setIsCompressing] = useState(false)
  const [compressedBlob, setCompressedBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string>('')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Estimate size when quality or format changes
  useEffect(() => {
    if (!selectedFile) {
      setCompressedSize(0)
      return
    }

    const estimateSize = async () => {
      try {
        const buffer = await selectedFile.arrayBuffer()
        const estimated = await estimatePdfSize(buffer, quality, format)
        setCompressedSize(estimated)
      } catch (err) {
        console.error('Failed to estimate size:', err)
      }
    }

    const debounceTimer = setTimeout(estimateSize, 300)
    return () => clearTimeout(debounceTimer)
  }, [selectedFile, quality, format])

  const handleFileSelect = (file: File) => {
    if (!file.type.includes('pdf')) {
      setError('Please select a PDF file')
      return
    }

    setSelectedFile(file)
    setOriginalSize(file.size)
    setCompressedBlob(null)
    setError('')
    setProgress({ current: 0, total: 0 })
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileSelect(files[0])
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files
    if (files && files.length > 0) {
      handleFileSelect(files[0])
    }
  }

  const handleCompress = async () => {
    if (!selectedFile) return

    setIsCompressing(true)
    setError('')

    try {
      const buffer = await selectedFile.arrayBuffer()
      const blob = await compressPdf(buffer, {
        quality,
        format,
        onProgress: (current, total) => {
          setProgress({ current, total })
        },
      })

      setCompressedBlob(blob)
      setCompressedSize(blob.size)
    } catch (err) {
      setError(`Compression failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      setCompressedBlob(null)
    } finally {
      setIsCompressing(false)
      setProgress({ current: 0, total: 0 })
    }
  }

  const handleDownload = () => {
    if (!compressedBlob || !selectedFile) return

    const url = URL.createObjectURL(compressedBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${selectedFile.name.replace('.pdf', '')}-compressed.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    setSelectedFile(null)
    setOriginalSize(0)
    setCompressedSize(0)
    setCompressedBlob(null)
    setError('')
    setProgress({ current: 0, total: 0 })
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const ratio = calculateCompressionRatio(originalSize, compressedSize)

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      {/* File Upload Area */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center transition hover:border-gray-400 dark:border-gray-600 dark:bg-gray-900"
      >
        <Upload className="mx-auto mb-2 h-8 w-8 text-gray-400" />
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          {selectedFile ? `📄 ${selectedFile.name}` : 'Drag and drop PDF here or'}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isCompressing}
        >
          Browse Files
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileInputChange}
          className="hidden"
        />
      </div>

      {selectedFile && (
        <>
          {/* Format Selection */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Output Format
            </label>
            <div className="flex gap-2">
              {(['jpeg', 'png', 'webp'] as const).map((fmt) => (
                <Button
                  key={fmt}
                  variant={format === fmt ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFormat(fmt)}
                  disabled={isCompressing}
                >
                  {fmt.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>

          {/* Quality Slider */}
          <div className="space-y-2">
            <label className="flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300">
              Quality: {quality}%
            </label>
            <input
              type="range"
              min="1"
              max="100"
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              disabled={isCompressing}
              className="h-2 w-full cursor-pointer rounded-lg bg-gray-200 dark:bg-gray-700"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Lower quality = smaller file size
            </p>
          </div>

          {/* Size Information */}
          <div className="space-y-2 rounded-lg bg-gray-50 p-4 dark:bg-gray-900">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Original:</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {formatBytes(originalSize)}
              </span>
            </div>
            {compressedSize > 0 && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Compressed:</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {formatBytes(compressedSize)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Reduction:</span>
                  <span className="font-medium text-green-600 dark:text-green-400">
                    {ratio}% smaller
                  </span>
                </div>
              </>
            )}
            {isCompressing && progress.total > 0 && (
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Processing page {progress.current} of {progress.total}...
              </div>
            )}
          </div>

          {/* Error Message */}
          {error && <div className="rounded bg-red-100 p-3 text-sm text-red-800 dark:bg-red-900 dark:text-red-200">{error}</div>}

          {/* Buttons */}
          <div className="flex gap-2">
            {!compressedBlob ? (
              <>
                <Button
                  onClick={handleCompress}
                  disabled={isCompressing || !selectedFile}
                  className="flex-1"
                >
                  {isCompressing ? 'Compressing...' : 'Compress'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={isCompressing}
                  size="icon"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button onClick={handleDownload} className="flex-1" variant="default">
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  size="icon"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>

          {/* Disclaimer */}
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-900 dark:bg-yellow-950">
            <p className="text-xs text-yellow-800 dark:text-yellow-200">
              ⚠️ <strong>Note:</strong> This tool converts PDF pages to images at the selected quality
              level, then reassembles them into a PDF. This is a lossy process and may result in
              reduced text sharpness or image quality compared to the original PDF.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
