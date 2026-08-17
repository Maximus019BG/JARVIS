"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios from "axios";
import * as React from "react";

export const noRetryStatusCodes = [400, 401, 403, 404, 500];

interface ApiProviderProps {
  children: React.ReactNode;
}

export function ApiProvider({ children }: ApiProviderProps) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * Every request costs a ~230ms round trip to Neon us-east-1, so the
             * default `staleTime: 0` (refetch on every mount) made each route fire
             * twice per navigation. 30s is long enough to cover a mount storm and
             * short enough that nothing looks stale.
             */
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // `AxiosResponse` is a type, not a runtime class, so the previous
              // `instanceof` check was always false and 401s retried forever.
              if (axios.isAxiosError(error) && error.response) {
                return !noRetryStatusCodes.includes(error.response.status);
              }

              return failureCount < 3;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
