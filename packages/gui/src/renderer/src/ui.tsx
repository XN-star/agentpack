import type { ReactNode } from 'react';
import type { Category, ScannedItem } from '@agentpack/core';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const CATEGORY_LABEL: Record<Category, string> = {
  settings: '设置',
  prompt: '提示词',
  rules: '规则',
  skills: '技能',
  mcp: 'MCP',
  memory: '记忆',
  credentials: '凭据',
  other: '其他',
};

export function CategoryChip({ category }: { category: Category }) {
  return (
    <span className={`chip chip-${category}`}>{CATEGORY_LABEL[category]}</span>
  );
}

export function SecretBadge() {
  return <span className="badge badge-secret">凭据·默认不勾选</span>;
}

export function LinkBadge({ count }: { count: number }) {
  return <span className="badge badge-link">↳ {count} 个链接已解引用</span>;
}

export function WarnBadge({ text }: { text: string }) {
  return <span className="badge badge-warn">{text}</span>;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="modal-mask">
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          {onClose && (
            <button className="btn-ghost" onClick={onClose} aria-label="关闭">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Progress({ percent, label }: { percent: number; label?: string }) {
  return (
    <div className="progress-wrap">
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      {label && <div className="progress-label">{label}</div>}
    </div>
  );
}

export function passwordStrength(pw: string): { level: 0 | 1 | 2 | 3; text: string } {
  if (!pw) return { level: 0, text: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  const level = Math.min(3, score) as 0 | 1 | 2 | 3;
  const texts = ['', '弱', '中', '强'];
  return { level, text: texts[level] ?? '' };
}

export function itemSubtitle(item: ScannedItem): string {
  if (item.note) return item.note;
  if (item.sensitivity === 'secret') return '包含密钥/令牌内容，导出文件请妥善保管';
  return item.placeholderPath;
}
