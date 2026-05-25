// ── Coretax Renamer PWA ──
// Client-side batch renamer for Coretax Faktur Pajak PDFs
// Works offline via Service Worker

import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';

// ── PDF.js worker ──
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

// ── DOM refs ──
const dropZone      = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const browseBtn      = document.getElementById('browse-btn');
const toolbar        = document.getElementById('toolbar');
const applyBtn       = document.getElementById('apply-btn');
const clearBtn       = document.getElementById('clear-btn');
const downloadAllBtn = document.getElementById('download-all-btn');
const counter        = document.getElementById('counter');
const jobsTable      = document.getElementById('jobs-table');
const jobsTbody      = document.getElementById('jobs-tbody');
const delimiterSel   = document.getElementById('delimiter');
const customDelLabel = document.getElementById('custom-delimiter-label');
const customDelInput = document.getElementById('custom-delimiter');
const templateInput  = document.getElementById('template');
const includeExtChk  = document.getElementById('include-ext');
const langSelect     = document.getElementById('lang-select');

// ── State ──
let jobs = []; // { id, file, name, status, info, proposed, message, blob }
let idCounter = 0;

const I18N = {
  en: {
    queued:'Queued', parsing:'Parsing…', ready:'Ready', done:'Done', failed:'Failed',
    downloaded:'✓ Downloaded', processing:'Processing…', apply:'Apply', counter_done:'done', counter_pending:'pending',
    drop_here:'Drop Faktur Pajak PDFs here', or:'or', browse:'Browse PDFs…', clear:'Clear completed', download_all:'Download All',
    err_buyer_heading:'Buyer block heading not found', err_buyer_name:'Buyer name (Nama) not found', err_invoice:'Invoice reference (Referensi:) not found', err_kode:'Kode dan Nomor Seri Faktur Pajak not found'
  },
  id: {
    queued:'Antri', parsing:'Memproses…', ready:'Siap', done:'Selesai', failed:'Gagal',
    downloaded:'✓ Terunduh', processing:'Memproses…', apply:'Terapkan', counter_done:'selesai', counter_pending:'menunggu',
    drop_here:'Taruh PDF Faktur Pajak di sini', or:'atau', browse:'Pilih PDF…', clear:'Bersihkan yang selesai', download_all:'Unduh Semua',
    err_buyer_heading:'Bagian pembeli tidak ditemukan', err_buyer_name:'Nama pembeli (Nama) tidak ditemukan', err_invoice:'Referensi invoice tidak ditemukan', err_kode:'Kode dan Nomor Seri Faktur Pajak tidak ditemukan'
  }
};
let currentLang = localStorage.getItem('lang') || 'id';
function tr(k){return (I18N[currentLang]&&I18N[currentLang][k])||I18N.en[k]||k;}
function applyI18n(){
  document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=tr(el.dataset.i18n);});
  updateApplyBtn();updateCounter();jobs.forEach(updateRow);
}


// ── Regex patterns (mirrors Rust extract.rs) ──
const BUYER_HEADING_RE = /Pembeli\s+Barang\s+Kena\s+Pajak\s*\/\s*Penerima\s+Jasa\s+Kena\s+Pajak/is;
const BUYER_END_RE     = /(?:No\.\s*[Kk]ode|Harga\s+Jual|Dasar\s+Pengenaan\s+Pajak|Jumlah\s+PPN|Penyerahan)/is;
const NAMA_RE          = /Nama\s*:\s*([A-Z][^:]*?)(?:\s*Alamat\s*:)/s;
const INV_RE           = /Referensi:\s*([^\s)\r\n]+)/i;
const KODE_RE          = /Kode\s+dan\s+Nomor\s+Seri\s+Faktur\s+Pajak\s*:?\s*([0-9]+)/i;

// ── Extract text from PDF ──
async function extractText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str);
    fullText += strings.join(' ') + '\n';
  }
  return fullText;
}

// ── Parse invoice info from text ──
function parseInvoiceInfo(text) {
  // Buyer name
  const headingMatch = BUYER_HEADING_RE.exec(text);
  if (!headingMatch) throw new Error(tr('err_buyer_heading'));

  const afterHeading = text.slice(headingMatch.index + headingMatch[0].length);
  const endMatch = BUYER_END_RE.exec(afterHeading);
  const buyerSlice = endMatch ? afterHeading.slice(0, endMatch.index) : afterHeading;

  const namaMatch = NAMA_RE.exec(buyerSlice);
  if (!namaMatch) throw new Error(tr('err_buyer_name'));
  const name = namaMatch[1].trim();

  // Invoice reference
  const invMatch = INV_RE.exec(text);
  if (!invMatch) throw new Error(tr('err_invoice'));
  const invoiceNum = invMatch[1].replace(/\//g, '-');

  // Kode Faktur Pajak
  const kodeMatch = KODE_RE.exec(text);
  if (!kodeMatch) throw new Error(tr('err_kode'));
  const kodeFakturPajak = kodeMatch[1];

  return { invoiceNum, name, kodeFakturPajak };
}

// ── Sanitize filename ──
function sanitize(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\x00-\x1f]/g, '_')
    .replace(/[.\s]+$/, '')
    .slice(0, 120);
}

