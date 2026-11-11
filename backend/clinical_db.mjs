import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(currentDir, '..');
let DATA_DIR = path.join(ROOT, 'data');
if (!existsSync(DATA_DIR) && existsSync(path.join(process.cwd(), 'data'))) {
  DATA_DIR = path.join(process.cwd(), 'data');
}

const DRUGVIEW_API_URL = 'https://script.google.com/macros/s/AKfycbwPjxaE67xfN1pV4A6nO2ND-tjOc_65jvpBR1xfeBwBSkVFMHf5IbLQ5rKWGu_xsRQ23Q/exec';
const MLCT_API_URL = 'https://script.google.com/macros/s/AKfycby1NsEE3QoqacmE4ep-It1loImsf_Zbgru3yZ7ITZVbdNNJFYTDKY-zJRhzaWYPtMR8/exec';

let mlctIndex = null;
let allDrugNames = [];
const mlctDrugCache = new Map();
let drugviewCatalogue = null;
let lastDrugviewFetch = 0;

// CSDL Tương Tác Thuốc (4,592 bản ghi)
let interactionsRaw = [];
const interactionsTwoWayMap = new Map();
const interactionsByDrug = new Map();

function cellText(cell) {
  if (!cell) return '';
  if (typeof cell === 'object' && cell !== null) return String(cell.value || cell.text || '').trim();
  return String(cell).trim();
}

export function normalize(str) {
  const text = cellText(str);
  if (!text) return '';
  return text.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().trim();
}

// Khởi tạo toàn bộ CSDL 2 Sheet
export async function initClinicalDB() {
  // 1. Nạp danh mục 1,114 thuốc từ Sheet 'Du lieu chuan hoa'
  try {
    const allNamesPath = path.join(DATA_DIR, 'all-drug-names.json');
    if (existsSync(allNamesPath)) {
      allDrugNames = JSON.parse(await readFile(allNamesPath, 'utf8'));
      console.log(`[CSDL] Đã tải danh mục mở rộng MLCT: ${allDrugNames.length} hoạt chất.`);
    }
  } catch (e) {
    console.warn('[CSDL] Chưa đọc được all-drug-names.json:', e.message);
  }

  // 2. Nạp chỉ mục 187 thuốc MLCT chi tiết
  try {
    const indexPath = path.join(DATA_DIR, 'mlct-index.json');
    if (existsSync(indexPath)) {
      const indexData = await readFile(indexPath, 'utf8');
      mlctIndex = JSON.parse(indexData);
      console.log(`[CSDL] Đã tải chỉ mục MLCT cốt lõi: ${mlctIndex.drugNames?.length || 0} hoạt chất.`);
    }
  } catch (err) {
    console.warn('[CSDL] Chưa đọc được tệp mlct-index.json:', err.message);
  }

  // 3. Nạp và lập chỉ mục 4,592 Tương tác thuốc từ Sheet 'TƯƠNG TÁC THUỐC'
  try {
    const interPath = path.join(DATA_DIR, 'interactions.json');
    if (existsSync(interPath)) {
      const raw = await readFile(interPath, 'utf8');
      interactionsRaw = JSON.parse(raw);
      buildInteractionsIndex(interactionsRaw);
      console.log(`[CSDL] Đã tải & lập chỉ mục ma trận 2 chiều: ${interactionsRaw.length} tương tác thuốc.`);
    }
  } catch (err) {
    console.warn('[CSDL] Chưa đọc được interactions.json:', err.message);
  }

  // 4. Preload danh mục DrugView
  fetchDrugViewCatalogue().catch(err => {
    console.warn('[CSDL] Không tải được trực tuyến DrugView Apps Script:', err.message);
  });
}

