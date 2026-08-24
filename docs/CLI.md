# CLI 与 AI 操作指南

项目提供 `ncm-podcast` 命令行接口。普通命令直接在 Node.js 中运行并与桌面 GUI 共享登录 Cookie 和设置；只有 `music-partner run` 会按需启动一个临时 Electron 窗口。

## 1. 启动方式

先安装依赖：

```bash
npm install
```

推荐直接执行入口文件，stdout 不会混入 npm 的脚本提示：

```bash
node bin/ncm-podcast.js --help
node bin/ncm-podcast.js --json auth status
node bin/ncm-podcast.js --jsonl auth login-qr
```

也可使用 npm 脚本：

```bash
npm run --silent cli -- auth status
npm run --silent cli:json -- auth status
npm run --silent cli:jsonl -- auth login-qr
```

`npm` 10 可能把 `npm run cli -- --json ...` 中的 `--json` 或 `--help` 当作 npm 自身选项。需要机器输出时，请使用 `cli:json`/`cli:jsonl` 别名并加 `--silent`，或直接执行 `node bin/ncm-podcast.js`。

所有选项只支持长名称，例如 `--podcast-id`。查看全部或分组帮助：

```bash
node bin/ncm-podcast.js --help
node bin/ncm-podcast.js auth sms --help
node bin/ncm-podcast.js music-partner --help
```

## 2. 输出模式与输入

CLI 有三种输出模式：

| 模式 | 用途 | 形式 |
|---|---|---|
| 默认人工模式 | 人在终端中阅读和操作 | 简洁文本、格式化 JSON、终端二维码 |
| `--json` | 一次性机器调用 | stdout 只有一个 JSON 对象 |
| `--jsonl` | 登录、上传、神秘功能等流式操作 | stdout 每行一个 JSON 事件，且只有一个终止事件 |

成功的 JSON 响应：

```json
{"ok":true,"data":{"isLoggedIn":false},"meta":{"command":"auth status","version":1}}
```

失败的 JSON 响应：

```json
{"ok":false,"error":{"code":"AUTH_REQUIRED","message":"Login is required","details":null},"meta":{"command":"auth whoami","version":1}}
```

JSON Lines 中，进度事件没有 `ok`；最终一行是 `event: "result"` 或 `event: "error"`：

```jsonl
{"event":"state","data":{"status":"daily","current":1,"total":5},"meta":{"command":"music-partner run","version":1}}
{"event":"result","ok":true,"data":{"success":true},"meta":{"command":"music-partner run","version":1}}
```

服务诊断写入 stderr。Cookie、Token、API Key、密码、短信验证码和已知授权标记会被脱敏。不要把 stderr 与 stdout 合并后再把结果当 JSON 解析。

结构化输入使用 `--input`：

```bash
# 从文件读取；文件路径字段相对于 manifest.json 所在目录解析
node bin/ncm-podcast.js --json episode update --episode-id 123 --input ./manifest.json

# 从标准输入读取；文件路径字段相对于当前工作目录解析
printf '%s\n' '{"text":"歌曲信息"}' | node bin/ncm-podcast.js --json llm parse --input -
```

敏感值和复杂对象应通过 stdin 传递，不要放在命令参数中。

## 3. 命令总览

| 命令 | 主要选项/输入 | 说明 |
|---|---|---|
| `auth status` | 无 | 检查本地是否有登录 Token，不返回 Cookie |
| `auth whoami` | 无 | 向网易云验证登录并返回当前用户 |
| `auth login-qr` | `--jsonl` 或人工模式 | 显示二维码并轮询登录状态 |
| `auth sms send` | `--phone`，或输入 `phone` | 发送手机短信验证码 |
| `auth sms verify` | 输入 `phone`、`code` | 使用手机号和短信验证码登录 |
| `auth logout` | `--yes`，或输入 `confirm: true` | 清除与 GUI 共享的登录状态 |
| `podcast list` | 无 | 列出当前账号创建的播客 |
| `episode list` | `--podcast-id`；可选 `--page`、`--page-size` | 分页列出单集，页大小 1–100 |
| `episode get` | `--episode-id` | 读取单集详情 |
| `episode update` | `--episode-id`；输入更新字段 | 更新 `name`、`description`、`privacy`、`coverImgId` |
| `episode delete` | `--podcast-id`、一个或多个 `--episode-id`、`--yes` | 删除单集，必须显式确认 |
| `audio metadata` | 一个或多个 `--file`；可选 `--cover-output-dir` | 读取标签；按需写出内嵌封面 |
| `upload one` | `--podcast-id`、`--file`；可选输入元数据 | 上传一个单集 |
| `upload batch` | `--podcast-id`、`--input`、`--jsonl` | 按清单逐个上传，失败后继续 |
| `cover upload` | `--file` | 上传 jpg/jpeg/png/webp 封面 |
| `cover set-episode` | `--episode-id`、`--cover-id`；可选 `--podcast-id` | 设置单集封面 |
| `cover set-podcast` | `--podcast-id`、`--cover-id` | 设置播客封面 |
| `llm parse` | 输入 `text`；可选 `template` | 使用已配置的 OpenAI 兼容接口解析歌曲信息 |
| `settings get` | 无 | 返回非敏感设置和 `hasOpenaiApiKey` |
| `settings set` | 设置对象 | 更新 LLM 与模板设置，不回显 API Key |
| `music-partner verify` | 无 | 验证音乐合伙人所需的网易云登录态 |
| `music-partner run` | 人工模式或 `--jsonl` | 临时启动隐藏的 Electron 神秘功能窗口 |

