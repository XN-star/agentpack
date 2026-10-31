import { useEffect, useState } from 'react';
import type { HistoryEntry } from '@agentpack/core';
import { formatBytes } from './ui';

export default function HistoryTab() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = async () => {
    try {
      setEntries(await window.agentpack.getHistory());
    } catch {
      setEntries([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const clear = async () => {
    await window.agentpack.clearHistory();
    setConfirmClear(false);
    void load();
  };

  return (
    <div className="history-tab">
      <section className="card">
        <header className="card-head">
          <div>
            <b>导入 / 导出历史记录</b>
            <span className="muted">
              （保存在本机 ~/.agentpack/history.json，仅记录元信息，不含配置内容）
            </span>
          </div>
          <div className="row">
            <button className="btn" onClick={() => void load()}>
              刷新
            </button>
            {entries && entries.length > 0 && (
              <button className="btn" onClick={() => setConfirmClear(true)}>
                清空记录
              </button>
            )}
          </div>
          {confirmClear && (
            <div className="row clear-confirm">
              <span className="warn-text">确认清空全部记录？</span>
              <button className="btn btn-small" onClick={() => setConfirmClear(false)}>
                取消
              </button>
              <button className="btn btn-small btn-primary" onClick={() => void clear()}>
                确认清空
              </button>
            </div>
          )}
        </header>

        {entries === null ? (
          <div className="muted card-empty">加载中…</div>
        ) : entries.length === 0 ? (
          <div className="muted card-empty">
            暂无记录。完成一次导出或导入后会自动记录日期、Agent、内容摘要与文件路径。
          </div>
        ) : (
          <ul className="history-list">
            {entries.map((e) => (
              <li key={e.id} className="history-item">
                <span
                  className={`badge ${e.action === 'export' ? 'badge-export' : 'badge-import'}`}
                >
                  {e.action === 'export' ? '导出' : '导入'}
                </span>
                <span className={`badge ${e.status === 'ok' ? 'badge-new' : 'badge-conflict'}`}>
                  {e.status === 'ok' ? '成功' : '失败'}
                </span>
                <div className="history-main">
                  <div className="history-line">
                    <span className="history-time">
                      {new Date(e.time).toLocaleString()}
                    </span>
                    <span className="history-agents">
                      {(e.agents.join('、') || '—')}
                    </span>
                    <span className="muted">
                      {e.itemCount} 条目 · {e.fileCount} 文件 ·{' '}
                      {formatBytes(e.bytes)}
                    </span>
                  </div>
                  <div className="history-path" title={e.path}>
                    {e.path}
                  </div>
                  {e.items.length > 0 && (
                    <div className="history-items">
                      {e.items.slice(0, 4).map((label, i) => (
                        <span key={i} className="chip">
                          {label}
                        </span>
                      ))}
                      {e.items.length > 4 && (
                        <span className="muted">等 {e.items.length} 项</span>
                      )}
                    </div>
                  )}
                  {e.message && <div className="history-msg">{e.message}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
