import { toCanvas } from 'html-to-image';

// Keep feedback UI and fields containing private information out of the cloned page.
export const feedbackScreenshotExcluded =
  '.feedback-dialog,.hobie-helper,[data-feedback-selection],input,textarea,select,' +
  '[contenteditable]:not([contenteditable="false"]),[data-feedback-private],' +
  '[data-student-sensitive],.sidebar-account,.sidebar-account-row,.admin-sidebar-account';

export function includeInFeedbackScreenshot(node: Node): boolean {
  return !(node instanceof Element && node.matches(feedbackScreenshotExcluded));
}

export async function captureFeedbackScreenshot(): Promise<string> {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const canvas = await Promise.race([
      toCanvas(document.body, {
        width,
        height,
        canvasWidth: width,
        canvasHeight: height,
        pixelRatio: Math.min(1, 2000 / Math.max(width, height)),
        skipFonts: true,
        backgroundColor: '#f7f7f5',
        // Margins offset scrolled content while keeping fixed toolbars in the viewport.
        style: {
          marginTop: `${-scrollY}px`,
          marginLeft: `${-scrollX}px`
        },
        filter: includeInFeedbackScreenshot
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Screenshot capture timed out.')), 8000);
      })
    ]);
    const image = canvas.toDataURL('image/png');
    if (image.length > 7_000_000) throw new Error('Screenshot is too large.');
    return image;
  } finally {
    clearTimeout(timeout);
  }
}
