#!/usr/bin/env node
/**
 * AgentPack CLI —— 批量迁移命令行模式
 * 退出码：0 成功 / 2 密码错误 / 3 存在跳过或失败的文件 / 4 包损坏或格式不支持 / 1 其他错误
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Command } from 'commander';
import {
  AppError,
  addManualPath,
  clearHistory,
  defaultPathContext,
  executeImport,
  exportPack,
  findRegistryDir,
  isAppError,
  loadRegistries,
  openPack,
  previewImport,
  readHistory,
  readManifest,
  scanRegistries,
  verifyPack,
  type ConflictStrategy,
  type PathContext,
  type ScanResult,
  type ScannedItem,
} from '@agentpack/core';

/* ---------------- 工具函数 ---------------- */

function resolveRegistryDir(): string {
  const candidates = [
    process.env.AGENTPACK_REGISTRY,
    path.resolve(__dirname, '../registry'),
    path.resolve(__dirname, '../../../registry'),
    path.resolve(__dirname, 'registry'),
  ];
  return findRegistryDir(candidates);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 静音读取密码：TTY 下关闭回显；非 TTY（管道）读一行 */
function readPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c: string) => (data += c));
      process.stdin.on('end', () =>
        resolve((data.split(/\r?\n/)[0] ?? '').trim()),
      );
      process.stdin.on('error', reject);
      return;
    }
    process.stdout.write(prompt);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const muted = rl as unknown as { _writeToOutput: (s: string) => void };
    muted._writeToOutput = () => {
      /* 静音：不回显密码字符 */
    };
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPasswordConfirmed(envVar?: string): Promise<string> {
  if (envVar) {
    const v = process.env[envVar];
    if (!v) {
      throw new AppError('PASSWORD_WEAK', `环境变量 ${envVar} 未设置`);
    }
    return v;
  }
  const pw = await readPassword('请设置导出密码（至少 8 位）：');
  if (!process.stdin.isTTY) {
    return pw;
  }
  const pw2 = await readPassword('请再次输入密码：');
  if (pw !== pw2) {
    throw new AppError('PASSWORD_WEAK', '两次输入的密码不一致');
  }
  return pw;
}

function collectStrings(value: string, previous: string[]): string[] {
  return [...previous, ...value.split(',').map((s) => s.trim()).filter(Boolean)];
}

function selectItems(
  scan: ScanResult,
  agentFilter: string[] | undefined,
  includeSecret: boolean,
): ScannedItem[] {
  const all = [...scan.agents.flatMap((a) => a.items), ...scan.manualItems];
  return all.filter((it) => {
    if (agentFilter && !agentFilter.includes(it.agentId)) return false;
    if (!it.migratable) return false;
    if (it.sensitivity === 'secret' && !includeSecret) return false;
    return true;
  });
}

function badge(category: string, sensitivity: string): string {
  const catMap: Record<string, string> = {
    settings: '设置',
    prompt: '提示词',
    rules: '规则',
    skills: '技能',
    mcp: 'MCP',
    memory: '记忆',
    credentials: '凭据',
    other: '其他',
  };
  const cat = catMap[category] ?? category;
  return sensitivity === 'secret' ? `${cat}·敏感` : cat;
}

