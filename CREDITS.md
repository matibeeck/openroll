# Credits

## Libraries
- [@tonejs/midi](https://github.com/Tonejs/Midi) — MIT
- [Tone.js](https://github.com/Tonejs/Tone.js) — MIT
- [Verovio](https://www.verovio.org) — LGPL-3.0, loaded unmodified as a separate module
- [Basic Pitch](https://github.com/spotify/basic-pitch-ts) by Spotify — Apache-2.0 (code and model)
- [TensorFlow.js](https://github.com/tensorflow/tfjs) — Apache-2.0
- [React](https://react.dev) — MIT
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (`onnxruntime-web`) by Microsoft — MIT (its WebAssembly is served from the app's own origin)
- [Transkun](https://github.com/Yujia-Yan/Transkun) by Yujia Yan — MIT. The mel front end, semi-CRF Viterbi decode and segment stitching in `src/converters/inputs/audio/transkun/` are written from its Python source (`transkun` 2.0.1)

## Assets
- Salamander Grand Piano samples by Alexander Holm — CC-BY 3.0 (subset served locally from `public/samples/salamander/`, see its README.md); https://archive.org/details/SalamanderGrandPianoV3
- Basic Pitch model weights (`public/models/basic-pitch/`, copied from the `@spotify/basic-pitch` npm package by `scripts/copy-models.mjs`) © Spotify AB — Apache-2.0. Bittner et al., "A Lightweight Instrument-Agnostic Model for Polyphonic Note Transcription and Multipitch Estimation", ICASSP 2022.
- Transkun model weights (`public/models/transkun/`, downloaded by `scripts/fetch-transkun.mjs`, never committed) © 2021 Yujia Yan — MIT. Yan, Cwitkowitz, Duan, "Skipping the Frame-Level: Event-Based Piano Transcription with Neural Semi-CRFs", NeurIPS 2021. ONNX export from [huggingface.co/TuesdayCrowd/transkun-onnx](https://huggingface.co/TuesdayCrowd/transkun-onnx) (MIT), checked against our own export of the pip weights (`scripts/transkun/export_onnx.py`, adapted from that repo's MIT export scripts).
- `tests/fixtures/transkun/ref3b_*`, `ref3c_*`: trimmed reference tensors from the same Hugging Face repository (MIT), made by `scripts/transkun/make-fixtures.mjs`.
