import { useState, useRef, useEffect } from 'react'
import { Upload, Download, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { compressImage, formatBytes, type ImageFormat } from '@/lib/imageCompression'

export function ImageCompressionTool() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [format, setFormat] = useState<ImageFormat>('jpeg')
  const [quality, setQuality] = useState(75)
  const [compressedBlob, setCompressedBlob] = useState<Blob | null>(null)
  const [isCompressing, setIsCompressing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  // Compress image whenever settings change
  useEffect(() => {
    if (!originalFile) return

    const compress = async () => {
      setIsCompressing(true)
      setError(null)
      try {
        const result = await compressImage(originalFile, {
          format,
          quality,
        })
        setCompressedBlob(result.blob)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Compression failed')
      } finally {
        setIsCompressing(false)
      }
    }

    compress()
  }, [originalFile, format, quality])

  const handleFileSelect = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file')
      return
    }

    setOriginalFile(file)
    setError(null)

    // Create preview
    const reader = new FileReader()
    reader.onload = (e) => {
      setPreview(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0]
    if (file) handleFileSelect(file)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileSelect(file)
  }

  const handleDownload = () => {
    if (!compressedBlob || !originalFile) return

    const url = URL.createObjectURL(compressedBlob)
    const link = document.createElement('a')
    const fileName = originalFile.name.replace(/\.[^/.]+$/, '')
    link.href = url
    link.download = `${fileName}-compressed.${format}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    setOriginalFile(null)
    setCompressedBlob(null)
    setPreview(null)
    setError(null)
    setQuality(75)
    setFormat('jpeg')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const compressionRatio =
    originalFile && compressedBlob
      ? Math.round(((originalFile.size - compressedBlob.size) / originalFile.size) * 100)
      : 0

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground">
        <p>
          <strong>Compress images with quality control.</strong> Upload an image, adjust quality
          settings, and see the file size update in real-time. Download your compressed image when
          ready.
        </p>
      </div>

      {/* Upload Area */}
      {!originalFile ? (
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-8 text-center space-y-4 cursor-pointer hover:border-muted-foreground/50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-12 mx-auto text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">Drag and drop an image here</p>
            <p className="text-sm text-muted-foreground">or click to browse</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileInputChange}
            className="hidden"
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Preview */}
          {preview && (
            <div className="border rounded-lg overflow-hidden bg-muted">
              <img src={preview} alt="Preview" className="w-full max-h-96 object-contain" />
            </div>
          )}

          {/* Format Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Output Format</label>
            <div className="flex gap-3">
              {(['jpeg', 'png', 'webp'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setFormat(fmt)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    format === fmt
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground hover:bg-muted/80'
                  }`}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Quality Slider */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">Quality</label>
              <span className="text-sm font-semibold text-primary">{quality}%</span>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Low (more compression)</span>
              <span>High (less compression)</span>
            </div>
          </div>

          {/* Size Comparison */}
          {compressedBlob && (
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Original Size</p>
                  <p className="text-lg font-bold text-foreground">{formatBytes(originalFile.size)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Compressed Size</p>
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-200">
                    {formatBytes(compressedBlob.size)}
                  </p>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 rounded p-2 text-center">
                <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                  {compressionRatio}% smaller
                </p>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm text-red-700 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              onClick={handleDownload}
              disabled={!compressedBlob || isCompressing}
              className="flex-1 gap-2"
            >
              <Download className="size-4" />
              Download
            </Button>
            <Button onClick={handleReset} variant="outline" className="gap-2">
              <RotateCcw className="size-4" />
              Reset
            </Button>
          </div>

          {isCompressing && (
            <p className="text-xs text-muted-foreground text-center">Compressing image...</p>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <div className="text-xs text-muted-foreground bg-muted p-3 rounded">
        <p>
          <strong>Note:</strong> All compression happens in your browser. No images are uploaded to
          any server. The tool converts images through JPEG as an intermediate step to maximize
          compression efficiency.
        </p>
      </div>
    </div>
  )
}
