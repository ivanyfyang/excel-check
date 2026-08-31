import * as XLSX from 'xlsx';

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(new Uint8Array(e.target.result));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsArrayBuffer(file);
  });
}

export function readWorkbook(buf) {
  return XLSX.read(buf, { type: 'array', cellDates: true });
}

export function parseDateRange(sheetName) {
  const cleaned = sheetName.trim();
  const m = cleaned.match(/(\d{8})\s*-\s*(\d{8})/);
  if (m) {
    const s = m[1], e = m[2];
    return {
      start: new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)),
      end: new Date(+e.slice(0, 4), +e.slice(4, 6) - 1, +e.slice(6, 8)),
    };
  }
  return { start: new Date(2000, 0, 1), end: new Date(2099, 11, 31) };
}

function numVal(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export function parseAttendance(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

  const employees = [];
  let lastStore = '';
  let i = 3;

  while (i + 3 < data.length) {
    const row0 = data[i];
    const row3 = data[i + 3];

    if (!row0 || row0[1] == null || String(row0[1]).trim() === '') {
      i += 4;
      continue;
    }

    const name = String(row0[1]).trim();
    if (row0[0] != null && String(row0[0]).trim() !== '') {
      lastStore = String(row0[0]).trim();
    }

    const dailyHours = [];
    for (let c = 3; c <= 33; c++) {
      const v = row3 ? numVal(row3[c]) : 0;
      dailyHours.push(Math.round(v * 100) / 100);
    }

    const shifts = [];
    for (let c = 3; c <= 33; c++) {
      const v = row0[c];
      shifts.push(v != null ? String(v).trim() : '');
    }

    const emp = {
      store: lastStore,
      name,
      shifts,
      dailyHours,
      sumDaily: Math.round(dailyHours.reduce((a, b) => a + b, 0) * 100) / 100,
      shouldHours: numVal(row0[34]),
      actualHours: numVal(row0[35]),
      personalLeave: numVal(row0[36]),
      sickLeave: numVal(row0[37]),
      annualLeave: numVal(row0[38]),
      weddingLeave: numVal(row0[39]),
      maternityLeave: numVal(row0[40]),
      parentalLeave: numVal(row0[41]),
      bereavementLeave: numVal(row0[42]),
      other: numVal(row0[43]),
      holidayOT: numVal(row0[44]),
      workdayOT: numVal(row0[45]),
    };
    emp.totalLeave = emp.personalLeave + emp.sickLeave + emp.annualLeave +
      emp.weddingLeave + emp.maternityLeave + emp.parentalLeave +
      emp.bereavementLeave + emp.other;
    emp.totalOT = emp.holidayOT + emp.workdayOT;

    employees.push(emp);
    i += 4;
  }
  return employees;
}

function excelDateToJS(serial) {
  const utcDays = Math.floor(serial - 25569);
  return new Date(utcDays * 86400 * 1000);
}

export function parseOvertime(wb) {
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });

  return rows.map(r => {
    let hours = 0;
    const raw = r['加班总时长'];
    if (raw != null) {
      const s = String(raw).replace(/小时/g, '').trim();
      hours = parseFloat(s) || 0;
    }

    let date = null;
    const rawDate = r['加班日期'];
    if (rawDate instanceof Date) {
      date = rawDate;
    } else if (typeof rawDate === 'number') {
      date = excelDateToJS(rawDate);
    } else if (rawDate) {
      const parts = String(rawDate).split('/');
      if (parts.length === 3) {
        date = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      }
    }

    return {
      name: r['申请人'] ? String(r['申请人']).trim() : '',
      date,
      dayType: r['工作日类型'] ? String(r['工作日类型']).trim() : '',
      hours,
      status: r['当前审批状态'] ? String(r['当前审批状态']).trim() : '',
    };
  });
}
