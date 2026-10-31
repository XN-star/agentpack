# AgentPack — AI Agent 配置安全转场

把本机已安装的 AI Agent（ZCode、Codex、Trae CN、Hermes、OpenCode、WorkBuddy）的配置**安全迁移到其他电脑**。

- **离线迁移**：导出为单一加密文件（`.agentpack`），U 盘/局域网传输均可，不经过任何第三方服务器
- **强加密**：密码派生密钥（scrypt）+ AES-256-GCM 全量加密，密钥不落盘；明文部分只有时间与来源系统等元信息，**不含任何条目清单**
- **双模式**：图形界面（Electron）+ 命令行（批量迁移），共享同一核心库
- **安全边界**：凭据类条目默认排除、需手动勾选；登录态/设备绑定项在界面中明确标注为不可迁移；导入前自动备份目标机器已有配置

仅支持 Windows 10+。

## 安装

- 双击 `packages/gui/release/AgentPack Setup 1.0.0.exe`，按向导安装（可选安装目录、自动创建桌面/开始菜单快捷方式）。
- CLI 已随安装包内置：`<安装目录>\resources\agentpack.cmd`（复用应用自带运行时，无需安装 Node.js）。可把 `resources` 目录加入 PATH 后直接使用 `agentpack` 命令。

### 从源码构建

```bash
npm install                 # 首次需联网（已配置国内镜像）
npm test                    # vitest 全部测试
npm run dist                # 生成 NSIS 安装包 → packages/gui/release/
```

> 中文路径注意：若仓库位于含中文/空格的路径，electron-builder 会失败（spawn ENOENT，且其依赖收集会精简 node_modules）。已内置解决脚本：
> `bash packages/gui/scripts/package-dist.sh`
> 它把产物拷到 ASCII 独立目录（默认 `C:\AgentPackDist`，可用环境变量 `AGENTPACK_STAGE` 改）独立打包，再把安装包拷回 `packages/gui/release/`。

## 快速上手（图形界面）

**导出（源电脑）**
1. 打开 AgentPack →「导出配置」页，自动扫描本机 agent 配置
2. 按需勾选条目（灰色为不可迁移；凭据默认不勾选，勾选时请留意警示）
3. 「导出…」→ 设置密码（≥8 位，两次确认）→ 选择保存位置 → 完成后记录校验值
4. 把 `.agentpack` 文件带到目标电脑

**导入（目标电脑）**
1. 「导入配置」页 → 选择 `.agentpack` → 输入密码 → 预览条目清单
2. 查看冲突标注（目标已存在/新增），选择冲突策略：
   - **备份后写入**（推荐）：先把目标已有文件备份到 `~/agentpack-backups/<时间戳>/`
   - **覆盖**：直接替换
   - **跳过**：保留目标已有配置
3. 开始导入 → 查看结果报告 → 按提示重启对应 agent 应用生效

**手动添加**：registry 未覆盖的配置路径，用「手动添加路径」选择任意文件/目录一起打包；含绝对路径的文本配置会在导入时自动改写为目标机器路径。

## 命令行

```bash
agentpack scan [--json] [--add <路径>]              # 扫描本机配置
agentpack export -o 迁移.agentpack [--agent zcode,codex]
                    [--only-secret]                 # 包含凭据（默认排除）
                    [--password-env MY_PW_VAR]      # 自动化时用环境变量传密码
                    [--dry-run] [--machine-name X]  # 在 manifest 记录来源机器名
agentpack verify 迁移.agentpack [--password-env VAR] # 校验完整性/密码
agentpack import 迁移.agentpack -s backup|overwrite|skip
                    [--agent ...] [--dry-run] [--backup-dir <dir>]
```

- 密码输入为静音回显；脚本化场景一律用 `--password-env`，避免密码进入命令历史
- 退出码：`0` 成功 / `2` 密码错误或强度不足 / `3` 存在跳过或失败的文件 / `4` 包损坏或格式不支持

## 支持的 Agent 清单（v1）

