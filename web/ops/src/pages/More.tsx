import { Link } from "react-router-dom"
import { Icon } from "../components/Icon"
import { PageHeader } from "../components/PageHeader"
import { MORE_PAGE_LINKS } from "../app/routes"

// Phone-only landing page for routes that don't deserve a bottom-nav slot. Desktop/tablet reach
// these directly from the sidebar, so this page itself only renders inside the phone shell.
export default function More() {
  return (
    <div className="page page-more">
      <PageHeader title="More" description="Analysis tools, field operations, and system controls." />
      <div className="ops-more-grid">
        {(["ANALYSIS", "FIELD", "SYSTEM"] as const).map((section) => (
          <section className="ops-more-section" key={section} aria-label={section}>
            <h2>{section === "ANALYSIS" ? "Analysis" : section === "FIELD" ? "Field operations" : "System & preferences"}</h2>
            {MORE_PAGE_LINKS.filter((r) => r.section === section).map((r) => (
              <Link key={r.path} to={r.path} className="ops-more-grid__item">
                <Icon name={r.icon} />
                <span>{r.label}</span>
                <Icon name="chevron" className="ops-more-grid__chevron" />
              </Link>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
