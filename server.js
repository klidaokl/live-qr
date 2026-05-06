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
app.get('/admin/api/codes', checkAuth, (req, res) => {
  res.json(db.getAllCodes());
});

// 创建活码
app.post('/admin/api/codes', checkAuth, (req, res) => {
  const { name, code, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: '名称和跳转URL不能为空' });
  }
  const shortCode = code || nanoid(6);
  try {
    const id = db.createCode(name, shortCode, url);
    res.json({ id, code: shortCode, name, url });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: '短码已存在，请换一个' });
    }
    throw e;
  }
});

// 更新活码
app.put('/admin/api/codes/:id', checkAuth, (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: '名称和跳转URL不能为空' });
  }
  const row = db.updateCode(Number(req.params.id), name, url);
  if (row.changes === 0) {
    return res.status(404).json({ error: '活码不存在' });
  }
  res.json({ success: true });
});

// 删除活码
app.delete('/admin/api/codes/:id', checkAuth, (req, res) => {
  db.deleteCode(Number(req.params.id));
  res.json({ success: true });
});

// 扫码统计
app.get('/admin/api/codes/:id/stats', checkAuth, (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const stats = db.getCodeStats(Number(req.params.id), days);
  res.json(stats);
});

// 生成二维码
app.get('/admin/api/codes/:id/qrcode', checkAuth, async (req, res) => {
  const code = db.getCodeById(Number(req.params.id));
  if (!code) {
    return res.status(404).json({ error: '活码不存在' });
  }
  const format = req.query.format || 'png';
  const size = parseInt(req.query.size) || 400;
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const targetUrl = `${baseUrl}/${code.code}`;

  try {
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

app.get('/:code', (req, res) => {
  const { code } = req.params;

  // 排除静态资源和API路径
  if (['admin', 'favicon.ico'].includes(code)) {
    return res.status(404).send('Not Found');
  }

  const record = db.getCodeByCode(code);
  if (!record) {
    return res.status(404).send('该活码不存在');
  }

  // 记录扫码
  const ip = req.ip || req.connection.remoteAddress;
  const ua = req.get('user-agent') || '';
  const source = parseSource(ua);
  db.recordScan(record.id, ip, ua, source);

  // 302重定向
  res.redirect(302, record.url);
});

// ========== 启动 ==========

app.listen(PORT, () => {
  console.log(`活码系统已启动: http://localhost:${PORT}`);
  console.log(`管理后台: http://localhost:${PORT}/admin`);
});
