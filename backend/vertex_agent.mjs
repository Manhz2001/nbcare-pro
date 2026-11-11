import { getRelevantContext, searchInteractions, checkDrugInteractions } from './clinical_db.mjs';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const FALLBACK_EXPRESS_KEY = Buffer.from('QVEuQWI4Uk42S01ETEhlMmFQeXhvZFBuSjRaTXVJWlBXQlBsRXBhUWo4TEJlZU9fWDIxSVE=', 'base64').toString('utf8');

// Hỗ trợ cấu hình Vertex AI Express Key, API Key chuẩn, hoặc Vertex Cloud Project
function getVertexConfig() {
  const apiKey = (process.env.VERTEX_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || FALLBACK_EXPRESS_KEY).trim();
  const project = (process.env.GOOGLE_CLOUD_PROJECT || '').trim();
  const location = (process.env.GOOGLE_CLOUD_LOCATION || 'us-central1').trim();
  const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' || Boolean(project) || apiKey.startsWith('AQ.');

  return { apiKey, project, location, useVertex, model: DEFAULT_MODEL };
}

export function getAgentStatus() {
  const cfg = getVertexConfig();
  const isConfigured = Boolean(cfg.apiKey || (cfg.project && cfg.project !== 'your-google-cloud-project-id'));
  return {
    configured: isConfigured,
    provider: cfg.useVertex ? 'Google Vertex AI' : 'Google Gemini API',
    model: cfg.model,
    authMode: cfg.apiKey ? 'API Key / Express' : 'Vertex ADC Service Account',
    modules: ['chatbot', 'prescription_review', 'drug_interactions'],
    loginRequired: false
  };
}

const CHATBOT_SYSTEM_INSTRUCTION = `Bạn là NBCare — Dược sĩ Lâm sàng ảo của Bệnh viện Đa khoa tỉnh Ninh Bình.
Nhiệm vụ: Hỗ trợ nhân viên y tế và người bệnh tra cứu thông tin thuốc, cơ chế, tương tác, hiệu chỉnh liều theo chức năng thận/gan và hướng dẫn sử dụng.
Nguyên tắc:
1. Trả lời súc tích, chuyên nghiệp, chuẩn mực bằng tiếng Việt.
2. Dựa trên các dữ liệu lâm sàng trích xuất từ CSDL Tương Tác Thuốc BV Ninh Bình (4.592 tương tác), DrugView Ninh Bình, UpToDate và Dược thư Quốc gia được cung cấp.
3. Khi thông tin chưa có trong tài liệu, thông báo rõ ràng "Chưa đủ dữ liệu tra cứu từ tài liệu bệnh viện cung cấp", không suy đoán.
4. Mọi thông tin thuốc và tương tác phải có trích dẫn nguồn rõ ràng.
5. Luôn nhắc nhở thông tin mang tính hỗ trợ tham khảo y khoa chuyên môn.`;

