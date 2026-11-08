export type PeriodPreset = "month" | "quarter" | "fy" | "custom";

export type DateRange = {
  from: string;
  to: string;
};

export type BankPeriodPreset = "month" | "60days" | "90days" | "fy";

export function getPeriodRange(
  preset: PeriodPreset,
  today: string,
  customFrom: string,
  customTo: string
): DateRange {
  const [year, month] = today.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;

  if (preset === "custom") {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(customFrom)
      ? customFrom
      : monthStart;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(customTo) ? customTo : today;
    return from <= to ? { from, to } : { from: to, to: from };
  }

  if (preset === "month") return { from: monthStart, to: today };

  const fiscalStartYear = month >= 4 ? year : year - 1;
  const fiscalStart = `${fiscalStartYear}-04-01`;
  if (preset === "fy") return { from: fiscalStart, to: today };

  const monthsSinceFiscalStart = (month - 4 + 12) % 12;
  const quarterStartIndex = 3 + Math.floor(monthsSinceFiscalStart / 3) * 3;
  const quarterYear = fiscalStartYear + Math.floor(quarterStartIndex / 12);
  const quarterMonth = (quarterStartIndex % 12) + 1;
  const from = `${quarterYear}-${String(quarterMonth).padStart(2, "0")}-01`;
  return { from, to: today };
}

export function getBankPeriodRange(
  preset: BankPeriodPreset,
  today: string
): DateRange {
  if (preset === "month" || preset === "fy")
    return getPeriodRange(preset, today, "", "");

  const days = preset === "60days" ? 60 : 90;
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: from.toISOString().slice(0, 10), to: today };
}
