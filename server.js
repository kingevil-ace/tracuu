// Máy chủ "Tra cứu và thống kê" — Node.js thuần, KHÔNG cần cài thư viện nào (Node >= 18).
//
// - Phục vụ giao diện trong thư mục public/
// - Endpoint /api/lookup?code=<SBD> gọi web trường (giống file Python gốc) rồi trả JSON.
//
// Vì sao cần máy chủ: trình duyệt không được gọi thẳng web trường (bị chặn CORS).
//
// Chạy:  npm start   (hoặc: node server.js)  ->  http://localhost:8000
// Trên host: host tự đặt biến PORT, server tự nghe 0.0.0.0:PORT.

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const UPSTREAM = process.env.TRACUU_UPSTREAM || 'https://thcsnuidoi.edu.vn/lookup.php';
const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// CORS mở để giao diện đặt ở host tĩnh khác (Netlify, GitHub Pages...) vẫn gọi được API này.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type'
};

function send(res, status, body, type, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...CORS, ...extra });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), MIME['.json']);
}

// Giống lay_du_lieu_hoc_sinh() trong file Python gốc.
async function layDuLieuHocSinh(sbd) {
  const url = `${UPSTREAM}?code=${encodeURIComponent(sbd)}&t=${Date.now()}`;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://thcsnuidoi.edu.vn/'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (r.status === 404) return ['not_found', null]; // web trường trả 404 khi không có SBD
    if (r.status !== 200) return ['error', `Máy chủ trường trả về mã ${r.status}`];
    const data = await r.json();
    return data && data.success ? ['ok', data] : ['not_found', null];
  } catch (e) {
    return ['error', `${e.name}: ${e.message}`];
  }
}

async function handleLookup(res, params) {
  const code = (params.get('code') || '').trim();
  if (!/^\d{1,12}$/.test(code)) {
    return sendJson(res, 400, { success: false, error: 'SBD không hợp lệ' });
  }

  const [status, payload] = await layDuLieuHocSinh(code);

  if (params.has('debug')) return sendJson(res, 200, { sbd: code, status, data: payload });
  if (status === 'ok') return sendJson(res, 200, payload);
  if (status === 'not_found') return sendJson(res, 200, { success: false });

  console.log(`[!] SBD ${code}: ${payload}`);
  return sendJson(res, 502, { success: false, error: payload });
}

async function serveStatic(res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad request', MIME['.txt']);
  }
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, 'Forbidden', MIME['.txt']);
  }

  try {
    const body = await fs.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    send(res, 200, body, type);
  } catch {
    send(res, 404, 'Not found', MIME['.txt']);
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') return send(res, 204, '', MIME['.txt']);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed', MIME['.txt']);
  }

  if (pathname === '/api/lookup') return handleLookup(res, searchParams);
  return serveStatic(res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log('='.repeat(60));
  console.log(`  TRA CỨU VÀ THỐNG KÊ - đang chạy tại http://localhost:${PORT}`);
  console.log('  Giữ cửa sổ này mở khi dùng web. Nhấn Ctrl+C để tắt.');
  console.log('='.repeat(60));
  // chay.bat bật biến này để tự mở trình duyệt khi chạy trên máy Windows.
  if (process.env.OPEN_BROWSER === '1') {
    require('node:child_process').exec(`start "" http://localhost:${PORT}`);
  }
});
