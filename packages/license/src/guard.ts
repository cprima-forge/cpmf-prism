export type CommandFn = () => Promise<void>;

export interface GuardOptions {
  onDenied?: (code: string) => void;
}

export function requireEntitlement(
  code: string,
  entitlements: string[],
  fn: CommandFn,
  opts: GuardOptions = {},
): CommandFn {
  return async () => {
    if (!entitlements.includes(code)) {
      opts.onDenied?.(code);
      return;
    }
    return fn();
  };
}