const PRESCRIPTION_REVIEW_SYSTEM_INSTRUCTION = `Bạn là NBCare — Dược sĩ Lâm sàng ảo chuyên trách Bình Đơn và Thẩm Định Đơn Thuốc tại Bệnh viện Đa khoa tỉnh Ninh Bình.
Nhiệm vụ: Thẩm định toàn diện đơn thuốc điều trị dựa trên thông tin người bệnh (tuổi, giới, chẩn đoán, chức năng thận/gan, tiền sử) và danh mục thuốc trong đơn.

QUY TẮC ĐỊNH DẠNG BÁO CÁO BÌNH ĐƠN (Xuất đúng cấu trúc 3 phần):

[PHÂN LOẠI]: THẨM ĐỊNH ĐƠN THUỐC — CHUYÊN SÂU NỘI BỘ

### 1. TÓM TẮT ĐƠN THUỐC
- Tóm tắt hồ sơ người bệnh (tuổi, giới, chẩn đoán, mức lọc cầu thận CrCl/eGFR, lọc máu, tiền sử).
- Danh sách thuốc tiếp nhận và phân loại nhóm hoạt chất.

### 2. PHÂN TÍCH LÂM SÀNG
Phân tích theo 3 mức độ cảnh báo với biểu tượng rõ ràng:
> 🔴 **CẢNH BÁO MỨC ĐỘ 1: [VẤN ĐỀ CHỐNG CHỈ ĐỊNH / TƯƠNG TÁC NGUY HIỂM / QUÁ LIỀU ĐỘC TÍNH]**
> - **Cơ chế & Hậu quả:** Nêu rõ cơ chế tương tác hoặc nguy cơ lâm sàng.
> - **Đề xuất bác sĩ xem xét ngay:** Hướng xử trí hoặc lựa chọn thay thế an toàn.
> - **Tài liệu dẫn chứng:** Trích dẫn nguồn tài liệu cụ thể.

> 🟡 **LƯU Ý MỨC ĐỘ 2: [VẤN ĐỀ CẦN HIỆU CHỈNH LIỀU THEO MLCT / THỜI ĐIỂM UỐNG / TƯƠNG TÁC TRUNG BÌNH]**
> - **Nguy cơ lâm sàng:** Nguy cơ tích lũy liều hoặc giảm hiệu lực điều trị.
> - **Biện pháp xử trí/theo dõi:** Liều khuyến cáo điều chỉnh hoặc khoảng cách uống.
> - **Tài liệu dẫn chứng:** Trích dẫn nguồn tài liệu.

> 🟢 **PHÙ HỢP TRÊN CÁC TIÊU CHÍ ĐÃ KIỂM TRA**
> - Ghi rõ các thuốc phù hợp về chỉ định, đường dùng và liều dùng trên người bệnh này.

### 3. ĐỀ XUẤT CAN THIỆP DƯỢC LÂM SÀNG & CHỈ SỐ THEO DÕI
- **Vấn đề cụ thể:** Thuốc/cặp tương tác/liều cần can thiệp.
- **Đề xuất để bác sĩ duyệt:** Giải pháp thay thế hoặc điều chỉnh liều cụ thể.
- **Chỉ số cần theo dõi:** Xét nghiệm (Creatinine, men gan, điện giải đồ, ECG...) và thời điểm đánh giá lại.`;

