import nodemailer from "nodemailer";

type SendResetEmailParams = {
  to: string;
  resetUrl: string;
};

export type PasswordResetEmailResult = {
  sent: boolean;
  devResetUrl?: string;
  error?: string;
};

const placeholderValues = new Set([
  "your-email@gmail.com",
  "your_from_email",
  "your-16-char-app-password",
  "your_smtp_password",
]);

function cleanEnv(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlaceholder(value: string) {
  return !value || placeholderValues.has(value);
}

export function getSmtpConfig() {
  const host = cleanEnv(process.env.SMTP_HOST);
  const port = Number(process.env.SMTP_PORT || 587);
  const user = cleanEnv(process.env.SMTP_USER);
  const pass = cleanEnv(process.env.SMTP_PASS);
  const fromCandidate = cleanEnv(process.env.SMTP_FROM);
  const from = isPlaceholder(fromCandidate) ? user : fromCandidate;

  return {
    host,
    port,
    user,
    pass,
    from,
    isConfigured: Boolean(host && user && pass && from && !isPlaceholder(pass)),
  };
}

export async function sendPasswordResetEmail({
  to,
  resetUrl,
}: SendResetEmailParams): Promise<PasswordResetEmailResult> {
  const smtp = getSmtpConfig();
  const isDevelopment = process.env.NODE_ENV === "development";

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

  if (!smtp.isConfigured) {
    console.warn(
      "[PASSWORD RESET] SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM in .env.local."
    );
    console.log(`[PASSWORD RESET] Email to ${to}: ${resetUrl}`);

    if (isDevelopment) {
      return { sent: false, devResetUrl: resetUrl };
    }

    return {
      sent: false,
      error: "Email service is not configured",
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
    ...(smtp.port === 587 ? { requireTLS: true } : {}),
  });

  try {
    await transporter.sendMail({
      from: smtp.from,
      to,
      subject: "Reset your password",
      html,
    });

    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send reset email";
    console.error("[PASSWORD RESET] SMTP send failed:", message);

    if (isDevelopment) {
      return { sent: false, devResetUrl: resetUrl, error: message };
    }

    return { sent: false, error: message };
  }
}
