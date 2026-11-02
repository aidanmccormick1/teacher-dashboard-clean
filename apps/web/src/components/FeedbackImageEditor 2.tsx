import { useEffect, useRef, useState } from 'react';

type Mark = {
  tool: 'rectangle' | 'arrow' | 'redact';
  x: number;
  y: number;
  endX: number;
  endY: number;
};

export async function loadFeedbackImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  if (
    !image.width ||
    !image.height ||
    image.width > 8192 ||
    image.height > 8192 ||
    image.width * image.height > 24_000_000
  ) {
    throw new Error('Choose an image with dimensions below 8192 pixels and 24 megapixels.');
  }
  return image;
}

export async function normalizeFeedbackImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadFeedbackImage(url);
    const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function FeedbackImageEditor({
  source,
  onSave,
  onCancel
}: {
  source: string;
  onSave: (image: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Mark['tool']>('rectangle');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void loadFeedbackImage(source)
      .then(setImage)
      .catch(() => setError('This image could not be opened.'));
  }, [source]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    for (const mark of [...marks, ...(draft ? [draft] : [])]) {
      ctx.lineWidth = Math.max(3, image.width / 450);
      ctx.strokeStyle = '#c52f25';
      if (mark.tool === 'redact') {
        ctx.fillStyle = '#111111';
        ctx.fillRect(mark.x, mark.y, mark.endX - mark.x, mark.endY - mark.y);
      } else if (mark.tool === 'rectangle') {
        ctx.strokeRect(mark.x, mark.y, mark.endX - mark.x, mark.endY - mark.y);
      } else {
        const angle = Math.atan2(mark.endY - mark.y, mark.endX - mark.x);
        const head = Math.max(15, image.width / 65);
        ctx.beginPath();
        ctx.moveTo(mark.x, mark.y);
        ctx.lineTo(mark.endX, mark.endY);
        ctx.moveTo(
          mark.endX - head * Math.cos(angle - Math.PI / 6),
          mark.endY - head * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(mark.endX, mark.endY);
        ctx.lineTo(
          mark.endX - head * Math.cos(angle + Math.PI / 6),
          mark.endY - head * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
      }
    }
  }, [image, marks, draft]);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * event.currentTarget.width) / bounds.width,
      y: ((event.clientY - bounds.top) * event.currentTarget.height) / bounds.height
    };
  };
  return (
    <section className="feedback-image-editor" aria-label="Screenshot editor">
      <p>Review the image. Remove student information with solid redaction before attaching.</p>
      <div className="feedback-actions" aria-label="Drawing tools">
        {(['rectangle', 'arrow', 'redact'] as const).map((value) => (
          <button
            type="button"
            className="secondary"
            aria-pressed={tool === value}
            key={value}
            onClick={() => setTool(value)}
          >
            {value === 'redact' ? 'Solid redaction' : value === 'arrow' ? 'Arrow' : 'Rectangle'}
          </button>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={!marks.length}
          onClick={() => setMarks(marks.slice(0, -1))}
        >
          Undo
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!marks.length}
          onClick={() => setMarks([])}
        >
          Clear annotations
        </button>
      </div>
      <p className="muted">
        Drag on the image to annotate. You can also attach the image without drawing.
      </p>
      {error && <p role="alert">{error}</p>}
      <canvas
        ref={canvasRef}
        aria-label="Screenshot preview; use pointer to draw annotations"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const p = point(event);
          setDraft({ tool, ...p, endX: p.x, endY: p.y });
        }}
        onPointerMove={(event) => {
          if (draft) {
            const p = point(event);
            setDraft({ ...draft, endX: p.x, endY: p.y });
          }
        }}
        onPointerUp={(event) => {
          if (!draft) return;
          const p = point(event);
          setMarks([...marks, { ...draft, endX: p.x, endY: p.y }]);
          setDraft(null);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => setDraft(null)}
      />
      <div className="feedback-actions">
        <button
          type="button"
          disabled={!image}
          onClick={() => {
            const data = canvasRef.current!.toDataURL('image/png');
            if (data.length > 7_000_000) setError('Image is too large. Choose a smaller image.');
            else onSave(data);
          }}
        >
          Attach reviewed image
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel editing
        </button>
      </div>
    </section>
  );
}
