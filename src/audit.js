export function audit(employees, otRecords, dateRange) {
  const results = [];

  for (const emp of employees) {
    if (emp.shouldHours === 0 && emp.actualHours === 0) continue;

    const checks = [];

    const myOT = otRecords.filter(r =>
      r.name === emp.name &&
      r.date &&
      r.date >= dateRange.start &&
      r.date <= dateRange.end
    );
    const approved = myOT.filter(r => r.status === '已通过');
    const pending = myOT.filter(r => r.status === '审批中');
    const rejected = myOT.filter(r => ['已驳回', '已撤销', '通过后撤销'].includes(r.status));

    const effective = [...approved, ...pending];
    const approvedTotal = approved.reduce((s, r) => s + r.hours, 0);
    const pendingTotal = pending.reduce((s, r) => s + r.hours, 0);
    const effectiveTotal = approvedTotal + pendingTotal;
    const effectiveWorkday = effective.filter(r => r.dayType === '普通工作日').reduce((s, r) => s + r.hours, 0);
    const effectiveWeekend = effective.filter(r => r.dayType === '周末').reduce((s, r) => s + r.hours, 0);
    const effectiveHoliday = effective.filter(r => r.dayType === '法定节假日').reduce((s, r) => s + r.hours, 0);

    // 规则 1: 等式平衡检查
    const diff = emp.actualHours - emp.shouldHours;
    const balance = emp.totalOT - emp.totalLeave;
    const r1Pass = Math.abs(diff - balance) <= 0.1;
    checks.push({
      type: '等式平衡检查',
      passed: r1Pass,
      severity: r1Pass ? 'ok' : 'high',
      formula: `实际出勤 - 应出勤 = ${emp.actualHours} - ${emp.shouldHours} = ${diff.toFixed(1)}` +
        `  |  加班 - 假期 = ${emp.totalOT} - ${emp.totalLeave} = ${balance.toFixed(1)}`,
      detail: r1Pass ? '两侧相等，工时记录一致' : `两侧应相等，实际差异 ${Math.abs(diff - balance).toFixed(1)}h，工时记录存在矛盾`,
    });

    // 规则 2: 加班总时长一致性
    const pendingNote = pendingTotal > 0 ? `(含审批中${pendingTotal.toFixed(1)})` : '';
    const r2Pass = Math.abs(emp.totalOT - effectiveTotal) <= 0.1;
    checks.push({
      type: '加班总时长一致性',
      passed: r2Pass,
      severity: r2Pass ? 'ok' : 'high',
      formula: `考勤表加班 = 节假日${emp.holidayOT} + 工作日${emp.workdayOT} = ${emp.totalOT.toFixed(1)}` +
        `  |  申请单(已通过+审批中) = ${effectiveTotal.toFixed(1)}${pendingNote}`,
      detail: r2Pass ? '考勤表与申请单加班工时一致' : `差异 ${(emp.totalOT - effectiveTotal).toFixed(1)}h`,
    });

    // 规则 3: 工作日加班分类一致性（普通工作日 + 周末）
    const effectiveWorkdayAll = effectiveWorkday + effectiveWeekend;
    const r3Pass = Math.abs(emp.workdayOT - effectiveWorkdayAll) <= 0.1;
    checks.push({
      type: '工作日加班分类一致性',
      passed: r3Pass,
      severity: r3Pass ? 'ok' : 'medium',
      formula: `考勤表工作日加班 = ${emp.workdayOT}  |  申请单(工作日${effectiveWorkday.toFixed(1)} + 周末${effectiveWeekend.toFixed(1)}) = ${effectiveWorkdayAll.toFixed(1)}`,
      detail: r3Pass ? '工作日加班分类一致' : `差异 ${(emp.workdayOT - effectiveWorkdayAll).toFixed(1)}h`,
    });

    // 规则 4: 法定节假日加班分类一致性（仅法定节假日）
    const r4Pass = Math.abs(emp.holidayOT - effectiveHoliday) <= 0.1;
    checks.push({
      type: '法定节假日加班分类一致性',
      passed: r4Pass,
      severity: r4Pass ? 'ok' : 'medium',
      formula: `考勤表法定节假日加班 = ${emp.holidayOT}  |  申请单(法定节假日,已通过+审批中) = ${effectiveHoliday.toFixed(1)}`,
      detail: r4Pass ? '法定节假日加班分类一致' : `差异 ${(emp.holidayOT - effectiveHoliday).toFixed(1)}h，分类错误会影响加班费计算`,
    });

    // 规则 5: 带薪假期工时异常
    const paidLeave = emp.annualLeave + emp.weddingLeave + emp.maternityLeave +
      emp.parentalLeave + emp.bereavementLeave + emp.other;
    if (paidLeave > 0) {
      const coveredHours = emp.actualHours + paidLeave;
      const expectedWithOT = emp.shouldHours + emp.totalOT;
      const r5Pass = Math.abs(coveredHours - expectedWithOT) <= 0.1;
      const leaveBreakdown = [
        emp.annualLeave > 0 ? `年假${emp.annualLeave}` : '',
        emp.weddingLeave > 0 ? `婚假${emp.weddingLeave}` : '',
        emp.maternityLeave > 0 ? `产假${emp.maternityLeave}` : '',
        emp.parentalLeave > 0 ? `育儿假${emp.parentalLeave}` : '',
        emp.bereavementLeave > 0 ? `丧假${emp.bereavementLeave}` : '',
        emp.other > 0 ? `其他${emp.other}` : '',
      ].filter(Boolean).join('+');
      const delta = coveredHours - expectedWithOT;
      checks.push({
        type: '带薪假期工时异常',
        passed: r5Pass,
        severity: r5Pass ? 'ok' : 'high',
        formula: `实际出勤 + 带薪假期 = ${emp.actualHours} + ${paidLeave}(${leaveBreakdown}) = ${coveredHours.toFixed(1)}` +
          `  |  应出勤 + 加班 = ${emp.shouldHours} + ${emp.totalOT} = ${expectedWithOT.toFixed(1)}`,
        detail: r5Pass ? '带薪假期工时正常' : `差异 ${delta > 0 ? '+' : ''}${delta.toFixed(1)}h，带薪假期当天可能重复计入了出勤工时`,
      });
    }

    // 规则 6: 加班打卡记录核验
    if (effective.length > 0 && emp.dateHeaders) {
      const mismatchDetails = [];
      for (const ot of effective) {
        if (!ot.date) continue;
        const otDay = ot.date.getDate();
        const otMonth = ot.date.getMonth();
        const otYear = ot.date.getFullYear();
        let dayIdx = -1;
        for (let d = 0; d < emp.dateHeaders.length; d++) {
          const dh = emp.dateHeaders[d];
          if (dh && dh.getFullYear() === otYear && dh.getMonth() === otMonth && dh.getDate() === otDay) {
            dayIdx = d;
            break;
          }
        }
        if (dayIdx === -1) continue;

        const ciMin = emp.clockIn[dayIdx];
        const coMin = emp.clockOut[dayIdx];
        const fmtMin = m => {
          if (m == null) return '-';
          const h = Math.floor(m / 60);
          const mm = m % 60;
          return `${h}:${String(mm).padStart(2, '0')}`;
        };
        const dateStr = `${otMonth + 1}/${otDay}`;

        if (ciMin == null || coMin == null) {
          mismatchDetails.push(`${dateStr}: 申请${ot.hours}h，但当日无打卡记录`);
          continue;
        }

        const problems = [];
        if (ot.startMinutes != null && ot.startMinutes < ciMin - 10) {
          problems.push(`开始${fmtMin(ot.startMinutes)}早于打卡${fmtMin(ciMin)}`);
        }
        if (ot.endMinutes != null) {
          if (ot.crossMidnight) {
            if (coMin < ciMin && coMin < ot.endMinutes - 10) {
              problems.push(`打卡${fmtMin(coMin)}早于加班结束次日${fmtMin(ot.endMinutes)}`);
            } else if (coMin >= ciMin && coMin <= ot.startMinutes + 10) {
              problems.push(`打卡${fmtMin(coMin)}未覆盖跨日加班至次日${fmtMin(ot.endMinutes)}`);
            }
          } else if (ot.endMinutes > coMin + 10) {
            problems.push(`结束${fmtMin(ot.endMinutes)}晚于打卡${fmtMin(coMin)}`);
          }
        }
        if (ot.startMinutes != null && ot.endMinutes != null) {
          const spanMinutes = ot.crossMidnight
            ? (1440 - ot.startMinutes) + ot.endMinutes
            : ot.endMinutes - ot.startMinutes;
          const spanHours = spanMinutes / 60;
          if (Math.abs(spanHours - ot.hours) > 0.1) {
            problems.push(`时长${ot.hours}h≠时间跨度${spanHours.toFixed(1)}h`);
          }
        }
        if (problems.length > 0) {
          const endLabel = ot.crossMidnight ? `次日${fmtMin(ot.endMinutes)}` : fmtMin(ot.endMinutes);
          mismatchDetails.push(`${dateStr}: 打卡${fmtMin(ciMin)}-${fmtMin(coMin)}，加班${fmtMin(ot.startMinutes)}-${endLabel} ${ot.hours}h → ${problems.join('；')}`);
        }
      }
      const r7Pass = mismatchDetails.length === 0;
      checks.push({
        type: '加班打卡记录核验',
        passed: r7Pass,
        severity: r7Pass ? 'ok' : 'high',
        formula: `已通过+审批中 ${effective.length} 条加班申请 vs 考勤打卡记录`,
        detail: r7Pass ? '所有加班申请的时间均在打卡范围内' : mismatchDetails.join('\n'),
      });
    }

    const issues = checks.filter(c => !c.passed);

    results.push({
      ...emp,
      checks,
      issues,
      otApproved: approved,
      otPending: pending,
      otRejected: rejected,
      approvedTotal,
      effectiveTotal,
    });
  }

  return results;
}