// Xây dựng chỉ mục ma trận tương tác 2 chiều (A, B) == (B, A)
function buildInteractionsIndex(items) {
  interactionsTwoWayMap.clear();
  interactionsByDrug.clear();

  for (const item of items) {
    const t1 = cellText(item['Thuốc 1']);
    const t2 = cellText(item['Thuốc 2']);
    if (!t1 || !t2) continue;

    const n1 = normalize(t1);
    const n2 = normalize(t2);

    const record = {
      stt: cellText(item['STT']),
      thuoc1: t1,
      nhom1: cellText(item['Nhóm tác dụng 1']),
      thuoc2: t2,
      nhom2: cellText(item['Nhóm tác dụng 2']),
      mucDo: cellText(item['Mức độ']),
      mucDoColor: item['Mức độ']?.foreground || '#000000',
      mucDoBold: Boolean(item['Mức độ']?.isBold),
      coChe: cellText(item['Cơ chế']),
      hauQua: cellText(item['Hậu quả']),
      xuTri: cellText(item['Xử trí']),
      nguon: cellText(item['Nguồn'])
    };

    // Phân loại mức độ lâm sàng
    const md = record.mucDo.toLowerCase();
    if (md.includes('rất nghiêm trọng') || md.includes('chống chỉ định') || md.includes('đe dọa tính mạng')) {
      record.severityLevel = 'DANGER'; // 🔴 Mức 1
    } else if (md.includes('nghiêm trọng') || md.includes('tránh phối hợp') || md.includes('độc tính cấp')) {
      record.severityLevel = 'DANGER'; // 🔴 Mức 1
    } else if (md.includes('đáng kể') || md.includes('trung bình') || md.includes('điều chỉnh liều')) {
      record.severityLevel = 'WARNING'; // 🟡 Mức 2
    } else {
      record.severityLevel = 'INFO'; // 🟢 Mức 3
    }

    // Khóa 2 chiều
    const key1 = `${n1}||${n2}`;
    const key2 = `${n2}||${n1}`;

    if (!interactionsTwoWayMap.has(key1)) interactionsTwoWayMap.set(key1, []);
    interactionsTwoWayMap.get(key1).push(record);

    if (!interactionsTwoWayMap.has(key2)) interactionsTwoWayMap.set(key2, []);
    interactionsTwoWayMap.get(key2).push(record);

    // Chỉ mục theo từng hoạt chất
    if (!interactionsByDrug.has(n1)) interactionsByDrug.set(n1, []);
    interactionsByDrug.get(n1).push(record);

    if (!interactionsByDrug.has(n2)) interactionsByDrug.set(n2, []);
    interactionsByDrug.get(n2).push(record);
  }
}

// Kiểm tra tương tác toàn diện giữa mọi cặp thuốc trong danh sách
export function checkDrugInteractions(drugNames = []) {
  const cleanNames = drugNames
    .map(d => typeof d === 'string' ? d.trim() : (d.name || '').trim())
    .filter(Boolean);

  const matched = [];
  const seenKeys = new Set();

  for (let i = 0; i < cleanNames.length; i++) {
    for (let j = i + 1; j < cleanNames.length; j++) {
      const nameA = cleanNames[i];
      const nameB = cleanNames[j];
      const normA = normalize(nameA);
      const normB = normalize(nameB);

      // Tra cứu trực tiếp cặp
      for (const [key, records] of interactionsTwoWayMap.entries()) {
        const [k1, k2] = key.split('||');
        const matchForward = (normA.includes(k1) || k1.includes(normA)) && (normB.includes(k2) || k2.includes(normB));
        const matchReverse = (normA.includes(k2) || k2.includes(normA)) && (normB.includes(k1) || k1.includes(normB));

        if (matchForward || matchReverse) {
          for (const r of records) {
            const pairKey = [normalize(r.thuoc1), normalize(r.thuoc2)].sort().join('__') + '__' + r.stt;
            if (!seenKeys.has(pairKey)) {
              seenKeys.add(pairKey);
              matched.push({
                ...r,
                pairQuery: `${nameA} + ${nameB}`
              });
            }
          }
        }
      }
    }
  }

  // Sắp xếp: Nguy hiểm nhất (DANGER) lên đầu, tiếp đến WARNING
  matched.sort((a, b) => {
    if (a.severityLevel === 'DANGER' && b.severityLevel !== 'DANGER') return -1;
    if (a.severityLevel !== 'DANGER' && b.severityLevel === 'DANGER') return 1;
    return 0;
  });

  return {
    total: matched.length,
    dangerCount: matched.filter(m => m.severityLevel === 'DANGER').length,
    warningCount: matched.filter(m => m.severityLevel === 'WARNING').length,
    interactions: matched
  };
}

