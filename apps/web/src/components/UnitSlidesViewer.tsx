import { useEffect, useMemo, useRef, useState } from 'react';

import { buildGoogleSlidesEmbedUrl } from '../lib/googleSlides.js';

export function UnitSlidesViewer({
  url,
  initialSlide = 1,
  currentSlide,
  onSlideChange,
  groupName,
  saveStatus = 'saved',
  compact = false,
  deckTitle = 'Unit Slides'
}: {
  url: string;
  initialSlide?: number;
  currentSlide?: number;
  onSlideChange?: (slide: number) => void;
  groupName?: string;
  saveStatus?: 'saved' | 'saving' | 'error' | 'loading';
  compact?: boolean;
  deckTitle?: string;
}) {
  const [localSlide, setLocalSlide] = useState(Math.max(1, initialSlide));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [frameLoading, setFrameLoading] = useState(true);
  const viewerRef = useRef<HTMLElement>(null);
  const slide = currentSlide ?? localSlide;
  const embedUrl = useMemo(() => buildGoogleSlidesEmbedUrl(url, slide), [slide, url]);

  useEffect(() => {
    if (currentSlide === undefined) setLocalSlide(Math.max(1, initialSlide));
  }, [currentSlide, initialSlide, url]);

  useEffect(() => {
    const update = () => setIsFullscreen(document.fullscreenElement === viewerRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const changeSlide = (next: number) => {
    const safeNext = Math.max(1, Math.trunc(next));
    setFrameLoading(true);
    if (currentSlide === undefined) setLocalSlide(safeNext);
    onSlideChange?.(safeNext);
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await viewerRef.current?.requestFullscreen();
  };

  if (!embedUrl) return null;

  return (
    <section
      className={`unit-slides-viewer${compact ? ' is-compact' : ''}`}
      ref={viewerRef}
      aria-label={deckTitle}
    >
      <header className="unit-slides-header">
        <div>
          <span className="unit-slides-mark" aria-hidden="true">
            ▰
          </span>
          <div>
            <p className="eyebrow">{deckTitle}</p>
            <strong>{groupName ? `${groupName} · Slide ${slide}` : `Slide ${slide}`}</strong>
          </div>
        </div>
        <button
          className="unit-slides-fullscreen"
          type="button"
          onClick={() => void toggleFullscreen()}
        >
          {isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </header>
      <div className="unit-slides-stage">
        {frameLoading ? <span className="unit-slides-loading">Loading slide {slide}…</span> : null}
        <iframe
          key={embedUrl}
          src={embedUrl}
          title={`${deckTitle}, slide ${slide}`}
          allow="fullscreen"
          onLoad={() => setFrameLoading(false)}
          tabIndex={-1}
        />
        <span className="unit-slides-ui-mask" aria-hidden="true" />
      </div>
      <footer className="unit-slides-controls">
        <button type="button" onClick={() => changeSlide(slide - 1)} disabled={slide <= 1}>
          <span aria-hidden="true">←</span> Back
        </button>
        <div aria-live="polite">
          <strong>Slide {slide}</strong>
          {onSlideChange ? (
            <small className={saveStatus === 'error' ? 'is-error' : ''}>
              {saveStatus === 'loading'
                ? 'Loading class position…'
                : saveStatus === 'saving'
                  ? 'Saving position…'
                  : saveStatus === 'error'
                    ? 'Position not saved'
                    : groupName
                      ? `Saved for ${groupName}`
                      : 'Position saved'}
            </small>
          ) : (
            <small>{deckTitle}</small>
          )}
        </div>
        <button type="button" onClick={() => changeSlide(slide + 1)}>
          Forward <span aria-hidden="true">→</span>
        </button>
      </footer>
    </section>
  );
}
