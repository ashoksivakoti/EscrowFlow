export function getExplorerTxUrl(chainId: number | null | undefined, txHash: string): string | null {
  if (!chainId || !txHash.startsWith("0x")) {
    return null;
  }

  const base =
    chainId === 1
      ? "https://etherscan.io"
      : chainId === 11155111
        ? "https://sepolia.etherscan.io"
        : chainId === 8453
          ? "https://basescan.org"
          : chainId === 84532
            ? "https://sepolia.basescan.org"
            : null;
  if (!base) {
    return null;
  }
  return `${base}/tx/${txHash}`;
}
