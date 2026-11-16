# React + TypeScript + Vite

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
  `public/voices/voices.json` records the dataset, speaker and utterance ids of each clip.
