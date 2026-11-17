/// <reference lib="webworker" />
/**
 * Falling-notes video analysis off the UI thread: median idle frame + keyboard calibration,
 * then per-frame key tracking on keyboard strips. Pure logic lives in
 * src/converters/inputs/falling-notes-video/detect.ts.
 */
import {
  autoCalibrate,
  calibrationFromManual,
  KeyTracker,
  medianFrame,
  type Calibration,
  type RgbaFrame,
} from '../converters/inputs/falling-notes-video/detect';
import type { FallingNotesRequest, FallingNotesResponse } from '../converters/inputs/falling-notes-video/protocol';

declare const self: DedicatedWorkerGlobalScope;

let idle: RgbaFrame | null = null;
let auto: Calibration | null = null;
let tracker: KeyTracker | null = null;

function post(msg: FallingNotesResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

function handle(req: FallingNotesRequest): void {
  switch (req.type) {
    case 'calibrate': {
      idle = medianFrame(req.frames);
      auto = autoCalibrate(idle);
      const copy = idle.data.slice();
      post({ type: 'calibrated', auto, idle: { width: idle.width, height: idle.height, data: copy } }, [copy.buffer]);
      return;
    }
    case 'start': {
      if (!idle) throw new Error('start before calibrate');
      const cal = req.calibration ?? (req.manual ? calibrationFromManual(idle, req.manual) : auto);
      if (!cal) throw new Error('no keyboard calibration');
      tracker = new KeyTracker(cal, idle, req.detect);
      post({ type: 'started', calibration: cal });
      return;
    }
    case 'frame':
      if (!tracker) throw new Error('frame before start');
      tracker.push(req.t, req.strip, req.yOffset);
      post({ type: 'ack' });
      return;
    case 'finish':
      if (!tracker) throw new Error('finish before start');
      post({ type: 'notes', notes: tracker.finish() });
      tracker = null;
      return;
  }
}

self.onmessage = (ev: MessageEvent<FallingNotesRequest>) => {
  try {
    handle(ev.data);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
