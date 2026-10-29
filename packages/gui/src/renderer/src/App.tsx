import { useCallback, useEffect, useState } from 'react';
import type { ScanResult } from '@agentpack/core';
import ExportTab from './ExportTab';
import ImportTab from './ImportTab';

export default function App() {
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; text: string } | null>(
    null,
  );

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">⇄</span>
          <span>
            AgentPack
            <span className="brand-sub">AI Agent 配置安全转场 · 离线加密</span>
          </span>
        </div>
        <nav className="tabs">
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
      </header>

      <main className="content">
        {tab === 'export' && (
          <ExportTab
            scan={scan}
            scanning={scanning}
            onRescan={() => void runScan()}
            onAddManual={() => void addManual()}
          />
        )}
        {tab === 'import' && <ImportTab />}
      </main>

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
