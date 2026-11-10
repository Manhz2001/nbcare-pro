export function initReviewModule() {
  const drugTableBody = document.getElementById('drugTableBody');
  const btnAddDrugRow = document.getElementById('btnAddDrugRow');
  const btnSubmitReview = document.getElementById('btnSubmitReview');
  const btnSamplePrescription = document.getElementById('btnSamplePrescription');
  const reviewOutput = document.getElementById('reviewOutput');
  const btnCopyReport = document.getElementById('btnCopyReport');
  const btnPrintReport = document.getElementById('btnPrintReport');
  const prescriptionText = document.getElementById('prescriptionText');
  const reviewImageUpload = document.getElementById('reviewImageUpload');
  const btnUploadReviewImage = document.getElementById('btnUploadReviewImage');

  let currentOcrText = '';

  // Thêm một dòng thuốc mới vào bảng
  function addRow(name = '', dose = '', route = 'Uống', frequency = '2 lần/ngày') {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="drug-name" placeholder="Tên thuốc / hoạt chất" value="${name}"></td>
      <td><input type="text" class="drug-dose" placeholder="500mg" value="${dose}" style="width:70px;"></td>
      <td><input type="text" class="drug-route" placeholder="Uống" value="${route}" style="width:70px;"></td>
      <td><input type="text" class="drug-freq" placeholder="2 lần/ngày" value="${frequency}"></td>
      <td style="text-align:center;"><button type="button" class="btn-remove-row" style="background:none; border:none; color:var(--danger); cursor:pointer; font-weight:bold;">✕</button></td>
    `;
    tr.querySelector('.btn-remove-row').addEventListener('click', () => tr.remove());
    drugTableBody.appendChild(tr);
  }

  btnAddDrugRow.addEventListener('click', () => addRow());

  // Nạp đơn thuốc mẫu thử nghiệm (Ví dụ: Bệnh nhân lớn tuổi, suy thận CrCl 35ml/phút, đơn có Ciprofloxacin và Metformin)
  btnSamplePrescription.addEventListener('click', () => {
    document.getElementById('patientAge').value = '68';
    document.getElementById('patientGender').value = 'Nam';
    document.getElementById('patientDiagnosis').value = 'Đái tháo đường type 2, Viêm phế quản cấp, Tăng huyết áp';
    document.getElementById('patientCrCl').value = '35';
    document.getElementById('patientDialysis').value = 'Không';
    document.getElementById('patientAllergy').value = 'Chưa ghi nhận';

    drugTableBody.innerHTML = '';
    addRow('Metformin', '1000 mg', 'Uống', '2 lần/ngày');
    addRow('Ciprofloxacin', '500 mg', 'Uống', '2 lần/ngày');
    addRow('Amlodipine', '5 mg', 'Uống', '1 lần/ngày');
    addRow('Aspirin', '81 mg', 'Uống', '1 lần/ngày');
  });

  // Tải ảnh đơn thuốc để tự động trích xuất
  btnUploadReviewImage.addEventListener('click', () => reviewImageUpload.click());
  reviewImageUpload.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    btnUploadReviewImage.textContent = '⏳ Đang quét ảnh...';
    btnUploadReviewImage.disabled = true;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      try {
        const res = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: { data: base64, mimeType: file.type || 'image/jpeg' } })
        });
        const data = await res.json();
        if (data.text) {
          currentOcrText = data.text;
          prescriptionText.value = data.text;
          alert(`Đã nhận dạng nội dung từ ảnh đơn thuốc. Hãy kiểm tra lại các trường thông tin.`);
        } else {
          alert('Không đọc được chữ từ ảnh đơn thuốc.');
        }
      } catch (err) {
        alert('Lỗi khi OCR ảnh đơn thuốc: ' + err.message);
      } finally {
        btnUploadReviewImage.textContent = '📷 Đọc từ ảnh đơn';
        btnUploadReviewImage.disabled = false;
      }
    };
    reader.readAsDataURL(file);
  });

  // Xử lý Thẩm Định / Bình Đơn
  btnSubmitReview.addEventListener('click', async () => {
    const patientInfo = {
      age: document.getElementById('patientAge').value.trim(),
      gender: document.getElementById('patientGender').value,
      diagnosis: document.getElementById('patientDiagnosis').value.trim(),
      crcl: document.getElementById('patientCrCl').value.trim(),
      dialysis: document.getElementById('patientDialysis').value,
      allergy: document.getElementById('patientAllergy').value.trim()
    };

    const drugs = [];
    const rows = drugTableBody.querySelectorAll('tr');
    rows.forEach(tr => {
      const name = tr.querySelector('.drug-name').value.trim();
      if (name) {
        drugs.push({
          name,
          dose: tr.querySelector('.drug-dose').value.trim(),
          route: tr.querySelector('.drug-route').value.trim(),
          frequency: tr.querySelector('.drug-freq').value.trim()
        });
      }
    });

    const freeText = prescriptionText.value.trim();

    if (drugs.length === 0 && !freeText) {
      alert('Vui lòng nhập ít nhất 1 thuốc hoặc dán nội dung đơn thuốc.');
      return;
    }

    btnSubmitReview.disabled = true;
    btnSubmitReview.textContent = '⏳ Đang thẩm định lâm sàng và kiểm tra tương tác...';
    reviewOutput.innerHTML = `
      <div style="text-align:center; padding: 2.5rem; color: var(--text-muted);">
        <p style="font-size:1.1rem; font-weight:600; margin-bottom:0.5rem;">Đang tra cứu kho dữ liệu DrugView và đối chiếu quy tắc MLCT Ninh Bình...</p>
        <p style="font-size:0.85rem;">Hệ thống đang tiến hành kiểm tra chống chỉ định, tương tác bất lợi, và phân liều theo chức năng thận.</p>
      </div>
    `;

    try {
      const res = await fetch('/api/review-prescription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientInfo,
          drugs,
          prescriptionText: freeText,
          ocrText: currentOcrText
        })
      });

      const data = await res.json();
      btnSubmitReview.disabled = false;
      btnSubmitReview.innerHTML = '<span>⚡ Bắt đầu Bình Đơn / Thẩm Định Đơn</span>';

      if (data.error) {
        reviewOutput.innerHTML = `<p style="color:var(--danger); font-weight:600;">Lỗi: ${data.error}</p>`;
        return;
      }

      renderReport(data.report, data.sources);
    } catch (err) {
      btnSubmitReview.disabled = false;
      btnSubmitReview.innerHTML = '<span>⚡ Bắt đầu Bình Đơn / Thẩm Định Đơn</span>';
      reviewOutput.innerHTML = `<p style="color:var(--danger); font-weight:600;">Lỗi kết nối máy chủ: ${err.message}</p>`;
    }
  });

  // Render báo cáo định dạng chuyên sâu chuẩn lâm sàng
  function renderReport(reportMarkdown, sources = []) {
    // Tách dòng để gộp các blockquote liền kề
    const lines = reportMarkdown.split('\n');
    const processedLines = [];
    let inQuote = false;
    let quoteBuffer = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('>')) {
        inQuote = true;
        quoteBuffer.push(line.replace(/^>\s?/, ''));
      } else {
        if (inQuote) {
          const fullQuote = quoteBuffer.join('\n');
          let boxClass = 'finding-box';
          if (fullQuote.includes('🔴') || fullQuote.includes('MỨC ĐỘ 1')) boxClass += ' red';
          else if (fullQuote.includes('🟡') || fullQuote.includes('MỨC ĐỘ 2')) boxClass += ' yellow';
          else if (fullQuote.includes('🟢') || fullQuote.includes('PHÙ HỢP')) boxClass += ' green';
          processedLines.push(`<div class="${boxClass}">${formatMarkdownSnippet(fullQuote)}</div>`);
          quoteBuffer = [];
          inQuote = false;
        }
        processedLines.push(line);
      }
    }
    if (inQuote) {
      const fullQuote = quoteBuffer.join('\n');
      let boxClass = 'finding-box';
      if (fullQuote.includes('🔴') || fullQuote.includes('MỨC ĐỘ 1')) boxClass += ' red';
      else if (fullQuote.includes('🟡') || fullQuote.includes('MỨC ĐỘ 2')) boxClass += ' yellow';
      else if (fullQuote.includes('🟢') || fullQuote.includes('PHÙ HỢP')) boxClass += ' green';
      processedLines.push(`<div class="${boxClass}">${formatMarkdownSnippet(fullQuote)}</div>`);
    }

    let finalHtml = formatMarkdownSnippet(processedLines.join('\n'));

    let sourcesHtml = '';
    if (sources && sources.length > 0) {
      sourcesHtml = `
        <div style="margin-top:1.5rem; padding-top:1rem; border-top:1px solid var(--c-line);">
          <h4 style="font-size:0.9rem; color:var(--c-navy-800); margin-bottom:0.5rem;">📚 TÀI LIỆU CĂN CỨ TRÍCH XUẤT:</h4>
          <ul style="font-size:0.8rem; padding-left:1.2rem; color:var(--c-muted);">
            ${sources.map(s => `<li><a href="${s.url}" target="_blank" style="color:var(--c-navy-600); text-decoration:none; font-weight:600;">${s.title} ↗</a></li>`).join('')}
          </ul>
        </div>
      `;
    }

    reviewOutput.innerHTML = `
      <div class="clinical-report-body">
        ${finalHtml}
        ${sourcesHtml}
      </div>
    `;
  }

  function formatMarkdownSnippet(md) {
    return md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/### (.*?)(?:\n|$)/g, '<h3>$1</h3>')
      .replace(/## (.*?)(?:\n|$)/g, '<h2>$1</h2>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^- (.*?)(?:\n|$)/gm, '<p style="margin-left:1rem; margin-bottom:4px;">• $1</p>')
      .replace(/\n\n/g, '<br>')
      .replace(/\n/g, '<br>');
  }

  // Sao chép báo cáo
  btnCopyReport.addEventListener('click', () => {
    const text = reviewOutput.innerText;
    if (!text || text.includes('Chưa có dữ liệu bình đơn')) return;
    navigator.clipboard.writeText(text).then(() => {
      alert('Đã sao chép biên bản bình đơn vào clipboard.');
    });
  });

  // In biên bản
  btnPrintReport.addEventListener('click', () => {
    window.print();
  });

  // Khởi tạo sẵn 2 dòng thuốc mặc định
  addRow();
  addRow();
}
