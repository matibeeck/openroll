// @vitest-environment jsdom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import type { Calibration, ManualCalibration } from '../../src/converters/inputs/falling-notes-video';
import { I18nProvider } from '../../src/i18n';
import { CalibrationDialog } from '../../src/ui/CalibrationDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no canvas: the dialog must still render (preview drawing is skipped).
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(auto: Calibration | null, onDone: (v: ManualCalibration) => void, onCancel = () => {}) {
  const frame = { width: 640, height: 360, data: new Uint8ClampedArray(640 * 360 * 4) } as unknown as ImageData;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(
      createElement(I18nProvider, {
        initial: 'en',
        children: createElement(CalibrationDialog, { frame, auto, onDone, onCancel }),
      }),
    );
  });
  return el;
}

function setInput(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

test('calibration dialog starts from the auto result and returns edited values', () => {
  const onDone = vi.fn();
  const auto: Calibration = {
    left: 12, right: 600, top: 290, blackBottom: 330, bottom: 360, low: 28, high: 103, confidence: 0.6, source: 'auto',
  };
  const el = mount(auto, onDone);
  expect(el.querySelector('[data-testid="calibration-dialog"]')).not.toBeNull();
  expect(el.textContent).toContain("We couldn't find the keyboard for sure");
  const [left, right] = [...el.querySelectorAll('input[type="number"]')] as HTMLInputElement[];
  expect(left!.value).toBe('12');
  const [keys, lowest] = [...el.querySelectorAll('select')] as HTMLSelectElement[];
  expect(keys!.value).toBe('76');
  expect(lowest!.value).toBe('28');
  act(() => setInput(right!, '620'));
  act(() => setInput(keys!, '61'));
  act(() => (el.querySelector('[data-testid="calibrate-ok"]') as HTMLButtonElement).click());
  expect(onDone).toHaveBeenCalledWith({ left: 12, right: 620, top: 290, bottom: 360, keys: 61, lowest: 36 });
});

test('calibration dialog without auto result defaults to an 88-key keyboard at the bottom; cancel works', () => {
  const onCancel = vi.fn();
  const el = mount(null, () => {}, onCancel);
  const [keys] = [...el.querySelectorAll('select')] as HTMLSelectElement[];
  expect(keys!.value).toBe('88');
  act(() => (el.querySelectorAll('button')[0] as HTMLButtonElement).click());
  expect(onCancel).toHaveBeenCalled();
});
