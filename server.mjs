import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initClinicalDB, getDatabaseStats } from './backend/clinical_db.mjs';
import { getAgentStatus, askChatbot, reviewPrescription, performOcr } from './backend/vertex_agent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8788);

// Tải file .env đơn giản nếu có
async function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (existsSync(envPath)) {
    try {
      const content = await readFile(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=');
          if (idx !== -1) {
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            if (!process.env[key]) process.env[key] = val;
          }
        }
      }
      console.log('[ENV] Đã nạp biến môi trường từ .env');
    } catch (e) {
      console.warn('[ENV] Lỗi khi đọc .env:', e.message);
    }
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.traineddata': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = decodeURIComponent(url.pathname);

  // --- API ROUTING ---
  if (pathname.startsWith('/api/')) {
    try {
      // 1. Trạng thái hệ thống (Không cần đăng nhập)
      if (pathname === '/api/status' && req.method === 'GET') {
        const agentStatus = getAgentStatus();
        const dbStats = getDatabaseStats();
        return sendJson(res, 200, {
          success: true,
          agent: agentStatus,
          database: dbStats,
          noAuthRequired: true
        });
      }

      // 2. Module 1: Chatbot tra cứu dược lâm sàng
      if (pathname === '/api/chat' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.message && !body.ocrText) {
          return sendJson(res, 400, { error: 'Vui lòng nhập câu hỏi hoặc đính kèm ảnh.' });
        }
        const response = await askChatbot({
          message: body.message || '',
          history: body.history || [],
          sourceMode: body.sourceMode || 'closed',
          ocrText: body.ocrText || ''
        });
        return sendJson(res, 200, response);
      }

      // 3. Module 2: Bình đơn & Thẩm định đơn thuốc chuyên sâu
      if (pathname === '/api/review-prescription' && req.method === 'POST') {
        const body = await readBody(req);
        const patientInfo = body.patientInfo || {};
        const drugs = Array.isArray(body.drugs) ? body.drugs : [];
        const prescriptionText = body.prescriptionText || '';
        const ocrText = body.ocrText || '';

        if (drugs.length === 0 && !prescriptionText && !ocrText) {
          return sendJson(res, 400, { error: 'Vui lòng cung cấp danh sách thuốc hoặc nội dung đơn để thẩm định.' });
        }

        const result = await reviewPrescription({ patientInfo, drugs, prescriptionText, ocrText });
        return sendJson(res, 200, result);
      }

      // 4. Tiện ích OCR ảnh đơn/vỏ thuốc
      if (pathname === '/api/ocr' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.image || !body.image.data) {
          return sendJson(res, 400, { error: 'Thiếu dữ liệu ảnh.' });
        }
        try {
          const ocrResult = await performOcr(body.image.data, body.image.mimeType || 'image/jpeg');
          return sendJson(res, 200, ocrResult);
        } catch (e) {
          return sendJson(res, 501, { error: 'Chưa cấu hình Vertex AI cho OCR ảnh. Hãy kiểm tra biến GEMINI_API_KEY.' });
        }
      }

      return sendJson(res, 404, { error: 'Không tìm thấy API endpoint.' });
    } catch (err) {
      console.error('[API Error]:', err);
      return sendJson(res, 500, { error: 'Lỗi xử lý máy chủ: ' + err.message });
    }
  }

  // --- STATIC FILE SERVING ---
  try {
    let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end('Access Denied');
    }

    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await readFile(filePath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  } catch (err) {
    res.writeHead(500);
    res.end('Server Error: ' + err.message);
  }
});

// Khởi động server
await loadEnv();
await initClinicalDB();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n===============================================================`);
  console.log(`🏥 NBCare - Dược Sĩ Lâm Sàng Ảo (Bản Clone Độc Lập)`);
  console.log(`🚀 Máy chủ đang chạy tại: http://127.0.0.1:${PORT}`);
  console.log(`💬 Module 1: Chatbot Dược Lâm Sàng (Tra cứu thông tin thuốc)`);
  console.log(`📋 Module 2: Bình Đơn Thuốc (Thẩm định & Rà soát đơn chuyên sâu)`);
  console.log(`🔓 Không yêu cầu đăng nhập (Zero Authentication Required)`);
  console.log(`🤖 Kết nối Vertex Agent / Gemini: ${process.env.GEMINI_API_KEY ? 'ĐÃ SẴN SÀNG' : 'CHẾ ĐỘ NỘI BỘ (Local DB)'}`);
  console.log(`===============================================================\n`);
});
