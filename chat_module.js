export function initChatModule() {
  const messageStream = document.getElementById('messageStream');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const attachedBox = document.getElementById('attachedBox');
  const attachedTextSpan = document.getElementById('attachedText');
  const removeAttachedBtn = document.getElementById('removeAttached');
  const imageUploadInput = document.getElementById('imageUpload');
  const btnUpload = document.getElementById('btnUpload');
  const evidenceList = document.getElementById('evidenceList');

  let currentSourceMode = 'closed';
  let attachedOcrText = '';
  const history = [];

  // Nguồn đóng / Nguồn mở toggle
  document.querySelectorAll('.source-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSourceMode = btn.dataset.source;
    });
  });

  // Tải ảnh đơn / nhãn thuốc để đọc OCR
  btnUpload.addEventListener('click', () => imageUploadInput.click());
  imageUploadInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    appendMessage('assistant', `Đang xử lý ảnh "${file.name}"...`);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      try {
        const res = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: { data: base64, mimeType: file.type || 'image/jpeg' }
          })
        });
        const data = await res.json();
        if (data.text) {
          attachedOcrText = data.text;
          attachedTextSpan.textContent = `Nội dung từ ảnh: ${file.name} (${data.text.length} ký tự)`;
          attachedBox.style.display = 'flex';
          appendMessage('assistant', `Đã trích xuất nội dung từ ảnh:\n\n${data.text}\n\n*Bạn có thể bấm gửi để tra cứu thông tin chi tiết về thuốc này.*`);
        } else {
          appendMessage('assistant', 'Không nhận dạng được văn bản từ ảnh hoặc chưa bật Vertex AI.');
        }
      } catch (err) {
        appendMessage('assistant', 'Lỗi khi gọi dịch vụ đọc ảnh: ' + err.message);
      }
    };
    reader.readAsDataURL(file);
  });

  removeAttachedBtn.addEventListener('click', () => {
    attachedOcrText = '';
    attachedBox.style.display = 'none';
    imageUploadInput.value = '';
  });

  // Gửi câu hỏi
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (!msg && !attachedOcrText) return;

    chatInput.value = '';
    chatInput.style.height = 'auto';

    appendMessage('user', msg || 'Tra cứu thông tin từ ảnh đã tải lên.');

    const tempLoading = appendMessage('assistant', 'Đang tra cứu cơ sở dữ liệu y khoa và phản hồi...');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          ocrText: attachedOcrText,
          sourceMode: currentSourceMode,
          history: history.slice(-6)
        })
      });

      const data = await res.json();
      tempLoading.remove();

      if (data.error) {
        appendMessage('assistant', '❌ Lỗi: ' + data.error);
        return;
      }

      appendMessage('assistant', data.text, data.sources);
      history.push({ role: 'user', text: msg });
      history.push({ role: 'assistant', text: data.text });

      // Cập nhật Căn cứ trả lời ở cột bên phải
      updateEvidencePanel(data.sources);

      // Reset attachment nếu đã gửi
      if (attachedOcrText) {
        attachedOcrText = '';
        attachedBox.style.display = 'none';
      }
    } catch (err) {
      tempLoading.remove();
      appendMessage('assistant', '❌ Không thể kết nối tới máy chủ: ' + err.message);
    }
  });

  function appendMessage(role, text, sources = []) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? 'BN' : 'NB';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;

    if (sources && sources.length > 0) {
      const chipsDiv = document.createElement('div');
      chipsDiv.className = 'msg-sources-chips';
      sources.slice(0, 3).forEach((s, idx) => {
        const a = document.createElement('a');
        a.className = 'source-chip';
        a.href = s.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = `[${idx + 1}] ${s.title}`;
        chipsDiv.appendChild(a);
      });
      bubble.appendChild(chipsDiv);
    }

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
    messageStream.appendChild(msgDiv);
    messageStream.scrollTop = messageStream.scrollHeight;
    return msgDiv;
  }

  function updateEvidencePanel(sources = []) {
    evidenceList.innerHTML = '';
    if (!sources || sources.length === 0) {
      evidenceList.innerHTML = '<p style="font-size:0.82rem; color:var(--text-muted);">Chưa có tài liệu trích dẫn riêng cho lượt hỏi này.</p>';
      return;
    }

    sources.forEach(s => {
      const card = document.createElement('div');
      card.className = 'evidence-card';
      card.innerHTML = `
        <h4>${s.title}</h4>
        <p style="color:var(--text-muted); font-size:0.75rem; margin-bottom:4px;">Nguồn: ${s.provenance || 'DrugView'}</p>
        <a href="${s.url}" target="_blank" rel="noopener noreferrer">Xem tài liệu tham khảo ↗</a>
      `;
      evidenceList.appendChild(card);
    });
  }

  // Tự động dãn input khi gõ
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });

  // Hỗ trợ Enter để gửi
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });
}
