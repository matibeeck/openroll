/**
 * Transkun 2.0 constants (pip `transkun` 2.0.1, `pretrained/2.0.conf`; MIT, © 2021 Yujia Yan).
 * Pure data: no DOM, no onnxruntime, so the main bundle and Node tests can import it.
 */

/** Model input sample rate. */
export const TK_SAMPLE_RATE = 44100;
export const TK_WINDOW = 4096;
export const TK_HOP = 1024;
export const TK_MELS = 229;
/** Hann + 5 learned Gaussian analysis windows. */
export const TK_WINDOWS = 6;
export const TK_F_MIN = 30;
export const TK_F_MAX = 8000;
export const TK_EPS = 1e-5;
/** Model segments: 16 s, one every 8 s (the second half of each overlaps the next). */
export const TK_SEGMENT_SECONDS = 16;
export const TK_SEGMENT_HOP_SECONDS = 8;
/** Interval context width of the backbone (`ctx` [90, T, 256]); the heads read [ctx_a, ctx_b, ctx_a·ctx_b]. */
export const TK_CTX = 256;
export const TK_ATTR = 3 * TK_CTX;

/**
 * Output tracks: index 0 = sustain pedal (CC64), 1 = soft pedal (CC67), 2–89 = MIDI 21–108
 * (`targetMIDIPitch` = [-64, -67, 21..108]).
 */
export const TK_SYMBOLS: readonly number[] = [-64, -67, ...Array.from({ length: 88 }, (_, i) => 21 + i)];
export const TK_TRACKS = TK_SYMBOLS.length;

/**
 * Learned Gaussian windows (`framewiseFeatureExtractor.spectrogramExtractor.winGen`): window i is
 * exp(−½·((n − N·σ(center_i)) / (σ(sigma_i)·N/2))²), n = 0…N−1. Values read from 2.0.pt by
 * scripts/transkun/export_onnx.py (float32 parameters printed exactly).
 */
export const TK_GAUSS_SIGMA_LOGITS = [
  -1.1706887483596802, -0.8110867142677307, 0.6248952746391296, -0.6810300946235657, -1.212547779083252,
];
export const TK_GAUSS_CENTER_LOGITS = [
  -0.6510074734687805, -0.2153073400259018, -0.031593162566423416, 0.3345024585723877, 0.9446282386779785,
];

/** Files under public/models/transkun/ (fetched by scripts/fetch-transkun.mjs, never committed). */
export const TK_MODEL_FILES = { main: 'transkun.onnx', heads: 'transkun-heads.onnx' } as const;

/**
 * Bytes the high-precision mode downloads once (model files + onnxruntime-web's WebAssembly), for
 * the UI. Checked against the real files by tests/unit/transkun-frontend.test.ts when they exist.
 */
export const TK_DOWNLOAD_BYTES = {
  main: 53_391_226,
  heads: 3_422_740,
  /** onnxruntime-web 1.31.1 `ort-wasm-simd-threaded.asyncify.wasm`. */
  wasm: 28_747_738,
};
