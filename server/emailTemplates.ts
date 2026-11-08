export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!
  );

export function emailLayout(input: {
  companyName: string;
  title: string;
  preheader: string;
  content: string;
  action?: { label: string; href: string };
}) {
  const action = input.action
    ? `<p style="margin:28px 0"><a href="${escapeHtml(input.action.href)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;padding:12px 20px;font-weight:600">${escapeHtml(input.action.label)}</a></p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head><body style="margin:0;background:#f3f6fa;color:#172033;font-family:Arial,Helvetica,sans-serif;line-height:1.55"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fa;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden"><tr><td style="background:#172033;padding:22px 28px;color:#fff;font-size:20px;font-weight:700">${escapeHtml(input.companyName)}</td></tr><tr><td style="padding:32px 28px"><h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;color:#172033">${escapeHtml(input.title)}</h1>${input.content}${action}</td></tr><tr><td style="padding:18px 28px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px">This email was sent by ${escapeHtml(input.companyName)} using BillFlow. Please do not reply to this automated message.</td></tr></table></td></tr></table></body></html>`;
}
