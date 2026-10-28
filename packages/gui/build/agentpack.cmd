@echo off
rem AgentPack CLI 垫片：复用 Electron 运行时以 Node 模式执行 CLI 脚本（无需单独安装 Node.js）
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\AgentPack.exe" "%~dp0cli\index.js" %*
endlocal
