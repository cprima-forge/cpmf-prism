import { describe, it, expect, vi } from 'vitest';
import { requireEntitlement } from './guard';

describe('requireEntitlement', () => {
  it('calls fn when entitlement present', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = requireEntitlement('uisor.generate-pdf', ['uisor.render', 'uisor.generate-pdf'], fn);
    await wrapped();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('blocks fn when entitlement absent', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = requireEntitlement('uisor.generate-pdf', ['uisor.render'], fn);
    await wrapped();
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls onDenied with the missing code', async () => {
    const fn = vi.fn();
    const onDenied = vi.fn();
    const wrapped = requireEntitlement('uisor.generate-pdf', [], fn, { onDenied });
    await wrapped();
    expect(onDenied).toHaveBeenCalledWith('uisor.generate-pdf');
  });

  it('does not call onDenied when entitlement present', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const onDenied = vi.fn();
    const wrapped = requireEntitlement('uisor.generate-pdf', ['uisor.generate-pdf'], fn, { onDenied });
    await wrapped();
    expect(onDenied).not.toHaveBeenCalled();
  });

  it('empty entitlements list blocks everything', async () => {
    const fn = vi.fn();
    const wrapped = requireEntitlement('uisor.parse', [], fn);
    await wrapped();
    expect(fn).not.toHaveBeenCalled();
  });

  it('exact string match only — no prefix match', async () => {
    const fn = vi.fn();
    const wrapped = requireEntitlement('uisor.generate-pdf', ['uisor.generate'], fn);
    await wrapped();
    expect(fn).not.toHaveBeenCalled();
  });

  it('propagates fn rejection', async () => {
    const err = new Error('downstream failure');
    const fn = vi.fn().mockRejectedValue(err);
    const wrapped = requireEntitlement('uisor.parse', ['uisor.parse'], fn);
    await expect(wrapped()).rejects.toThrow('downstream failure');
  });
});