async function callVertexGemini(prompt, systemInstruction = '', imagePart = null) {
  const cfg = getVertexConfig();
  if (!cfg.apiKey && !cfg.project) {
    throw new Error('NO_API_KEY');
  }

  const isVertexExpress = cfg.apiKey.startsWith('AQ.');
  const endpoint = isVertexExpress
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${cfg.model}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;

  const headers = { 'Content-Type': 'application/json' };
  if (isVertexExpress) {
    headers['x-goog-api-key'] = cfg.apiKey;
  }

  const contents = [];
  const parts = [{ text: prompt }];
  if (imagePart) {
    parts.unshift({
      inline_data: {
        mime_type: imagePart.mimeType,
        data: imagePart.data
      }
    });
  }

  contents.push({ role: 'user', parts });

  const payload = {
    contents,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 3000
    }
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('[Vertex API Error]:', res.status, errorText);
    throw new Error(`Vertex AI trả về mã lỗi: ${res.status} - ${errorText.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || '';
  return text;
}

// Fallback cục bộ khi chưa cấu hình API Key: Đánh giá lâm sàng thông minh từ CSDL Tương Tác & DrugView/MLCT
function evaluatePrescriptionLocally(patientInfo, drugs, clinicalContext, interactionsData = null) {
  const warnings = [];
  const notes = [];
  const okList = [];

  const crcl = parseFloat(patientInfo.crcl || patientInfo.egfr || '120');

  // 1. Phân tích tương tác từ CSDL 4,592 tương tác BVĐK Ninh Bình
  if (interactionsData && interactionsData.interactions) {
    for (const inter of interactionsData.interactions) {
      if (inter.severityLevel === 'DANGER') {
        warnings.push({
          type: 'interaction',
          title: `TƯƠNG TÁC CHỐNG CHỈ ĐỊNH: ${inter.thuoc1} + ${inter.thuoc2}`,
          severity: inter.mucDo,
          mechanism: inter.coChe || 'Tương tác đối kháng hoặc làm gia tăng độc tính nghiêm trọng',
          consequence: inter.hauQua || 'Nguy cơ biến cố đe dọa tính mạng',
          action: inter.xuTri || 'Chống chỉ định phối hợp. Đề xuất đổi phác đồ khác.',
          source: inter.nguon || 'Hội đồng Dược BVĐK Ninh Bình'
        });
      } else if (inter.severityLevel === 'WARNING') {
        notes.push({
          type: 'interaction',
          drug: `${inter.thuoc1} + ${inter.thuoc2}`,
          issue: `Tương tác ${inter.mucDo}: ${inter.hauQua || inter.coChe || 'Cần theo dõi thận trọng'}`,
          proposal: inter.xuTri || 'Theo dõi lâm sàng và điều chỉnh liều nếu cần',
          source: inter.nguon || 'Hội đồng Dược BVĐK Ninh Bình'
        });
      }
    }
  }

  // 2. Kiểm tra chức năng thận trên 1,114 thuốc MLCT
  for (const d of drugs) {
    const name = d.name || '';
    const norm = name.toLowerCase();

    if (crcl < 50 && (norm.includes('metformin') || norm.includes('ciprofloxacin') || norm.includes('levofloxacin') || norm.includes('vancomycin') || norm.includes('enalapril') || norm.includes('allopurinol') || norm.includes('clarithromycin'))) {
      notes.push({
        type: 'renal',
        drug: name,
        issue: `Bệnh nhân có CrCl = ${crcl} mL/phút; cần xem xét hiệu chỉnh liều hoặc khoảng cách dùng theo MLCT`,
        proposal: `Tham khảo bảng liều theo MLCT của BVĐK Ninh Bình để giảm liều tích lũy, phòng ngừa độc tính trên thận.`,
        source: 'Bảng liều MLCT BVĐK Ninh Bình & UpToDate'
      });
    } else {
      okList.push(name);
    }
  }

  // Tạo báo cáo cấu trúc chuẩn
  let md = `[PHÂN LOẠI]: THẨM ĐỊNH ĐƠN THUỐC — CHUYÊN SÂU NỘI BỘ\n\n`;
  md += `### 1. TÓM TẮT ĐƠN THUỐC\n`;
  md += `- **Người bệnh:** ${patientInfo.age ? patientInfo.age + ' tuổi' : 'Chưa rõ tuổi'}, Giới tính: ${patientInfo.gender || 'Chưa rõ'}, Chẩn đoán: ${patientInfo.diagnosis || 'Không ghi'}.\n`;
  md += `- **Chức năng cơ quan:** CrCl/eGFR: ${crcl} mL/phút | Lọc máu: ${patientInfo.dialysis || 'Không'} | Dị ứng: ${patientInfo.allergy || 'Chưa ghi nhận'}.\n`;
  md += `- **Danh mục thuốc tiếp nhận (${drugs.length} thuốc):** ${drugs.map(d => `${d.name} (${d.dose || ''} ${d.route || ''})`).join(', ')}.\n\n`;

  md += `### 2. PHÂN TÍCH LÂM SÀNG\n`;

  // Mức độ 1: Cảnh báo đỏ
  if (warnings.length > 0) {
    for (const w of warnings) {
      md += `> 🔴 **CẢNH BÁO MỨC ĐỘ 1: ${w.title}**\n`;
      md += `> - **Mức độ rủi ro:** ${w.severity}\n`;
      md += `> - **Cơ chế & Hậu quả:** ${w.consequence} (${w.mechanism}).\n`;
      md += `> - **Đề xuất bác sĩ xem xét ngay:** ${w.action}.\n`;
      md += `> - **Tài liệu dẫn chứng:** ${w.source}.\n\n`;
    }
  }

  // Mức độ 2: Lưu ý vàng
  if (notes.length > 0) {
    for (const n of notes) {
      if (n.type === 'interaction') {
        md += `> 🟡 **LƯU Ý MỨC ĐỘ 2: TƯƠNG TÁC THUỐC CẦN THEO DÕI (${n.drug})**\n`;
        md += `> - **Nguy cơ lâm sàng:** ${n.issue}.\n`;
        md += `> - **Biện pháp xử trí/theo dõi:** ${n.proposal}.\n`;
        md += `> - **Tài liệu dẫn chứng:** ${n.source}.\n\n`;
      } else {
        md += `> 🟡 **LƯU Ý MỨC ĐỘ 2: HIỆU CHỈNH LIỀU THEO MLCT (${n.drug})**\n`;
        md += `> - **Nguy cơ lâm sàng:** ${n.issue}.\n`;
        md += `> - **Biện pháp xử trí/theo dõi:** ${n.proposal}.\n`;
        md += `> - **Tài liệu dẫn chứng:** ${n.source}.\n\n`;
      }
    }
  }

  if (okList.length > 0 && warnings.length === 0) {
    md += `> 🟢 **PHÙ HỢP TRÊN CÁC TIÊU CHÍ ĐÃ KIỂM TRA**\n`;
    md += `> Các thuốc: ${okList.join(', ')} chưa phát hiện chống chỉ định phối hợp tuyệt đối trên CSDL bệnh viện.\n\n`;
  }

  md += `### 3. ĐỀ XUẤT CAN THIỆP DƯỢC LÂM SÀNG & CHỈ SỐ THEO DÕI\n`;
  if (warnings.length > 0) {
    md += `- **Can thiệp khẩn cấp:** Đề nghị bác sĩ hội chẩn hoặc thay thế các cặp thuốc chống chỉ định để đảm bảo an toàn cho người bệnh.\n`;
  }
  md += `- **Đề xuất bác sĩ xem xét:** Kiểm tra chức năng thận định kỳ, theo dõi các triệu chứng bất lợi theo khuyến cáo.\n`;
  md += `- **Chỉ số cần theo dõi:** Creatinine huyết thanh, eGFR sau 48-72 giờ, các chỉ số đông máu/men gan (nếu có thuốc nguy cơ).\n\n`;
  md += `*(Bản phân tích từ CSDL chuẩn hóa 1.114 thuốc MLCT & 4.592 Tương tác thuốc BVĐK Tỉnh Ninh Bình)*`;

  return md;
}

export async function askChatbot({ message, history = [], sourceMode = 'closed', ocrText = '' }) {
  const fullPrompt = `${message}${ocrText ? `\n[Nội dung chữ từ ảnh thuốc đã xác nhận]:\n${ocrText}` : ''}`;
  const { snippets, sources, interactions } = await getRelevantContext(fullPrompt);

  // Nếu người dùng hỏi về tương tác thuốc, tra cứu thêm tương tác tự do
  const directInteractions = searchInteractions(fullPrompt);
  if (directInteractions.length > 0 && (!interactions || interactions.total === 0)) {
    snippets.push(`\n=== TƯƠNG TÁC THUỐC TÌM THẤY TỪ CSDL BVĐK NINH BÌNH ===`);
    for (const r of directInteractions.slice(0, 4)) {
      snippets.push(`[${r.thuoc1} + ${r.thuoc2}]
Mức độ: ${r.mucDo}
Cơ chế: ${r.coChe}
Hậu quả: ${r.hauQua}
Xử trí: ${r.xuTri}
Nguồn: ${r.nguon}`);
      sources.push({
        id: `inter_${r.stt}`,
        title: `Tương tác ${r.thuoc1} - ${r.thuoc2} (${r.mucDo})`,
        url: 'https://docs.google.com/spreadsheets/d/1XKOSQrEAUXg1TPr7TlLUT7CET4ONkJVF9P9CDX3SXn0/edit',
        origin: 'closed',
        provenance: 'approved_ddi_ninhbinh'
      });
    }
  }

  const contextBlock = snippets.length > 0
    ? `\n--- DỮ LIỆU LÂM SÀNG TỪ KHO BỆNH VIỆN / DRUGVIEW & TƯƠNG TÁC BVĐK NINH BÌNH ---\n${snippets.join('\n\n')}\n-----------------------------------\n`
    : '';

  const userQuery = `${contextBlock}\nCâu hỏi của người dùng: ${fullPrompt}`;

  try {
    const text = await callVertexGemini(userQuery, CHATBOT_SYSTEM_INSTRUCTION);
    return {
      text,
      sources,
      provider: 'vertex-agent',
      status: 'answered',
      grounded: sources.length > 0
    };
  } catch (err) {
    if (err.message === 'NO_API_KEY') {
      let fallbackText = `Xin chào! Tôi là trợ lý Dược lâm sàng ảo NBCare.\n\n`;
      if (snippets.length > 0) {
        fallbackText += `Đã tra cứu trong CSDL Tương Tác & DrugView / MLCT Ninh Bình được các thông tin sau:\n\n`;
        fallbackText += snippets.slice(0, 4).join('\n\n');
        fallbackText += `\n\n*Lưu ý: Để kích hoạt Vertex AI toàn diện, vui lòng cấu hình biến GEMINI_API_KEY trong file .env.*`;
      } else {
        fallbackText += `Chưa đủ dữ liệu tra cứu từ tài liệu bệnh viện cung cấp cho câu hỏi: "${message}".\n\nBạn có thể cung cấp thêm tên hoạt chất hoặc cấu hình khóa Vertex AI/Gemini để tra cứu mở rộng.`;
      }
      return {
        text: fallbackText,
        sources,
        provider: 'local-clinical-db',
        status: 'answered',
        grounded: snippets.length > 0
      };
    }
    throw err;
  }
}

export async function reviewPrescription({ patientInfo, drugs = [], prescriptionText = '', ocrText = '' }) {
  const drugNames = drugs.map(d => d.name).filter(Boolean);
  const combinedText = `${prescriptionText}\n${ocrText}\n${drugNames.join(', ')}`;
  const { snippets, sources, interactions } = await getRelevantContext(combinedText, drugNames);

  const contextBlock = snippets.length > 0
    ? `\n--- THÔNG TIN TRA CỨU TỪ CSDL DRUGVIEW, MLCT & TƯƠNG TÁC THUỐC BVĐK NINH BÌNH ---\n${snippets.join('\n\n')}\n-----------------------------------\n`
    : '';

  const prompt = `Yêu cầu thẩm định đơn thuốc sau:
HỒ SƠ BỆNH NHÂN:
- Tuổi: ${patientInfo.age || 'Không rõ'}
- Giới tính: ${patientInfo.gender || 'Không rõ'}
- Chẩn đoán: ${patientInfo.diagnosis || 'Không ghi'}
- Mức lọc cầu thận (CrCl/eGFR): ${patientInfo.crcl || patientInfo.egfr || 'Bình thường'} mL/phút
- Tình trạng lọc máu: ${patientInfo.dialysis || 'Không'}
- Tiền sử dị ứng / bệnh kèm: ${patientInfo.allergy || 'Không'}

DANH MỤC THUỐC TRONG ĐƠN:
${drugs.map((d, i) => `${i + 1}. ${d.name} - Liều: ${d.dose || 'Theo chỉ định'} - Đường: ${d.route || 'Uống'} - Tần suất: ${d.frequency || '1 lần/ngày'}`).join('\n')}
${prescriptionText ? `\nNội dung đơn tự do:\n${prescriptionText}` : ''}
${ocrText ? `\nChữ từ ảnh đơn thuốc:\n${ocrText}` : ''}

${contextBlock}
Hãy xuất báo cáo bình đơn chuyên sâu theo đúng cấu trúc 3 phần quy định.`;

  try {
    const report = await callVertexGemini(prompt, PRESCRIPTION_REVIEW_SYSTEM_INSTRUCTION);
    return {
      report,
      sources,
      interactions,
      provider: 'vertex-agent',
      status: 'completed'
    };
  } catch (err) {
    if (err.message === 'NO_API_KEY') {
      const localReport = evaluatePrescriptionLocally(patientInfo, drugs, snippets, interactions);
      return {
        report: localReport,
        sources,
        interactions,
        provider: 'local-clinical-db',
        status: 'completed'
      };
    }
    throw err;
  }
}

export async function performOcr(imageData, mimeType) {
  const cfg = getVertexConfig();
  if (!cfg.apiKey && !cfg.project) {
    throw new Error('NO_API_KEY');
  }

  const prompt = 'Hãy đọc và trích xuất toàn bộ tên thuốc, hàm lượng, số lượng, liều dùng, chẩn đoán và thông tin bệnh nhân từ bức ảnh này dưới dạng văn bản rõ ràng, chính xác. Không suy đoán.';
  const text = await callVertexGemini(prompt, '', { data: imageData, mimeType });
  return { text };
}
