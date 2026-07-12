// api/keyword.js —— Naver 搜索广告 API 后端（防崩溃调试版）
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const keyword = (req.query.keyword || '').trim();
    if (!keyword) {
      return res.status(400).json({ error: '请提供关键词' });
    }

    const API_KEY = process.env.NAVER_API_KEY;
    const SECRET_KEY = process.env.NAVER_SECRET_KEY;
    const CUSTOMER_ID = process.env.NAVER_CUSTOMER_ID;

    // 【关键】检查环境变量是否存在
    if (!API_KEY || !SECRET_KEY || !CUSTOMER_ID) {
      return res.status(500).json({
        error: '环境变量缺失',
        hasApiKey: !!API_KEY,
        hasSecretKey: !!SECRET_KEY,
        hasCustomerId: !!CUSTOMER_ID,
        提示: '去 Vercel → Settings → Environment Variables 配置这3个变量'
      });
    }

    const timestamp = Date.now().toString();
    const method = 'GET';
    const path = '/keywordstool';
    const sign = crypto
      .createHmac('sha256', SECRET_KEY)
      .update(`${timestamp}.${method}.${path}`)
      .digest('base64');

    const hintKeyword = keyword.replace(/\s/g, '');
    const url = `https://api.searchad.naver.com${path}?hintKeywords=${encodeURIComponent(hintKeyword)}&showDetail=1`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Timestamp': timestamp,
        'X-API-KEY': API_KEY,
        'X-Customer': CUSTOMER_ID,
        'X-Signature': sign,
      },
    });

    // 先拿文本，避免非 JSON 时崩溃
    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return res.status(500).json({
        error: 'Naver 返回的不是 JSON',
        status: response.status,
        raw: rawText.slice(0, 500)  // 显示前500字，看真实原因
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Naver API 错误', status: response.status, detail: data });
    }

    const toNumber = (val) => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const n = parseInt(val.replace(/[^0-9]/g, ''), 10);
        return isNaN(n) ? 0 : n;
      }
      return 0;
    };

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

    list.sort((a, b) => (b.pcSearch + b.mobileSearch) - (a.pcSearch + a.mobileSearch));

    return res.status(200).json({ keyword, total: list.length, list });

  } catch (err) {
    // 捕获所有崩溃，返回具体原因
    return res.status(500).json({ error: '函数崩溃', message: err.message, stack: err.stack });
  }
}
