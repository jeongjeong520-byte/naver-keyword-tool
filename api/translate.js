// api/translate.js
export default async function handler(req, res) {
  // 允许跨域
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { text } = req.query;
  if (!text) {
    return res.status(400).json({ error: "Missing text parameter" });
  }

  try {
    // 使用 Google 官方免 token 翻译接口 (韩语 ko -> 中文 zh-CN)
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    // 解析翻译结果
    const translatedText = data[0].map(item => item[0]).join('');
    
    res.status(200).json({ translation: translatedText });
  } catch (error) {
    console.error("Translation error:", error);
    res.status(500).json({ error: "Translation failed", details: error.message });
  }
}
