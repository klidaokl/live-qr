const express = require('express');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// uploads 目录
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// multer 配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${nanoid(8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('仅支持 jpg/png/webp/gif 格式'));
  }
});

// ========== 管理后台API ==========

// 简单密码校验中间件
function checkAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || auth !== `Bearer ${ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: '未授权' });
  }
  next();
}

// 活码列表
app.get('/admin/api/codes', checkAuth, async (req, res) => {
  try {
    res.json(await db.getAllCodes());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 创建活码
app.post('/admin/api/codes', checkAuth, async (req, res) => {
  const { name, code, url, mode, landing_config } = req.body;
  const useMode = mode || 'redirect';
  if (!name) {
    return res.status(400).json({ error: '名称不能为空' });
  }
  if (useMode === 'redirect' && !url) {
    return res.status(400).json({ error: '跳转URL不能为空' });
  }
  const shortCode = code || nanoid(6);
  try {
    const id = await db.createCode(name, shortCode, url || '', useMode, landing_config || null);
    res.json({ id, code: shortCode, name, url: url || '', mode: useMode, landing_config });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: '短码已存在，请换一个' });
    }
    res.status(500).json({ error: e.message });
  }
});

// 更新活码
app.put('/admin/api/codes/:id', checkAuth, async (req, res) => {
  const { name, url, mode, landing_config } = req.body;
  if (!name) {
    return res.status(400).json({ error: '名称不能为空' });
  }
  try {
    const row = await db.updateCode(Number(req.params.id), name, url || '', mode, landing_config);
    if (row.changes === 0) {
      return res.status(404).json({ error: '活码不存在' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 复制活码
app.post('/admin/api/codes/:id/duplicate', checkAuth, async (req, res) => {
  try {
    const original = await db.getCodeById(Number(req.params.id));
    if (!original) {
      return res.status(404).json({ error: '活码不存在' });
    }
    const { nanoid } = require('nanoid');
    const newCode = nanoid(6);
    const newName = original.name + ' (副本)';
    const newId = await db.createCode(
      newName, newCode, original.url || '', original.mode || 'redirect',
      original.landing_config || null
    );
    res.json({ id: newId, code: newCode, name: newName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除活码
app.delete('/admin/api/codes/:id', checkAuth, async (req, res) => {
  try {
    await db.deleteCode(Number(req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 扫码统计
app.get('/admin/api/codes/:id/stats', checkAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const stats = await db.getCodeStats(Number(req.params.id), days);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 生成二维码
app.get('/admin/api/codes/:id/qrcode', checkAuth, async (req, res) => {
  try {
    const code = await db.getCodeById(Number(req.params.id));
    if (!code) {
      return res.status(404).json({ error: '活码不存在' });
    }
    const format = req.query.format || 'png';
    const size = parseInt(req.query.size) || 400;
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const targetUrl = `${baseUrl}/${code.code}`;

    if (format === 'svg') {
      const svg = await QRCode.toString(targetUrl, { type: 'svg', width: size });
      res.type('image/svg+xml').send(svg);
    } else {
      const png = await QRCode.toBuffer(targetUrl, { width: size, margin: 2 });
      res.type('image/png').send(png);
    }
  } catch (e) {
    res.status(500).json({ error: '二维码生成失败' });
  }
});

// 图片上传
app.post('/admin/api/upload', checkAuth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请选择图片' });
  }
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const imageUrl = `${baseUrl}/uploads/${req.file.filename}`;
  res.json({ url: imageUrl, filename: req.file.filename });
}, (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: `上传失败: ${err.message}` });
  } else if (err) {
    res.status(400).json({ error: err.message });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ========== 核心功能：短码访问 ==========

// 落地页配置 API（公开，供 landing.html 前端获取）
app.get('/api/landing/:code', async (req, res) => {
  try {
    const record = await db.getCodeByCode(req.params.code);
    if (!record || record.mode !== 'landing' || !record.landing_config) {
      return res.status(404).json({ error: 'not found' });
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(record.landing_config);
  } catch (e) {
    res.status(500).json({ error: 'server error' });
  }
});

function parseSource(ua) {
  if (!ua) return 'other';
  const lower = ua.toLowerCase();
  if (lower.includes('micromessenger')) return 'wechat';
  if (lower.includes('alipay')) return 'alipay';
  if (lower.includes('dingtalk')) return 'dingtalk';
  if (lower.includes('weibo')) return 'weibo';
  return 'browser';
}

// admin页面
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 短码访问
app.get('/:code', async (req, res) => {
  const { code } = req.params;

  // 排除静态资源和管理路径
  if (['favicon.ico', 'admin', 'health'].includes(code)) {
    return res.status(404).send('Not Found');
  }

  try {
    const record = await db.getCodeByCode(code);
    if (!record) {
      return res.status(404).send('该活码不存在');
    }

    // 记录扫码（异步，不阻塞响应）
    const ip = req.ip || req.connection.remoteAddress;
    const ua = req.get('user-agent') || '';
    const source = parseSource(ua);
    db.recordScan(record.id, ip, ua, source).catch(() => {});

    // 根据模式决定行为
    if (record.mode === 'landing' && record.landing_config) {
      // H5 落地页模式 — 渲染 landing.html 模板，禁止缓存
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.sendFile(path.join(__dirname, 'public', 'landing.html'));
      return;
    }

    // 默认：302重定向
    if (record.url) {
      res.redirect(302, record.url);
    } else {
      res.status(404).send('该活码未配置跳转地址');
    }
  } catch (e) {
    res.status(500).send('服务异常');
  }
});

// ========== 启动 ==========

// 数据库初始化完成标志 — 未就绪时返回 503
let dbReady = false;

// 短码访问前检查数据库就绪状态
app.use('/:code', async (req, res, next) => {
  // 排除静态资源和管理路径
  const code = req.params.code;
  if (['favicon.ico', 'admin', 'health', 'uploads', 'api'].includes(code)) return next();

  if (!dbReady) {
    return res.status(503).send('<html><body style="text-align:center;padding:80px 20px;color:#999"><p style="font-size:48px;margin-bottom:16px">⏳</p><p>系统启动中，请稍后刷新</p></body></html>');
  }
  next();
});

// 立即监听端口（Railway要求快速响应），db异步初始化
app.listen(PORT, '0.0.0.0', () => {
  console.log(`活码系统已启动: http://0.0.0.0:${PORT}`);
  console.log(`管理后台: http://0.0.0.0:${PORT}/admin`);
});

// 异步初始化数据库
db.init().then(() => {
  dbReady = true;
  console.log('✅ 数据库已就绪，开始接收请求');
}).catch(err => {
  console.error('数据库初始化失败:', err.message);
  if (process.env.DATABASE_URL) process.exit(1); // 有PG连接串时初始化失败才退出
});

process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err.message);
  process.exit(1);
});
