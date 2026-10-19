import { PageHeader } from "../components/PageHeader";

export default function DevelopmentPage({
  title,
  detail = "Route and chassis are present for Phase 1. This section is explicitly not live yet.",
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="page page-dev">
      <PageHeader title={title} kicker="DEVELOPMENT / NOT YET AVAILABLE" />
      <div className="ops-dev-panel">
        <p>{detail}</p>
        <p>No data is fabricated here. This surface will consume normalized Core contracts when the backend product is ready.</p>
      </div>
    </div>
  );
}
