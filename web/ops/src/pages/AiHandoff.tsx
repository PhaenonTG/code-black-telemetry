import { Link } from "react-router-dom"

// Independent console sign-in is unverified. Keep the existing OPS route usable
// without exporting the OPS session or claiming a working replacement login.
export default function AiHandoff() {
  return <div className="page-empty" role="status">
    <h1>AEGIS console handoff disabled</h1>
    <p>Session-token URL handoff has been disabled. Independent console sign-in has not been verified.</p>
    <p>Console access is awaiting review. Your OPS session remains available here.</p>
    <Link to="/" className="page-action-link">RETURN TO OPS</Link>
  </div>
}
