# JADEVEIL 发布说明

> 线上地址：**https://jadeveil.vibe.citrolabs.dev**（受 Cloudflare Zero Trust 保护，未登录会被拦截）
> 部署方式：**Cloudflare Workers Static Assets**（没有 Worker 入口脚本，纯静态资源）
> 本文件面向「以后还要再放第二个作品」的场景，照着 §7 的清单做即可。

---

## 1. 结论速览

| 项目 | 值 |
| --- | --- |
| 线上域名 | `jadeveil.vibe.citrolabs.dev` |
| Worker 名 | `jadeveil` |
| 部署方式 | Workers Static Assets（`assets.directory`，无 `main` 入口） |
| 路由 | 唯一一条 Custom Domain |
| 保护 | Cloudflare Access（Zero Trust），复用组织级可复用策略 **Team-Only** |
| Cloudflare 账号 | `<cloudflare-account-email>`（Account ID `<ACCOUNT_ID>`） |
| Zone | `citrolabs.dev`（`vibe.citrolabs.dev` **不是**独立 zone，只是该 zone 下的主机名） |
| Team 域 | `<team>.cloudflareaccess.com` |

同款做法的既有站点：`<internal-site-a>`、`<internal-site-b>`、`<internal-site-c>`。

---

## 2. 为什么是「Workers Static Assets」而不是别的

**不用 cloudflared tunnel。** 这台机器上并没有装 `cloudflared`（`~/.cloudflared/` 不存在），
用户既有的内部站点没有一个是 tunnel 方案；tunnel 还要求本机常驻一个服务进程，
一旦机器合盖/重启，站点就挂了。静态资源放进 Worker 是纯云端、无本地依赖的。

**不用 Cloudflare Pages。** 既有内部站点的统一形态就是 Workers Static Assets
（`deb` / `keel-website` 都是：只发静态资源、关掉 `workers.dev` 与预览域名、只绑一条 Custom Domain）。
新增站点沿用同一形态，运维动作、权限、验证方式才是一致的。

**为什么要先把 three vendor 进仓库。** `index.html` 的 importmap 原本指向
`./node_modules/three/...`，而 `node_modules/` 既被 `.gitignore` 排除、也不会随静态资源上传，
直接部署会 404。所以用 `scripts/vendor-three.mjs` 把真正用到的文件（核心 + 5 个后处理模块
及其依赖）导出到 `vendor/three/`，importmap 改指 `vendor/`。
**副作用是好的**：`node_modules/` 现在是纯 devDependency，clone 下来 `node serve.mjs 8123` 就能直接跑。

---

## 3. 仓库里与本发布相关的文件

| 文件 | 作用 |
| --- | --- |
| `wrangler.jsonc` | Worker 名、Custom Domain 路由、静态资源目录 |
| `.assetsignore` | 只影响上传范围：排除 `node_modules/`、`screenshots/`、`docs/`、`scripts/`、`.git/` 等（**不影响 git，也不影响本地开发**） |
| `index.html` | importmap 指向 `./vendor/three/...` |
| `scripts/vendor-three.mjs` | 从 `node_modules/three` 递归导出真正用到的文件到 `vendor/three/` |
| `vendor/three/` | 已入库的 three（含 VERSION.txt）。**改 three 版本或新增 addons 后必须重跑 `npm run vendor`** |
| `serve.mjs` | 本地预览服务器（`node serve.mjs 8123`），不参与线上部署 |

上传范围实测：**42 个文件**（`index.html` + `src/**` + `tests/**` + `vendor/**`）。
`node_modules/`（约 2900 文件）与 `screenshots/`（21MB）都在 `.assetsignore` 里被排除。

---

## 4. 部署步骤

```bash
cd ~/Projects/pandaria-voxel
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:/opt/homebrew/bin:$PATH"

# 1) 依赖（wrangler 是项目内 devDependency，版本 4.125.0）
npm install
#    若报 esbuild 被系统杀掉（SIGKILL）：npm 下载的二进制带了 com.apple.quarantine，
#    执行 xattr -dr com.apple.quarantine node_modules 后重试。

# 2) 自包含检查（改过 three 版本/新增 addons 时才需要重跑）
npm run vendor

# 3) 先看要传什么，不动线上
npm run deploy:dry-run

# 4) ★ 先确认 Access 应用已存在（见 §5），否则会出现公网空窗期
# 5) 发布
npm run deploy
```