| Agent | 配置根 | 可迁移项 | 凭据（默认排除） | 不可迁移（自动排除） |
|---|---|---|---|---|
| ZCode | `~/.zcode` | AGENTS.md、agents/、skills/（符号链接解引用去重）、cli/config.json、v2/* 配置、memories/ | v2/credentials.json、v2/certs/ | cli/plugins(1.6G 缓存)、db/log/rollout/sessions、`D:\ZCode\.zcode` 会话数据 |
| Codex | `~/.codex` | config.toml、AGENTS.md、rules/、agents/、hooks.json、memories/、skills/ | auth.json、secrets/、.sandbox-secrets/ | plugins/(468M)、sessions/、*.sqlite、.sandbox-bin/、backups/、installation_id |
| Trae CN | `~/.trae-cn` + `%APPDATA%\Trae CN` + `%APPDATA%\TRAE SOLO CN` | mcps/、skills/、builtin_skills/、user_rules/、各类 *-config.json、permission/、argv.json、User/settings.json、User/mcp.json、User/snippets/ | trae-jwt-token | work/(294M)、extensions/、globalStorage(state.vscdb)、workspaceStorage、Local Storage/Cookies |
| Hermes | `%LOCALAPPDATA%\hermes` + `%APPDATA%\Hermes` | config.yaml、skills/、memories/、plugins/、hooks/、cron/、各 *.db、Roaming 侧 *.json 配置 | auth.json、.env、secure-token-storage.json | 各类 cache/、bin/、node/、installs/、runtime/、hermes-agent/、backups/、Electron 壳 |
| OpenCode | `~/.config/opencode` + `~/.opencode` + `~/.local/share/opencode` + `%APPDATA%\ai.opencode.desktop` | opencode.json(c)、agent-team/、skills/、opencode.db、opencode.settings、drafts.sqlite | auth.json | node_modules、browser-profile、repos/snapshot/log、WebView 缓存 |
| WorkBuddy | `%APPDATA%\WorkBuddy` | User/settings.json、User/snippets/、globalStorage/storage.json、automations/、codebuddy-sessions.vscdb、languagepacks.json、User/History/（可选） | globalStorage 内扩展登录态 | machineid、Local State、state.vscdb、全部 Cache/Local Storage/Cookies、workspaceStorage |

二期计划：Claude Code/Desktop、Cursor、Qwen Code、Continue、DeepSeek 等——新增 agent 只需在 `registry/` 添加一个 JSON 描述文件，无需修改核心代码。

## `.agentpack` 格式与安全设计

```
migration.agentpack（ZIP 容器）
├─ manifest.json   明文：格式版本/时间/来源系统/scrypt 参数/payload 校验值（不含任何条目信息）
└─ payload.bin     AES-256-GCM( inner.zip )；inner.zip = entries.json（条目清单）+ 各文件内容
```

- KDF：scrypt（N=32768, r=8, p=1，32 字节随机盐），密钥仅存内存、用后清零
- payload 完整性：SHA-256 校验；密文篡改或密码错误时解密失败
- 路径可移植：registry 与包内一律用正斜杠 + `{{home}}/{{appdata}}/{{localappdata}}` 占位符，导入时按目标机器展开（自动适配用户名/盘符差异）
- 符号链接/目录联接：导出解引用（dereference），跨条目相同内容按哈希去重（sameAs 机制）
- 内容转换：导入时把配置文件里来源机器的绝对路径改写为本机路径（限小体积文本文件）
- 每个条目标注敏感级：`normal` / `secret`（默认排除、预览打码）/ `bound`（设备绑定，不可迁移）

## 常见问题

- **忘记密码怎么办？** 无法恢复。加密强度取决于密码，请妥善保管。
- **导入时部分文件失败？** 多为对应 agent 正在运行锁定了数据库文件（如 `state.db`）；关闭应用后重新导入。失败的文件会列在结果报告中，不影响其他文件。
- **导出包多大？** 等于所选条目压缩后大小；技能目录（如 1.4GB 的共享技能库）建议用「手动添加」按需挑选。
- **卸载会删配置吗？** 不会。AgentPack 只读写各 agent 自己的配置文件；卸载仅移除程序本身。

## 开发

```
agentpack/
├─ registry/          # 每个 agent 一个 JSON 描述（数据驱动）
├─ packages/core/     # 纯 TS 核心库（扫描/打包/加密/导入）
├─ packages/cli/      # 命令行（esbuild 单文件打包）
└─ packages/gui/      # Electron + React（electron-vite + electron-builder）
```

```bash
npm run build        # core → cli → gui
npm test             # vitest（含 scan→export→import 端到端集成测试）
```

安全约定：任何真实凭据严禁入库（`.gitignore` 模式 + pre-commit 拦截）；测试一律使用 `test/fixtures` 假数据。

## 许可

MIT
