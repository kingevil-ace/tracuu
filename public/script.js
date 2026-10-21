// ============================================================================
// TRA CỨU VÀ THỐNG KÊ ĐIỂM THI (GỌI QUA server.js - CÙNG CÁCH TRA VỚI FILE PYTHON)
// ============================================================================

// -> server.js gọi web trường giống hệt file Python. Đổi địa chỉ trong config.js.
const API_ORIGIN = String(window.TRACUU_API_ORIGIN || '').replace(/\/+$/, '');
const TARGET_API_BASE = `${API_ORIGIN}/api/lookup`;
const FIXED_COLUMNS = ['SBD', 'Họ và tên', 'Lớp'];
const CONCURRENT_BATCH_SIZE = 10; // Xử lý song song 10 SBD mỗi lô (vừa nhanh, vừa tránh bị server trường chặn)
const MAX_RETRIES = 2; // Số lần thử lại khi lỗi mạng / lỗi server

const state = {
  isFetching: false,
  errorCount: 0,
  shouldStop: false,
  students: [],
  subjectColumns: [],
  sortColumn: 'SBD',
  sortDirection: 'asc',
  searchQuery: '',
  selectedClass: 'ALL',
  distSubject: 'Tổng',
  rankingSubject: 'Tổng'
};

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initRippleButtons();
  bindEvents();
});

// 1. Giao diện Sáng / Tối
function initTheme() {
  let savedTheme = 'light';
  try {
    savedTheme = localStorage.getItem('lookup_theme') || 'light';
  } catch (e) {
    savedTheme = 'light';
  }
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const themeLabel = document.getElementById('themeLabel');
  if (themeLabel) {
    themeLabel.textContent = theme === 'dark' ? 'Giao diện Sáng' : 'Giao diện Tối';
  }
  try {
    localStorage.setItem('lookup_theme', theme);
  } catch (e) {}
}

// 2. Hiệu ứng gợn sóng (Ripple) khi nhấn nút
function initRippleButtons() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn, .grade-range-btn');
    if (!btn || btn.disabled) return;

    const rect = btn.getBoundingClientRect();
    const wave = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    wave.style.width = wave.style.height = `${size}px`;
    wave.style.left = `${e.clientX - rect.left - size / 2}px`;
    wave.style.top = `${e.clientY - rect.top - size / 2}px`;
    wave.className = 'ripple-wave';

    btn.appendChild(wave);
    setTimeout(() => wave.remove(), 600);
  });
}

// 3. Gắn sự kiện giao diện
function bindEvents() {
  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  // Chọn nhanh khoảng SBD của từng khối Phân hiệu 2
  document.querySelectorAll('.grade-range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const start = btn.getAttribute('data-start');
      const end = btn.getAttribute('data-end');
      const startInput = document.getElementById('sbdStart');
      const endInput = document.getElementById('sbdEnd');
      if (startInput && endInput) {
        startInput.value = start;
        endInput.value = end;
        startInput.classList.remove('input-error');
        endInput.classList.remove('input-error');
        document.getElementById('errStart').textContent = '';
        document.getElementById('errEnd').textContent = '';
      }
    });
  });

  const lookupForm = document.getElementById('lookupForm');
  if (lookupForm) {
    lookupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleStartLookup();
    });
  }

  const stopBtn = document.getElementById('stopBtn');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (state.isFetching) {
        state.shouldStop = true;
        updateProgressText('Đang dừng...');
      }
    });
  }

  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportToCSV);
  }

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      renderTableBody();
    });
  }

  const classFilter = document.getElementById('classFilter');
  if (classFilter) {
    classFilter.addEventListener('change', (e) => {
      state.selectedClass = e.target.value;
      renderTableBody();
    });
  }

  const distSubjectSelect = document.getElementById('distSubjectSelect');
  if (distSubjectSelect) {
    distSubjectSelect.addEventListener('change', (e) => {
      state.distSubject = e.target.value;
      renderScoreDistribution();
    });
  }

  const rankingTypeSelect = document.getElementById('rankingTypeSelect');
  if (rankingTypeSelect) {
    rankingTypeSelect.addEventListener('change', (e) => {
      state.rankingSubject = e.target.value;
      renderPodiumTop3();
      renderBottom3List();
      renderSubjectRankingTable();
    });
  }
}

