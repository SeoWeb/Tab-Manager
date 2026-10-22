import { describe, it, expect } from 'vitest';
import { buildLoginEmail, LOGIN_CODE_TTL_MINUTES } from '../email';

describe('buildLoginEmail', () => {
  it('embeds the 8-digit code with a fixed neutral greeting', () => {
    const { subject, html, text } = buildLoginEmail('12345678');

    expect(subject).toContain('login code');
    // The code must appear verbatim in both renderings.
    expect(html).toContain('12345678');
    expect(text).toContain('12345678');
    expect(html).toContain('Hey there');
    expect(text).toContain('Hey there');
  });

  it('mentions the validity window and an ignore-this-email note', () => {
    const { html, text } = buildLoginEmail('87654321');
    expect(html).toContain(String(LOGIN_CODE_TTL_MINUTES));
    expect(text).toContain('ignore this email');
  });

  it('escapes the code slot defensively (no raw HTML even for odd input)', () => {
    // Codes are server-generated digits, but the template must never become a
    // raw-HTML passthrough if the code value were ever anything else.
    const { html } = buildLoginEmail('<script>x</script>');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('accepts only the code — personalization was removed on purpose', () => {
    // Regression guard for the security fix: the email body must contain no
    // attacker-chosen text, so buildLoginEmail deliberately takes no name.
    // If this arity ever changes, revisit that decision first.
    expect(buildLoginEmail.length).toBe(1);

    const { text } = buildLoginEmail('11111111');
    expect(text.startsWith('Hey there,')).toBe(true);
  });
});
