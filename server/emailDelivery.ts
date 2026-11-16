import { Resend } from "resend";

export async function deliverEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ sent: boolean; reason: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    return {
      sent: false,
      reason:
        "Email delivery is not configured. Add RESEND_API_KEY and RESEND_FROM in project secrets.",
    };
  }

  try {
    const { error } = await new Resend(apiKey).emails.send({
      from,
      to,
      subject,
      html,
    });

    if (error) {
      return {
        sent: false,
        reason: error.message.slice(0, 420),
      };
    }

    return {
      sent: true,
      reason: "Message accepted by Resend.",
    };
  } catch (error) {
    return {
      sent: false,
      reason:
        error instanceof Error
          ? error.message.slice(0, 420)
          : "Resend email delivery failed.",
    };
  }
}
