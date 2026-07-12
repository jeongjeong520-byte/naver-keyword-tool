// api/keyword.js —— Naver 搜索广告 API 后端（含自动翻译版）
import crypto from 'crypto';

// ===== 翻译缓存（同一个词不重复翻译）=====
const translateCache = {};

// ===== 批量翻译函数 =====
async function translateBatch(words) {
  // 过滤出还没缓存的词
  const needTranslate = words.filter(w => !translateCache[w]);

  if (needTranslate.length > 0) {
    // 用 \n 把多个词拼成一段，一次性翻译（省请求次数）
    const joined = needTranslate.join('\n');
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=zh-CN&dt=t&q=${encodeURIComponent(joined)}`;
      const response = await fetch(url);
      const data = await response.json();

      // data[0] 是一个数组，每一段翻译是一个 item
      // item[0]=译文, item[1]=原文
      const segments = data[0] || [];
      segments.forEach(seg => {
        const zh = (seg[0] || '').trim();
        const ko = (seg[1] || '').trim();
        if (ko) translateCache[ko] = zh;
      });
    } catch (e) {
      // 翻译失败就跳过，不影响主功能
      console.error('翻译失败:', e.message);
    }
  }

  // 返回一个 {韩文: 中文} 的对照表
  const result = {};
  words.forEach(w => {
    result[w] = translateCache[w] || '';
  });
  return result;
}

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

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return res.status(500).json({
        error: 'Naver 返回的不是 JSON',
        status: response.status,
        raw: rawText.slice(0, 500)
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

    // ===== 只翻译前 30 个（避免太慢/被限制）=====
    const topList = list.slice(0, 30);
    const wordsToTranslate = topList.map(item => item.keyword);
    const translations = await translateBatch(wordsToTranslate);

    // 把中文翻译加到每个词上
    topList.forEach(item => {
      item.translation = translations[item.keyword] || '';
    });

    // 剩下的词不翻译，translation 留空
    list.forEach((item, i) => {
      if (i >= 30) item.translation = '';
    });

    return res.status(200).json({ keyword, total: list.length, list });

  } catch (err) {
    return res.status(500).json({ error: '函数崩溃', message: err.message, stack: err.stack });
  }
}