function printScan(scan: ScanResult): void {
  for (const agent of scan.agents) {
    const head = agent.found ? '●' : '○';
    const ver = agent.version ? `（版本 ${agent.version}）` : '';
    console.log(`\n${head} ${agent.name} [${agent.id}]${ver}`);
    if (!agent.found) {
      console.log('    未在本机发现');
      continue;
    }
    for (const item of agent.items) {
      const flag =
        item.sensitivity === 'secret'
          ? '  ⚠ 默认不导出（凭据）'
          : item.linkCount > 0
            ? `  ↳ 含 ${item.linkCount} 个符号链接`
            : '';
      console.log(
        `    - ${item.label.padEnd(44)} [${badge(item.category, item.sensitivity)}]  ${formatBytes(item.size)}${flag}`,
      );
      for (const w of item.warnings.slice(0, 3)) {
        console.log(`        ! ${w}`);
      }
    }
    for (const nm of agent.nonMigratable ?? []) {
      console.log(`    ✖ ${nm.path} — 不可迁移：${nm.reason}`);
    }
    console.log(`    提示：${agent.restartHint}`);
  }
  if (scan.manualItems.length > 0) {
    console.log('\n● 手动添加');
    for (const item of scan.manualItems) {
      console.log(
        `    - ${item.label}  ${formatBytes(item.size)}  <${item.placeholderPath}>`,
      );
    }
  }
  const total = [...scan.agents.flatMap((a) => a.items), ...scan.manualItems]
    .filter((i) => i.migratable)
    .reduce((acc, i) => acc + i.size, 0);
  console.log(`\n可迁移总计：${formatBytes(total)}\n`);
}

function printReportLine(kind: string, msg: string): void {
  console.log(`  ${kind} ${msg}`);
}

function exitByError(e: unknown): never {
  if (isAppError(e)) {
    console.error(`错误[${e.code}]: ${e.message}`);
    const codeMap: Record<string, number> = {
      PASSWORD_WRONG: 2,
      PASSWORD_WEAK: 2,
      PACK_CORRUPT: 4,
      PACK_FORMAT_UNSUPPORTED: 4,
    };
    process.exit(codeMap[e.code] ?? 1);
  }
  throw e;
}

async function withContext(): Promise<PathContext> {
  return defaultPathContext();
}

/* ---------------- 命令 ---------------- */

const program = new Command();

program
  .name('agentpack')
  .description('AI Agent 配置安全迁移工具（离线 .agentpack 格式）')
  .version('1.1.0');

program
  .command('scan')
  .description('扫描本机 agent 配置')
  .option('--json', '以 JSON 输出')
  .option('--add <path>', '手动添加路径（可多次/逗号分隔）', collectStrings, [])
  .action(async (opts: { json?: boolean; add: string[] }) => {
    try {
      const regs = loadRegistries(resolveRegistryDir());
      const ctx = await withContext();
      const scan = await scanRegistries(regs, ctx);
      for (const p of opts.add.flatMap((s) => s.split(','))) {
        if (p) {
          scan.manualItems.push(await addManualPath(path.resolve(p), ctx));
        }
      }
      if (opts.json) {
        console.log(JSON.stringify(scan, null, 2));
      } else {
        printScan(scan);
      }
    } catch (e) {
      exitByError(e);
    }
  });

program
  .command('export')
  .description('把选中的配置打包为加密 .agentpack')
  .requiredOption('-o, --out <file>', '输出文件路径（.agentpack）')
  .option('--agent <ids>', '仅打包指定 agent（逗号分隔，默认全部已发现）', collectStrings, [])
  .option('--only-secret', '包含凭据类条目（默认排除）', false)
  .option('--add <path>', '手动添加路径（可多次/逗号分隔）', collectStrings, [])
  .option('--password-env <var>', '从环境变量读取密码（自动化推荐）')
  .option('--machine-name <name>', '在 manifest 中记录来源机器名（默认不记录）')
  .option('--dry-run', '仅列出将打包的内容与大小')
  .action(
    async (opts: {
      out: string;
      agent: string[];
      onlySecret: boolean;
      add: string[];
      passwordEnv?: string;
      machineName?: string;
      dryRun?: boolean;
    }) => {
      try {
        const regs = loadRegistries(resolveRegistryDir());
        const ctx = await withContext();
        const scan = await scanRegistries(regs, ctx);
        for (const p of opts.add.flatMap((s) => s.split(','))) {
          if (p) {
            scan.manualItems.push(await addManualPath(path.resolve(p), ctx));
          }
        }
        const items = selectItems(scan, opts.agent.length ? opts.agent : undefined, opts.onlySecret);
        if (items.length === 0) {
          console.error('没有可打包的条目（检查 --agent 过滤条件）');
          process.exit(1);
        }
        const total = items.reduce((acc, i) => acc + i.size, 0);
        console.log(`将打包 ${items.length} 个条目，共 ${formatBytes(total)}：`);
        for (const it of items) {
          console.log(`  - [${it.agentName}] ${it.label} (${formatBytes(it.size)})`);
        }
        if (opts.dryRun) {
          return;
        }
        const password = await readPasswordConfirmed(opts.passwordEnv);
        console.log('正在打包加密…');
        const result = await exportPack({
          items,
          ctx,
          outPath: path.resolve(opts.out),
          password,
          machineName: opts.machineName,
          onProgress: (p) => {
            if (p.phase === 'collect' && p.itemLabel) {
              console.log(`  收集: ${p.itemLabel}`);
            }
          },
        });
        console.log(
          `\n完成 → ${path.resolve(opts.out)}\n  条目 ${items.length} / 文件 ${result.fileCount} / 原始 ${formatBytes(result.totalBytes)} / 包大小 ${formatBytes(result.outSize)}`,
        );
        console.log('  请妥善保管密码：忘记密码将无法解密。');
      } catch (e) {
        exitByError(e);
      }
    },
  );