所有播客、单集和封面 ID 都必须是正十进制整数。先查询真实 ID，不要猜测。

## 4. 登录

### 手机短信验证码

发送验证码：

```bash
node bin/ncm-podcast.js --json auth sms send --phone 13800138000
```

PowerShell 验证：

```powershell
'{"phone":"13800138000","code":"1234"}' |
  node .\bin\ncm-podcast.js --json auth sms verify --input -
```

Command Prompt 验证：

```bat
echo {"phone":"13800138000","code":"1234"}| node bin\ncm-podcast.js --json auth sms verify --input -
```

Bash 验证：

```bash
printf '%s\n' '{"phone":"13800138000","code":"1234"}' |
  node bin/ncm-podcast.js --json auth sms verify --input -
```

验证码不要作为专用命令参数传入；这样可以避免它出现在进程参数列表中。

### 二维码登录

人工模式会直接在终端绘制二维码：

```bash
node bin/ncm-podcast.js auth login-qr
```

AI 或其他程序应读取 JSON Lines，使用 `start.qrUrl` 交给用户：

```bash
node bin/ncm-podcast.js --jsonl auth login-qr
```

二维码登录最长等待 5 分钟。`--json` 不适用于需要轮询的二维码流程。

### 状态与注销

```bash
node bin/ncm-podcast.js --json auth status
node bin/ncm-podcast.js --json auth whoami
node bin/ncm-podcast.js --json auth logout --yes
```

注销会影响 GUI 与 CLI 的共享登录态，因此自动化程序必须先获得用户明确授权，才可添加 `--yes` 或传入 `{"confirm":true}`。

## 5. 播客、单集与封面

```bash
node bin/ncm-podcast.js --json podcast list
node bin/ncm-podcast.js --json episode list --podcast-id 100 --page 1 --page-size 50
node bin/ncm-podcast.js --json episode get --episode-id 200
```

更新单集：

```powershell
'{"name":"新标题","description":"新简介","privacy":false}' |
  node .\bin\ncm-podcast.js --json episode update --episode-id 200 --input -
```

删除一个或多个单集：

```bash
node bin/ncm-podcast.js --json episode delete \
  --podcast-id 100 --episode-id 200 --episode-id 201 --yes
```

不带 `--yes` 或 `confirm: true` 时，命令会在任何网络删除请求之前返回 `CONFIRMATION_REQUIRED`。

上传封面并应用返回的 `coverId`：

```bash
node bin/ncm-podcast.js --json cover upload --file ./cover.png
node bin/ncm-podcast.js --json cover set-episode --episode-id 200 --cover-id 300 --podcast-id 100
node bin/ncm-podcast.js --json cover set-podcast --podcast-id 100 --cover-id 300
```

## 6. 音频元数据与上传

读取多个文件的标签，并把内嵌封面写到指定目录：

```bash
node bin/ncm-podcast.js --json audio metadata \
  --file ./audio/a.mp3 --file ./audio/b.flac --cover-output-dir ./covers
```

不指定 `--cover-output-dir` 时，只返回封面的 MIME 类型和字节数，不把二进制数据放进 JSON。

单文件上传的可选输入字段是 `name`、`description`、`privacy` 和 `coverImgId`：

```powershell
'{"name":"节目名","description":"简介","privacy":false}' |
  node .\bin\ncm-podcast.js --json upload one --podcast-id 100 --file .\audio\song.mp3 --input -
```

批量清单 `batch-upload.json`：

