import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent
} from 'react';
import { clampTimeline, zoomScrollLeft } from '../lib/timeline-editing.js';

export function useTimelineViewport(meetingCount: number, storageKey: string, locked = false) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(72);
  const scaleRef = useRef(scale);
  const [viewport, setViewport] = useState({ left: 0, width: 800 });
  const [handTool, setHandTool] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{ x: number; left: number; y: number; top: number } | null>(null);
  const zoomAnchor = useRef<number | null>(null);
  const minScale = Math.min(8, viewport.width / meetingCount);

  const zoomTo = useCallback(
    (next: number, pointerX?: number) => {
      if (locked) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const value = clampTimeline(next, Math.min(8, canvas.clientWidth / meetingCount), 200);
      const anchor = pointerX ?? canvas.clientWidth / 2;
      zoomAnchor.current = zoomScrollLeft(canvas.scrollLeft, anchor, scaleRef.current, value);
      scaleRef.current = value;
      setScale(value);
    },
    [meetingCount, locked]
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && zoomAnchor.current !== null) {
      canvas.scrollLeft = zoomAnchor.current;
      zoomAnchor.current = null;
      setViewport({ left: canvas.scrollLeft, width: canvas.clientWidth });
    }
  }, [scale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      if (stored && typeof stored === 'object') {
        const value = clampTimeline(
          Number(stored.scale) || 72,
          Math.min(8, canvas.clientWidth / meetingCount),
          200
        );
        scaleRef.current = value;
        setScale(value);
        zoomAnchor.current = Number(stored.left) || 0;
      }
    } catch {
      /* A missing viewport preference does not affect the plan. */
    }
    const update = () => {
      setViewport({ left: canvas.scrollLeft, width: canvas.clientWidth });
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ left: canvas.scrollLeft, scale: scaleRef.current })
        );
      } catch {
        /* Storage can be unavailable in private browsing. */
      }
    };
    const resize = new ResizeObserver(update);
    resize.observe(canvas);
    canvas.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      resize.disconnect();
      canvas.removeEventListener('scroll', update);
    };
  }, [storageKey, meetingCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        event.preventDefault();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
        zoomTo(
          scaleRef.current * Math.exp(-delta * 0.008),
          event.clientX - canvas.getBoundingClientRect().left
        );
      } else if (event.shiftKey && !event.deltaX) {
        event.preventDefault();
        canvas.scrollLeft += event.deltaY;
      }
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  }, [zoomTo]);

  useEffect(() => {
    const release = () => {
      setSpaceHeld(false);
      setPanning(false);
      panRef.current = null;
    };
    window.addEventListener('blur', release);
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keyup', keyup);
    return () => {
      window.removeEventListener('blur', release);
      window.removeEventListener('keyup', keyup);
    };
  }, []);

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (!(handTool || spaceHeld || event.button === 1) || event.button === 2) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    canvas.setPointerCapture(event.pointerId);
    panRef.current = {
      x: event.clientX,
      left: canvas.scrollLeft,
      y: event.clientY,
      top: canvas.scrollTop
    };
    setPanning(true);
  };
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    if (!panRef.current || !canvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    canvasRef.current.scrollLeft = panRef.current.left + panRef.current.x - event.clientX;
    canvasRef.current.scrollTop = panRef.current.top + panRef.current.y - event.clientY;
  };
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    event.stopPropagation();
    panRef.current = null;
    setPanning(false);
  };

  return {
    canvasRef,
    scale,
    zoomTo,
    minScale,
    viewport,
    handTool,
    setHandTool,
    spaceHeld,
    setSpaceHeld,
    panning,
    panHandlers: {
      onPointerDownCapture: startPan,
      onPointerMoveCapture: movePan,
      onPointerUpCapture: endPan,
      onPointerCancelCapture: endPan
    }
  };
}
