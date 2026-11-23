# React + TypeScript + Vite

## Local image AI tools

- **Watermark Removal** (`#/watermark-removal`): FODUU reconstruction, 1-5
  passes, PNG output with the original aspect ratio within 256 x 256.
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
exports and numerically checks the watermark ONNX model if necessary, and puts
content-addressed ONNX files, a manifest, and Apache-2.0 text in
`public/models/`. These generated files are ignored. A cold setup needs internet and about 180 MB of source-model
downloads plus Python dependencies; browser model downloads total about 180 MB.
`npm run build` also prepares these assets. Do not commit generated models.

Licensing and provenance are in [image-models.txt](public/licenses/image-models.txt).
Both publishers declare [Apache-2.0](public/licenses/Apache-2.0.txt); preserve that license and attribution when
redistributing. FODUU supplies limited training-data provenance. Removing
watermarks requires permission to edit the underlying image.

### Deployment

The [Pages workflow](.github/workflows/pages.yml) builds and uploads the complete
static output as an artifact, including models and licenses. Set the repository's
**Settings > Pages > Source** to **GitHub Actions**, then push to `main` or run
the workflow manually. The `/tools/` base path is retained.

The watermark file exceeds GitHub's 100 MiB regular Git-file limit. Consequently,
the old branch-pushing `npm run deploy` path is disabled; do not use Git LFS as
a Pages-serving workaround. No Python or inference server runs in production.

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
