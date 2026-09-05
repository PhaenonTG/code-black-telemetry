import shield from "../assets/codeblack-shield.png";
import "./BrandBug.css";

// Persistent, quiet corner identity mark. The supplied Code Black WX shield
// as provided -- never redrawn, retraced, or regenerated.
export function BrandBug() {
  return (
    <div className="brand-bug" aria-hidden="true">
      <img src={shield} alt="" className="cb-brand-bug" />
    </div>
  );
}
