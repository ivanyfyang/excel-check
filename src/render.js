const $ = s => document.querySelector(s);

function fmtDate(d) {
  if (!d) return '-';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

export function render(results) {
  const container = $('#results');
  container.style.display = 'block';

  const highCount = results.reduce((s, r) => s + r.issues.filter(i => i.severity === 'high').length, 0);
  const medCount = results.reduce((s, r) => s + r.issues.filter(i => i.severity === 'medium').length, 0);
  const affectedCount = results.filter(r => r.issues.length > 0).length;
  const okCount = results.filter(r => r.issues.length === 0).length;

  $('#stats').innerHTML = `
    <div class="stat-card error"><div class="stat-num">${highCount}</div><div class="stat-label">严重问题</div></div>
    <div class="stat-card warn"><div class="stat-num">${medCount}</div><div class="stat-label">一般问题</div></div>
    <div class="stat-card"><div class="stat-num">${affectedCount}</div><div class="stat-label">涉及人数</div></div>
    <div class="stat-card ok"><div class="stat-num">${okCount}</div><div class="stat-label">无问题人数</div></div>
  `;

  const sorted = [...results].sort((a, b) => {
    const sa = a.issues.filter(i => i.severity === 'high').length;
    const sb = b.issues.filter(i => i.severity === 'high').length;
    if (sb !== sa) return sb - sa;
    return b.issues.length - a.issues.length;
  });

  $('#issueCards').innerHTML = sorted.map(emp => {
    const hasHigh = emp.issues.some(i => i.severity === 'high');
    const hasMed = emp.issues.some(i => i.severity === 'medium');
    const tagHtml = emp.issues.length === 0
      ? '<span class="tag tag-ok">无问题</span>'
      : (hasHigh ? '<span class="tag tag-error">严重</span>' : '') +
        (hasMed ? '<span class="tag tag-warn">一般</span>' : '');

    const leaveItems = [
      emp.personalLeave > 0 ? `事假 ${emp.personalLeave}h` : '',
      emp.sickLeave > 0 ? `病假 ${emp.sickLeave}h` : '',
      emp.annualLeave > 0 ? `年假 ${emp.annualLeave}h` : '',
      emp.weddingLeave > 0 ? `婚假 ${emp.weddingLeave}h` : '',
      emp.maternityLeave > 0 ? `产假 ${emp.maternityLeave}h` : '',
      emp.parentalLeave > 0 ? `育儿假 ${emp.parentalLeave}h` : '',
      emp.bereavementLeave > 0 ? `丧假 ${emp.bereavementLeave}h` : '',
      emp.other > 0 ? `其他 ${emp.other}h` : '',
    ].filter(Boolean).join('、') || '无';

    const icon = c => c.passed ? '\u{2705}' : (c.severity === 'high' ? '\u{1F534}' : '\u{1F7E1}');
    const checksHtml = `<ul class="issue-list">${emp.checks.map(c =>
        `<li class="issue-item ${c.passed ? 'ok' : c.severity}">
          <span class="issue-icon">${icon(c)}</span>
          <div>
            <strong>${c.type}</strong>
            <div class="issue-formula">${c.formula}</div>
            <div class="issue-detail">${c.detail.replace(/\n/g, '<br>')}</div>
          </div>
        </li>`
      ).join('')}</ul>`;

    const fmtMin = m => {
      if (m == null) return '-';
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return `${h}:${String(mm).padStart(2, '0')}`;
    };
    const fmtTimeRange = r => {
      if (!r.startTimeRaw && !r.endTimeRaw) return '-';
      const s = r.startTimeRaw.replace(/^\d{4}\/\d{1,2}\/\d{1,2}\s*/, '');
      const e = r.endTimeRaw.replace(/^\d{4}\/\d{1,2}\/\d{1,2}\s*/, '');
      return `${s}-${e}${r.crossMidnight ? '(次日)' : ''}`;
    };
    const findDayIdx = (d) => {
      if (!d || !emp.dateHeaders) return -1;
      for (let i = 0; i < emp.dateHeaders.length; i++) {
        const dh = emp.dateHeaders[i];
        if (dh && dh.getFullYear() === d.getFullYear() && dh.getMonth() === d.getMonth() && dh.getDate() === d.getDate()) return i;
      }
      return -1;
    };
    const attInfo = (r) => {
      const idx = findDayIdx(r.date);
      if (idx === -1) return { shift: '-', clock: '-', hours: '-', ci: null, co: null };
      const shift = emp.shifts[idx] || '-';
      const ci = emp.clockIn[idx];
      const co = emp.clockOut[idx];
      const clock = (ci != null || co != null) ? `${fmtMin(ci)}-${fmtMin(co)}` : '无记录';
      const hours = emp.dailyHours[idx] > 0 ? `${emp.dailyHours[idx]}h` : '-';
      return { shift, clock, hours, ci, co };
    };
    const clockMismatch = (r, a) => {
      if (['已驳回', '已撤销', '通过后撤销'].includes(r.status)) return '';
      if (a.ci == null || a.co == null) return r.startMinutes != null ? '无打卡记录' : '';
      const problems = [];
      if (r.startMinutes != null && r.startMinutes < a.ci - 10)
        problems.push(`开始${fmtMin(r.startMinutes)}早于打卡${fmtMin(a.ci)}`);
      if (r.endMinutes != null) {
        if (r.crossMidnight) {
          if (a.co < a.ci && a.co < r.endMinutes - 10) {
            problems.push(`打卡${fmtMin(a.co)}早于加班结束次日${fmtMin(r.endMinutes)}`);
          } else if (a.co >= a.ci && a.co <= r.startMinutes + 10) {
            problems.push(`打卡${fmtMin(a.co)}未覆盖跨日加班至次日${fmtMin(r.endMinutes)}`);
          }
        } else if (r.endMinutes > a.co + 10) {
          problems.push(`结束${fmtMin(r.endMinutes)}晚于打卡${fmtMin(a.co)}`);
        }
      }
      return problems.join('；');
    };
    const statusCls = r => {
      if (r.status === '已通过') return 'ot-status-pass';
      if (r.status === '审批中') return 'ot-status-pending';
      return 'ot-status-reject';
    };
    const otRow = r => {
      const a = attInfo(r);
      const warn = clockMismatch(r, a);
      const rowCls = warn ? ' class="ot-row-warn"' : '';
      const warnCell = warn ? `<td class="ot-warn-tip">${warn}</td>` : '<td></td>';
      return `<tr${rowCls}><td>${fmtDate(r.date)}</td><td>${r.dayType}</td><td>${fmtTimeRange(r)}</td><td>${r.hours}h</td><td class="${statusCls(r)}">${r.status}</td><td>${a.shift}</td><td>${a.clock}</td><td>${a.hours}</td>${warnCell}</tr>`;
    };
    const allOTRecords = [...emp.otApproved, ...emp.otPending, ...emp.otRejected];
    const allOTRows = allOTRecords.map(otRow).join('');
    const otDetailHtml = allOTRows
      ? `<details class="ot-detail"><summary>查看加班申请明细 (${allOTRecords.length} 条)</summary>
          <table class="ot-table"><thead><tr><th>日期</th><th>类型</th><th>加班时段</th><th>时长</th><th>状态</th><th>班次</th><th>打卡</th><th>出勤</th><th>核验</th></tr></thead><tbody>${allOTRows}</tbody></table></details>`
      : '<p style="font-size:12px;color:var(--text2);margin-top:8px;">无本期加班申请记录</p>';

    return `
    <div class="emp-card${emp.issues.length > 0 ? ' open' : ''}">
      <div class="emp-header" onclick="this.parentElement.classList.toggle('open')">
        <div><span class="emp-name">${emp.name}</span><span class="emp-store">${emp.store}</span></div>
        <div class="emp-tags">${tagHtml}</div>
      </div>
      <div class="emp-body">
        <div class="data-grid">
          <div class="data-item"><span class="dl">应出勤</span> <span class="dv">${emp.shouldHours}h</span></div>
          <div class="data-item"><span class="dl">实际出勤</span> <span class="dv">${emp.actualHours}h</span></div>
          <div class="data-item"><span class="dl">工作日加班</span> <span class="dv">${emp.workdayOT}h</span></div>
          <div class="data-item"><span class="dl">节假日加班</span> <span class="dv">${emp.holidayOT}h</span></div>
          <div class="data-item"><span class="dl">带薪假期</span> <span class="dv">${(emp.annualLeave + emp.weddingLeave + emp.maternityLeave + emp.parentalLeave + emp.bereavementLeave + emp.other)}h</span></div>
          <div class="data-item"><span class="dl">扣薪假期</span> <span class="dv">${(emp.personalLeave + emp.sickLeave)}h</span></div>
          <div class="data-item"><span class="dl">假期明细</span> <span class="dv">${leaveItems}</span></div>
          <div class="data-item"><span class="dl">申请单(通过+审批中)</span> <span class="dv">${emp.effectiveTotal.toFixed(1)}h</span></div>
        </div>
        ${checksHtml}
        ${otDetailHtml}
      </div>
    </div>`;
  }).join('');
}
