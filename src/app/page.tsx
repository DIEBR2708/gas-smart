import { Planner } from "@/components/planner";
import { SAMPLE_ROUTES } from "@/lib/data/sample-routes";

export default function Home() {
  return <Planner routes={SAMPLE_ROUTES} />;
}
