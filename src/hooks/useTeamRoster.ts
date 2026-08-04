import { useEffect, useState } from "react";
import { getTeamMembers, loadTeamMembers, subscribeTeamMembers, type TeamMember } from "../services/settings";

export function useTeamRoster(): TeamMember[] {
  const [members, setMembers] = useState(() => getTeamMembers());
  useEffect(() => {
    const unsubscribe = subscribeTeamMembers(setMembers);
    void loadTeamMembers();
    return unsubscribe;
  }, []);
  return members;
}
