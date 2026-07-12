// api/test2.js —— 测试 /stats（修正ID格式 + 日期）
import crypto from 'crypto';

const ACCOUNTS = [
  { name: '账户1', apiKey: process.env.NAVER_API_KEY, secret: process.env.NAVER_SECRET_KEY, customerId: process.env.NAVER_CUSTOMER_ID },
].filter(a => a.apiKey && a.secret && a.customerId);

function makeSign(secret, timestamp, method, path) {
  return crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${method}.${path}`)
    .digest('base64');
}

// 通用请求（query 直接传字符串，方便控制格式）
async function naverGetRaw(acc, path, queryString = '') {
  const timestamp = Date.now().toString();
  const sign = makeSign(acc.secret, timestamp, 'GET', path);
  const url = `https://api.searchad.naver.com${path}${queryString ? '?' + queryString : ''}`;
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

  // 1. 拿关键词ID
  const adgroups = await naverGetRaw(acc, '/ncc/adgroups');
  const firstGroupId = adgroups.data[0].nccAdgroupId;
  const kws = await naverGetRaw(acc, '/ncc/keywords', `nccAdgroupId=${firstGroupId}`);
  const testIds = kws.data.slice(0, 5).map(k => k.nccKeywordId);
  report['测试用ID'] = testIds;

  // 2. 日期：手动用固定的过去日期（避开服务器时间错误）
  //    先用一个明确的过去范围测试
  const since = '2025-05-01';
  const until = '2025-05-31';
  report['测试日期'] = { since, until };

  // ===== 方式1：ids 用逗号拼接 =====
  const idsComma = testIds.join(',');
  const q1 = `ids=${idsComma}` +
             `&fields=${encodeURIComponent(JSON.stringify(['impCnt','clkCnt','salesAmt']))}` +
             `&timeRange=${encodeURIComponent(JSON.stringify({ since, until }))}`;
  const r1 = await naverGetRaw(acc, '/stats', q1);
  report['方式1_逗号ID状态'] = r1.status;
  report['方式1_返回'] = JSON.stringify(r1.data).slice(0, 800);

  // ===== 方式2：ids 用重复参数 ids=x&ids=y =====
  const idsRepeat = testIds.map(id => `ids=${id}`).join('&');
  const q2 = idsRepeat +
             `&fields=${encodeURIComponent(JSON.stringify(['impCnt','clkCnt','salesAmt']))}` +
             `&timeRange=${encodeURIComponent(JSON.stringify({ since, until }))}`;
  const r2 = await naverGetRaw(acc, '/stats', q2);
  report['方式2_重复ID状态'] = r2.status;
  report['方式2_返回'] = JSON.stringify(r2.data).slice(0, 800);

  // ===== 方式3：单个ID测试（最简单，先确认接口能用）=====
  const q3 = `id=${testIds[0]}` +
             `&fields=${encodeURIComponent(JSON.stringify(['impCnt','clkCnt','salesAmt']))}` +
             `&timeRange=${encodeURIComponent(JSON.stringify({ since, until }))}`;
  const r3 = await naverGetRaw(acc, '/stats', q3);
  report['方式3_单ID状态'] = r3.status;
  report['方式3_返回'] = JSON.stringify(r3.data).slice(0, 800);

  return res.status(200).json(report);
}
