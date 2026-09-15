import { ANALOG_MATCHES_NOT_YET_AVAILABLE, type AnalogMatchesResult } from "../core/analogMatches";

export function AnalogMatchesPanel({ result = ANALOG_MATCHES_NOT_YET_AVAILABLE }: { result?: AnalogMatchesResult }) {
  return (
    <section className="soundings-panel soundings-panel--analog">
      <header className="soundings-panel__header">
        <h2>Analog Matches</h2>
        <span className="soundings-panel__badge">{`v${result.schemaVersion}`}</span>
      </header>
      {result.available ? (
        <ul className="analog-matches__list">
          {result.matches.map((match) => (
            <li key={match.matchId} className="analog-matches__row">
              <span className="analog-matches__score">{`${Math.round(match.similarityScore * 100)}%`}</span>
              <span className="analog-matches__location">{match.matchedLocation.displayName}</span>
              <span className="analog-matches__date">{match.matchedAt}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="soundings-panel__empty">
          Not populated. {result.unavailableReason} Similarity will mean environmental
          resemblance only, never a forecast or outcome probability.
        </p>
      )}
    </section>
  );
}
