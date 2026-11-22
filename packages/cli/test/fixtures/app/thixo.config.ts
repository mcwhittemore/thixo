import { defineConfig } from "thixo";
import { memoryAdapters } from "./memory.js";

export default defineConfig({
  identity: () => null,
  adapters: memoryAdapters(),
  layout: { main: "hello" },
  addressHosts: ["cdn.example.com"],
});