```json
{
  "files": [
    {
      "file": "./audio/first.mp3",
      "name": "第一集",
      "description": "简介",
      "privacy": false,
      "coverImgId": "300"
    },
    {
      "file": "./audio/second.flac",
      "name": "第二集"
    }
  ]
}
```

清单中的相对路径以清单文件所在目录为基准：

```bash
node bin/ncm-podcast.js --jsonl upload batch --podcast-id 100 --input ./batch-upload.json
```

PowerShell 从 stdin 提交清单：

```powershell
Get-Content -Raw .\batch-upload.json |
  node .\bin\ncm-podcast.js --jsonl upload batch --podcast-id 100 --input -
```

批量上传会先验证全部本地文件，再开始网络请求。单个远程上传失败后其余项目继续；最终返回 `PARTIAL_FAILURE` 和退出码 `5`，详情位于 `error.details.succeeded` 与 `error.details.failed`。

支持的音频扩展名：mp3、wav、m4a、aac、ogg、flac。支持的封面扩展名：jpg、jpeg、png、webp。

## 7. LLM 与设置

查看设置不会返回 API Key：

```bash
node bin/ncm-podcast.js --json settings get
```

`settings set` 接受：`openaiApiKey`、`openaiBaseUrl`、`openaiModel`、`nameTemplate`、`introTemplate`、`systemPrompt`。建议通过 stdin 设置敏感值：

```bash
printf '%s\n' '{"openaiApiKey":"...","openaiModel":"gpt-4o"}' |
  node bin/ncm-podcast.js --json settings set --input -
```

解析文本：

```bash
printf '%s\n' '{"text":"企划名、歌曲、歌手和制作信息","template":{"nameTemplate":"{songTitle} - {artistName}"}}' |
  node bin/ncm-podcast.js --json llm parse --input -
```

`template` 只接受 `nameTemplate` 和 `introTemplate`。

## 8. 音乐合伙人临时 Electron 神秘功能

先验证共享登录态：

```bash
node bin/ncm-podcast.js --json music-partner verify
```

神秘功能的参考密码来自运行环境中的 `VITE_MP_PASSWORD`；为兼容现有 GUI 开发配置，也可回退到项目根目录、已被 Git 忽略的 `.env`：

```dotenv
VITE_MP_PASSWORD=请使用你自己的值
```

每次运行时，必须另外注入 `NCM_MP_PASSWORD`。CLI 会在启动 Electron 之前，用 SHA-256 等长摘要和 `crypto.timingSafeEqual` 比较两者。密码不会被放入命令参数、子进程环境、JSON 输出或日志；父进程只向 Electron 子进程发送一次性的随机授权标记。为避免新增明文密码文件，推荐在当前 shell 中临时设置两个环境变量，而不是新建 `.env`。

PowerShell：

```powershell
$unlock = Read-Host -MaskInput 'Music Partner password'
$env:VITE_MP_PASSWORD = $unlock
$env:NCM_MP_PASSWORD = $unlock
$unlock = $null
node .\bin\ncm-podcast.js --jsonl music-partner run
Remove-Item Env:NCM_MP_PASSWORD
Remove-Item Env:VITE_MP_PASSWORD
```

Command Prompt 没有可靠的原生遮罩输入，可从 CMD 调用 PowerShell，在该子进程中完成遮罩读取、运行和清理：

```bat
powershell -NoProfile -Command "$s=Read-Host -AsSecureString 'Music Partner password'; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { $v=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p); $env:VITE_MP_PASSWORD=$v; $env:NCM_MP_PASSWORD=$v; node .\bin\ncm-podcast.js --jsonl music-partner run } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p); Remove-Item Env:NCM_MP_PASSWORD -ErrorAction SilentlyContinue; Remove-Item Env:VITE_MP_PASSWORD -ErrorAction SilentlyContinue }"
```

Bash：

```bash
read -rsp 'Music Partner password: ' NCM_MP_PASSWORD; echo
export NCM_MP_PASSWORD VITE_MP_PASSWORD="$NCM_MP_PASSWORD"
node bin/ncm-podcast.js --jsonl music-partner run
unset NCM_MP_PASSWORD VITE_MP_PASSWORD
```

运行行为：

- Electron 使用唯一的内存 session，窗口默认隐藏，后台节流已关闭。
- 终端只能显示结构化评分进度，无法把完整 H5 页面渲染到命令行中。
- 遇到必须由人选择或处理的页面时，CLI 发出 `intervention` 事件并显示、聚焦临时窗口。
- 人工解除阻塞后自动从同一检查点继续；中断时的检查点保存在共享数据目录中。
- 成功、失败、30 分钟超时、父进程退出或 Ctrl+C 都会走幂等清理，关闭窗口、清除临时 session、删除 preload 并退出 Electron。
- Ctrl+C 返回退出码 `130`。不要强制结束 Electron 子进程，除非正常取消流程已经失效。

