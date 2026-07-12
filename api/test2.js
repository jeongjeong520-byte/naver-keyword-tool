// api/test2.js —— 测试 /stats 报表接口的返回结构
import crypto from 'crypto';

const ACCOUNTS = [
  { name: '账户1', apiKey: process.env.NAVER_API_KEY, secret: process.env.NAVER_SECRET_KEY, customerId: process.env.NAVER_CUSTOMER_ID },
].filter(a => a.apiKey && a.secret && a.customerId);

function makeSign(secret, timestamp, method, path) {
  return crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${method}.${path}`)
    .digest('base64');
}

async function naverGet(acc, path, queryObj = {}) {
  const timestamp = Date.now().toString();
  const sign = makeSign(acc.secret, timestamp, 'GET', path);
  const query = new URLSearchParams(queryObj).toString();
  const url = `https://api.searchad.naver.com${path}${query ? '?' + query : ''}`;
  const res = await fetch(url, {
    headers: {
      'X-Timestamp': timestamp,
      'X-API-KEY': acc.apiKey,
      'X-Customer': String(acc.customerId),
      'X-Signature': sign,
    }
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, ok: res.ok, data: parsed };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const acc = ACCOUNTS[0];
  const report = {};

  // 1. 先拿到几个关键词ID
  const adgroups = await naverGet(acc, '/ncc/adgroups');
  const firstGroupId = adgroups.data[0].nccAdgroupId;
  const kws = await naverGet(acc, '/ncc/keywords', { nccAdgroupId: firstGroupId });
  const testIds = kws.data.slice(0, 5).map(k => k.nccKeywordId);  // 取前5个词测试

  report['测试用的关键词ID'] = testIds;

  // 2. 算近7天日期
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 7);
  const fmt = d => d.toISOString().slice(0, 10);
  report['日期范围'] = { since: fmt(start), until: fmt(today) };

  // ===== 尝试方式A：/stats + timeRange =====
  const statsA = await naverGet(acc, '/stats', {
    ids: JSON.stringify(testIds),
    fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc']),
    timeRange: JSON.stringify({ since: fmt(start), until: fmt(today) }),
  });
  report['方式A_stats状态'] = statsA.status;
  report['方式A_stats返回'] = JSON.stringify(statsA.data).slice(0, 800);

  // ===== 尝试方式B：/stats + datePreset =====
  const statsB = await naverGet(acc, '/stats', {
    ids: JSON.stringify(testIds),
    fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt']),
    datePreset: 'last7days',
  });
  report['方式B_datePreset状态'] = statsB.status;
  report['方式B_datePreset返回'] = JSON.stringify(statsB.data).slice(0, 800);

  return res.status(200).json(report);
}
