import type { Controls } from "./Controls.ts";

declare global {
  interface Window {
    earthTextureLoaded: boolean;
    minTimeElapsed: boolean;
    guiControlsInstance: Controls | null;
  }
}

export {};
