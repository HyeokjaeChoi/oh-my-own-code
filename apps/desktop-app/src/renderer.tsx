import { createRoot } from "react-dom/client";
import { Workbench } from "./renderer/app/index.js";
import "../../../docs/design/tokens/tokens.css";
import "./renderer.css";

const root = document.getElementById("root");
if (!root) throw new Error("Desktop renderer root is missing");
createRoot(root).render(<Workbench />);
