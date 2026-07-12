// api/test3.js —— 多ID汇总 + 近期日期
import crypto from 'crypto';

const ACCOUNTS = [
  { name: '账户1', apiKey: process.env.NAVER_API_KEY, secret: process.env.NAVER_SECRET_KEY, customerId: process.env.NAVER_CUSTOMER_ID },
].filter(a => a.apiKey && a.secret && a.customerId);

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

// 关键：日期用 UTC 减1天（避开当天没数据 + 服务器时间处理）
function getDateRange(daysBack) {
  const now = new Date();
  const until = new Date(now); until.setUTCDate(now.getUTCDate() - 1);   // 昨天
  const since = new Date(now); since.setUTCDate(now.getUTCDate() - daysBack); // N天前
  const fmt = d => d.toISOString().slice(0, 10);
  return { since: fmt(since), until: fmt(until) };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const acc = ACCOUNTS[0];
  const report = {};

  // 拿所有广告组的关键词ID（多拿点，增加出数概率）
  const adgroups = await naverGetRaw(acc, '/ncc/adgroups');
  let allIds = [];
  for (const g of adgroups.data.slice(0, 3)) {  // 前3个组
    const kws = await naverGetRaw(acc, '/ncc/keywords', `nccAdgroupId=${g.nccAdgroupId}`);
    if (Array.isArray(kws.data)) allIds.push(...kws.data.map(k => k.nccKeywordId));
  }
  const testIds = allIds.slice(0, 10);  // 取10个测试
  report['测试ID数量'] = testIds.length;

  const { since, until } = getDateRange(7);
  report['近7天日期'] = { since, until };

  // 多ID + timeIncrement=allDays（汇总，每个ID一条）
  const q = `ids=${testIds.join(',')}` +
            `&fields=${encodeURIComponent(JSON.stringify(['impCnt','clkCnt','salesAmt','ctr','cpc']))}` +
            `&timeRange=${encodeURIComponent(JSON.stringify({ since, until }))}` +
            `&timeIncrement=allDays`;
  const r = await naverGetRaw(acc, '/stats', q);
  report['状态'] = r.status;
  report['返回'] = r.data;

  return res.status(200).json(report);
}
