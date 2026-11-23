# React + TypeScript + Vite

## Universal Base64

Open `#/base64` to encode any file or typed/pasted UTF-8 text as plain Base64, or reconstruct bytes from
standard Base64, Base64URL, or a Base64 data URL. MIME types and extensions are
not prerequisites. ASCII whitespace and omitted final padding are accepted;
invalid characters, mixed alphabets, malformed padding, and nonzero trailing
bits are rejected. Raw Base64 cannot recover the original filename.

Both modes accept clipboard files with Ctrl+V / Cmd+V when the browser exposes
them (including copied images). The first file replaces the current input and
clears the previous result; conversion still requires the action button.
Ordinary text pasting remains available in the text field. File pasting is
ignored while a conversion is running, and pasted files use the same size limits
as uploaded files. Clear a selected file to switch back to text input.

Conversion runs in a cancellable worker, in chunks, with no uploads or remote
viewers. Binary inputs/decoded outputs are limited to 64 MiB, encoded text files
to 96 MiB, pasted input/copy to 4 MiB, and displayed text to 65,536 characters.
Large results remain fully downloadable rather than being inserted into the page.

Detection uses `file-type` and conservative text heuristics; it is not file
validation. Unknown files download as `decoded.bin`. Detection and preview
failures never discard successfully decoded bytes. Native images/audio/video
are previewed when the browser supports their actual format/codec. Image
previews are limited to 8 MiB and 16 megapixels. Text/HTML/XML/Markdown are
escaped source previews, not executable documents. PDFs are detected and
downloadable but deliberately never previewed.
SVG previews are rasterized in browser image mode before display. Active
HTML/XML/SVG downloads use a binary attachment MIME type, retaining the detected
extension and original bytes, so their blob URLs do not execute in the app origin.
Worker operations have a 30-second timeout; SVG loading has a 10-second timeout.

ZIP listing and stored/DEFLATE entry extraction use `fflate`: 16 MiB compressed,
1,000 entries, 8 MiB expanded per selected file, and CRC-32 verification.
Encrypted, split, and ZIP64 extraction are unsupported. Nested archives are
not expanded automatically. Unencrypted DOCX/XLSX/PPTX support bounded
text/cell-content previews, not original layout: 2 MiB total XML, 24 parts,
1,000 paragraphs per part, 200 rows and 30 columns per sheet, 2,000 total cells,
and 65,536 characters of cell/text content. Spreadsheet formulas/macros are never
executed; dates and cached formula results remain stored values. Unsupported formats still download
unchanged. No AI model assets are needed for this tool.
Third-party notices are in [base64.txt](public/licenses/base64.txt).

## Local image AI tools

- **Watermark Removal** (`#/watermark-removal`): FODUU reconstruction, 1-5
  passes, PNG output with the original aspect ratio within 256 x 256. Weights
  use FP16 storage (about 63 MB); computation and inputs/outputs remain FP32 for
  WebGPU and CPU/WASM compatibility. Reduced precision can slightly change results;
  it reduces download/storage size, not necessarily runtime memory usage.
- **Image Upscaling** (`#/image-upscaling`): Swin2SR at 2x, 3x, or 4x.
  3x uses two 2x passes then downsampling; 4x uses two 2x passes.

Both tools process images locally in a worker. Models are downloaded only after
the user requests them, checked against SHA-256, and saved in browser OPFS when
available. They can be unloaded or deleted independently. Select WebGPU for
acceleration or CPU/WASM for slower execution. Transparency is flattened onto
white. Upscaling has a 4-megapixel intermediate-image safety limit; input images
are limited to 16 megapixels. These models infer detail and may introduce artifacts.
The model cache alone does not guarantee that the app can be reopened offline.
Choose an image by upload, drag-and-drop, or clipboard paste (Ctrl+V / Cmd+V).
Pasting another image replaces the selection while the tool is idle.

### Preparing assets

Use Node 24 and Python 3.14. For a fresh checkout:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/image-models-requirements.txt
npm ci
npm run prepare:image-models
npm run dev
```

Preparation downloads pinned source weights into ignored `.data/models/`,
exports and numerically checks the FP16-stored watermark ONNX model if necessary,
and puts content-addressed ONNX files, a manifest, and Apache-2.0 text in
`public/models/`. The export rejects files at or above 100 MiB and single-pass
output errors above 1/255 on fixed test inputs. These generated files are ignored.
A cold setup needs internet and about 180 MB of source-model
downloads plus Python dependencies; browser model downloads total about 117 MB.
`npm run build` also prepares these assets. Do not commit generated models.
The new content hash triggers a fresh browser download rather than reusing old
FP32 weights. "Delete downloaded model" also removes older cached versions.

Licensing and provenance are in [image-models.txt](public/licenses/image-models.txt).
Both publishers declare [Apache-2.0](public/licenses/Apache-2.0.txt); preserve that license and attribution when
redistributing. FODUU supplies limited training-data provenance. Removing
watermarks requires permission to edit the underlying image.

### Deployment

The [Pages workflow](.github/workflows/pages.yml) builds and uploads the complete
static output as an artifact, including models and licenses. Set the repository's
**Settings > Pages > Source** to **GitHub Actions**, then push to `main` or run
the workflow manually. The `/tools/` base path is retained.

The FP16-stored watermark file fits below GitHub's 100 MiB regular Git-file
limit. The old branch-pushing `npm run deploy` path remains disabled; deployment
continues through Actions artifacts. In **Settings > Environments > github-pages**,
allow deployments from `main`. No Python or inference server runs in production.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Credits

- **Speak (Edge AI Studio):** text-to-speech with [Chatterbox](https://huggingface.co/onnx-community/chatterbox-ONNX)
  (Resemble AI, MIT). The built-in voices in `public/voices/` are short clips from
  [VCTK 0.92](https://datashare.ed.ac.uk/handle/10283/3443) (CSTR, University of Edinburgh) and
  [LibriTTS-R](https://www.openslr.org/141/) (Google), both licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); clips were trimmed, joined and loudness-normalised.
  `src/lib/tts/voices.json` records the dataset, speaker and utterance ids of each clip.