program
  .command('verify')
  .description('校验 .agentpack 完整性（可同时验证密码）')
  .argument('<file>', '.agentpack 文件')
  .option('--password-env <var>', '从环境变量读取密码以验证可解密性')
  .action(async (file: string, opts: { passwordEnv?: string }) => {
    try {
      const manifest = await readManifest(file);
      console.log(`格式: ${manifest.format}  工具版本: ${manifest.toolVersion}`);
      console.log(`创建时间: ${manifest.createdAt}  来源系统: ${manifest.sourceOs}`);
      if (manifest.sourceMachineName) {
        console.log(`来源机器: ${manifest.sourceMachineName}`);
      }
      let password: string | undefined;
      if (opts.passwordEnv) {
        password = process.env[opts.passwordEnv];
        if (!password) {
          throw new AppError('PASSWORD_WEAK', `环境变量 ${opts.passwordEnv} 未设置`);
        }
      } else if (process.stdin.isTTY) {
        password = await readPassword('输入密码以验证（回车跳过）：');
        if (!password) {
          password = undefined;
        }
      }
      const result = await verifyPack(file, password);
      console.log(`payload 完整性: ${result.payloadOk ? '通过' : '失败'}`);
      console.log(`密码验证: ${result.decrypted ? '通过' : password ? '失败' : '未验证'}`);
      if (result.entries) {
        console.log(
          `包含 ${result.entries.items.length} 个条目 / ${result.entries.files.length} 个文件`,
        );
      }
      if (!result.payloadOk || (password && !result.decrypted)) {
        process.exit(4);
      }
    } catch (e) {
      exitByError(e);
    }
  });

