import { describe, it, expect } from 'vitest';
import { buildLoginEmail, LOGIN_CODE_TTL_MINUTES } from '../email';

describe('buildLoginEmail', () => {
  it('embeds the 8-digit code and a friendly greeting (no name)', () => {
    const { subject, html, text } = buildLoginEmail('12345678');

    expect(subject).toContain('login code');
    // The code must appear verbatim in both renderings.
    expect(html).toContain('12345678');
    expect(text).toContain('12345678');
    expect(html).toContain('Hey there');
    expect(text).toContain('Hey there');
  });

  it('greets by display name when provided', () => {
    const { html, text } = buildLoginEmail('00000000', 'Ada');
    expect(html).toContain('Hey Ada');
    expect(text).toContain('Hey Ada');
  });

  it('mentions the validity window and an ignore-this-email note', () => {
    const { html, text } = buildLoginEmail('87654321');
    expect(html).toContain(String(LOGIN_CODE_TTL_MINUTES));
    expect(text).toContain('ignore this email');
  });

  it('escapes HTML in the display name to prevent injection', () => {
    const { html } = buildLoginEmail('11111111', '<script>x</script>');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
