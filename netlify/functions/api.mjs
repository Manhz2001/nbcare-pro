import { initClinicalDB, getDatabaseStats } from '../../backend/clinical_db.mjs';
import { getAgentStatus, askChatbot, reviewPrescription, performOcr } from '../../backend/vertex_agent.mjs';

let isDbReady = false;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store'
    }
  });
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (!isDbReady) {
    await initClinicalDB();
    isDbReady = true;
  }

  const url = new URL(req.url);
  const pathname = url.pathname.replace(/^\/\.netlify\/functions\/api/, '/api');

  try {
    if (pathname === '/api/status' && req.method === 'GET') {
      const agent = getAgentStatus();
      const database = getDatabaseStats();
      return jsonResponse({
        success: true,
        agent,
        database,
        noAuthRequired: true
      });
    }

    if (pathname === '/api/chat' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (!body.message && !body.ocrText) {
        return jsonResponse({ error: 'Vui lòng nhập câu hỏi hoặc đính kèm ảnh.' }, 400);
      }
      const res = await askChatbot({
        message: body.message || '',
        history: body.history || [],
        sourceMode: body.sourceMode || 'closed',
        ocrText: body.ocrText || ''
      });
      return jsonResponse(res);
    }

    if (pathname === '/api/review-prescription' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const patientInfo = body.patientInfo || {};
      const drugs = Array.isArray(body.drugs) ? body.drugs : [];
      const prescriptionText = body.prescriptionText || '';
      const ocrText = body.ocrText || '';

      if (drugs.length === 0 && !prescriptionText && !ocrText) {
        return jsonResponse({ error: 'Vui lòng cung cấp danh sách thuốc hoặc nội dung đơn để thẩm định.' }, 400);
      }

      const res = await reviewPrescription({ patientInfo, drugs, prescriptionText, ocrText });
      return jsonResponse(res);
    }

    if (pathname === '/api/ocr' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (!body.image || !body.image.data) {
        return jsonResponse({ error: 'Thiếu dữ liệu ảnh.' }, 400);
      }
      const res = await performOcr(body.image.data, body.image.mimeType || 'image/jpeg');
      return jsonResponse(res);
    }

    return jsonResponse({ error: 'Endpoint không tồn tại: ' + pathname }, 404);
  } catch (err) {
    console.error('[Netlify API Error]:', err);
    return jsonResponse({ error: 'Lỗi máy chủ: ' + err.message }, 500);
  }
};

export const config = {
  path: "/api/*"
};
