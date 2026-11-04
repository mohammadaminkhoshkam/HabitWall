import { useEffect, useState } from 'react';
import type { SearchHit } from '../data/repo';
import { getRepo, useApp } from '../state/store';
import type { ScreenProps } from './DashboardApp';

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return text;
  const start = Math.max(0, i - 30);
  return (
    <>
      {start > 0 ? '…' : ''}
      {text.slice(start, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function SearchPalette({ onClose, go, edit }: { onClose: () => void } & Pick<ScreenProps, 'go' | 'edit'>) {
  const i18n = useApp((s) => s.i18n);
  const habits = useApp((s) => s.habits);
  const { t } = i18n;
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => {
      void getRepo()
        .search(q)
        .then((h) => (setHits(h), setSel(0)));
    }, 80);
    return () => clearTimeout(id);
  }, [q]);

  const open = (h: SearchHit) => {
    onClose();
    if (h.kind === 'habit') edit(h.ref);
    else if (h.kind === 'note') go('calendar', h.day ?? undefined);
    else go('inbox');
  };

  const kindLabel = (h: SearchHit) =>
    h.kind === 'habit' ? t('navHabits') : h.kind === 'note' ? `${t('note')} · ${habits.find((x) => x.id === h.ref)?.title ?? ''}` : t('voice');

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal>
        <input
          autoFocus
          dir="auto"
          placeholder={t('searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(hits.length - 1, s + 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
            if (e.key === 'Enter' && hits[sel]) open(hits[sel]);
          }}
        />
        <div className="palette-list" role="listbox">
          {q && !hits.length && <div className="muted" style={{ padding: 14 }}>{t('noResults')}</div>}
          {hits.map((h, i) => (
            <button key={`${h.kind}-${h.ref}-${h.day}-${i}`} className="palette-item" role="option" aria-selected={i === sel} onClick={() => open(h)} onMouseEnter={() => setSel(i)}>
              <span className="kind">{kindLabel(h)}</span>
              <span className="txt" dir="auto">
                {highlight(h.text, q)}
              </span>
              {h.day && <span className="faint num" style={{ fontSize: 12 }}>{i18n.dayLabel(h.day, { day: 'numeric', month: 'short' })}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
