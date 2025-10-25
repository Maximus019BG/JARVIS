"use client";

import type { SearchParams } from "nuqs";

interface Props {
  searchParams: Promise<SearchParams>;
}

export default function DashboardPage({ searchParams: _searchParams }: Props) {
  return <>app + {JSON.stringify(_searchParams)}</>;
}
