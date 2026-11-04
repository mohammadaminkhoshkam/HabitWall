import '@fontsource-variable/inter';
import './styles/base.css';
import './styles/widget.css';
import './styles/dashboard.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrap } from './bootstrap';
import { currentWindowKind } from './platform';
import { useApp } from './state/store';
import { WidgetApp } from './widget/WidgetApp';

const DashboardApp = lazy(() => import('./dashboard/DashboardApp'));

function Root() {
  const ready = useApp((s) => s.ready);
  const kind = useApp((s) => s.windowKind);
  if (!ready) return null;
  return kind === 'widget' ? (
    <WidgetApp />
  ) : (
    <Suspense fallback={null}>
      <DashboardApp />
    </Suspense>
  );
}

function Fatal({ error }: { error: unknown }) {
  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', color: '#b00', background: '#fff', borderRadius: 12, margin: 10 }}>
      <b>HabitWall could not start</b>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{String(error instanceof Error ? error.stack ?? error.message : error)}</pre>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
(async () => {
  try {
    const kind = await currentWindowKind();
    await bootstrap(kind);
    root.render(
      <StrictMode>
        <Root />
      </StrictMode>,
    );
  } catch (e) {
    console.error(e);
    root.render(<Fatal error={e} />);
    const { host } = await import('./platform');
    void host.showSelf();
  }
})();
