import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type MenuItem =
  | { kind?: 'item'; label: string; onSelect: () => void; checked?: boolean; danger?: boolean; icon?: ReactNode }
  | { kind: 'sep' }
  | { kind: 'label'; label: string }
  | { kind: 'sub'; label: string; items: MenuItem[] };

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Context/dropdown menu, clamped inside the (small) widget window, keyboard navigable. */
export function Menu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [sub, setSub] = useState<{ items: MenuItem[]; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
    (el.querySelector('button') as HTMLButtonElement | null)?.focus();
  }, [x, y, sub]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const btns = [...(ref.current?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
    };
    const t = setTimeout(() => window.addEventListener('pointerdown', onDown), 0);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const list = sub?.items ?? items;
  return (
    <div className="menu" role="menu" ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {sub && (
        <>
          <button role="menuitem" onClick={() => setSub(null)}>
            ‹ …
          </button>
          <div className="sep" />
        </>
      )}
      {list.map((it, i) => {
        if (it.kind === 'sep') return <div key={i} className="sep" />;
        if (it.kind === 'label') return <div key={i} className="menu-label">{it.label}</div>;
        if (it.kind === 'sub')
          return (
            <button key={i} role="menuitem" onClick={(e) => setSub({ items: it.items, y: e.currentTarget.getBoundingClientRect().top })}>
              {it.label}
              <span style={{ marginInlineStart: 'auto', opacity: 0.5 }}>›</span>
            </button>
          );
        return (
          <button
            key={i}
            role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={it.checked}
            className={it.danger ? 'danger' : undefined}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
