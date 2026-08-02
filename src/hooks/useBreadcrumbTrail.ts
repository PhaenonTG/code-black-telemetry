import { useEffect, useState } from "react";
import { getBreadcrumbTrail, subscribeBreadcrumbTrail, type BreadcrumbPoint } from "../services/breadcrumbTrail";

export function useBreadcrumbTrail(): BreadcrumbPoint[] {
  const [trail, setTrail] = useState(() => getBreadcrumbTrail());
  useEffect(() => subscribeBreadcrumbTrail(setTrail), []);
  return trail;
}
