// api/keyword.js —— Naver 搜索广告 API 后端（含自动翻译版 · 逐个并发翻译）
import crypto from 'crypto';

// ===== 翻译缓存 =====
const translateCache = {};

// ===== 翻译单个词 =====
async function translateOne(word) {
  if (!word) return '';
  if (translateCache[word] !== undefined) return translateCache[word];

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=zh-CN&dt=t&q=${encodeURIComponent(word)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000); // 4秒超时
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    clearTimeout(timer);

    const data = await response.json();
    // 结构：data[0] 是数组，每段 [译文, 原文, ...]，拼起来才是完整译文
    let zh = '';
    if (Array.isArray(data[0])) {
      zh = data[0].map(seg => (seg && seg[0]) ? seg[0] : '').join('').trim();
    }
    translateCache[word] = zh;
    return zh;
  } catch (e) {
    return '';
  }
}

// ===== 批量翻译（逐个并发，分批避免限流）=====
async function translateBatch(words) {
  const result = {};
  const batchSize = 10; // 每批10个并发

  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize);
    await Promise.all(batch.map(async (w) => {
      result[w] = await translateOne(w);
    }));
  }
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

        // 点击率可能是数字，也可能是 "< 0.1" 这种字符串，直接原样保留
    const toCtr = (val) => {
      if (val === undefined || val === null || val === '') return 0;
      return val;   // 保持原样（可能是 0.35 或 "< 0.1"）
    };

    let list = (data.keywordList || []).map(item => {
      const pc = toNumber(item.monthlyPcQcCnt);
      const mobile = toNumber(item.monthlyMobileQcCnt);
      return {
        keyword: item.relKeyword,
        pcSearch: pc,
        mobileSearch: mobile,
        pcCtr: toCtr(item.monthlyAvePcCtr),         // 👈 新增：PC 点击率
        mobileCtr: toCtr(item.monthlyAveMobileCtr), // 👈 新增：移动点击率
        competition: item.compIdx,
        translation: ''
      };
    });

    list.sort((a, b) => (b.pcSearch + b.mobileSearch) - (a.pcSearch + a.mobileSearch));

    // ===== 只翻译前 50 个 =====
    const topN = 50;
    const topList = list.slice(0, topN);
    const wordsToTranslate = topList.map(item => item.keyword);
    const translations = await translateBatch(wordsToTranslate);

    topList.forEach(item => {
      item.translation = translations[item.keyword] || '';
    });

    return res.status(200).json({ keyword, total: list.length, list });

  } catch (err) {
    return res.status(500).json({ error: '函数崩溃', message: err.message, stack: err.stack });
  }
}
