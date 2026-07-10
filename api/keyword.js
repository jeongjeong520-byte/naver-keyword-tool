// api/keyword.js —— Naver 搜索广告 API 后端
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const keyword = (req.query.keyword || '').trim();
  if (!keyword) {
    return res.status(400).json({ error: '请提供关键词' });
  }

  const API_KEY = process.env.NAVER_API_KEY;
  const SECRET_KEY = process.env.NAVER_SECRET_KEY;
  const CUSTOMER_ID = process.env.NAVER_CUSTOMER_ID;

  const timestamp = Date.now().toString();
  const method = 'GET';
  const path = '/keywordstool';
  const sign = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(`${timestamp}.${method}.${path}`)
    .digest('base64');

  const hintKeyword = keyword.replace(/\s/g, '');
  const url = `https://api.searchad.naver.com${path}?hintKeywords=${encodeURIComponent(hintKeyword)}&showDetail=1`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Timestamp': timestamp,
        'X-API-KEY': API_KEY,
        'X-Customer': CUSTOMER_ID,
        'X-Signature': sign,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Naver API 错误', detail: data });
    }

    // 处理搜索量：Naver 有时返回 "< 10" 字符串，转成数字
    const toNumber = (val) => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const n = parseInt(val.replace(/[^0-9]/g, ''), 10);
        return isNaN(n) ? 0 : n;
      }
      return 0;
    };

    // 整理全部数据（不再切成 20 个）
    let list = (data.keywordList || []).map(item => {
      const pc = toNumber(item.monthlyPcQcCnt);
      const mobile = toNumber(item.monthlyMobileQcCnt);
      return {
        keyword: item.relKeyword,
        pcSearch: pc,
        mobileSearch: mobile,
        competition: item.compIdx,
      };
    });

    // 按总搜索量从高到低排序
    list.sort((a, b) => (b.pcSearch + b.mobileSearch) - (a.pcSearch + a.mobileSearch));

    return res.status(200).json({ keyword, total: list.length, list });
  } catch (err) {
    return res.status(500).json({ error: '请求失败', detail: err.message });
  }
}
