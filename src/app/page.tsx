"use client";

import dynamic from "next/dynamic";
import { SAMPLE_ROUTES } from "@/lib/data/sample-routes";

const Planner = dynamic(() => import("@/components/planner"), {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        경로와 주유소를 불러오는 중
      </div>
    ),
  },
);

export default function Home() {
  return <Planner routes={SAMPLE_ROUTES} />;
}