// Tìm kiếm tương tác cho Chatbot theo câu hỏi tự do
export function searchInteractions(query) {
  const normQ = normalize(query);
  const matched = [];
  const seen = new Set();

  for (const [key, records] of interactionsTwoWayMap.entries()) {
    const [k1, k2] = key.split('||');
    if (normQ.includes(k1) && normQ.includes(k2)) {
      for (const r of records) {
        const pairKey = [normalize(r.thuoc1), normalize(r.thuoc2)].sort().join('__');
        if (!seen.has(pairKey)) {
          seen.add(pairKey);
          matched.push(r);
        }
      }
    }
  }

  // Nếu chưa thấy cặp rõ ràng, tìm theo từng hoạt chất có trong câu
  if (matched.length === 0) {
    for (const [drugNorm, records] of interactionsByDrug.entries()) {
      if (drugNorm.length > 3 && normQ.includes(drugNorm)) {
        for (const r of records.slice(0, 3)) {
          const pairKey = [normalize(r.thuoc1), normalize(r.thuoc2)].sort().join('__');
          if (!seen.has(pairKey)) {
            seen.add(pairKey);
            matched.push(r);
          }
        }
      }
      if (matched.length >= 6) break;
    }
  }

  return matched;
}

export async function fetchDrugViewCatalogue() {
  const now = Date.now();
  if (drugviewCatalogue && now - lastDrugviewFetch < 300000) {
    return drugviewCatalogue;
  }
  try {
    const res = await fetch(DRUGVIEW_API_URL, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        drugviewCatalogue = data;
        lastDrugviewFetch = now;
        console.log(`[CSDL] Đã nạp danh mục trực tuyến DrugView: ${data.length} thuốc.`);
        return drugviewCatalogue;
      }
    }
  } catch (err) {}
  return drugviewCatalogue || [];
}

export async function getDrugDetails(drugName) {
  if (!drugName) return null;
  const normalized = normalize(drugName);

  // 1. Kiểm tra trong bộ nhớ đệm
  for (const [cachedKey, details] of mlctDrugCache.entries()) {
    if (normalize(cachedKey) === normalized || normalized.includes(normalize(cachedKey))) {
      return details;
    }
  }

  // 2. Tìm trong mlctIndex (187 thuốc có tệp local)
  let matchedKey = null;
  if (mlctIndex && mlctIndex.drugFiles) {
    for (const name of Object.keys(mlctIndex.drugFiles)) {
      if (normalize(name) === normalized || normalized.includes(normalize(name))) {
        matchedKey = name;
        break;
      }
    }
  }

  if (matchedKey && mlctIndex.drugFiles[matchedKey]) {
    try {
      const relPath = mlctIndex.drugFiles[matchedKey];
      let fullPath = path.join(ROOT, relPath);
      if (!existsSync(fullPath) && existsSync(path.join(process.cwd(), relPath))) {
        fullPath = path.join(process.cwd(), relPath);
      }
      const content = await readFile(fullPath, 'utf8');
      const parsed = JSON.parse(content);
      mlctDrugCache.set(matchedKey, parsed);
      return parsed;
    } catch (err) {}
  }

  // 3. Nếu thuốc nằm trong danh mục 1,114 thuốc của 'Du lieu chuan hoa' nhưng chưa có file local:
  // Tự động fetch trực tuyến từ API của Apps Script 'Du lieu chuan hoa'
  if (allDrugNames.length > 0) {
    const matchedOnline = allDrugNames.find(n => normalize(n) === normalized || normalized.includes(normalize(n)));
    if (matchedOnline) {
      try {
        const fetchUrl = `${MLCT_API_URL}?action=getDrugDataByHoatChat&drugName=${encodeURIComponent(matchedOnline)}`;
        const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const json = await res.json();
          if (json.ok && Array.isArray(json.data) && json.data.length > 0) {
            const parsed = {
              name: matchedOnline,
              rows: json.data
            };
            mlctDrugCache.set(matchedOnline, parsed);
            return parsed;
          }
        }
      } catch (e) {}
    }
  }

  return null;
}

