# 康比特活码管理系统 — AI 开发提示词

> 复制以下内容到新的 AI 对话框即可，包含完整的系统背景、技术架构、功能清单和已知坑点。

---

## 提示词（直接复制）

---

你是一个全栈开发助手，现在要帮我维护一个「康比特活码管理系统」。以下是系统的完整背景信息，请仔细阅读。

## 项目背景

这是一个用于康比特私域运营的活码（动态二维码）管理系统。主要用途是管理推广二维码（淘宝/京东/天猫等电商链接），用户扫码后可以跳转到商品页面或展示 H5 营销落地页。

## 技术栈

- **后端**：Node.js + Express 4.x
- **数据库**：PostgreSQL（Neon），表名 `codes`（活码）和 `scans`（扫码记录）。有 DATABASE_URL 用 PostgreSQL，无则降级内存存储
- **前端**：原生 HTML + Tailwind CSS（CDN）+ Chart.js
- **二维码**：qrcode 库（服务端生成）
- **文件上传**：multer（本地磁盘 uploads/ 目录）
- **唯一ID**：nanoid（6位短码）
- **部署**：Railway（免费套餐），GitHub 仓库 `klidaokl/live-qr`

## 项目结构

```
live-qr/
├── server.js            # 后端服务入口（Express API + 路由 + 启动逻辑）
├── db.js                # 数据库模块（PostgreSQL / 内存双模式）
├── package.json         # 依赖：express, pg, multer, nanoid, qrcode
├── railway.json         # Railway 部署配置
├── Procfile             # web: node server.js
├── uploads/             # 上传图片存储目录
└── public/
    ├── index.html       # 管理后台页面（活码CRUD + H5编辑器 + 统计）
    └── landing.html     # 用户扫码看到的 H5 落地页模板
```

## 核心功能

### 1. 活码管理
- 支持两种模式：**直接跳转**（302 重定向）/ **H5 营销页**（可视化落地页）
- CRUD 操作：创建、编辑、删除、复制活码
- 短码自动生成（nanoid 6位），也可手动指定

### 2. H5 落地页编辑器
- 管理后台内置可视化编辑器，左侧手机实时预览 + 右侧模块管理
- 支持模块类型：图片、文字、按钮、分割线、间距
- 图片模块可配：商品名称、图片URL、跳转链接、淘口令、圆角
- 文字模块可配：内容、字号、颜色、对齐、加粗
- 按钮模块可配：按钮文字、跳转链接、淘口令、颜色、圆角

### 3. 扫码统计
- 记录每次扫码的 IP、UA、来源（wechat/browser/alipay/dingtalk/weibo/other）
- 统计面板：总扫码次数、独立UV、30天趋势折线图、来源分布饼图

### 4. 二维码功能
- 服务端生成二维码图片（支持 PNG/SVG）
- 管理后台支持下载二维码、在线预览二维码、复制链接
- 二维码内容为活码访问地址（如 `https://域名/短码`）

### 5. 微信兼容机制（重点）
微信内置浏览器会屏蔽淘宝/天猫等外部链接，`landing.html` 前端实现了链接拦截和分流：

**域名分类**：
- **淘系域名**（走淘口令弹窗）：`tmall.com`, `taobao.com`, `tb.cn`, `e.tb.cn`, `m.tb.cn`, `a.m.taobao.com`, `s.click.taobao.com`, `uland.taobao.com`
- **京东域名**（不拦截，正常跳转）：`jd.com`, `3.cn`, `m.jd.com`
- **其他屏蔽域名**（走浏览器引导遮罩）：`douyin.com`, `tiktok.com`, `pinduoduo.com`, `yangkeduo.com`

**淘口令弹窗逻辑**：
1. 检测到微信环境 + 淘系域名 → 阻止默认跳转 → 弹淘口令复制弹窗
2. 用户点击复制 → 自动复制到剪贴板 → 打开淘宝 APP 自动弹出商品
3. 图片配置了 taoCode 但没有 link → 点击图片也弹淘口令
4. 无淘口令也无链接的图片 → 纯展示不可点击

### 6. 防缓存机制
- 服务端对落地页和 API 响应设置 `Cache-Control: no-store, no-cache`
- 解决微信浏览器缓存旧 HTML 导致页面空白的问题

### 7. 冷启动保护
- `server.js` 有 `dbReady` 标志，数据库未就绪时返回 503 + "系统启动中"提示页
- 防止 Railway 冷启动时数据库连接失败导致用户看到错误页

## API 接口

### 公开接口
- `GET /:code` — 短码访问（redirect 模式302跳转，landing 模式返回 H5）
- `GET /api/landing/:code` — 获取 H5 落地页配置 JSON
- `GET /health` — 健康检查

### 管理接口（需 Authorization: Bearer <密码>）
- `GET /admin/api/codes` — 获取所有活码列表
- `POST /admin/api/codes` — 创建活码
- `PUT /admin/api/codes/:id` — 更新活码
- `DELETE /admin/api/codes/:id` — 删除活码
- `POST /admin/api/codes/:id/duplicate` — 复制活码
- `GET /admin/api/codes/:id/stats?days=30` — 扫码统计
- `GET /admin/api/codes/:id/qrcode?format=png&size=400` — 生成二维码
- `POST /admin/api/upload` — 上传图片（multipart, 字段名: image, 限5MB）

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | 3000 |
| `DATABASE_URL` | PostgreSQL 连接串 | 空（降级内存模式） |
| `ADMIN_PASSWORD` | 管理密码 | admin123 |
| `BASE_URL` | 二维码基础URL | 自动取请求头 |

## 数据库表结构

```sql
-- 表名是 codes，不是 qr_codes！
CREATE TABLE codes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'redirect',
  landing_config JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE scans (
  id SERIAL PRIMARY KEY,
  code_id INTEGER NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  ip TEXT DEFAULT '',
  ua TEXT DEFAULT '',
  source TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 已踩过的坑（新开发务必注意）

1. **表名是 `codes`**，不是 `qr_codes`，db.js 里写死的
2. **`3.cn` 是京东域名**，不能放进淘系域名列表，否则京东链接会被错误拦截弹淘口令
3. **`tb.cn`、`e.tb.cn` 等短域名**必须在淘系域名列表中，否则淘口令弹窗不会触发
4. **微信缓存极其激进**，必须设置 `Cache-Control: no-store`，否则用户可能看到旧版本页面
5. **Railway 冷启动**时数据库连接可能失败，必须有 503 保护机制
6. **淘口令弹窗触发条件**：只在微信内 + 淘系域名（或无链接但有 taoCode）时才触发，不能所有图片都弹
7. **图片无链接但有 taoCode 时**，需要用 `<a href="#">` 包裹才能触发点击事件
8. **图片上传目录** `uploads/` 需要有写入权限，多实例部署时需共享存储

## 架构局限（后续可优化）

- 图片存储在本地磁盘，不支持 CDN，多实例需改用 OSS
- 管理后台只有单一密码认证，无多用户/角色权限
- 无管理操作审计日志
- Railway 免费套餐有冷启动延迟（5-10秒）

## 部署交接文档

项目根目录下有 `部署交接文档.md`，包含完整的部署步骤（云服务器/Docker/Railway 三种方案）、数据迁移方法、运维注意事项。

---

以上是这个系统的完整上下文。请基于这些信息帮我进行后续的开发和维护工作。
