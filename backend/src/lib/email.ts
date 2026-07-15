/**
 * Email templates for the magic-PIN login flow.
 *
 * Two entry points: `buildLoginEmail` (used by the backend to send the 8-digit
 * code) and a couple of small helpers for the subject/from. The tone is
 * deliberately casual and friendly — this is a sign-in code, not a legal notice.
 */

export const EMAIL_FROM = 'welcome@support.tabspace.ww0.dev';

/** How long a login code stays valid, in minutes (must match auth.ts). */
export const LOGIN_CODE_TTL_MINUTES = 10;

export interface LoginEmailContent {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the sign-in email. `displayName` is optional (the user may not have set
 * one yet); when present we greet them by name for a warmer tone.
 */
export function buildLoginEmail(
  code: string,
  displayName?: string | null
): LoginEmailContent {
  const greeting = displayName
    ? `Hey ${escapeHtml(displayName)}`
    : 'Hey there';
  const subject = 'Your TabSpace login code';

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:#6d28d9;padding:28px 32px;">
                <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">TabSpace</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 16px;color:#18181b;font-size:16px;line-height:1.5;">${greeting},</p>
                <p style="margin:0 0 24px;color:#3f3f46;font-size:15px;line-height:1.6;">
                  Here's your one-time login code. Pop it into the app and you're in:
                </p>
                <div style="margin:0 0 24px;padding:20px;text-align:center;background:#f4f4f5;border-radius:10px;letter-spacing:8px;font-size:30px;font-weight:700;color:#6d28d9;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
                  ${escapeHtml(code)}
                </div>
                <p style="margin:0 0 8px;color:#71717a;font-size:13px;line-height:1.5;">
                  The code is good for about ${LOGIN_CODE_TTL_MINUTES} minutes. After that it expires and you can just ask for a new one.
                </p>
                <p style="margin:0;color:#71717a;font-size:13px;line-height:1.5;">
                  If you didn't try to sign in, no worries — you can safely ignore this email. Nothing happens until the code is used.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;">
                <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.5;">
                  TabSpace · happy tabbing!
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${greeting},

Here's your one-time TabSpace login code:

${code}

It's good for about ${LOGIN_CODE_TTL_MINUTES} minutes. After that, just ask for a new one in the app.

If you didn't try to sign in, no worries — you can ignore this email. Nothing happens until the code is used.

TabSpace · happy tabbing!`;

  return { subject, html, text };
}
