import { useEffect, useState } from "react";
import { getBreadcrumbTrail, loadBreadcrumbTrail, subscribeBreadcrumbTrail, type BreadcrumbPoint } from "../services/breadcrumbTrail";

export function useBreadcrumbTrail(): BreadcrumbPoint[] {
  const [trail, setTrail] = useState(() => getBreadcrumbTrail());
  useEffect(() => {
    const unsubscribe = subscribeBreadcrumbTrail(setTrail);
    void loadBreadcrumbTrail();
    return unsubscribe;
  }, []);
  return trail;
}
