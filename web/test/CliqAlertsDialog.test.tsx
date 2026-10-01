import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliqAlertsDialog } from '@/components/shell/CliqAlertsDialog';
import type { CliqStatus } from '@/lib/cliqMessage';

const base: CliqStatus = { enabled: false, email: '', lastResult: null, lastSentAt: null, sentToday: 0, maxPerDay: 3 };

function bridge(initial: CliqStatus = base) {
  let current = { ...initial };
  const b = {
    getAccount: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
    getCliq: vi.fn(async () => current),
    setCliq: vi.fn(async (s: { enabled: boolean; email: string }) => {
      if (s.enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.email)) return { ok: false, reason: 'bad-email', status: current };
      current = { ...current, enabled: s.enabled, email: s.email };
      return { ok: true, status: current };
    }),
    testCliq: vi.fn(async () => ({ result: 'sent' })),
  };
  window.hitlistDesktop = b as unknown as typeof window.hitlistDesktop;
  return b;
}

afterEach(() => { delete window.hitlistDesktop; });

describe('CliqAlertsDialog', () => {
  it('says it belongs to the desktop app when opened in a browser', () => {
    render(<CliqAlertsDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/part of the HitList desktop app/)).toBeInTheDocument();
  });

  it('keeps the switch off until there is an email, then saves it on', async () => {
    const b = bridge();
    render(<CliqAlertsDialog open onOpenChange={vi.fn()} />);
    const toggle = await screen.findByRole('switch', { name: 'Send me alerts in Cliq' });
    expect(toggle).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your Cliq email'), { target: { value: 'me@zohocorp.com' } });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    await waitFor(() => expect(b.setCliq).toHaveBeenCalledWith({ enabled: true, email: 'me@zohocorp.com' }));
    await waitFor(() => expect(screen.getByText(/Alerts are on/)).toBeInTheDocument());
  });

  it('saves the typed email and sends the test message, then says it was sent', async () => {
    const b = bridge({ ...base, enabled: true, email: 'me@zohocorp.com' });
    render(<CliqAlertsDialog open onOpenChange={vi.fn()} />);
    const send = await screen.findByRole('button', { name: 'Send test message' });
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);
    await waitFor(() => expect(b.testCliq).toHaveBeenCalled());
    expect(b.setCliq).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent(/message from the HitList bot/);
  });

  it('explains a refused test instead of failing silently', async () => {
    const b = bridge({ ...base, enabled: true, email: 'me@zohocorp.com' });
    b.testCliq.mockResolvedValue({ result: 'bad-recipient' });
    render(<CliqAlertsDialog open onOpenChange={vi.fn()} />);
    const send = await screen.findByRole('button', { name: 'Send test message' });
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);
    expect(await screen.findByRole('status')).toHaveTextContent(/not allowed/);
  });
});