export async function getRelevantContext(query, drugList = []) {
  const snippets = [];
  const sources = [];
  const targetDrugs = new Set();

  for (const d of drugList) {
    if (d && typeof d === 'string') targetDrugs.add(d);
    else if (d && d.name) targetDrugs.add(d.name);
  }

  // Quét từ khóa hoạt chất trong câu query
  const normQ = normalize(query);
  if (mlctIndex && mlctIndex.drugNames) {
    for (const dName of mlctIndex.drugNames) {
      if (normQ.includes(normalize(dName))) {
        targetDrugs.add(dName);
      }
    }
  }

  // 1. Trích xuất Tương tác thuốc từ CSDL 4,592 tương tác
  const interactions = checkDrugInteractions(Array.from(targetDrugs));
  if (interactions.total > 0) {
    snippets.push(`=== CẢNH BÁO TƯƠNG TÁC THUỐC PHÁT HIỆN TỪ CSDL BVĐK NINH BÌNH (${interactions.total} tương tác) ===`);
    for (const inter of interactions.interactions.slice(0, 5)) {
      snippets.push(`[TƯƠNG TÁC: ${inter.thuoc1} + ${inter.thuoc2}]
Mức độ: ${inter.mucDo} (Cấp độ: ${inter.severityLevel})
Cơ chế: ${inter.coChe || 'Chưa ghi rõ'}
Hậu quả lâm sàng: ${inter.hauQua || 'Tăng nguy cơ biến cố bất lợi'}
Hướng xử trí: ${inter.xuTri || 'Theo dõi sát / Cân nhắc thay thế'}
Nguồn thẩm định: ${inter.nguon || 'Hội đồng Dược BVĐK Ninh Bình'}`);

      sources.push({
        id: `interaction_${inter.stt}`,
        title: `Tương tác: ${inter.thuoc1} + ${inter.thuoc2} (${inter.mucDo})`,
        url: 'https://docs.google.com/spreadsheets/d/1XKOSQrEAUXg1TPr7TlLUT7CET4ONkJVF9P9CDX3SXn0/edit',
        origin: 'closed',
        provenance: 'approved_ddi_ninhbinh'
      });
    }
  }

  // 2. Trích xuất dữ liệu thận / MLCT từ 1,114 thuốc chuẩn hóa
  for (const drugName of targetDrugs) {
    const details = await getDrugDetails(drugName);
    if (details && details.rows) {
      for (const row of details.rows.slice(0, 3)) {
        snippets.push(`[THUỐC: ${details.name} - ${row.ChiDinh || ''}]
Liều thông thường: ${row.LieuThongThuong || 'N/A'}
Hiệu chỉnh thận/MLCT: ${row.LieuTheoMLCT || row.LieuChuanHoa || 'Không có khuyến cáo riêng'}
Lọc máu (IHD/CRRT/CAPD): IHD: ${row.IHD || 'N/A'} | CRRT: ${row.CRRT || 'N/A'} | PD: ${row.CAPD || 'N/A'}
Nguồn: ${row.Nguon || 'UpToDate'}`);

        sources.push({
          id: `mlct_${details.name.replace(/\s+/g, '_')}`,
          title: `Hiệu chỉnh liều ${details.name} theo MLCT (BVĐK Ninh Bình)`,
          url: row.GhiChuNguonLink || 'https://docs.google.com/spreadsheets/d/1vmuz5pDyPMleMZUFphZoGAAhOoXqB62eEing3NVn8gs/edit',
          origin: 'closed',
          provenance: 'approved_local'
        });
      }
    }
  }

  // 3. Trích xuất từ DrugView nếu có
  if (drugviewCatalogue) {
    for (const item of drugviewCatalogue) {
      const hc = normalize(item['Hoạt chất']);
      const bd = normalize(item['Biệt dược']);
      if ((hc && normQ.includes(hc)) || (bd && normQ.includes(bd))) {
        const hoatChat = cellText(item['Hoạt chất']);
        const bietDuoc = cellText(item['Biệt dược']);
        snippets.push(`[DRUGVIEW: ${hoatChat} (${bietDuoc})]
Dạng: ${cellText(item['Dạng bào chế'])}
Chỉ định: ${cellText(item['Chỉ định'])}
Liều & Cách dùng: ${cellText(item['Liều dùng'])} - ${cellText(item['Cách dùng'])}
Chống chỉ định: ${cellText(item['Chống chỉ định'])}
Tương hợp/Tương kỵ: ${cellText(item['Tương kỵ'])}`);

        sources.push({
          id: `drugview_${hoatChat || 'item'}`,
          title: `DrugView Ninh Bình - ${hoatChat}`,
          url: 'https://gentle-madeleine-2d07c3.netlify.app/tra-cuu-thuoc-tiem-truyen.html',
          origin: 'closed',
          provenance: 'published_drugview'
        });
        if (snippets.length >= 10) break;
      }
    }
  }

  return { snippets, sources, interactions };
}

export function getDatabaseStats() {
  return {
    mlctDrugsCount: allDrugNames.length || mlctIndex?.drugNames?.length || 187,
    preloadedMlctDrugs: mlctIndex?.drugNames?.length || 187,
    totalInteractionsCount: interactionsRaw.length || 4592,
    drugviewOnlineCount: drugviewCatalogue?.length || null,
    loaded: Boolean(mlctIndex || interactionsRaw.length)
  };
}
