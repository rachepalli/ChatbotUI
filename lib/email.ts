import nodemailer from "nodemailer";

type SendResetEmailParams = {
  to: string;
  resetUrl: string;
};

export async function sendPasswordResetEmail({
  to,
  resetUrl,
}: SendResetEmailParams) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const hasPlaceholderConfig =
    user === "your-email@gmail.com" ||
    from === "your-email@gmail.com" ||
    pass === "your-16-char-app-password";

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Reset your password</h2>
      <p>We received a request to reset your password.</p>
      <p>
        Click the link below to set a new password. This link will expire in 15 minutes.
      </p>
      <p>
        <a href="${resetUrl}" target="_blank" rel="noopener noreferrer">Reset Password</a>
      </p>
      <p>If you did not request this, you can safely ignore this email.</p>
    </div>
  `;

  // Local/dev fallback so the flow is testable without SMTP.
  if (!host || !user || !pass || !from || hasPlaceholderConfig) {
    console.log(`[PASSWORD RESET] Email to ${to}: ${resetUrl}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });

  await transporter.sendMail({
    from,
    to,
    subject: "Reset your password",
    html,
  });
}
