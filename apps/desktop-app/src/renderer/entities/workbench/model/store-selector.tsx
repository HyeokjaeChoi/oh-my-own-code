/* eslint-disable no-unused-vars -- Type parameter names describe callbacks; TypeScript unused checks remain enabled. */
import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand/react";
import type { WindowWorkbench } from "./controller.js";
import type { State } from "./store.js";
const WindowContext = createContext<WindowWorkbench | null>(null);
export function WorkbenchProvider({
  value,
  children,
}: {
  value: WindowWorkbench;
  children: ReactNode;
}) {
  return (
    <WindowContext.Provider value={value}>{children}</WindowContext.Provider>
  );
}
export function useWindowWorkbench() {
  const value = useContext(WindowContext);
  if (!value) throw new Error("Workbench window provider is missing");
  return value;
}
export function useWorkbenchSelector<T>(selector: (_state: State) => T): T {
  return useStore(useWindowWorkbench().store, selector);
}
