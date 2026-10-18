import { useCallback, useState } from "react";
import { useWallet } from "../context/WalletContext";
import { useToast } from "../context/ToastContext";
import type { Signer } from "../lib/types";
import { parseContractError } from "../lib/rules.js";

/**
 * One place for the "check wallet -> mark busy -> send -> toast -> refresh" dance every action
 * button needs. `busy` holds the label of the action in flight so each button can show its own
 * spinner while the others stay disabled.
 */
export function useRunner(onDone?: () => void | Promise<void>) {
  const wallet = useWallet();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (
      label: string,
      fn: (signer: Signer) => Promise<unknown>,
      successTitle: string,
      successDetail?: string,
    ): Promise<boolean> => {
      if (!wallet.signer) {
        toast.push("error", "Connect a wallet first.");
        return false;
      }
      setBusy(label);
      try {
        await fn(wallet.signer);
        toast.push("success", successTitle, successDetail);
        if (onDone) await onDone();
        return true;
      } catch (e) {
        toast.push("error", "Transaction failed", parseContractError(e).message);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [wallet.signer, toast, onDone],
  );

  return { busy, run };
}