// 4. Kiểm tra hợp lệ SBD
function validateInputs() {
  const startInput = document.getElementById('sbdStart');
  const endInput = document.getElementById('sbdEnd');
  const errStart = document.getElementById('errStart');
  const errEnd = document.getElementById('errEnd');

  const rawStart = startInput.value.trim();
  const rawEnd = endInput.value.trim();

  startInput.classList.remove('input-error');
  endInput.classList.remove('input-error');
  errStart.textContent = '';
  errEnd.textContent = '';

  const digitRegex = /^\d+$/;
  let isValid = true;

  if (!rawStart || !digitRegex.test(rawStart)) {
    startInput.classList.add('input-error');
    errStart.textContent = 'Chỉ nhập chữ số (VD: 203001).';
    isValid = false;
  }

  if (!rawEnd || !digitRegex.test(rawEnd)) {
    endInput.classList.add('input-error');
    errEnd.textContent = 'Chỉ nhập chữ số (VD: 203183).';
    isValid = false;
  }

  if (!isValid) return null;

  const sbdStart = parseInt(rawStart, 10);
  const sbdEnd = parseInt(rawEnd, 10);

  if (sbdEnd < sbdStart) {
    endInput.classList.add('input-error');
    errEnd.textContent = 'SBD kết thúc phải lớn hơn hoặc bằng SBD bắt đầu.';
    return null;
  }

  return { sbdStart, sbdEnd };
}

// 5. Gọi API qua server.js (phía server làm đúng như file Python)
//    - success:false  => SBD không tồn tại (không thử lại)
//    - lỗi mạng/5xx    => thử lại tối đa MAX_RETRIES lần, rồi tính là lỗi kết nối
async function fetchStudentData(sbd) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url = `${TARGET_API_BASE}?code=${encodeURIComponent(sbd)}&t=${Date.now()}`;
      const response = await fetch(url, { headers: { 'Accept': 'application/json' } });

      if (response.ok) {
        const data = await response.json();
        if (data && data.success) return data;
        return null; // SBD không có dữ liệu
      }
      if (response.status === 400 || response.status === 404) return null;
    } catch (e) {
      // lỗi mạng hoặc phản hồi không phải JSON -> thử lại
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  state.errorCount += 1;
  return null;
}

// 6. Chuẩn hóa bản ghi học sinh
function normalizeRecord(rawJson, fallbackSbd) {
  const student = rawJson.student || {};
  const subjects = Array.isArray(rawJson.subjects) ? rawJson.subjects : [];

  const record = {
    'SBD': String(student.ma_hoc_sinh || fallbackSbd),
    'Họ và tên': student.ho_ten || '',
    'Lớp': student.lop || '',
    _scores: {},
    _totalNum: null
  };

  let sumSubjects = 0;
  let countSubjects = 0;

  subjects.forEach((mon) => {
    const tenMon = (mon.ten_mon || '').trim();
    const rawDiem = mon.diem !== undefined && mon.diem !== null ? String(mon.diem).trim() : '';
    if (!tenMon) return;

    record[tenMon] = rawDiem;
    if (!state.subjectColumns.includes(tenMon)) {
      state.subjectColumns.push(tenMon);
    }

    const numVal = parseFloat(rawDiem.replace(',', '.'));
    if (!Number.isNaN(numVal)) {
      record._scores[tenMon] = numVal;
      if (tenMon.toLowerCase() === 'tổng' || tenMon.toLowerCase() === 'tong') {
        record._totalNum = numVal;
      } else {
        sumSubjects += numVal;
        countSubjects += 1;
      }
    }
  });

  if (record._totalNum === null && countSubjects > 0) {
    record._totalNum = Number(sumSubjects.toFixed(2));
    record._scores['Tổng'] = record._totalNum;
    record['Tổng'] = String(record._totalNum);
    if (!state.subjectColumns.includes('Tổng')) {
      state.subjectColumns.push('Tổng');
    }
  } else if (record._totalNum !== null) {
    record._scores['Tổng'] = record._totalNum;
  }

  return record;
}