// ── Get delimiter ──
function getDelimiter() {
  const v = delimiterSel.value;
  if (v === 'custom') return customDelInput.value || '_';
  return v;
}


// ── Analytics helper ──
function trackEvent(name, data = {}) {
  if (typeof window === 'undefined') return;
  window.umami?.track?.(name, data);
}

// ── Build proposed filename ──
function buildFilename(info) {
  const d = getDelimiter();
  let template = templateInput.value || '{invoice}{d}{name}{d}{kode}';
  const sanitized = sanitize(info.name);

  let stem = template
    .replace('{invoice}', info.invoiceNum)
    .replace('{name}', sanitized)
    .replace('{kode}', info.kodeFakturPajak)
    .replace(/{d}/g, d);

  // Collapse multiple consecutive delimiters
  const escaped = d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (escaped) {
    const multiRe = new RegExp(escaped + '{2,}', 'g');
    stem = stem.replace(multiRe, d);
  }

  stem = stem.trim();
  if (includeExtChk.checked) stem += '.pdf';
  return stem;
}

// ── Handle files ──
async function handleFiles(files) {
  const selectedCount = files?.length ?? 0;
  const pdfFiles = Array.from(files).filter(f =>
    f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf'
  );
  trackEvent('files_selected', { selected_count: selectedCount, pdf_count: pdfFiles.length });
  if (!pdfFiles.length) return;

  toolbar.style.display = 'flex';
  jobsTable.style.display = 'table';

  for (const file of pdfFiles) {
    // Skip duplicates
    if (jobs.some(j => j.name === file.name && j.file.size === file.size)) continue;

    const id = ++idCounter;
    const job = { id, file, name: file.name, status: 'queued', info: null, proposed: null, message: '', blob: null };
    jobs.push(job);
    renderRow(job);
    processJob(job);
  }
  updateCounter();
}

// ── Process single job ──
async function processJob(job) {
  job.status = 'working';
  updateRow(job);

  try {
    const text = await extractText(job.file);
    const info = parseInvoiceInfo(text);
    job.info = info;
    job.proposed = buildFilename(info);
    job.status = 'ready';
  } catch (err) {
    job.status = 'failed';
    job.message = err.message;
  }
  updateRow(job);
  updateCounter();
  updateApplyBtn();
}

// ── Apply renames (download renamed files) ──
async function applyAll() {
  const readyJobs = jobs.filter(j => j.status === 'ready');
  trackEvent('apply_clicked', { ready_jobs: readyJobs.length });
  if (!readyJobs.length) return;

  applyBtn.disabled = true;
  applyBtn.textContent = tr('processing');

  for (const job of readyJobs) {
    try {
      const blob = await job.file.arrayBuffer().then(buf => new Blob([buf], { type: 'application/pdf' }));
      job.blob = blob;

      // Handle collisions
      let finalName = job.proposed;
      let counter = 2;
      const baseName = finalName.replace(/\.pdf$/i, '');
      const ext = finalName.endsWith('.pdf') ? '.pdf' : '';
      let hasCollisionSuffix = false;
      while (readyJobs.slice(0, readyJobs.indexOf(job)).some(j => j.proposed === finalName)) {
        hasCollisionSuffix = true;
        finalName = `${baseName} (${counter})${ext}`;
        counter++;
      }
      job.proposed = finalName;

      downloadBlob(blob, finalName);
      trackEvent('rename_download_completed', { has_collision_suffix: hasCollisionSuffix });
      job.status = 'done';
      job.message = tr('downloaded');
    } catch (err) {
      job.status = 'failed';
      job.message = err.message;
    }
    updateRow(job);
  }

  applyBtn.disabled = false;
  updateApplyBtn();
  updateCounter();
}

// ── Download single blob ──
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Download all ready as zip ──
async function downloadAll() {
  const readyJobs = jobs.filter(j => j.status === 'ready');
  trackEvent('download_all_clicked', { ready_jobs: readyJobs.length });
  if (!readyJobs.length) return;

  // Simple sequential download (no zip lib to keep it lightweight)
  for (const job of readyJobs) {
    const blob = await job.file.arrayBuffer().then(buf => new Blob([buf], { type: 'application/pdf' }));
    downloadBlob(blob, job.proposed);
    trackEvent('download_all_item_completed', { has_collision_suffix: /\s\(\d+\)(?:\.pdf)?$/i.test(job.proposed || '') });
    job.status = 'done';
    job.message = tr('downloaded');
    updateRow(job);
  }
  updateCounter();
}

