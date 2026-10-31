import { useEffect, useMemo, useState } from 'react';
import type { ScanResult, ScannedItem } from '@agentpack/core';
import {
  CategoryChip,
  LinkBadge,
  Modal,
  Progress,
  SecretBadge,
  WarnBadge,
  formatBytes,
  itemSubtitle,
  passwordStrength,
} from './ui';
import type { ExportResultLite } from './api.d';

interface Props {
  scan: ScanResult | null;
  scanning: boolean;
  /** 侧边栏选择的 agent 过滤：null=全部，'manual'=手动添加 */
  filter: string | null;
  onRescan: () => void;
  onAddManual: () => void;
}

const PHASE_LABEL: Record<string, string> = {
  collect: '正在收集配置文件…',
  pack: '正在打包…',
  encrypt: '正在加密…',
  container: '正在生成导出文件…',
  done: '完成',
};

const PHASE_PERCENT: Record<string, number> = {
  collect: 15,
  pack: 45,
  encrypt: 75,
  container: 92,
  done: 100,
};

export default function ExportTab({ scan, scanning, filter, onRescan, onAddManual }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 折叠的卡片（agentId 或 'manual'），默认全部展开 */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };

  const [dialogOpen, setDialogOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [machineName, setMachineName] = useState(false);
  const [outPath, setOutPath] = useState('');
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; label: string }>({
    percent: 0,
    label: '',
  });
  const [result, setResult] = useState<ExportResultLite | null>(null);
  const [errText, setErrText] = useState('');

  const items = useMemo(
    () =>
      scan
        ? [
            ...scan.agents.flatMap((a) => a.items),
            ...scan.manualItems,
          ].filter((i) => i.migratable)
        : [],
    [scan],
  );

  useEffect(() => {
    if (!scan) return;
    const init = new Set<string>();
    for (const i of items) {
      if (i.defaultSelected) init.add(i.key);
    }
    setSelected(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan]);

  const selectedItemObjs = items.filter((i) => selected.has(i.key));
  const totalSize = selectedItemObjs.reduce((acc, i) => acc + i.size, 0);
  const secretSelected = selectedItemObjs.some((i) => i.sensitivity === 'secret');

  const toggle = (key: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    setSelected(next);
  };

  const toggleAgent = (agentId: string, on: boolean) => {
    const next = new Set(selected);
    for (const i of items) {
      if (i.agentId === agentId) {
        if (on) next.add(i.key);
        else next.delete(i.key);
      }
    }
    setSelected(next);
  };

  const strength = passwordStrength(password);
  const pwOk = password.length >= 8 && password === confirmPw;

  const openDialog = () => {
    if (selectedItemObjs.length === 0) {
      setErrText('请至少勾选一个要导出的条目');
      return;
    }
    setErrText('');
    setResult(null);
    setPassword('');
    setConfirmPw('');
    setOutPath('');
    setDialogOpen(true);
  };

  const chooseOut = async () => {
    const p = await window.agentpack.chooseSavePath();
    if (p) setOutPath(p);
  };

  const doExport = async () => {
    if (!pwOk || !outPath) return;
    setWorking(true);
    setErrText('');
    setProgress({ percent: 5, label: '准备导出…' });
    try {
      const r = await window.agentpack.exportPack({
        items: selectedItemObjs,
        outPath,
        password,
        machineName,
      });
      if (r.ok) {
        setResult(r);
        setProgress({ percent: 100, label: '导出完成' });
      } else {
        setErrText(r.message);
      }
    } catch (e) {
      setErrText((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    return window.agentpack.onExportProgress((p) => {
      setProgress({
        percent: PHASE_PERCENT[p.phase] ?? 0,
        label:
          PHASE_LABEL[p.phase] ?? '' + (p.itemLabel ? ` — ${p.itemLabel}` : ''),
      });
    });
  }, []);

  return (
    <div className="export-tab">
      <div className="toolbar">
        <div className="toolbar-info">
          {scanning ? (
            <span className="muted">正在扫描本机 agent 配置…</span>
          ) : (
            <span>
              共发现{' '}
              <b>{scan ? scan.agents.filter((a) => a.found).length : 0}</b>{' '}
              个 agent，可迁移条目 {items.length} 个
            </span>
          )}
        </div>
        <div className="toolbar-actions">
          <button className="btn" onClick={onAddManual}>
            手动添加路径
          </button>
          <button className="btn" onClick={onRescan} disabled={scanning}>
            重新扫描
          </button>
        </div>
      </div>

      {scan && (
        <div className="cards">
          {(filter && filter !== 'manual'
            ? scan.agents.filter((a) => a.id === filter)
            : scan.agents
          ).map((agent) => (
            <section className="card" key={agent.id}>
              <header className="card-head">
                <div>
                  <button
                    className={collapsed.has(agent.id) ? 'card-toggle collapsed' : 'card-toggle'}
                    onClick={() => toggleCollapse(agent.id)}
                    title={collapsed.has(agent.id) ? '展开' : '折叠'}
                  >
                    <span className="chev">▾</span>
                  </button>
                  <span className={agent.found ? 'dot dot-on' : 'dot dot-off'} />
                  <b>{agent.name}</b>
                  <span className="muted agent-id"> [{agent.id}]</span>
                  {agent.version && (
                    <span className="badge badge-ver">版本 {agent.version}</span>
                  )}
                </div>
                {agent.found && agent.items.length > 0 && (
                  <label className="check-all">
                    <input
                      type="checkbox"
                      onChange={(e) => toggleAgent(agent.id, e.target.checked)}
                      checked={agent.items.every((i) => selected.has(i.key))}
                    />
                    全选
                  </label>
                )}
              </header>
              {!agent.found ? (
                <div className="muted card-empty">未在本机发现该 agent</div>
              ) : !collapsed.has(agent.id) ? (
                <>
                  <ul className="items">
                    {agent.items.map((item: ScannedItem) => (
                      <li key={item.key} className={item.migratable ? '' : 'disabled'}>
                        <label className="item-row">
                          <input
                            type="checkbox"
                            checked={selected.has(item.key)}
                            disabled={!item.migratable}
                            onChange={(e) => toggle(item.key, e.target.checked)}
                          />
                          <div className="item-main">
                            <div className="item-title">
                              {item.label}
                              <CategoryChip category={item.category} />
                              {item.sensitivity === 'secret' && <SecretBadge />}
                              {item.linkCount > 0 && <LinkBadge count={item.linkCount} />}
                              {item.warnings.length > 0 && (
                                <WarnBadge text={`⚠ ${item.warnings.length} 条警告`} />
                              )}
                            </div>
                            <div className="item-sub">
                              {itemSubtitle(item)}
                              {item.warnings.length > 0 && (
                                <span className="warn-text"> · {item.warnings[0]}</span>
                              )}
                            </div>
                          </div>
                          <span className="item-size">{formatBytes(item.size)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {(agent.nonMigratable?.length ?? 0) > 0 && (
                    <details className="non-migratable">
                      <summary>不可迁移项（{agent.nonMigratable!.length}）— 已自动排除</summary>
                      <ul>
                        {agent.nonMigratable!.map((nm) => (
                          <li key={nm.path}>
                            <code>{nm.path}</code> — {nm.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="restart-hint">生效方式：{agent.restartHint}</div>
                </>
              ) : null}
            </section>
          ))}

          {(filter === null || filter === 'manual') &&
            scan.manualItems.length > 0 && (
            <section className="card">
              <header className="card-head">
                <div>
                  <button
                    className={collapsed.has('manual') ? 'card-toggle collapsed' : 'card-toggle'}
                    onClick={() => toggleCollapse('manual')}
                    title={collapsed.has('manual') ? '展开' : '折叠'}
                  >
                    <span className="chev">▾</span>
                  </button>
                  <span className="dot dot-on" />
                  <b>手动添加</b>
                </div>
              </header>
              {!collapsed.has('manual') && (
              <ul className="items">
                {scan.manualItems.map((item) => (
                  <li key={item.key}>
                    <label className="item-row">
                      <input
                        type="checkbox"
                        checked={selected.has(item.key)}
                        onChange={(e) => toggle(item.key, e.target.checked)}
                      />
                      <div className="item-main">
                        <div className="item-title">
                          {item.label}
                          <CategoryChip category={item.category} />
                        </div>
                        <div className="item-sub">{item.placeholderPath}</div>
                      </div>
                      <span className="item-size">{formatBytes(item.size)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              )}
            </section>
          )}
        </div>
      )}

      <footer className="summary-bar">
        <span>
          已选 <b>{selectedItemObjs.length}</b> 个条目 ·{' '}
          <b>{formatBytes(totalSize)}</b>
          {secretSelected && (
            <span className="warn-text">（包含凭据内容，请妥善保管导出文件与密码）</span>
          )}
        </span>
        <button className="btn btn-primary" onClick={() => void openDialog()}>
          导出…
        </button>
      </footer>

      {dialogOpen && (
        <Modal title="导出为加密 .agentpack" onClose={working ? undefined : () => setDialogOpen(false)}>
          {working || result ? (
            <div>
              {!result && <Progress percent={progress.percent} label={progress.label} />}
              {result && (
                <div className="result">
                  <div className="result-ok">✅ 导出成功</div>
                  <ul>
                    <li>
                      文件：<code>{outPath}</code>
                    </li>
                    <li>
                      条目 {selectedItemObjs.length} / 文件 {result.fileCount} / 原始{' '}
                      {formatBytes(result.totalBytes)} / 包大小 {formatBytes(result.outSize)}
                    </li>
                    <li>
                      完整性校验值：<code>{result.payloadSha256.slice(0, 16)}…</code>
                    </li>
                  </ul>
                  <p className="warn-text">
                    请妥善保管密码：忘记密码将无法解密；导出文件包含敏感配置，建议通过可信渠道传输。
                  </p>
                  <div className="modal-actions">
                    <button className="btn btn-primary" onClick={() => setDialogOpen(false)}>
                      完成
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="field">
                <label>导出密码（至少 8 位，用于 AES-256 加密）</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="输入密码"
                  autoFocus
                />
                {strength.text && (
                  <span className={`pw-strength pw-${strength.level}`}>
                    强度：{strength.text}
                  </span>
                )}
              </div>
              <div className="field">
                <label>确认密码</label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="再次输入密码"
                />
                {confirmPw && password !== confirmPw && (
                  <span className="warn-text">两次输入不一致</span>
                )}
              </div>
              <div className="field">
                <label>保存位置</label>
                <div className="row">
                  <input
                    type="text"
                    value={outPath}
                    readOnly
                    placeholder="点击右侧按钮选择保存位置"
                  />
                  <button className="btn" onClick={() => void chooseOut()}>
                    选择…
                  </button>
                </div>
              </div>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={machineName}
                  onChange={(e) => setMachineName(e.target.checked)}
                />
                在文件中记录来源机器名（可选，便于核对，默认不记录）
              </label>
              {errText && <p className="warn-text">{errText}</p>}
              <div className="modal-actions">
                <button className="btn" onClick={() => setDialogOpen(false)}>
                  取消
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!pwOk || !outPath}
                  onClick={() => void doExport()}
                >
                  开始导出
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