function sortSubjectColumns() {
  const idx = state.subjectColumns.findIndex((c) => c.toLowerCase() === 'tổng');
  if (idx > -1 && idx !== state.subjectColumns.length - 1) {
    const [tongCol] = state.subjectColumns.splice(idx, 1);
    state.subjectColumns.push(tongCol);
  }
}

// 7. Cào dữ liệu song song theo lô (Batch) cực nhanh, không delay thừa
async function handleStartLookup() {
  if (state.isFetching) return;

  const validated = validateInputs();
  if (!validated) return;

  const { sbdStart, sbdEnd } = validated;

  if (location.protocol === 'file:' && !API_ORIGIN) {
    alert('Không mở index.html trực tiếp. Hãy chạy chay.bat (hoặc: npm start) rồi dùng địa chỉ http://localhost:8000, hoặc điền địa chỉ API trong config.js.');
    return;
  }

  state.isFetching = true;
  state.shouldStop = false;
  state.students = [];
  state.subjectColumns = [];
  state.errorCount = 0;

  toggleFetchingUI(true);
  const totalCount = sbdEnd - sbdStart + 1;
  let processed = 0;

  for (let batchStart = sbdStart; batchStart <= sbdEnd; batchStart += CONCURRENT_BATCH_SIZE) {
    if (state.shouldStop) break;

    const batchEnd = Math.min(sbdEnd, batchStart + CONCURRENT_BATCH_SIZE - 1);
    const batchSbds = [];
    for (let s = batchStart; s <= batchEnd; s++) {
      batchSbds.push(String(s));
    }

    updateProgressUI(
      `${batchSbds[0]} - ${batchSbds[batchSbds.length - 1]}`,
      processed,
      totalCount,
      state.students.length
    );

    const results = await Promise.all(
      batchSbds.map(async (sbdStr) => {
        const apiData = await fetchStudentData(sbdStr);
        return { sbdStr, apiData };
      })
    );

    results.forEach(({ sbdStr, apiData }) => {
      if (apiData) {
        const normalized = normalizeRecord(apiData, sbdStr);
        state.students.push(normalized);
      }
    });

    processed += batchSbds.length;
    sortSubjectColumns();
    updateProgressUI(
      batchSbds[batchSbds.length - 1],
      processed,
      totalCount,
      state.students.length
    );

    if (state.students.length > 0) {
      syncSubjectSelectors();
      refreshAllViews(false);
    }
  }

  state.isFetching = false;
  toggleFetchingUI(false);

  if (state.students.length > 0) {
    state.students.sort((a, b) => a['SBD'].localeCompare(b['SBD'], 'vi', { numeric: true }));
    const errNote = state.errorCount ? ` • ${state.errorCount} SBD lỗi kết nối, hãy tra lại` : '';
    updateProgressText(`Hoàn tất (${state.students.length}/${processed} SBD có dữ liệu)${errNote}.`);
    syncSubjectSelectors();
    refreshAllViews(true);
  } else {
    updateProgressText(
      state.errorCount
        ? `Lỗi kết nối tới máy chủ trường (${state.errorCount} SBD). Hãy chắc chắn server.js đang chạy (hoặc địa chỉ API trong config.js đúng) rồi tra lại.`
        : 'Không tìm thấy dữ liệu trong khoảng SBD đã nhập.'
    );
    refreshAllViews(false);
  }
}

function toggleFetchingUI(isRunning) {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const progressBox = document.getElementById('progressWrapper');
  const pulseDot = document.getElementById('pulseDot');

  if (startBtn) startBtn.disabled = isRunning;
  if (stopBtn) stopBtn.classList.toggle('hidden', !isRunning);
  if (progressBox) progressBox.classList.remove('hidden');
  if (pulseDot) pulseDot.classList.toggle('hidden', !isRunning);
}