回滚：`wrangler rollback`（或把 `wrangler.jsonc` 的 routes 去掉再 deploy，域名立刻不再指向本 Worker）。

---

## 5. Zero Trust（Cloudflare Access）配置

为了让域名「未登录直接看不到游戏」，需要在 Cloudflare Zero Trust 里为该主机名建一个 **Self-hosted 应用**：

- **应用域名**：`jadeveil.vibe.citrolabs.dev`
- **策略**：复用组织里已有的可复用策略 **Team-Only**
  （policy id `<ACCESS_POLICY_ID>`；放行邮箱后缀 the organization's email domain，其余默认拒绝）
- **会话时长**：24 小时（与其它内部站点一致）
- **IdP**：OIDC SSO ＋ 邮箱 OTP（与其它内部站点一致）

⚠️ **顺序很重要**：先建 Access 应用，再 `npm run deploy`。
反过来会出现「域名已能打开、但还没被 Access 挡住」的公网空窗期。

⚠️ **wrangler 改不了 Access**：本地 wrangler 用的是 OAuth 身份，
权限里只有 Workers / Zone / DNS 之类，**没有 Access 的读写权限**。
Access 应用只能在 Zero Trust Dashboard 里人工创建/修改（或用带 `Access: Edit` 的 API Token）。
日常改站、重新部署不需要动 Access。

---

## 6. 部署后的验证

```bash
# ① 未认证：应当是 302 跳转到 Cloudflare Access 登录页，而不是直接返回游戏 HTML
curl -sI https://jadeveil.vibe.citrolabs.dev/ | head -5
# 期望：
#   HTTP/2 302
#   location: https://<team>.cloudflareaccess.com/cdn-cgi/access/login/jadeveil.vibe.citrolabs.dev?...

# ② 认证后：用已在 Access 登录过的浏览器打开 https://jadeveil.vibe.citrolabs.dev/
#    应看到 JADEVEIL 游戏（标题栏 / 像素 UI / 体素世界），且页面无 404、无控制台报错。
```

`curl` 拿到 **200 且返回游戏 HTML** 就说明 Access 没生效，要回到 §5 检查。

---

## 7. 新增第二个作品时的清单

1. 项目里加 `wrangler.jsonc`：`name` 用作品名；`routes` 一条 `{ "pattern": "<作品名>.vibe.citrolabs.dev", "custom_domain": true }`；
   `assets.directory` 指向站点根目录。
2. `workers_dev: false`、`preview_urls: false` —— 不要留下任何公开入口。
3. 让站点**自包含**：不要引用 `node_modules/`，需要的依赖 vendor 进仓库并入库；
   加 `.assetsignore` 排除 node_modules / 截图 / 文档等。
4. 在 **Zero Trust Dashboard** 里为该主机名新建 Self-hosted Access 应用，
   策略复用 **Team-Only**（session 24h）。**先建 Access，再部署。**
5. `npm install` → `npm run deploy:dry-run`（确认上传清单）→ `npm run deploy`。
6. 验证：`curl -sI` 必须看到 302 到 `<team>.cloudflareaccess.com` 的登录跳转；
   浏览器登录后必须看到作品本体。
7. 本地提交（**不建远程仓库、不 push**）。

---

## 8. 注意事项

- **不要建公开路由**：`workers_dev` / `preview_urls` 保持关闭，Custom Domain 建之前先有 Access。
- **不要提交凭据**：仓库里不出现任何 token、`cert.pem`、`~/.cf` 或 `~/.wrangler` 的内容。
  本说明只写「身份是 <cloudflare-account-email>」，不记录任何密钥。
- **不要去改既有站点**：`deb` / `keel-website` / `harness-book` 的 Worker、路由、Access 应用与本项目互不影响，
  只做新增。
- **本机环境备注**：`node` 需显式加进 PATH（`~/.nvm/versions/node/v24.11.0/bin`）；
  系统里没有 GNU `timeout`；`git` 用 `/opt/homebrew/bin/git`（`/usr/bin/git` 会撞上 Xcode 许可弹窗）。
