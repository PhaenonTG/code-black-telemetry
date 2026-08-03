import { useEffect, useState } from "react";
import { getTeamRoster, loadTeamRoster, subscribeTeamRoster } from "../services/settings";

export function useTeamRoster(): string[] {
  const [roster, setRoster] = useState(() => getTeamRoster());
  useEffect(() => {
    const unsubscribe = subscribeTeamRoster(setRoster);
    void loadTeamRoster();
    return unsubscribe;
  }, []);
  return roster;
}
