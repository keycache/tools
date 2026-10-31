import { useState } from 'react'
import { Copy, RotateCw } from 'lucide-react'
import { v1, v3, v4, v5, v6, v7 } from 'uuid'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

// Generate a random MAC address for v1 UUID generation
function generateRandomMac(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(6))
  // Set multicast bit (bit 0 of first octet) to indicate it's not a real MAC
  randomBytes[0] |= 0x01
  return Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join(':')
}

interface UuidVersion {
  version: number
  label: string
  description: string
  disclaimer: string
  generate: () => string
}

export function UuidGeneratorTool() {
  const [generatedIds, setGeneratedIds] = useState<Record<number, string>>({
    1: v1(),
    3: v3('example.com', NAMESPACE_DNS),
    4: v4(),
    5: v5('example.com', NAMESPACE_DNS),
    6: v6(),
    7: v7(),
  })

  const [copiedId, setCopiedId] = useState<number | null>(null)

  const versions: UuidVersion[] = [
    {
      version: 1,
      label: 'Version 1 (Time-based)',
      description: 'Time-based UUID using timestamp and random MAC address',
      disclaimer:
        'Browsers cannot access real MAC addresses. This implementation generates a random node ID (with multicast bit set) for each generation.',
      generate: () => v1({ node: new Uint8Array(generateRandomMac().split(':').map((x) => parseInt(x, 16))) }),
    },
    {
      version: 3,
      label: 'Version 3 (MD5 Name-based)',
      description: 'MD5 hash-based UUID derived from namespace and name',
      disclaimer:
        'Deterministic: same namespace + name always produces same UUID. Uses fixed example.com input; change it to generate different IDs.',
      generate: () => v3('example.com', NAMESPACE_DNS),
    },
    {
      version: 4,
      label: 'Version 4 (Random)',
      description: 'Cryptographically random UUID using crypto.getRandomValues()',
      disclaimer: 'Lowest collision risk; recommended for most use cases. Supported natively in all modern browsers.',
      generate: () => v4(),
    },
    {
      version: 5,
      label: 'Version 5 (SHA-1 Name-based)',
      description: 'SHA-1 hash-based UUID derived from namespace and name',
      disclaimer:
        'Deterministic: same namespace + name always produces same UUID. Uses fixed example.com input; change it to generate different IDs.',
      generate: () => v5('example.com', NAMESPACE_DNS),
    },
    {
      version: 6,
      label: 'Version 6 (Time-based, sortable)',
      description: 'Sortable time-based UUID with improved performance',
      disclaimer: 'Not part of RFC 4122 but standardized in RFC 9562. Useful for databases that benefit from sortable IDs.',
      generate: () => v6(),
    },
    {
      version: 7,
      label: 'Version 7 (Unix Epoch-based)',
      description: 'Modern time-based UUID using Unix timestamp with random component',
      disclaimer: 'Sortable and collision-resistant. RFC 9562 standard; recommended for new high-volume systems.',
      generate: () => v7(),
    },
  ]

  const handleGenerate = (versionNum: number) => {
    const version = versions.find((v) => v.version === versionNum)
    if (version) {
      setGeneratedIds((prev) => ({
        ...prev,
        [versionNum]: version.generate(),
      }))
    }
  }

  const handleCopy = (versionNum: number) => {
    const id = generatedIds[versionNum]
    if (id) {
      navigator.clipboard.writeText(id)
      setCopiedId(versionNum)
      setTimeout(() => setCopiedId(null), 2000)
    }
  }

  return (
    <div className="space-y-8">
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <p className="text-muted-foreground">
          Generate UUIDs of different versions. Each version has different use cases and characteristics. Click generate
          to create a new UUID, or copy to clipboard.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {versions.map((version) => (
          <Card key={version.version} className="p-6 flex flex-col gap-4">
            <div className="space-y-2">
              <h3 className="font-semibold text-base">{version.label}</h3>
              <p className="text-sm text-muted-foreground">{version.description}</p>
              <p className="text-xs text-muted-foreground italic">{version.disclaimer}</p>
            </div>

            <div className="flex-1" />

            <div className="space-y-3">
              <div className="bg-secondary p-3 rounded-md font-mono text-xs break-all">
                {generatedIds[version.version]}
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleGenerate(version.version)}
                  className="flex-1 gap-2"
                >
                  <RotateCw className="size-4" />
                  Generate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(version.version)}
                  className="flex-1 gap-2"
                >
                  <Copy className="size-4" />
                  {copiedId === version.version ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="border-t pt-6">
        <h3 className="font-semibold mb-3">About UUID Versions</h3>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong>Version 1 & 6:</strong> Time-based identifiers. Version 6 is more modern and sortable.
          </p>
          <p>
            <strong>Version 3 & 5:</strong> Name-based identifiers. Deterministic for the same input. Version 5 (SHA-1)
            is preferred over version 3 (MD5).
          </p>
          <p>
            <strong>Version 4:</strong> Randomly generated. Has the lowest collision risk and no privacy concerns.
          </p>
          <p>
            <strong>Version 7:</strong> Modern standard combining Unix timestamps with random bits. Sortable and
            recommended for new applications.
          </p>
          <p className="text-xs">
            <strong>Note:</strong> Version 2 (DCE Security) is intentionally omitted due to high collision risk and
            security vulnerabilities. Version 8 is reserved for custom implementations.
          </p>
        </div>
      </div>
    </div>
  )
}
