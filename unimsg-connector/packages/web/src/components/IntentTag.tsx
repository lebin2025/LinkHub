import { intentColor, toneStyle } from '../utils/format';

export function IntentTag({ intent }: { intent?: string }) {
  const meta = intentColor(intent);
  const label = intent ?? '待分类';
  return (
    <span className="intent-tag" style={toneStyle(meta)}>
      {label}
    </span>
  );
}