function updateProgressUI(currentSbd, processed, total, foundCount) {
  const percent = Math.min(100, Math.round((processed / total) * 100));
  const statusEl = document.getElementById('progressStatusText');
  const statsEl = document.getElementById('progressStatsText');
  const fillEl = document.getElementById('progressFill');

  if (statusEl) statusEl.textContent = `Đang xử lý SBD: ${currentSbd}...`;
  if (statsEl) statsEl.textContent = `${processed}/${total} SBD (${percent}%) • Đã tải: ${foundCount}`;
  if (fillEl) fillEl.style.width = `${percent}%`;
}

function updateProgressText(message) {
  const statusEl = document.getElementById('progressStatusText');
  if (statusEl) statusEl.textContent = message;
}

// Đồng bộ danh sách môn vào bộ chọn Biểu đồ phổ điểm & Bảng xếp hạng
function syncSubjectSelectors() {
  const distSelect = document.getElementById('distSubjectSelect');
  const rankSelect = document.getElementById('rankingTypeSelect');
  if (!distSelect || !rankSelect) return;

  const cols = state.subjectColumns.length ? state.subjectColumns : ['Tổng'];

  if (!cols.includes(state.distSubject)) {
    state.distSubject = cols.includes('Tổng') ? 'Tổng' : cols[0];
  }
  if (!cols.includes(state.rankingSubject)) {
    state.rankingSubject = cols.includes('Tổng') ? 'Tổng' : cols[0];
  }

  distSelect.innerHTML = cols
    .map((c) => `<option value="${escapeHtml(c)}">Phổ điểm: ${escapeHtml(c)}</option>`)
    .join('');
  distSelect.value = state.distSubject;

  rankSelect.innerHTML = cols
    .map((c) => `<option value="${escapeHtml(c)}">Xếp hạng theo: ${escapeHtml(c)}</option>`)
    .join('');
  rankSelect.value = state.rankingSubject;
}

// 8. Render toàn bộ giao diện thống kê
function refreshAllViews(animatePodium = true) {
  const hasData = state.students.length > 0;
  document.getElementById('resultsDashboard').classList.toggle('hidden', !hasData);
  document.getElementById('emptyStateCard').classList.toggle('hidden', hasData);

  if (!hasData) return;

  renderKPISummary();
  renderScoreDistribution();
  renderPodiumTop3(animatePodium);
  renderBottom3List();
  renderSubjectRankingTable();
  populateClassFilter();
  renderTableHead();
  renderTableBody();
}

function getScoreBySubject(student, subjectName) {
  if (subjectName === 'Tổng' && student._totalNum !== null) {
    return student._totalNum;
  }
  const val = student._scores[subjectName];
  return val !== undefined && !Number.isNaN(val) ? val : null;
}

// 8.1. Thống kê số liệu tổng quan
function renderKPISummary() {
  const validTotals = state.students
    .map((s) => s._totalNum)
    .filter((v) => v !== null && !Number.isNaN(v));

  const count = state.students.length;
  const maxScore = validTotals.length ? Math.max(...validTotals) : 0;
  const minScore = validTotals.length ? Math.min(...validTotals) : 0;
  const avgScore = validTotals.length
    ? (validTotals.reduce((a, b) => a + b, 0) / validTotals.length).toFixed(2)
    : '0.00';

  document.getElementById('kpiTotalStudents').textContent = String(count);
  document.getElementById('kpiMaxScore').textContent = String(maxScore);
  document.getElementById('kpiAvgScore').textContent = String(avgScore);
  document.getElementById('kpiMinScore').textContent = String(minScore);
}

