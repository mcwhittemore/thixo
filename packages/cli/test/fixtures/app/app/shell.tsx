import { Shell, Slot } from "thixo/shell";
import { main } from "./slots";

export default function App() {
  return (
    <Shell>
      <Slot is={main} />
    </Shell>
  );
}
