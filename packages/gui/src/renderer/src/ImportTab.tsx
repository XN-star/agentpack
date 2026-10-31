import { useEffect, useState } from 'react';
import type { ConflictStrategy, ImportReport } from '@agentpack/core';
import { Modal, Progress, formatBytes } from './ui';
import type { ImportPreviewResult } from './api.d';

const STRATEGY_LABEL: Record<ConflictStrategy, string> = {
  overwrite: '覆盖',
  skip: '跳过',
  backup: '备份后写入',
};

export default function ImportTab() {
  const [packPath, setPackPath] = useState('');
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [globalStrategy, setGlobalStrategy] = useState<ConflictStrategy>('backup');
  const [decisions, setDecisions] = useState<Record<string, ConflictStrategy>>({});
  const [phase, setPhase] = useState<'input' | 'working' | 'done'>('input');
  const [progress, setProgress] = useState<{ percent: number; label: string }>({
    percent: 0,
    label: '',
  });
  const [report, setReport] = useState<ImportReport | null>(null);
  const [errText, setErrText] = useState('');

  useEffect(() => {
    return window.agentpack.onImportProgress((p) => {
      if (p.phase === 'write' && p.totalFiles) {
        setProgress({
          percent: Math.round(((p.files ?? 0) / p.totalFiles) * 100),
          label: `写入 ${p.files ?? 0}/${p.totalFiles}：${p.current ?? ''}`,
        });
      } else if (p.phase === 'backup') {
        setProgress({ percent: 10, label: '正在备份目标现有配置…' });
      } else if (p.phase === 'done') {
        setProgress({ percent: 100, label: '完成' });
      }
    });
  }, []);

  const chooseFile = async () => {
    const p = await window.agentpack.choosePackFile();
    if (p) {
      setPackPath(p);
      setPreview(null);
      setReport(null);
      setErrText('');
    }
  };

  const doPreview = async () => {
    if (!packPath || !password) return;
    setErrText('');
    const r = await window.agentpack.importPreview({ packPath, password });
    if (r.ok) {
      setPreview(r);
      const init = new Set<string>(r.preview.map((p) => p.item.key));
      setChecked(init);
      const d: Record<string, ConflictStrategy> = {};
      for (const p of r.preview) {
        d[p.item.key] = globalStrategy;
      }
      setDecisions(d);
    } else {
      setPreview(null);
      setErrText(r.message);
    }
  };

  const doExecute = async () => {
    if (!preview) return;
    const selected = preview.preview.filter((p) => checked.has(p.item.key));
    if (selected.length === 0) {
      setErrText('请至少选择一个要导入的条目');
      return;
    }
    setErrText('');
    setPhase('working');
    setProgress({ percent: 0, label: '准备导入…' });
    const dec: Record<string, ConflictStrategy> = {};
    for (const p of selected) {
      dec[p.item.key] = decisions[p.item.key] ?? globalStrategy;
    }
    const r = await window.agentpack.importExecute({
      packPath,
      password,
      decisions: dec,
    });
    if (r.ok) {
      setReport(r.report);
      setPhase('done');
    } else {
      setPhase('input');
      setErrText(r.message);
    }
  };

  const applyGlobal = (s: ConflictStrategy) => {
    setGlobalStrategy(s);
    if (!preview) return;
    const d: Record<string, ConflictStrategy> = {};
    for (const p of preview.preview) {
      d[p.item.key] = s;
    }
    setDecisions(d);
  };

  const toggle = (key: string, on: boolean) => {
    const next = new Set(checked);
    if (on) next.add(key);
    else next.delete(key);
    setChecked(next);
  };

  const hintAgents = () => {
    if (!preview || !report) return [];
    const ids = new Set(
      preview.preview
        .filter((p) => checked.has(p.item.key) && p.item.agentId !== 'manual')
        .map((p) => p.item.agentId),
    );
    return [...ids]
      .map((id) => ({ id, hint: preview.agentHints[id] }))
      .filter((x) => x.hint);
  };

  return (
    <div className="import-tab">
      {phase === 'input' && (
        <>
          <section className="card">
            <div className="field">
              <label>1. 选择导入文件（.agentpack）</label>
              <div className="row">
                <input type="text" value={packPath} readOnly placeholder="尚未选择文件" />
                <button className="btn" onClick={() => void chooseFile()}>
                  选择文件…
                </button>
              </div>
            </div>
            <div className="field">
              <label>2. 输入导出时设置的密码</label>
              <div className="row">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="导出密码"
                  disabled={!packPath}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && packPath && password) void doPreview();
                  }}
                />
                <button
                  className="btn btn-primary"
                  disabled={!packPath || !password}
                  onClick={() => void doPreview()}
                >
                  验证并预览
                </button>
              </div>
              <p className="muted">
                密码错误时无法读取内容；文件包含条目清单在内的全部信息均已加密。
              </p>
            </div>
            {errText && <p className="warn-text">{errText}</p>}
          </section>

          {preview && (
            <section className="card">
              <header className="card-head">
                <div>
                  <b>包含 {preview.preview.length} 个条目</b>
                  <span className="muted">
                    （来源：{preview.manifest.sourceMachineName ?? '未记录机器名'} ·{' '}
                    {new Date(preview.manifest.createdAt).toLocaleString()} · 工具版本{' '}
                    {preview.manifest.toolVersion}）
                  </span>
                </div>
                <div className="row">
                  <label>冲突策略：</label>
                  {(Object.keys(STRATEGY_LABEL) as ConflictStrategy[]).map((s) => (
                    <button
                      key={s}
                      className={globalStrategy === s ? 'btn btn-small active' : 'btn btn-small'}
                      onClick={() => applyGlobal(s)}
                    >
                      {STRATEGY_LABEL[s]}
                    </button>
                  ))}
                </div>
              </header>
              <p className="muted strategy-note">
                覆盖=直接替换目标文件；跳过=保留目标已有配置；备份后写入=先把目标已有文件备份到
                <code> ~/agentpack-backups/</code> 再写入（推荐）。路径已按本机用户目录自动适配。
              </p>
              <ul className="items">
                {preview.preview.map((p) => (
                  <li key={p.item.key}>
                    <div className="item-row import-row">
                      <input
                        type="checkbox"
                        checked={checked.has(p.item.key)}
                        onChange={(e) => toggle(p.item.key, e.target.checked)}
                      />
                      <div className="item-main">
                        <div className="item-title">
                          [{p.item.agentName}] {p.item.label}
                          <span
                            className={`badge ${p.conflict === 'exists' ? 'badge-conflict' : 'badge-new'}`}
                          >
                            {p.conflict === 'exists' ? '⚠ 目标已存在' : '新增'}
                          </span>
                          {p.conflict === 'exists' && p.existingSize > 0 && (
                            <span className="muted">（现 {formatBytes(p.existingSize)}）</span>
                          )}
                        </div>
                        <div className="item-sub">
                          → {p.targetAbs}
                          {p.item.sensitivity === 'secret' && (
                            <span className="badge badge-secret">凭据·内容不可预览</span>
                          )}
                        </div>
                      </div>
                      <select
                        className="strategy-select"
                        value={decisions[p.item.key] ?? globalStrategy}
                        onChange={(e) =>
                          setDecisions({
                            ...decisions,
                            [p.item.key]: e.target.value as ConflictStrategy,
                          })
                        }
                      >
                        {(Object.keys(STRATEGY_LABEL) as ConflictStrategy[]).map((s) => (
                          <option key={s} value={s}>
                            {STRATEGY_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </li>
                ))}
              </ul>
              <footer className="summary-bar">
                <span>
                  已选 <b>{preview.preview.filter((p) => checked.has(p.item.key)).length}</b> 个条目
                </span>
                <button className="btn btn-primary" onClick={() => void doExecute()}>
                  开始导入
                </button>
              </footer>
            </section>
          )}
        </>
      )}

      {phase === 'working' && (
        <section className="card">
          <h3>正在导入…</h3>
          <Progress percent={progress.percent} label={progress.label} />
          <p className="muted">导入过程中请勿关闭对应的 agent 应用。</p>
        </section>
      )}

      {phase === 'done' && report && (
        <section className="card">
          <h3>✅ 导入完成</h3>
          <ul className="report">
            <li>写入 {report.written} 个文件（{formatBytes(report.bytesWritten)}）</li>
            <li>跳过 {report.skipped} 个文件</li>
            <li>备份 {report.backedUp} 个文件</li>
            {report.backupPath && (
              <li>
                备份目录：<code>{report.backupPath}</code>
              </li>
            )}
          </ul>
          {report.warnings.length > 0 && (
            <details className="non-migratable" open>
              <summary>警告（{report.warnings.length}）</summary>
              <ul>
                {report.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="restart-hints">
            <b>让配置生效：</b>
            <ul>
              {hintAgents().map((h) => (
                <li key={h.id}>{h.hint}</li>
              ))}
            </ul>
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                setPhase('input');
                setPreview(null);
                setReport(null);
                setPassword('');
                setPackPath('');
              }}
            >
              导入其他文件
            </button>
          </div>
        </section>
      )}

      {errText && phase === 'working' && <p className="warn-text">{errText}</p>}
    </div>
  );
}