// 8.2. Biểu đồ phổ điểm theo các mức điểm hiện có (dạng cột đứng như ảnh mẫu)
function renderScoreDistribution() {
  const container = document.getElementById('distributionContainer');
  if (!container) return;

  const subject = state.distSubject || 'Tổng';
  const scores = state.students
    .map((s) => getScoreBySubject(s, subject))
    .filter((v) => v !== null);

  if (!scores.length) {
    container.innerHTML = `<div class="empty-state">Chưa có dữ liệu điểm cho môn ${escapeHtml(subject)}.</div>`;
    return;
  }

  const freqMap = new Map();
  scores.forEach((val) => {
    const key = Number(val.toFixed(2));
    freqMap.set(key, (freqMap.get(key) || 0) + 1);
  });

  const sortedEntries = Array.from(freqMap.entries()).sort((a, b) => a[0] - b[0]);
  const maxCount = Math.max(...sortedEntries.map((e) => e[1]), 1);
  const totalStudents = scores.length;

  const yTicks = [
    maxCount,
    Math.round(maxCount * 0.75),
    Math.round(maxCount * 0.5),
    Math.round(maxCount * 0.25),
    0
  ];

  const barsHtml = sortedEntries
    .map(([scoreVal, count]) => {
      const heightPct = Math.max(2, Math.round((count / maxCount) * 100));
      const ratioPct = ((count / totalStudents) * 100).toFixed(1);
      return `
        <div class="hist-col" title="Điểm ${scoreVal}: ${count} học sinh (${ratioPct}%)">
          <span class="hist-count">${count} (${ratioPct}%)</span>
          <div class="hist-bar" style="height: ${heightPct}%;"></div>
        </div>
      `;
    })
    .join('');

  const xLabelsHtml = sortedEntries
    .map(([scoreVal]) => {
      return `
        <div class="hist-x-tick">
          <span class="hist-score-label">${scoreVal}</span>
        </div>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="histogram-chart">
      <div class="histogram-y-label">Số lượng học sinh</div>
      <div class="histogram-y-axis">
        ${yTicks.map((t) => `<span>${t}</span>`).join('')}
      </div>
      <div class="histogram-bars-area">
        <div class="histogram-bars-row">
          ${barsHtml}
        </div>
        <div class="histogram-x-row">
          ${xLabelsHtml}
        </div>
        <div class="histogram-x-title">Điểm (${escapeHtml(subject)})</div>
      </div>
    </div>
  `;
}

// 8.3. Bục Podium Top 3 cao nhất
function renderPodiumTop3(animate = true) {
  const stage = document.getElementById('podiumStage');
  const heading = document.getElementById('podiumHeading');
  if (!stage) return;

  const subject = state.rankingSubject || 'Tổng';
  if (heading) {
    heading.textContent = `Top 3 điểm cao nhất (${subject})`;
  }

  const sortedDesc = [...state.students]
    .filter((s) => getScoreBySubject(s, subject) !== null)
    .sort((a, b) => getScoreBySubject(b, subject) - getScoreBySubject(a, subject));

  const slots = [
    { rank: 2, student: sortedDesc[1] || null, badge: 'Hạng 2', label: '2' },
    { rank: 1, student: sortedDesc[0] || null, badge: 'Hạng 1', label: '1' },
    { rank: 3, student: sortedDesc[2] || null, badge: 'Hạng 3', label: '3' }
  ];

  const animClass = animate ? 'animate-in' : '';
  const staticStyle = animate ? '' : 'style="opacity:1; transform:none;"';

  stage.innerHTML = slots
    .map((slot) => {
      if (!slot.student) {
        return `
          <div class="podium-column podium-rank-${slot.rank} ${animClass}" ${staticStyle}>
            <div class="podium-avatar">${slot.label}</div>
            <div class="podium-name">—</div>
            <div class="podium-meta">—</div>
            <div class="podium-pedestal">
              <div class="pedestal-score">—</div>
              <span class="pedestal-rank-badge">${slot.badge}</span>
            </div>
          </div>
        `;
      }

      const st = slot.student;
      const scoreVal = getScoreBySubject(st, subject);
      return `
        <div class="podium-column podium-rank-${slot.rank} ${animClass}" ${staticStyle}>
          <div class="podium-avatar">${slot.label}</div>
          <div class="podium-name">${escapeHtml(st['Họ và tên'])}</div>
          <div class="podium-meta">Lớp ${escapeHtml(st['Lớp'] || '—')} • SBD ${escapeHtml(st['SBD'])}</div>
          <div class="podium-pedestal">
            <div class="pedestal-score">${scoreVal}</div>
            <span class="pedestal-rank-badge">${slot.badge}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

// 8.4. Top 3 điểm thấp nhất
function renderBottom3List() {
  const listEl = document.getElementById('bottom3List');
  const heading = document.getElementById('lowestHeading');
  if (!listEl) return;

  const subject = state.rankingSubject || 'Tổng';
  if (heading) {
    heading.textContent = `Top 3 điểm thấp nhất (${subject})`;
  }

  const sortedAsc = [...state.students]
    .filter((s) => getScoreBySubject(s, subject) !== null)
    .sort((a, b) => getScoreBySubject(a, subject) - getScoreBySubject(b, subject))
    .slice(0, 3);

  listEl.innerHTML = sortedAsc
    .map((st, idx) => {
      const scoreVal = getScoreBySubject(st, subject);
      return `
        <div class="neutral-item">
          <div>
            <div class="neutral-name">${idx + 1}. ${escapeHtml(st['Họ và tên'])}</div>
            <div class="neutral-meta">SBD: ${escapeHtml(st['SBD'])} • Lớp: ${escapeHtml(st['Lớp'] || '—')}</div>
          </div>
          <div class="neutral-score">${scoreVal}</div>
        </div>
      `;
    })
    .join('');
}

// 8.5. Bảng xếp hạng theo từng môn hoặc Điểm Tổng
function renderSubjectRankingTable() {
  const tbody = document.getElementById('rankingTableBody');
  const colHeader = document.getElementById('rankingScoreColHeader');
  if (!tbody) return;

  const subject = state.rankingSubject || 'Tổng';
  if (colHeader) {
    colHeader.textContent = `Điểm (${subject})`;
  }

  const validList = [...state.students]
    .filter((s) => getScoreBySubject(s, subject) !== null)
    .sort((a, b) => getScoreBySubject(b, subject) - getScoreBySubject(a, subject));

  if (!validList.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 1.5rem;">Chưa có dữ liệu.</td></tr>`;
    return;
  }

  const maxScore = Math.max(...validList.map((s) => getScoreBySubject(s, subject)), 1);

  let currentRank = 1;
  tbody.innerHTML = validList
    .map((st, idx) => {
      const scoreVal = getScoreBySubject(st, subject);
      if (idx > 0 && scoreVal < getScoreBySubject(validList[idx - 1], subject)) {
        currentRank = idx + 1;
      }
      const rankClass = currentRank <= 3 ? `rank-pill-${currentRank}` : '';
      const pctOfMax = ((scoreVal / maxScore) * 100).toFixed(1);

      return `
        <tr>
          <td><span class="rank-pill ${rankClass}">${currentRank}</span></td>
          <td><strong>${escapeHtml(st['SBD'])}</strong></td>
          <td>${escapeHtml(st['Họ và tên'])}</td>
          <td><span class="badge-class">${escapeHtml(st['Lớp'] || '—')}</span></td>
          <td class="col-num col-total">${scoreVal}</td>
          <td class="col-num">${pctOfMax}%</td>
        </tr>
      `;
    })
    .join('');
}

// 8.6. Bảng điểm chi tiết động
function populateClassFilter() {
  const select = document.getElementById('classFilter');
  if (!select) return;

  const classes = Array.from(
    new Set(state.students.map((s) => s['Lớp']).filter(Boolean))
  ).sort();

  const currentVal = state.selectedClass;
  select.innerHTML =
    `<option value="ALL">Tất cả các lớp (${state.students.length})</option>` +
    classes.map((cls) => `<option value="${escapeHtml(cls)}">Lớp ${escapeHtml(cls)}</option>`).join('');

  if (classes.includes(currentVal)) {
    select.value = currentVal;
  } else {
    state.selectedClass = 'ALL';
  }
}

function getAllTableColumns() {
  return [...FIXED_COLUMNS, ...state.subjectColumns];
}

function renderTableHead() {
  const thead = document.getElementById('scoreTableHead');
  if (!thead) return;

  const cols = getAllTableColumns();
  thead.innerHTML = `
    <tr>
      ${cols
        .map((col) => {
          const isNumeric = !FIXED_COLUMNS.includes(col);
          const isSorted = state.sortColumn === col;
          const arrow = isSorted ? (state.sortDirection === 'asc' ? ' ↑' : ' ↓') : '';
          return `<th class="${isNumeric ? 'col-num' : ''}" data-col="${escapeHtml(col)}">${escapeHtml(col)}${arrow}</th>`;
        })
        .join('')}
    </tr>
  `;

  thead.querySelectorAll('th').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-col');
      if (state.sortColumn === col) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortColumn = col;
        state.sortDirection = FIXED_COLUMNS.includes(col) ? 'asc' : 'desc';
      }
      renderTableHead();
      renderTableBody();
    });
  });
}

