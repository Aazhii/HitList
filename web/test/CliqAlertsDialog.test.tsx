import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliqAlertsDialog } from '@/components/shell/CliqAlertsDialog';
import type { CliqStatus } from '@/lib/cliqMessage';
import type { CliqConnectionState } from '@/hooks/useCliqConnection';

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

const disconnected: CliqConnectionState = { available: true, linked: false, email: null, enabled: false, connected: false, lastResult: 'stopped' };
const linked: CliqConnectionState = { ...disconnected, linked: true, email: 'me@zohocorp.com' };

function commandBridge(initial = disconnected) {
  bridge();
  let current = initial;
  const commands = {
    getCliqConnection: vi.fn(async () => current),
    startCliqLink: vi.fn(async (): Promise<CliqConnectionState> => (current = { ...disconnected, code: 'a'.repeat(32), expiresAt: Date.now() + 300000 })),
    confirmCliqLink: vi.fn(async () => (current = linked)),
    setCliqIntake: vi.fn(async (enabled: boolean) => (current = { ...current, enabled })),
    fetchCliqCommands: vi.fn(async () => (current = { ...current, lastResult: 'fetched' })),
    unlinkCliq: vi.fn(async () => (current = disconnected)),
  };
  Object.assign(window.hitlistDesktop, commands);
  return commands;
}

afterEach(() => { delete window.hitlistDesktop; });

describe('CliqAlertsDialog', () => {
  it('says it belongs to the desktop app when opened in a browser', () => {
    render(<CliqAlertsDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/part of the HitList desktop app/)).toBeInTheDocument();
    expect(screen.getByText(/Cliq commands are unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create pairing link' })).not.toBeInTheDocument();
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

  it('only requests connection state when opened, and exposes a copyable command without a nonce', async () => {
    const commands = commandBridge();
    const { rerender } = render(<CliqAlertsDialog open={false} onOpenChange={vi.fn()} />);
    expect(commands.getCliqConnection).not.toHaveBeenCalled();
    rerender(<CliqAlertsDialog open onOpenChange={vi.fn()} />);
    await screen.findByRole('button', { name: 'Create pairing link' });
    expect(commands.getCliqConnection).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing link' }));
    expect(await screen.findByText(`link ${'a'.repeat(32)}`)).toBeInTheDocument();
    expect(screen.getByText(/Expires/)).toBeInTheDocument();
    expect(screen.queryByText(/nonce/)).not.toBeInTheDocument();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy link command' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`link ${'a'.repeat(32)}`));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm link' }));
    expect(await screen.findByText('Linked to me@zohocorp.com')).toBeInTheDocument();
    expect(commands.confirmCliqLink).toHaveBeenCalledOnce();
  });

  it('keeps intake independent from alerts and supports fetch and unlink', async () => {
    const commands = commandBridge(linked);
    render(<CliqAlertsDialog open onOpenChange={vi.fn()} />);
    const intake = await screen.findByRole('switch', { name: 'Receive tasks from Cliq' });
    expect(intake).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Send me alerts in Cliq' })).not.toBeChecked();
    fireEvent.click(intake);
    await waitFor(() => expect(commands.setCliqIntake).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByRole('button', { name: 'Fetch now' }));
    await waitFor(() => expect(commands.fetchCliqCommands).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(await screen.findByRole('button', { name: 'Create pairing link' })).toBeInTheDocument();
    expect(commands.unlinkCliq).toHaveBeenCalledOnce();
  });

  it('reports signed-out, workspace and bridge failures without actionable controls', async () => {
    const commands = commandBridge({ ...disconnected, available: false, error: 'auth-required' });
    const { rerender } = render(<CliqAlertsDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText(/Sign in to the desktop app to connect Cliq commands/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create pairing link' })).not.toBeInTheDocument();
    rerender(<CliqAlertsDialog open={false} onOpenChange={vi.fn()} />);
    commands.getCliqConnection.mockResolvedValue({ ...disconnected, available: false, error: 'workspace-unavailable' });
    rerender(<CliqAlertsDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('The local workspace is unavailable.')).toBeInTheDocument();
    rerender(<CliqAlertsDialog open={false} onOpenChange={vi.fn()} />);
    commands.getCliqConnection.mockRejectedValue(new Error('offline'));
    rerender(<CliqAlertsDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText(/Could not load Cliq commands/)).toBeInTheDocument();
  });

  it('shows a returned conflict and recovers after a rejected action', async () => {
    const commands = commandBridge();
    commands.startCliqLink.mockResolvedValueOnce({ ...disconnected, error: 'link-conflict' });
    render(<CliqAlertsDialog open onOpenChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create pairing link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already linked elsewhere');
    commands.startCliqLink.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing link' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not update'));
    expect(screen.getByRole('button', { name: 'Create pairing link' })).not.toBeDisabled();
  });

  it('does not confirm an expired pairing link', async () => {
    commandBridge({ ...disconnected, code: 'b'.repeat(32), expiresAt: Date.now() - 1000 });
    render(<CliqAlertsDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('Pairing link expired.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm link' })).toBeDisabled();
  });
});
