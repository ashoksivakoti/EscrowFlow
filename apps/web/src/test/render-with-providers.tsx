import { createElement, type ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";

import { ContractPauseProvider } from "@/components/providers/contract-pause-provider";

const testWagmiConfig = createConfig({
  chains: [arbitrumSepolia],
  transports: {
    [arbitrumSepolia.id]: http("http://127.0.0.1:8545"),
  },
});

export function renderWithProviders(
  node: ReactNode,
  options?: { includePauseProvider?: boolean },
) {
  const queryClient = new QueryClient();
  const withPauseProvider = options?.includePauseProvider ?? false;
  const content = withPauseProvider
    ? createElement(ContractPauseProvider, null, node)
    : node;

  return render(
    createElement(
      WagmiProvider,
      { config: testWagmiConfig },
      createElement(QueryClientProvider, { client: queryClient }, content),
    ),
  );
}
