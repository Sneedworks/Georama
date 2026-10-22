/// <reference types="vite/client" />
import type { GeoramaApi } from '../shared/ipc';

declare global {
  interface Window {
    georama: GeoramaApi;
  }
}

export {};