// ── Render / update table rows ──
function renderRow(job) {
  const tr = document.createElement('tr');
  tr.id = `job-${job.id}`;
  tr.innerHTML = rowHTML(job);
  jobsTbody.appendChild(tr);
}

function updateRow(job) {
  const tr = document.getElementById(`job-${job.id}`);
  if (tr) tr.innerHTML = rowHTML(job);
}

function rowHTML(job) {
  const badgeClass = `badge-${job.status}`;
  const statusLabel = {
    queued:   `<span class="badge badge-queued">${tr('queued')}</span>`,
    working:  `<span class="spinner"></span> ${tr('parsing')}`,
    ready:    `<span class="badge badge-ready">${tr('ready')}</span>`,
    done:     `<span class="badge badge-done">${tr('done')}</span>`,
    failed:   `<span class="badge badge-failed">${tr('failed')}</span>`,
  }[job.status] || job.status;

  return `
    <td>${job.id}</td>
    <td title="${esc(job.name)}">${esc(job.name)}</td>
    <td>${statusLabel}</td>
    <td title="${esc(job.proposed || '')}">${esc(job.proposed || '—')}</td>
    <td>${esc(job.message)}</td>
  `;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ── UI helpers ──
function updateCounter() {
  const total = jobs.length;
  const done  = jobs.filter(j => j.status === 'done').length;
  const working = jobs.filter(j => j.status === 'queued' || j.status === 'working').length;
  counter.textContent = total ? `${done}/${total} ${tr('counter_done')}` + (working ? ' · ' : '') + (working ? `${working} ${tr('counter_pending')}` : '') : '';
}

function updateApplyBtn() {
  const ready = jobs.filter(j => j.status === 'ready').length;
  applyBtn.disabled = ready === 0;
  applyBtn.textContent = `${tr('apply')} (${ready})`;
  downloadAllBtn.disabled = ready === 0;
}

function clearDone() {
  const doneCount = jobs.filter(j => j.status === 'done').length;
  const failedCount = jobs.filter(j => j.status === 'failed').length;
  trackEvent('clear_done_clicked', { done_count: doneCount, failed_count: failedCount });
  jobs = jobs.filter(j => j.status !== 'done' && j.status !== 'failed');
  jobsTbody.innerHTML = '';
  jobs.forEach(j => renderRow(j));
  updateCounter();
  updateApplyBtn();
  if (!jobs.length) {
    toolbar.style.display = 'none';
    jobsTable.style.display = 'none';
  }
}

// ── Event listeners ──
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
  fileInput.value = '';
});

// Drag & drop
['dragenter', 'dragover'].forEach(evt =>
  dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('drag-over'); })
);
['dragleave', 'drop'].forEach(evt =>
  dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); })
);
dropZone.addEventListener('drop', e => {
  const files = e.dataTransfer.files;
  if (files.length) handleFiles(files);
});

// Also allow drop on the whole page
document.body.addEventListener('dragover', e => e.preventDefault());
document.body.addEventListener('drop', e => {
  e.preventDefault();
  const files = e.dataTransfer.files;
  if (files.length) handleFiles(files);
});

applyBtn.addEventListener('click', applyAll);
clearBtn.addEventListener('click', clearDone);
downloadAllBtn.addEventListener('click', downloadAll);

// Delimiter UI
delimiterSel.addEventListener('change', () => {
  customDelLabel.style.display = delimiterSel.value === 'custom' ? 'flex' : 'none';
});

// Re-preview when settings change
[delimiterSel, customDelInput, templateInput, includeExtChk].forEach(el => {
  el.addEventListener('change', () => {
    jobs.forEach(job => {
      if (job.status === 'ready' && job.info) {
        job.proposed = buildFilename(job.info);
        updateRow(job);
      }
    });
  });
  el.addEventListener('input', () => {
    if (el === customDelInput || el === templateInput) {
      jobs.forEach(job => {
        if (job.status === 'ready' && job.info) {
          job.proposed = buildFilename(job.info);
          updateRow(job);
        }
      });
    }
  });
});


if (langSelect) {
  langSelect.value = currentLang;
  langSelect.addEventListener('change', () => {
    currentLang = langSelect.value;
    localStorage.setItem('lang', currentLang);
    applyI18n();
  });
}
applyI18n();

// ── Service Worker registration ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('SW registered', reg.scope))
      .catch(err => console.warn('SW registration failed', err));
  });
}
