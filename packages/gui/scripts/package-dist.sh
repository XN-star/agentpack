#!/usr/bin/env bash
# 在 ASCII 路径独立目录中打包 NSIS（绕开两类问题：
#   1) electron-builder 在中文/非 ASCII 仓库路径下 spawn app-builder ENOENT
#   2) electron-builder 依赖收集步骤会破坏仓库根 node_modules）
# 用法：bash packages/gui/scripts/package-dist.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
STAGE_WIN="${AGENTPACK_STAGE:-C:\AgentPackDist}"
# Windows 路径 → MSYS 路径（/c/AgentPackDist）。不能用 "/C:/..." 形式，
# 那会被 MSYS 解析到 Git 安装目录下的字面目录
STAGE_POSIX=$(cygpath -u "$STAGE_WIN")

echo "仓库: $REPO"
echo "打包暂存目录: $STAGE"

# 1) 准备暂存目录（保持 electron-builder.yml 的 ../../registry 相对布局）
rm -rf "$STAGE_POSIX"
mkdir -p "$STAGE_POSIX/packages/gui"
cp -r "$REPO/packages/gui/out" "$STAGE_POSIX/packages/gui/out"
cp -r "$REPO/packages/gui/build" "$STAGE_POSIX/packages/gui/build"
cp "$REPO/packages/gui/electron-builder.yml" "$STAGE_POSIX/packages/gui/"
cp "$REPO/packages/gui/build/standalone-package.json" "$STAGE_POSIX/packages/gui/package.json"
cp -r "$REPO/registry" "$STAGE_POSIX/registry"
mkdir -p "$STAGE_POSIX/packages/cli"
cp -r "$REPO/packages/cli/dist" "$STAGE_POSIX/packages/cli/dist"

# 2) 独立安装 electron 工具链并打包
cd "$STAGE_POSIX/packages/gui"
npm install --no-audit --no-fund
npx electron-builder --win

# 3) 产物拷回仓库
mkdir -p "$REPO/packages/gui/release"
cp -f "$STAGE_POSIX/packages/gui/release/"*.exe "$REPO/packages/gui/release/" || true
cp -f "$STAGE_POSIX/packages/gui/release/"*.blockmap "$REPO/packages/gui/release/" || true

echo "完成：$REPO/packages/gui/release/"
