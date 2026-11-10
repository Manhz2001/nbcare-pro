import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let DATA_DIR = path.join(ROOT, 'data');
if (!existsSync(DATA_DIR) && existsSync(path.join(process.cwd(), 'data'))) {
  DATA_DIR = path.join(process.cwd(), 'data');
}

const DRUGVIEW_API_URL = 'https://script.google.com/macros/s/AKfycbwPjxaE67xfN1pV4A6nO2ND-tjOc_65jvpBR1xfeBwBSkVFMHf5IbLQ5rKWGu_xsRQ23Q/exec';

let mlctIndex = null;
const mlctDrugCache = new Map();
let drugviewCatalogue = null;
let lastDrugviewFetch = 0;

function cellText(cell) {
  if (!cell) return '';
  if (typeof cell === 'object' && cell !== null) return String(cell.value || cell.text || '').trim();
  return String(cell).trim();
}

function normalize(str) {
  const text = cellText(str);
  if (!text) return '';
  return text.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().trim();
}

export async function initClinicalDB() {
  try {
    const indexPath = path.join(DATA_DIR, 'mlct-index.json');
    const indexData = await readFile(indexPath, 'utf8');
    mlctIndex = JSON.parse(indexData);
    console.log(`[CSDL] Đã tải chỉ mục MLCT: ${mlctIndex.drugNames?.length || 0} hoạt chất.`);
  } catch (err) {
    console.warn('[CSDL] Chưa đọc được tệp mlct-index.json:', err.message);
  }

  // Preload hoặc fetch DrugView catalogue trong background
  fetchDrugViewCatalogue().catch(err => {
    console.warn('[CSDL] Không tải được trực tuyến DrugView Apps Script:', err.message);
  });
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
  } catch (err) {
    // offline or timeout, use memory if exists
  }
  return drugviewCatalogue || [];
}

export async function getDrugDetails(drugName) {
  if (!mlctIndex || !mlctIndex.drugFiles) return null;
  const normalized = normalize(drugName);
  
  // Tìm thuốc trong mlctIndex
  let matchedKey = null;
  for (const name of Object.keys(mlctIndex.drugFiles)) {
    if (normalize(name) === normalized || normalized.includes(normalize(name))) {
      matchedKey = name;
      break;
    }
  }
  if (!matchedKey) return null;

  if (mlctDrugCache.has(matchedKey)) {
    return mlctDrugCache.get(matchedKey);
  }

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
  } catch (err) {
    return null;
  }
}

export async function getRelevantContext(query, drugList = []) {
  const snippets = [];
  const sources = [];
  const targetDrugs = new Set();

  for (const d of drugList) {
    if (d && typeof d === 'string') targetDrugs.add(d);
  }

  // Quét các từ khóa thuốc trong câu query nếu chưa có list
  if (mlctIndex && mlctIndex.drugNames) {
    const normQ = normalize(query);
    for (const dName of mlctIndex.drugNames) {
      if (normQ.includes(normalize(dName))) {
        targetDrugs.add(dName);
      }
    }
  }

  // Trích xuất dữ liệu thận / MLCT từ 187 thuốc
  for (const drugName of targetDrugs) {
    const details = await getDrugDetails(drugName);
    if (details && details.rows) {
      for (const row of details.rows.slice(0, 3)) {
        snippets.push(`[THUỐC: ${details.name} - ${row.ChiDinh || ''}]
Liều thông thường: ${row.LieuThongThuong || 'N/A'}
Hiệu chỉnh thận/MLCT: ${row.LieuTheoMLCT || row.LieuChuanHoa || 'Không có khuyến cáo riêng'}
Lọc máu (IHD/CRRT): ${row.IHD || ''} | ${row.CRRT || ''}
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

  // Trích xuất từ DrugView nếu có
  if (drugviewCatalogue) {
    const normQ = normalize(query);
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
        if (snippets.length >= 8) break;
      }
    }
  }

  return { snippets, sources };
}

export function getDatabaseStats() {
  return {
    mlctDrugsCount: mlctIndex?.drugNames?.length || 187,
    drugviewOnlineCount: drugviewCatalogue?.length || null,
    loaded: Boolean(mlctIndex)
  };
}
