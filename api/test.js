// api/test.js —— 纯测试：能不能拉到各账户的关键词和ID
import crypto from 'crypto';

// ===== 多账户配置 =====
const ACCOUNTS = [
  { name: '账户1', apiKey: process.env.NAVER_API_KEY,   secret: process.env.NAVER_SECRET_KEY,   customerId: process.env.NAVER_CUSTOMER_ID },
  { name: '账户2', apiKey: process.env.NAVER_API_KEY_2, secret: process.env.NAVER_SECRET_KEY_2, customerId: process.env.NAVER_CUSTOMER_ID_2 },
  { name: '账户3', apiKey: process.env.NAVER_API_KEY_3, secret: process.env.NAVER_SECRET_KEY_3, customerId: process.env.NAVER_CUSTOMER_ID_3 },
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

  const report = {
    账户数量: ACCOUNTS.length,
    结果: []
  };

  for (const acc of ACCOUNTS) {
    const accResult = { 账户: acc.name };

    // ---- 测试1：直接拉广告组 ----
    const adgroups = await naverGet(acc, '/ncc/adgroups');
    accResult['① adgroups状态'] = adgroups.status;
    accResult['① adgroups是数组吗'] = Array.isArray(adgroups.data);
    accResult['① adgroups数量'] = Array.isArray(adgroups.data) ? adgroups.data.length : '不是数组';

    // 如果不是数组，试试先拉 campaigns
    if (!Array.isArray(adgroups.data)) {
      const campaigns = await naverGet(acc, '/ncc/campaigns');
      accResult['②备用 campaigns状态'] = campaigns.status;
      accResult['②备用 campaigns数量'] = Array.isArray(campaigns.data) ? campaigns.data.length : '不是数组';
      accResult['②备用 campaigns返回样例'] = JSON.stringify(campaigns.data).slice(0, 300);
    }

    // ---- 测试2：拉第一个广告组的关键词 ----
    if (Array.isArray(adgroups.data) && adgroups.data.length > 0) {
      const firstGroupId = adgroups.data[0].nccAdgroupId;
      accResult['广告组ID样例'] = firstGroupId;

      const kws = await naverGet(acc, '/ncc/keywords', { nccAdgroupId: firstGroupId });
      accResult['③ keywords状态'] = kws.status;
      accResult['③ keywords数量'] = Array.isArray(kws.data) ? kws.data.length : '不是数组';

      // 展示前3个关键词和ID
      if (Array.isArray(kws.data)) {
        accResult['③ 关键词样例'] = kws.data.slice(0, 3).map(k => ({
          词: k.keyword,
          ID: k.nccKeywordId
        }));
      } else {
        accResult['③ keywords原始返回'] = JSON.stringify(kws.data).slice(0, 300);
      }
    }

    report.结果.push(accResult);
  }

  return res.status(200).json(report);
}
