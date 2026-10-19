import { PageHeader } from "../components/PageHeader";

export default function DevelopmentPage({
  title,
  detail = "This section is planned and not available yet.",
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="page page-dev">
      <PageHeader title={title} kicker="DEVELOPMENT / NOT YET AVAILABLE" />
      <div className="ops-dev-panel">
        <p>{detail}</p>
        <p>Nothing here is live and no data is shown. It is hidden from navigation until it is ready.</p>
      </div>
    </div>
  );
}
