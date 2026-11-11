import { afterEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import {
  captureFeedbackScreenshot,
  feedbackScreenshotExcluded,
  includeInFeedbackScreenshot
} from './feedbackScreenshot.js';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function page() {
  const body = {};
  vi.stubGlobal('document', { body });
  vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 900, scrollX: 0, scrollY: 640 });
  return body;
}

describe('automatic feedback screenshot', () => {
  it('captures the current viewport and returns an attachment without an image editor step', async () => {
    const body = page();
    const toDataURL = vi.fn().mockReturnValue('data:image/png;base64,c2NyZWVuc2hvdA==');
    vi.mocked(toCanvas).mockResolvedValue({ toDataURL } as unknown as HTMLCanvasElement);
    await expect(captureFeedbackScreenshot()).resolves.toBe(
      'data:image/png;base64,c2NyZWVuc2hvdA=='
    );
    expect(toCanvas).toHaveBeenCalledWith(
      body,
      expect.objectContaining({
        width: 1440,
        height: 900,
        pixelRatio: 1,
        style: { marginTop: '-640px', marginLeft: '0px' },
        filter: includeInFeedbackScreenshot
      })
    );
    expect(toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('limits high-resolution screenshots before encoding', async () => {
    page();
    vi.stubGlobal('window', { innerWidth: 4000, innerHeight: 2000, scrollX: 0, scrollY: 0 });
    vi.mocked(toCanvas).mockResolvedValue({
      toDataURL: () => 'data:image/png;base64,YQ=='
    } as HTMLCanvasElement);
    await captureFeedbackScreenshot();
    expect(toCanvas).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pixelRatio: 0.5 })
    );
  });

  it('excludes private fields and the feedback dialog without changing the live page', () => {
    class TestElement {
      constructor(private excluded: boolean) {}
      matches(selector: string) {
        expect(selector).toBe(feedbackScreenshotExcluded);
        return this.excluded;
      }
    }
    vi.stubGlobal('Element', TestElement);
    expect(includeInFeedbackScreenshot(new TestElement(true) as unknown as Node)).toBe(false);
    expect(includeInFeedbackScreenshot(new TestElement(false) as unknown as Node)).toBe(true);
    expect(includeInFeedbackScreenshot({ nodeType: 3 } as Node)).toBe(true);
    for (const selector of [
      '.feedback-dialog',
      '[data-feedback-private]',
      '[data-student-sensitive]',
      'input',
      'textarea',
      'select',
      '[contenteditable]',
      '.sidebar-account'
    ])
      expect(feedbackScreenshotExcluded).toContain(selector);
  });

  it('rejects failed and oversized captures so written feedback can continue', async () => {
    page();
    vi.mocked(toCanvas).mockRejectedValueOnce(new Error('Network error'));
    await expect(captureFeedbackScreenshot()).rejects.toThrow('Network error');
    vi.mocked(toCanvas).mockResolvedValue({
      toDataURL: () => 'x'.repeat(7_000_001)
    } as HTMLCanvasElement);
    await expect(captureFeedbackScreenshot()).rejects.toThrow('too large');
  });

  it('times out a stalled renderer and clears its timeout after success', async () => {
    page();
    vi.useFakeTimers();
    vi.mocked(toCanvas).mockReturnValue(new Promise(() => {}));
    const result = expect(captureFeedbackScreenshot()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(8000);
    await result;
    vi.mocked(toCanvas).mockResolvedValue({
      toDataURL: () => 'data:image/png;base64,YQ=='
    } as HTMLCanvasElement);
    await captureFeedbackScreenshot();
    expect(vi.getTimerCount()).toBe(0);
  });
});
