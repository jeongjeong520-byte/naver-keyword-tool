// api/test3.js —— 多账号汇总，找点击量最多的
import crypto from 'crypto';

// 👇 改成读取多账号（跟 keyword.js 一致）
function loadAccounts() {
  try {
    return JSON.parse(process.env.NAVER_ACCOUNTS || '[]');
  } catch {
    return [];
  }
}

function makeSign(secret, timestamp, method, path) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${method}.${path}`).digest('base64');
}

async function naverGetRaw(acc, path, queryString = '') {
  const timestamp = Date.now().toString();
  const sign = makeSign(acc.secret, timestamp, 'GET', path);
  const url = `https://api.searchad.naver.com${path}${queryString ? '?' + queryString : ''}`;
  const res = await fetch(url, {
    headers: { 'X-Timestamp': timestamp, 'X-API-KEY': acc.apiKey, 'X-Customer': String(acc.customerId), 'X-Signature': sign }
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, data: parsed };
}

function getDateRange(daysBack) {
  const now = new Date();
  const until = new Date(now); until.setUTCDate(now.getUTCDate() - 1);
  const since = new Date(now); since.setUTCDate(now.getUTCDate() - daysBack);
  const fmt = d => d.toISOString().slice(0, 10);
  return { since: fmt(since), until: fmt(until) };
}

// 👇 把"查单个账号"抽成一个函数
async function queryOneAccount(acc) {
  // 拿广告组
  const adgroups = await naverGetRaw(acc, '/ncc/adgroups');
  if (!Array.isArray(adgroups.data)) return [];

  let allIds = [];
  for (const g of adgroups.data.slice(0, 3)) {
    const kws = await naverGetRaw(acc, '/ncc/keywords', `nccAdgroupId=${g.nccAdgroupId}`);
    if (Array.isArray(kws.data)) allIds.push(...kws.data.map(k => k.nccKeywordId));
  }
  const testIds = allIds.slice(0, 10);
  if (!testIds.length) return [];

  const { since, until } = getDateRange(7);
  const q = `ids=${testIds.join(',')}` +
            `&fields=${encodeURIComponent(JSON.stringify(['impCnt','clkCnt','salesAmt','ctr','cpc']))}` +
            `&timeRange=${encodeURIComponent(JSON.stringify({ since, until }))}` +
            `&timeIncrement=allDays`;
  const r = await naverGetRaw(acc, '/stats', q);

  // 返回的每条数据，标记上是哪个账号
  const rows = (r.data && r.data.data) ? r.data.data : [];
  return rows.map(row => ({
    accountName: acc.name,
    customerId: acc.customerId,
    ...row
  }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const accounts = loadAccounts();
  if (!accounts.length) {
    return res.status(500).json({ error: '没有配置 NAVER_ACCOUNTS' });
  }

  // 👇 所有账号并发查询
  const settled = await Promise.allSettled(
    accounts.map(acc => queryOneAccount(acc))
  );

  // 汇总所有账号的数据
  let allRows = [];
  settled.forEach(s => {
    if (s.status === 'fulfilled') allRows.push(...s.value);
  });

  if (!allRows.length) {
    return res.status(200).json({ message: '所有账号都没查到投放数据', total: 0 });
  }

  // 👇 按点击量（clkCnt）从大到小排序
  allRows.sort((a, b) => (Number(b.clkCnt) || 0) - (Number(a.clkCnt) || 0));

  const best = allRows[0];  // 点击量最多的那条

  return res.status(200).json({
    total: allRows.length,
    best,          // 👈 点击量最多的
    allRows        // 全部数据（已按点击量排序）
  });
}
