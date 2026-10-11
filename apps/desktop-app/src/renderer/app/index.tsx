import { useEffect, useState } from "react";
import {
  createWindowWorkbench,
  WorkbenchProvider,
} from "../entities/workbench/index.js";
import { Workbench as WorkbenchPage } from "../pages/workbench/index.js";
export function Workbench() {
  const [api] = useState(() =>
    createWindowWorkbench(window.desktopBridge, {
      wide: window.matchMedia("(min-width: 900px)").matches,
      visible: () => document.visibilityState === "visible",
      onVisibility: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      },
      onRefocus: (listener) => {
        window.addEventListener("focus", listener);
        return () => window.removeEventListener("focus", listener);
      },
    }),
  );
  useEffect(() => {
    api.start();
    return api.dispose;
  }, [api]);
  return (
    <WorkbenchProvider value={api}>
      <WorkbenchPage />
    </WorkbenchProvider>
  );
}
