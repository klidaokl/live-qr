const express = require('express');
const QRCode = require('qrcode');
const path = require('path');
const { nanoid } = require('nanoid');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  const { name, code, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: '名称和跳转URL不能为空' });
  }
  const shortCode = code || nanoid(6);
  try {
    const id = await db.createCode(name, shortCode, url);
    res.json({ id, code: shortCode, name, url });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: '短码已存在，请换一个' });
    }
    res.status(500).json({ error: e.message });
  }
});

// 更新活码
app.put('/admin/api/codes/:id', checkAuth, async (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: '名称和跳转URL不能为空' });
  }
  try {
    const row = await db.updateCode(Number(req.params.id), name, url);
    if (row.changes === 0) {
      return res.status(404).json({ error: '活码不存在' });
    }
    res.json({ success: true });
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

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ========== 核心功能：短码重定向 ==========

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

// 短码重定向
app.get('/:code', async (req, res) => {
  const { code } = req.params;

  // 排除静态资源路径
  if (['favicon.ico'].includes(code)) {
    return res.status(404).send('Not Found');
  }

  try {
    const record = await db.getCodeByCode(code);
    if (!record) {
      return res.status(404).send('该活码不存在');
    }

    // 记录扫码（异步，不阻塞重定向）
    const ip = req.ip || req.connection.remoteAddress;
    const ua = req.get('user-agent') || '';
    const source = parseSource(ua);
    db.recordScan(record.id, ip, ua, source).catch(() => {});

    // 302重定向
    res.redirect(302, record.url);
  } catch (e) {
    res.status(500).send('服务异常');
  }
});

// ========== 启动 ==========

db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`活码系统已启动: http://localhost:${PORT}`);
    console.log(`管理后台: http://localhost:${PORT}/admin`);
  });
}).catch(err => {
  console.error('数据库初始化失败:', err.message);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err.message);
  process.exit(1);
});
