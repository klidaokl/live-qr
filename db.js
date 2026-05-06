const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'liveqr.db');

// 确保data目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// 开启WAL模式提升并发性能
db.pragma('journal_mode = WAL');

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_id INTEGER NOT NULL,
    ip TEXT DEFAULT '',
    ua TEXT DEFAULT '',
    source TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (code_id) REFERENCES codes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_scans_code_id ON scans(code_id);
  CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at);
`);

// ========== 活码 CRUD ==========

function getAllCodes() {
  const rows = db.prepare(`
    SELECT c.*, COUNT(s.id) as scan_count
    FROM codes c
    LEFT JOIN scans s ON s.code_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all();
  return rows;
}

function getCodeById(id) {
  return db.prepare('SELECT * FROM codes WHERE id = ?').get(id);
}

function getCodeByCode(code) {
  return db.prepare('SELECT * FROM codes WHERE code = ?').get(code);
}

function createCode(name, code, url) {
  const result = db.prepare('INSERT INTO codes (name, code, url) VALUES (?, ?, ?)').run(name, code, url);
  return result.lastInsertRowid;
}

function updateCode(id, name, url) {
  return db.prepare('UPDATE codes SET name = ?, url = ? WHERE id = ?').run(name, url, id);
}

function deleteCode(id) {
  db.prepare('DELETE FROM scans WHERE code_id = ?').run(id);
  return db.prepare('DELETE FROM codes WHERE id = ?').run(id);
}

// ========== 扫码记录 ==========

function recordScan(codeId, ip, ua, source) {
  db.prepare(
    'INSERT INTO scans (code_id, ip, ua, source) VALUES (?, ?, ?, ?)'
  ).run(codeId, ip, ua, source);
}

// ========== 统计查询 ==========

function getCodeStats(codeId, days = 30) {
  // 总扫码 / UV
  const total = db.prepare(`
    SELECT COUNT(*) as total, COUNT(DISTINCT ip) as uv
    FROM scans WHERE code_id = ?
  `).get(codeId);

  // 按天趋势
  const daily = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count, COUNT(DISTINCT ip) as uv
    FROM scans
    WHERE code_id = ? AND created_at >= DATE('now', '-' || ? || ' days')
    GROUP BY DATE(created_at)
    ORDER BY date
  `).all(codeId, days);

  // 来源分布
  const sources = db.prepare(`
    SELECT source, COUNT(*) as count
    FROM scans
    WHERE code_id = ?
    GROUP BY source
  `).all(codeId);

  return { total: total.total, uv: total.uv, daily, sources };
}

module.exports = {
  getAllCodes, getCodeById, getCodeByCode,
  createCode, updateCode, deleteCode,
  recordScan, getCodeStats
};
