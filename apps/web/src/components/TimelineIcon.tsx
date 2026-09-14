type IconName =
  | 'select'
  | 'hand'
  | 'snap'
  | 'fit'
  | 'minus'
  | 'plus'
  | 'undo'
  | 'redo'
  | 'left'
  | 'right'
  | 'trim-start'
  | 'trim-end'
  | 'grip'
  | 'help';

const paths: Record<IconName, string> = {
  select: 'M5 3v15l4-4 3 6 3-1.5-3-5.5h6Z',
  hand: 'M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v6c0 4-3 7-7 7-3 0-5-2-6-4l-3-5a1.5 1.5 0 0 1 2-2Z',
  snap: 'M5 3v10a7 7 0 0 0 14 0V3h-5v10a2 2 0 0 1-4 0V3ZM5 7h5m4 0h5',
  fit: 'M3 5v14M21 5v14M7 8l-4 4 4 4m10-8 4 4-4 4M4 12h16',
  minus: 'M5 12h14',
  plus: 'M5 12h14M12 5v14',
  undo: 'M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12',
  redo: 'm16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12',
  left: 'm14 5-7 7 7 7',
  right: 'm10 5 7 7-7 7',
  'trim-start': 'M15 3H9v18h6M3 8v8',
  'trim-end': 'M9 3h6v18H9m12-13v8',
  grip: 'M9 6v2m6-2v2M9 11v2m6-2v2M9 16v2m6-2v2',
  help: 'M9 8a3 3 0 1 1 4 3c-1 .5-1 1-1 3m0 3v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'
};

export function TimelineIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="timeline-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