`--json` 会在密码校验和 Electron 启动之前返回 `INVALID_INPUT`；机器调用必须使用 `--jsonl`。

## 9. 数据目录

CLI 默认与 Electron GUI 使用同一数据目录：

| 平台 | 默认目录 |
|---|---|
| Windows | `%APPDATA%\NCM-Podcast-Assistant` |
| macOS | `~/Library/Application Support/NCM-Podcast-Assistant` |
| Linux | `$XDG_CONFIG_HOME/NCM-Podcast-Assistant`，未设置时为 `~/.config/NCM-Podcast-Assistant` |

可以用 `NCM_DATA_DIR` 覆盖。相对路径会按当前平台解析为绝对路径：

```powershell
$env:NCM_DATA_DIR = Join-Path $PWD '.ncm-podcast-data'
node .\bin\ncm-podcast.js --json auth status
```

```bash
NCM_DATA_DIR="$PWD/.ncm-podcast-data" node bin/ncm-podcast.js --json auth status
```

`.ncm-podcast-data/` 已加入项目 `.gitignore`。若指定其他仓库内目录，请自行将其加入 `.gitignore`；其中可能包含登录 Cookie、设置和神秘功能检查点。

## 10. 退出码

| 退出码 | 公共错误码 | 含义 |
|---:|---|---|
| 0 | 无 | 成功 |
| 2 | `INVALID_INPUT`、`CONFIRMATION_REQUIRED` | 参数/JSON 无效，或危险操作缺少确认 |
| 3 | `AUTH_REQUIRED`、`UNLOCK_FAILED` | 未登录，或音乐合伙人解锁失败 |
| 4 | `IO_ERROR`、`REMOTE_ERROR` | 本地文件或远程服务失败；未知错误也映射到 4 |
| 5 | `PARTIAL_FAILURE` | 批量操作部分成功、部分失败 |
| 124 | `TIMEOUT` | 操作超时 |
| 130 | `CANCELLED` | 操作被取消或收到 Ctrl+C |

程序应同时检查进程退出码和 JSON 中的公共 `error.code`，不要解析可能调整措辞的 `message`。

## 11. AI 操作策略

AI 或自动化代理应遵循以下规则：

1. 先调用精确前缀的 `--help`，再构造命令；不要依赖记忆猜测参数。
2. 一次性操作优先 `--json`，二维码、批量上传和音乐合伙人等流式操作使用 `--jsonl`。
3. 结构化或敏感数据通过 `--input -` 和 stdin 传递；不要把密码、短信验证码、API Key 或 Cookie 放入命令参数。
4. 先查询播客、单集和封面 ID，绝不编造标识符。
5. 删除单集或注销前必须获得用户明确授权；未授权时不得添加 `--yes` 或 `confirm: true`。
6. 依据退出码和公共 `error.code` 分支处理，不要解析错误消息文本。
7. stdout 按 JSON/JSONL 协议解析；stderr 仅作为已脱敏诊断信息保存。
8. 对 `PARTIAL_FAILURE` 检查 `error.details`，不要因为部分成功而重复上传所有文件。
9. 收到 `manual-intervention-required` 时通知用户接管 Electron 窗口，等待 CLI 自行恢复，不要模拟不确定的选择。

## 12. 常见问题

- **执行 npm 命令只看到 npm 帮助**：直接用 `node bin/ncm-podcast.js --help`；机器模式使用 `npm run --silent cli:json` 或 `cli:jsonl`。
- **`AUTH_REQUIRED`**：先完成 SMS 或二维码登录，并确认 CLI 与 GUI 使用相同数据目录。
- **`UNLOCK_FAILED`**：确认运行时 `NCM_MP_PASSWORD` 与 `VITE_MP_PASSWORD`/项目 `.env` 完全一致，且没有多余空格。
- **`INVALID_INPUT: JSON input is invalid`**：检查 shell 引号，或改用 UTF-8 JSON 文件和 `--input <file>`。
- **相对文件找不到**：文件输入的相对路径以 JSON 文件目录为准；stdin 输入以当前目录为准。
- **机器输出无法解析**：不要合并 stderr；通过 npm 调用时使用 `--silent`，或直接运行 Node 入口。
- **人工介入窗口没有出现**：确认桌面会话允许显示 Electron 窗口，并查看 JSONL 中是否已经出现 `intervention` 事件。
