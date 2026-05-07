/**
 * 双模式数据库：有 DATABASE_URL 用 PostgreSQL，无则降级内存存储
 * Railway 自动注入 DATABASE_URL，本地开发无需配置
 */

const { Pool } = require('pg');

// 环境变量
const DATABASE_URL = process.env.DATABASE_URL || '';

// ========== 内存模式（本地降级） ==========

let nextId = 1;
const memCodes = new Map();
const memScans = [];

function memGetAllCodes() {
  const rows = [];
  for (const c of memCodes.values()) {
    const scanCount = memScans.filter(s => s.code_id === c.id).length;
    rows.push({ ...c, scan_count: scanCount });
  }
  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return rows;
}
function memGetCodeById(id) { return memCodes.get(id) || null; }
function memGetCodeByCode(code) {
  for (const c of memCodes.values()) { if (c.code === code) return c; }
  return null;
}
function memCreateCode(name, code, url, mode, landingConfig) {
  if (memGetCodeByCode(code)) { const e = new Error('UNIQUE constraint failed: codes.code'); throw e; }
  const id = nextId++;
  memCodes.set(id, { id, name, code, url, mode: mode || 'redirect', landing_config: landingConfig || null, created_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  return id;
}
function memUpdateCode(id, name, url, mode, landingConfig) {
  const c = memCodes.get(id); if (!c) return { changes: 0 }; c.name = name; c.url = url; if (mode !== undefined) c.mode = mode; if (landingConfig !== undefined) c.landing_config = landingConfig; return { changes: 1 };
}
function memDeleteCode(id) {
  memCodes.delete(id);
  for (let i = memScans.length - 1; i >= 0; i--) { if (memScans[i].code_id === id) memScans.splice(i, 1); }
}
function memRecordScan(codeId, ip, ua, source) {
  memScans.push({ id: memScans.length + 1, code_id: codeId, ip, ua, source, created_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
}
function memGetCodeStats(codeId, days = 30) {
  const filtered = memScans.filter(s => s.code_id === codeId);
  const total = filtered.length;
  const uv = new Set(filtered.map(s => s.ip)).size;
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const dailyMap = {};
  for (const s of filtered) {
    const date = s.created_at.slice(0, 10);
    if (date >= cutoffStr) {
      if (!dailyMap[date]) dailyMap[date] = { count: 0, uvSet: new Set() };
      dailyMap[date].count++; dailyMap[date].uvSet.add(s.ip);
    }
  }
  const daily = Object.keys(dailyMap).sort().map(d => ({ date: d, count: dailyMap[d].count, uv: dailyMap[d].uvSet.size }));
  const sourceMap = {};
  for (const s of filtered) sourceMap[s.source] = (sourceMap[s.source] || 0) + 1;
  return { total, uv, daily, sources: Object.entries(sourceMap).map(([source, count]) => ({ source, count })) };
}

// ========== 初始化：选择模式 ==========

let usePostgres = false;
let pool;

if (DATABASE_URL) {
  usePostgres = true;
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  console.log('✅ 数据库模式: PostgreSQL');
} else {
  console.log('⚠️ 未检测到 DATABASE_URL，使用内存存储（数据不持久化）');
}

// ========== 导出统一的接口 ==========

async function init() {
  if (!usePostgres) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS codes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'redirect',
      landing_config JSONB DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY,
      code_id INTEGER NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
      ip TEXT DEFAULT '',
      ua TEXT DEFAULT '',
      source TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_scans_code_id ON scans(code_id);
    CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at);
  `);
  console.log('✅ PostgreSQL 表结构已就绪');
  // 为旧数据添加新字段默认值
  try {
    await pool.query("ALTER TABLE codes ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'redirect'");
    await pool.query("ALTER TABLE codes ADD COLUMN IF NOT EXISTS landing_config JSONB DEFAULT NULL");
    console.log('✅ codes 表字段已更新');
  } catch (e) {
    console.log('ℹ️ 字段更新跳过:', e.message);
  }
}

async function getAllCodes() {
  if (!usePostgres) return memGetAllCodes();
  const { rows } = await pool.query(`
    SELECT c.*, COALESCE(cnt.scan_count, 0) as scan_count
    FROM codes c
    LEFT JOIN (SELECT code_id, COUNT(*) as scan_count FROM scans GROUP BY code_id) cnt ON cnt.code_id = c.id
    ORDER BY c.created_at DESC
  `);
  return rows.map(r => {
    if (typeof r.landing_config === 'string') r.landing_config = JSON.parse(r.landing_config);
    return r;
  });
}

async function getCodeById(id) {
  if (!usePostgres) return memGetCodeById(id);
  const { rows } = await pool.query('SELECT * FROM codes WHERE id = $1', [id]);
  const r = rows[0] || null;
  if (r && typeof r.landing_config === 'string') r.landing_config = JSON.parse(r.landing_config);
  return r;
}

async function getCodeByCode(code) {
  if (!usePostgres) return memGetCodeByCode(code);
  const { rows } = await pool.query('SELECT * FROM codes WHERE code = $1', [code]);
  const r = rows[0] || null;
  if (r && typeof r.landing_config === 'string') r.landing_config = JSON.parse(r.landing_config);
  return r;
}

async function createCode(name, code, url, mode, landingConfig) {
  if (!usePostgres) return memCreateCode(name, code, url, mode, landingConfig);
  try {
    const { rows } = await pool.query(
      'INSERT INTO codes (name, code, url, mode, landing_config) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, code, url, mode || 'redirect', landingConfig ? JSON.stringify(landingConfig) : null]
    );
    return rows[0].id;
  } catch (e) {
    if (e.code === '23505') { // unique_violation
      const err = new Error('UNIQUE constraint failed: codes.code');
      throw err;
    }
    throw e;
  }
}

async function updateCode(id, name, url, mode, landingConfig) {
  if (!usePostgres) return memUpdateCode(id, name, url, mode, landingConfig);
  const { rowCount } = await pool.query(
    'UPDATE codes SET name = $1, url = $2, mode = COALESCE($3, mode), landing_config = COALESCE($4, landing_config) WHERE id = $5',
    [name, url, mode || null, landingConfig ? JSON.stringify(landingConfig) : null, id]
  );
  return { changes: rowCount };
}

async function deleteCode(id) {
  if (!usePostgres) return memDeleteCode(id);
  await pool.query('DELETE FROM scans WHERE code_id = $1', [id]);
  await pool.query('DELETE FROM codes WHERE id = $1', [id]);
}

async function recordScan(codeId, ip, ua, source) {
  if (!usePostgres) return memRecordScan(codeId, ip, ua, source);
  await pool.query(
    'INSERT INTO scans (code_id, ip, ua, source) VALUES ($1, $2, $3, $4)',
    [codeId, ip, ua, source]
  );
}

async function getCodeStats(codeId, days = 30) {
  if (!usePostgres) return memGetCodeStats(codeId, days);
  const total = await pool.query('SELECT COUNT(*) as total, COUNT(DISTINCT ip) as uv FROM scans WHERE code_id = $1', [codeId]);
  const daily = await pool.query(
    `SELECT DATE(created_at) as date, COUNT(*) as count, COUNT(DISTINCT ip) as uv
     FROM scans WHERE code_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
     GROUP BY DATE(created_at) ORDER BY date`,
    [codeId, days]
  );
  const sources = await pool.query(
    'SELECT source, COUNT(*) as count FROM scans WHERE code_id = $1 GROUP BY source',
    [codeId]
  );
  return {
    total: parseInt(total.rows[0].total),
    uv: parseInt(total.rows[0].uv),
    daily: daily.rows.map(r => ({ date: r.date.toISOString().slice(0, 10), count: parseInt(r.count), uv: parseInt(r.uv) })),
    sources: sources.rows.map(r => ({ source: r.source, count: parseInt(r.count) }))
  };
}

module.exports = {
  init,
  getAllCodes, getCodeById, getCodeByCode,
  createCode, updateCode, deleteCode,
  recordScan, getCodeStats
};
