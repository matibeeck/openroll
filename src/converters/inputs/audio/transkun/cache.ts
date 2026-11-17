/**
 * Where the high-precision model lives and whether it is already on this device. Tiny and free of
 * onnxruntime, so the mode question can show "downloaded" vs the download size.
 */
import { TK_DOWNLOAD_BYTES, TK_MODEL_FILES } from './constants';

export const TRANSKUN_TOTAL_BYTES = TK_DOWNLOAD_BYTES.main + TK_DOWNLOAD_BYTES.heads + TK_DOWNLOAD_BYTES.wasm;
export const TRANSKUN_TOTAL_MB = Math.round(TRANSKUN_TOTAL_BYTES / 1e6);

/** Absolute URL of public/models/transkun/ (same origin as the app). */
export function transkunModelBase(): string {
  const base = typeof document !== 'undefined' ? document.baseURI : self.location.href;
  return new URL(`${import.meta.env.BASE_URL}models/transkun/`, base).href;
}

/** Whether the service worker has already cached the model (its first use downloaded it). Never throws. */
export async function isTranskunCached(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    return !!(await caches.match(new URL(TK_MODEL_FILES.main, transkunModelBase()).href));
  } catch {
    return false;
  }
}
