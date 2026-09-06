import { useContext } from "react";
import { CoreOpsContext } from "./CoreOpsContext";

export function useCoreOps() {
  const value = useContext(CoreOpsContext);
  if (!value) throw new Error("useCoreOps must be used inside CoreOpsProvider");
  return value;
}
