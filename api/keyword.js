// api/keyword.js —— Naver 搜索广告 API 后端
import crypto from 'crypto';

export default async function handler(req, res) {
  // 允许跨域（让前端能调用）
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const keyword = (req.query.keyword || '').trim();
  if (!keyword) {
    return res.status(400).json({ error: '请提供关键词' });
  }

  // 从环境变量读取密钥（安全！不写在代码里）
  const API_KEY = process.env.NAVER_API_KEY;
  const SECRET_KEY = process.env.NAVER_SECRET_KEY;
  const CUSTOMER_ID = process.env.NAVER_CUSTOMER_ID;

  // 生成 Naver 要求的签名
  const timestamp = Date.now().toString();
  const method = 'GET';
  const path = '/keywordstool';
  const sign = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(`${timestamp}.${method}.${path}`)
    .digest('base64');

  // 去掉关键词里的空格（Naver 要求）
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

    // 整理返回数据（只保留有用的字段）
    const list = (data.keywordList || []).slice(0, 20).map(item => ({
      keyword: item.relKeyword,
      pcSearch: item.monthlyPcQcCnt,      // PC 月搜索
      mobileSearch: item.monthlyMobileQcCnt, // 移动端月搜索
      competition: item.compIdx,           // 竞争度
    }));

    return res.status(200).json({ keyword, list });
  } catch (err) {
    return res.status(500).json({ error: '请求失败', detail: err.message });
  }
}
