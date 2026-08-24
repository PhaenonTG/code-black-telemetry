export function PageHeader({ title, kicker }: { title: string; kicker?: string }) {
  return (
    <header className="page-header">
      {kicker && <p className="page-header__kicker">{kicker}</p>}
      <h1>{title}</h1>
    </header>
  )
}
