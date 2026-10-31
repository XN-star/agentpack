import { useCallback, useEffect, useState } from 'react';
import type { ScanResult } from '@agentpack/core';
import ExportTab from './ExportTab';
import ImportTab from './ImportTab';

type Theme = 'light' | 'dark';

function initTheme(): Theme {
  const saved = localStorage.getItem('agentpack-theme');
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export default function App() {
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initTheme);
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; text: string } | null>(
    null,
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('agentpack-theme', theme);
  }, [theme]);

  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      const r = await window.agentpack.scan();
      setScan(r);
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message });
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void runScan();
  }, [runScan]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const addManual = async () => {
    const p = await window.agentpack.chooseManualPath();
    if (!p || !scan) return;
    try {
      const item = await window.agentpack.addManualPath(p);
      setScan({ ...scan, manualItems: [...scan.manualItems, item] });
      setToast({ kind: 'info', text: `已添加：${item.label}` });
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message });
    }
  };

  const openAgent = (id: string | null) => {
    setFilter(id);
    setTab('export');
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">⇄</span>
          <span>
            AgentPack
            <span className="brand-sub">AI Agent 配置安全转场</span>
          </span>
        </div>

        <nav className="side-nav">
          <button
            className={tab === 'export' ? 'tab active' : 'tab'}
            onClick={() => setTab('export')}
          >
            导出配置
          </button>
          <button
            className={tab === 'import' ? 'tab active' : 'tab'}
            onClick={() => setTab('import')}
          >
            导入配置
          </button>
        </nav>

        {tab === 'export' && scan && (
          <div className="agent-filter">
            <div className="filter-title">按 Agent 查看</div>
            <button
              className={filter === null ? 'agent-item active' : 'agent-item'}
              onClick={() => openAgent(null)}
            >
              <span className="dot dot-all" />
              全部
            </button>
            {scan.agents.map((a) => (
              <button
                key={a.id}
                className={filter === a.id ? 'agent-item active' : 'agent-item'}
                onClick={() => openAgent(a.id)}
              >
                <span className={a.found ? 'dot dot-on' : 'dot dot-off'} />
                <span className="agent-name">{a.name}</span>
                {a.found && a.items.length > 0 && (
                  <span className="agent-count">{a.items.length}</span>
                )}
              </button>
            ))}
            {scan.manualItems.length > 0 && (
              <button
                className={filter === 'manual' ? 'agent-item active' : 'agent-item'}
                onClick={() => openAgent('manual')}
              >
                <span className="dot dot-all" />
                手动添加
              </button>
            )}
          </div>
        )}

        <div className="sidebar-foot">
          <button
            className="btn theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="切换浅色/深色主题"
          >
            {theme === 'dark' ? '☀ 浅色模式' : '☾ 深色模式'}
          </button>
        </div>
      </aside>

      <div className="main">
        <main className="content">
          {tab === 'export' && (
            <ExportTab
              scan={scan}
              scanning={scanning}
              filter={filter}
              onRescan={() => void runScan()}
              onAddManual={() => void addManual()}
            />
          )}
          {tab === 'import' && <ImportTab />}
        </main>
      </div>

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
