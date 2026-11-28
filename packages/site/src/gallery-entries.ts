export interface GalleryEntry {
  id: string;
  title: string;
  blurb: string;
}

export const GALLERY: GalleryEntry[] = [
  { id: "drag", title: "Drag", blurb: "Tiles you move with the mouse or a finger, through useGesture." },
  { id: "keys", title: "Keys", blurb: "A dot driven by the arrow keys, through useKeys and the frame clock." },
  { id: "bloom", title: "Bloom", blurb: "An animated SVG flower, built from a second file it imports." },
];
