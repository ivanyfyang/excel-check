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

    const approvedTotal = approved.reduce((s, r) => s + r.hours, 0);
    const approvedWorkday = approved.filter(r => r.dayType === '普通工作日').reduce((s, r) => s + r.hours, 0);
    const approvedWeekend = approved.filter(r => r.dayType === '周末').reduce((s, r) => s + r.hours, 0);
    const approvedHoliday = approved.filter(r => r.dayType === '法定节假日').reduce((s, r) => s + r.hours, 0);

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
    const r2Pass = Math.abs(emp.totalOT - approvedTotal) <= 0.1;
    checks.push({
      type: '加班总时长一致性',
      passed: r2Pass,
      severity: r2Pass ? 'ok' : (emp.totalOT > 0 && approvedTotal === 0 ? 'high' : 'medium'),
      formula: `考勤表加班 = 节假日${emp.holidayOT} + 工作日${emp.workdayOT} = ${emp.totalOT.toFixed(1)}` +
        `  |  申请单已通过 = ${approvedTotal.toFixed(1)}`,
      detail: r2Pass ? '考勤表与申请单加班工时一致' : `差异 ${(emp.totalOT - approvedTotal).toFixed(1)}h`,
    });

    // 规则 3: 工作日加班分类一致性
    const r3Pass = Math.abs(emp.workdayOT - approvedWorkday) <= 0.1;
    checks.push({
      type: '工作日加班分类一致性',
      passed: r3Pass,
      severity: r3Pass ? 'ok' : 'medium',
      formula: `考勤表工作日加班 = ${emp.workdayOT}  |  申请单(普通工作日,已通过) = ${approvedWorkday.toFixed(1)}`,
      detail: r3Pass ? '工作日加班分类一致' : `差异 ${(emp.workdayOT - approvedWorkday).toFixed(1)}h`,
    });

    // 规则 4: 节假日加班分类一致性
    const r4Pass = Math.abs(emp.holidayOT - (approvedHoliday + approvedWeekend)) <= 0.1;
    checks.push({
      type: '节假日加班分类一致性',
      passed: r4Pass,
      severity: r4Pass ? 'ok' : 'medium',
      formula: `考勤表节假日加班 = ${emp.holidayOT}  |  申请单(周末${approvedWeekend.toFixed(1)} + 法定${approvedHoliday.toFixed(1)}) = ${(approvedHoliday + approvedWeekend).toFixed(1)}`,
      detail: r4Pass ? '节假日加班分类一致' : `差异 ${(emp.holidayOT - approvedHoliday - approvedWeekend).toFixed(1)}h，分类错误会影响加班费计算`,
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

    // 规则 6: 未审批加班提醒
    const r6Pass = pending.length === 0;
    if (!r6Pass) {
      const pendingTotal = pending.reduce((s, r) => s + r.hours, 0);
      checks.push({
        type: '未审批加班提醒',
        passed: false,
        severity: 'medium',
        formula: `审批中 ${pending.length} 条，共 ${pendingTotal.toFixed(1)}h`,
        detail: '需及时审批以确保数据完整',
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
      approvedWorkday,
      approvedWeekend,
      approvedHoliday,
    });
  }

  return results;
}
