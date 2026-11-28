declare module "*.thx" {
  const source: string;
  export default source;
}

declare module "thixo:gallery" {
  import type { GalleryEntry } from "./gallery-entries.ts";
  const gallery: (GalleryEntry & { files: Record<string, string> })[];
  export default gallery;
}
