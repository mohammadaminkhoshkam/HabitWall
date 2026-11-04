import { useEffect } from 'react';
import { dismissToast, useApp } from '../state/store';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const t = useApp((s) => s.i18n.t);

  // Ctrl+Z undoes the most recent undoable action.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea')) return;
      const last = [...useApp.getState().toasts].reverse().find((x) => x.undo);
      if (last?.undo) {
        e.preventDefault();
        dismissToast(last.id);
        void last.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.tone === 'error' ? 'error' : ''}`}>
          <span>{x.text}</span>
          {x.undo && (
            <button
              onClick={() => {
                dismissToast(x.id);
                void x.undo!();
              }}
            >
              {t('undo')}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
