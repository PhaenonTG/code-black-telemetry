import { Link } from "react-router-dom"
import { Icon } from "../components/Icon"
import { PageHeader } from "../components/PageHeader"
import { MORE_PAGE_LINKS } from "../app/routes"

// Phone-only landing page for routes that don't deserve a bottom-nav slot. Desktop/tablet reach
// these directly from the sidebar, so this page itself only renders inside the phone shell.
export default function More() {
  return (
    <div className="page page-more">
      <PageHeader title="More" />
      <div className="ops-more-grid">
        {MORE_PAGE_LINKS.map((r) => (
          <Link key={r.path} to={r.path} className="ops-more-grid__item">
            <Icon name={r.icon} />
            <span>{r.label}</span>
            <Icon name="chevron" className="ops-more-grid__chevron" />
          </Link>
        ))}
      </div>
    </div>
  )
}
