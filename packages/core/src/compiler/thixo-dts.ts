// The declarations of the built-in "thixo" module: the hooks every program gets. `@thixo/react` implements them.

export const THIXO_DTS = `
/** A value that survives renders, and the function that changes it. */
export declare function useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void];
export declare function useMemo<T>(fn: () => T, deps: readonly unknown[]): T;
/** Runs after a render. Return a function to undo it. */
export declare function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
/** Calls \\\`fn\\\` once a frame while the program is on screen: \\\`time\\\` is seconds since it mounted, \\\`delta\\\` seconds since
 * the last frame. */
export declare function useFrame(fn: (time: number, delta: number) => void): void;
/** The pointer, in pixels from the top left of the program's box. \\\`inside\\\` is false once it leaves. */
export declare function usePointer(): { readonly x: number; readonly y: number; readonly down: boolean; readonly inside: boolean };
/** A point in the program's box, in pixels from its top left. */
export interface GesturePoint { readonly x: number; readonly y: number }
/** A drag's point, with how far it moved since the last \\\`onDrag\\\`. */
export interface DragPoint extends GesturePoint { readonly dx: number; readonly dy: number }
/** Pointer gestures on the program's box, from a mouse, a pen or a finger. Only the primary pointer counts, and by
 * default only its main button. Each \\\`onDown\\\` gets one \\\`onUp\\\`, also when the pointer leaves the box or is cancelled. A
 * press that moves 4 pixels or less (by default) and comes up inside the box is a click. One that moves further is a drag: \\\`onDragStart\\\` at
 * the point it was pressed, \\\`onDrag\\\` for each move after, and \\\`onDragEnd\\\` when it comes up, leaves or is cancelled. The host
 * decides the threshold, the buttons, whether touch counts, and whether gestures come at all. While the host has input
 * off, no gesture comes. A press in progress when the host turns input off gets its \\\`onUp\\\` (and \\\`onDragEnd\\\`) first, at
 * its last point. */
export declare function useGesture(handlers: {
  onDown?(point: GesturePoint): void;
  onUp?(point: GesturePoint): void;
  onClick?(point: GesturePoint): void;
  onDragStart?(point: GesturePoint): void;
  onDrag?(point: DragPoint): void;
  onDragEnd?(point: GesturePoint): void;
}): void;
/** The size of the program's box, in pixels. */
export declare function useSize(): { readonly width: number; readonly height: number };
/** The keys held down right now, by \\\`key\\\` name, such as "ArrowLeft" or "a". Only while the program has focus. */
export declare function useKeys(): readonly string[];
/** A class name for a style object. States (":hover") and "@media" blocks go inside it. */
export declare function css(style: ThxCss): string;
`;