program
  .command('import')
  .description('从 .agentpack 导入配置到本机')
  .argument('<file>', '.agentpack 文件')
  .option('-s, --strategy <strategy>', '冲突策略: overwrite|skip|backup（默认 backup）', 'backup')
  .option('--agent <ids>', '仅导入指定 agent（逗号分隔，默认全部）', collectStrings, [])
  .option('--password-env <var>', '从环境变量读取密码（自动化推荐）')
  .option('--backup-dir <dir>', '备份目录（默认 ~/agentpack-backups/<时间戳>）')
  .option('--dry-run', '仅预览，不写入')
  .action(
    async (
      file: string,
      opts: {
        strategy: string;
        agent: string[];
        passwordEnv?: string;
        backupDir?: string;
        dryRun?: boolean;
      },
    ) => {
      try {
        if (!['overwrite', 'skip', 'backup'].includes(opts.strategy)) {
          throw new AppError('IO_ERROR', `无效的冲突策略: ${opts.strategy}`);
        }
        let password: string;
        if (opts.passwordEnv) {
          const v = process.env[opts.passwordEnv];
          if (!v) {
            throw new AppError('PASSWORD_WEAK', `环境变量 ${opts.passwordEnv} 未设置`);
          }
          password = v;
        } else {
          password = await readPassword('输入导出时设置的密码：');
        }
        const handle = await openPack(file, password);
        try {
          const ctx = await withContext();
          const preview = previewImport(handle, ctx);
          const filtered = preview.filter(
            (p) => !opts.agent.length || opts.agent.includes(p.item.agentId),
          );
          console.log(
            `来源: ${handle.manifest.sourceMachineName ?? '(未记录机器名)'}  导出于 ${handle.manifest.createdAt}`,
          );
          for (const p of filtered) {
            const conflict =
              p.conflict === 'exists' ? `  ⚠ 目标已存在（${formatBytes(p.existingSize)}）` : '  新增';
            console.log(
              `  - [${p.item.agentName}] ${p.item.label} → ${p.targetAbs}${conflict}`,
            );
          }
          const decisions: Record<string, ConflictStrategy> = {};
          for (const p of filtered) {
            decisions[p.item.key] = opts.strategy as ConflictStrategy;
          }
          if (opts.dryRun) {
            console.log('（dry-run：未写入）');
            return;
          }
          const report = await executeImport({
            handle,
            ctx,
            decisions,
            backupRoot: opts.backupDir ? path.resolve(opts.backupDir) : undefined,
            packPath: path.resolve(file),
            onProgress: (p) => {
              if (p.phase === 'write' && p.current && p.files !== undefined && p.totalFiles) {
                process.stdout.write(`\r写入 ${p.files}/${p.totalFiles}`);
              }
            },
          });
          process.stdout.write('\n');
          console.log(
            `导入完成：写入 ${report.written}，跳过 ${report.skipped}，备份 ${report.backedUp}`,
          );
          if (report.backupPath) {
            console.log(`备份目录: ${report.backupPath}`);
          }
          for (const w of report.warnings) {
            printReportLine('!', w);
          }
          const importedAgents = new Set(
            filtered
              .filter((p) => decisions[p.item.key] !== 'skip')
              .map((p) => p.item.agentId),
          );
          const regs = loadRegistries(resolveRegistryDir());
          for (const agentId of importedAgents) {
            if (agentId === 'manual') continue;
            const reg = regs.find((r) => r.id === agentId);
            if (reg) {
              console.log(`【${reg.name}】${reg.restartHint}`);
            }
          }
          if (report.warnings.length > 0) {
            process.exit(3);
          }
        } finally {
          await handle.close();
        }
      } catch (e) {
        exitByError(e);
      }
    },
  );

program
  .command('history')
  .description('查看/清空导入导出历史记录（~/.agentpack/history.json）')
  .option('-n, --limit <n>', '显示条数', '20')
  .option('--json', '以 JSON 输出')
  .option('--clear', '清空全部记录')
  .action(async (opts: { limit: string; json?: boolean; clear?: boolean }) => {
    if (opts.clear) {
      clearHistory();
      console.log('已清空历史记录');
      return;
    }
    const list = readHistory(Number(opts.limit) || 20);
    if (opts.json) {
      console.log(JSON.stringify(list, null, 2));
      return;
    }
    if (list.length === 0) {
      console.log('暂无记录');
      return;
    }
    for (const e of list) {
      const mark = e.status === 'ok' ? '✔' : '✖';
      const action = e.action === 'export' ? '导出' : '导入';
      const time = new Date(e.time).toLocaleString();
      console.log(
        `${mark} ${time} [${action}] ${(e.agents.join('、') || '-')} — ${e.itemCount} 条目 / ${formatBytes(e.bytes)}` +
          (e.status === 'failed' ? ` — 失败：${e.message ?? ''}` : ''),
      );
      console.log(`    ${e.path}`);
    }
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
