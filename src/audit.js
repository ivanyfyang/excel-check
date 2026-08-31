export function audit(employees, otRecords, dateRange) {
  const results = [];

  for (const emp of employees) {
    if (emp.shouldHours === 0 && emp.actualHours === 0) continue;

    const issues = [];

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

    const diff = emp.actualHours - emp.shouldHours;
    const balance = emp.totalOT - emp.totalLeave;
    if (Math.abs(diff - balance) > 0.1) {
      issues.push({
        type: '等式不平衡',
        severity: 'high',
        detail: `实际出勤(${emp.actualHours}h) - 应出勤(${emp.shouldHours}h) = ${diff.toFixed(1)}h，` +
          `但 加班(${emp.totalOT}h) - 假期(${emp.totalLeave}h) = ${balance.toFixed(1)}h，差异 ${Math.abs(diff - balance).toFixed(1)}h`,
      });
    }

    if (Math.abs(emp.totalOT - approvedTotal) > 0.1) {
      issues.push({
        type: '加班总时长不一致',
        severity: emp.totalOT > 0 && approvedTotal === 0 ? 'high' : 'medium',
        detail: `考勤表加班合计 ${emp.totalOT.toFixed(1)}h，加班申请单已通过合计 ${approvedTotal.toFixed(1)}h，差异 ${(emp.totalOT - approvedTotal).toFixed(1)}h`,
      });
    }

    if (Math.abs(emp.workdayOT - approvedWorkday) > 0.1) {
      issues.push({
        type: '工作日加班不一致',
        severity: 'medium',
        detail: `考勤表工作日加班 ${emp.workdayOT}h，申请单工作日加班(已通过) ${approvedWorkday.toFixed(1)}h，差异 ${(emp.workdayOT - approvedWorkday).toFixed(1)}h`,
      });
    }

    if (Math.abs(emp.holidayOT - (approvedHoliday + approvedWeekend)) > 0.1) {
      issues.push({
        type: '节假日加班不一致',
        severity: 'medium',
        detail: `考勤表节假日加班 ${emp.holidayOT}h，申请单节假日+周末加班(已通过) ${(approvedHoliday + approvedWeekend).toFixed(1)}h，差异 ${(emp.holidayOT - approvedHoliday - approvedWeekend).toFixed(1)}h`,
      });
    }

    if (pending.length > 0) {
      const pendingTotal = pending.reduce((s, r) => s + r.hours, 0);
      issues.push({
        type: '有未审批加班申请',
        severity: 'medium',
        detail: `${pending.length} 条加班申请仍在审批中，共 ${pendingTotal.toFixed(1)}h`,
      });
    }

    results.push({
      ...emp,
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
