/**
 * Lazy, cached loader for Verovio (LGPL-3.0). Verovio must stay an unmodified, separately loaded
 * module: only reach it through the dynamic `import()`s below, never with a static import, so the
 * bundler emits it as its own chunk and the main bundle never contains it.
 *
 * The WASM module is expensive to start (several MB); it is created once and shared. Toolkits are
 * cheap and hold their own loaded document, so each user (MusicXML import, sheet rendering in M6)
 * creates its own with `createVerovioToolkit()` and calls `destroy()` when done.
 */
import type { VerovioToolkit } from 'verovio/esm';

export type { VerovioToolkit };

type VerovioModuleInstance = ConstructorParameters<typeof VerovioToolkit>[0];

let modulePromise: Promise<{ module: VerovioModuleInstance; Toolkit: typeof VerovioToolkit }> | null = null;

function loadModule(): Promise<{ module: VerovioModuleInstance; Toolkit: typeof VerovioToolkit }> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const [wasm, esm] = await Promise.all([import('verovio/wasm'), import('verovio/esm')]);
      const module = await wasm.default();
      return { module, Toolkit: esm.VerovioToolkit };
    })();
    // A failed load (e.g. offline before the chunk was cached) must not poison later attempts.
    modulePromise.catch(() => {
      modulePromise = null;
    });
  }
  return modulePromise;
}

/** Create a new Verovio toolkit. Loads the WASM module on first use. Call `destroy()` when done. */
export async function createVerovioToolkit(): Promise<VerovioToolkit> {
  const { module, Toolkit } = await loadModule();
  return new Toolkit(module);
}

/** Run `fn` with a fresh toolkit and always destroy it afterwards. */
export async function withVerovio<T>(fn: (tk: VerovioToolkit) => T | Promise<T>): Promise<T> {
  const tk = await createVerovioToolkit();
  try {
    return await fn(tk);
  } finally {
    tk.destroy();
  }
}

/** Decode the base64 string returned by `renderToMIDI()`. Works in browsers, workers and Node. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
