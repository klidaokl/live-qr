/**
 * 内存数据库 —— 不依赖文件系统，完美兼容 Railway 等临时文件系统环境
 * 重启后数据清空（适合活码系统，数据量小，可接受）
 */

let nextId = 1;
const codes = new Map(); // id -> { id, name, code, url, created_at }
const scans = [];        // [{ id, code_id, ip, ua, source, created_at }]

// ========== 活码 CRUD ==========

function getAllCodes() {
  const rows = [];
  for (const c of codes.values()) {
    const scanCount = scans.filter(s => s.code_id === c.id).length;
    rows.push({ ...c, scan_count: scanCount });
  }
  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return rows;
}

function getCodeById(id) {
  return codes.get(id) || null;
}

function getCodeByCode(code) {
  for (const c of codes.values()) {
    if (c.code === code) return c;
  }
  return null;
}

function createCode(name, code, url) {
  // 检查短码唯一性
  if (getCodeByCode(code)) {
    const err = new Error('UNIQUE constraint failed');
    err.message = 'UNIQUE constraint failed: codes.code';
    throw err;
  }
  const id = nextId++;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  codes.set(id, { id, name, code, url, created_at: now });
  return id;
}

function updateCode(id, name, url) {
  const c = codes.get(id);
  if (!c) return { changes: 0 };
  c.name = name;
  c.url = url;
  return { changes: 1 };
}

function deleteCode(id) {
  if (!codes.has(id)) return;
  codes.delete(id);
  // 删除关联扫码记录
  for (let i = scans.length - 1; i >= 0; i--) {
    if (scans[i].code_id === id) scans.splice(i, 1);
  }
}

// ========== 扫码记录 ==========

function recordScan(codeId, ip, ua, source) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  scans.push({ id: scans.length + 1, code_id: codeId, ip, ua, source, created_at: now });
}

// ========== 统计查询 ==========

function getCodeStats(codeId, days = 30) {
  const filtered = scans.filter(s => s.code_id === codeId);
  const total = filtered.length;
  const uv = new Set(filtered.map(s => s.ip)).size;

  // 按天趋势
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const dailyMap = {};
  for (const s of filtered) {
    const date = s.created_at.slice(0, 10);
    if (date >= cutoffStr) {
      if (!dailyMap[date]) dailyMap[date] = { count: 0, uvSet: new Set() };
      dailyMap[date].count++;
      dailyMap[date].uvSet.add(s.ip);
    }
  }
  const daily = Object.keys(dailyMap).sort().map(date => ({
    date,
    count: dailyMap[date].count,
    uv: dailyMap[date].uvSet.size
  }));

  // 来源分布
  const sourceMap = {};
  for (const s of filtered) {
    sourceMap[s.source] = (sourceMap[s.source] || 0) + 1;
  }
  const sources = Object.entries(sourceMap).map(([source, count]) => ({ source, count }));

  return { total, uv, daily, sources };
}

module.exports = {
  getAllCodes, getCodeById, getCodeByCode,
  createCode, updateCode, deleteCode,
  recordScan, getCodeStats
};