function renderTableBody() {
  const tbody = document.getElementById('scoreTableBody');
  const countLabel = document.getElementById('tableCountLabel');
  if (!tbody) return;

  const cols = getAllTableColumns();

  const filtered = state.students.filter((st) => {
    const matchClass = state.selectedClass === 'ALL' || st['Lớp'] === state.selectedClass;
    const matchQuery =
      !state.searchQuery ||
      st['SBD'].toLowerCase().includes(state.searchQuery) ||
      st['Họ và tên'].toLowerCase().includes(state.searchQuery) ||
      (st['Lớp'] || '').toLowerCase().includes(state.searchQuery);
    return matchClass && matchQuery;
  });

  const sorted = [...filtered].sort((a, b) => {
    const col = state.sortColumn;
    const dir = state.sortDirection === 'asc' ? 1 : -1;

    if (!FIXED_COLUMNS.includes(col)) {
      const numA = a._scores[col] !== undefined ? a._scores[col] : -Infinity;
      const numB = b._scores[col] !== undefined ? b._scores[col] : -Infinity;
      return (numA - numB) * dir;
    }

    const valA = String(a[col] || '');
    const valB = String(b[col] || '');
    return valA.localeCompare(valB, 'vi', { numeric: true }) * dir;
  });

  if (countLabel) {
    countLabel.textContent = `${sorted.length}`;
  }

  if (sorted.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="${cols.length}" style="text-align:center; padding: 2rem; color: var(--text-muted);">
          Không tìm thấy kết quả phù hợp.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = sorted
    .map((st) => {
      return `
        <tr>
          ${cols
            .map((col) => {
              const val = st[col] !== undefined && st[col] !== '' ? st[col] : '—';
              if (col === 'SBD') {
                return `<td><strong>${escapeHtml(val)}</strong></td>`;
              }
              if (col === 'Lớp') {
                return `<td><span class="badge-class">${escapeHtml(val)}</span></td>`;
              }
              if (col.toLowerCase() === 'tổng') {
                return `<td class="col-num col-total">${escapeHtml(val)}</td>`;
              }
              if (!FIXED_COLUMNS.includes(col)) {
                return `<td class="col-num">${escapeHtml(val)}</td>`;
              }
              return `<td>${escapeHtml(val)}</td>`;
            })
            .join('')}
        </tr>
      `;
    })
    .join('');
}

// 9. Xuất file CSV
function exportToCSV() {
  if (!state.students.length) return;

  const cols = getAllTableColumns();
  const csvRows = [];

  csvRows.push(cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));

  state.students.forEach((st) => {
    const row = cols.map((col) => {
      const cell = st[col] !== undefined && st[col] !== null ? String(st[col]) : '';
      return `"${cell.replace(/"/g, '""')}"`;
    });
    csvRows.push(row.join(','));
  });

  const csvContent = '\uFEFF' + csvRows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const sbdStart = document.getElementById('sbdStart').value.trim() || 'start';
  const sbdEnd = document.getElementById('sbdEnd').value.trim() || 'end';

  const link = document.createElement('a');
  link.href = url;
  link.download = `KetQua_SBD_${sbdStart}_den_${sbdEnd}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
