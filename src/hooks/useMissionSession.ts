import { useEffect, useState } from "react";
import { loadMissionSession, subscribeMissionSession, type MissionSession } from "../services/missionSession";

export function useMissionSession() {
  const [session, setSession] = useState<MissionSession | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeMissionSession(setSession);
    void loadMissionSession();
    return unsubscribe;
  }, []);

  return session;
}
