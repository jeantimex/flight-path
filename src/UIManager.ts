import * as THREE from "three";
import Stats from "stats.js";
import type { PerspectiveCamera } from "three";
import type { Earth } from "./Earth.ts";
import { vector3ToLatLng } from "./Utils.ts";

/**
 * UIManager centralizes DOM overlay helpers such as the loading screen,
 * dat.GUI visibility toggles, and footer coordinate updates.
 */
export class UIManager {
  private readonly stats: Stats;
  private loadingScreenCreated = false;
  private loadingScreenElement: HTMLElement | null = null;
  private footerCoordinatesElement: HTMLElement | null = null;

  constructor(stats: Stats) {
    this.stats = stats;
  }

  public createLoadingScreen(): void {
    if (this.loadingScreenCreated) {
      return;
    }
    this.loadingScreenCreated = true;

    const loadingDiv = document.createElement("div");
    loadingDiv.id = "loading-screen";
    loadingDiv.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: radial-gradient(circle at top, rgba(0, 40, 80, 0.95), rgba(0, 10, 20, 0.98));
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        transition: opacity 0.5s ease-out;
    `;

    const spinner = document.createElement("div");
    spinner.innerHTML = `
        <div style="
            width: 80px;
            height: 80px;
            border: 4px solid rgba(255, 255, 255, 0.1);
            border-top: 4px solid rgba(88, 166, 255, 1);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        "></div>
    `;

    const style = document.createElement("style");
    style.setAttribute("data-ui-manager", "loading-style");
    style.textContent = `
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);

    loadingDiv.appendChild(spinner);
    document.body.appendChild(loadingDiv);
    this.loadingScreenElement = loadingDiv;
  }

  public hideDuringLoading(): void {
    document.querySelectorAll(".dg.ac").forEach((container) => {
      (container as HTMLElement).style.display = "none";
    });

    this.stats.dom.style.display = "none";
    if (this.footerCoordinatesElement) {
      this.footerCoordinatesElement.style.display = "none";
    }
  }

  public showAfterLoading(): void {
    document.querySelectorAll(".dg.ac").forEach((container) => {
      (container as HTMLElement).style.display = "block";
    });

    this.stats.dom.style.display = "block";

    if (this.footerCoordinatesElement) {
      this.footerCoordinatesElement.style.display = "block";
    }
  }

  public removeLoadingScreen(): void {
    if (!this.loadingScreenElement) {
      return;
    }

    const element = this.loadingScreenElement;
    element.style.opacity = "0";
    element.style.transition = "opacity 0.5s ease-out";
    window.setTimeout(() => {
      element.remove();
      this.loadingScreenElement = null;
      this.showAfterLoading();
    }, 500);
  }

  public createFooter(): void {
    const existing = document.getElementById("app-footer");
    if (existing) {
      this.footerCoordinatesElement = existing.querySelector(
        "#coordinates",
      ) as HTMLElement | null;
      if (this.footerCoordinatesElement) {
        this.footerCoordinatesElement.style.display = "none";
      }
      return;
    }

    const footer = document.createElement("div");
    footer.id = "app-footer";
    footer.style.cssText = `
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 40px;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 20px;
        color: white;
        font-family: Arial, sans-serif;
        font-size: 14px;
        z-index: 10000;
        pointer-events: none;
    `;

    footer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; pointer-events: auto;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="width: 16px; height: 16px; fill: white;">
                <path d="M173.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3 .3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5 .3-6.2 2.3zm44.2-1.7c-2.9 .7-4.9 2.6-4.6 4.9 .3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM252.8 8c-138.7 0-244.8 105.3-244.8 244 0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1 100-33.2 167.8-128.1 167.8-239 0-138.7-112.5-244-251.2-244zM105.2 352.9c-1.3 1-1 3.3 .7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3 .3 2.9 2.3 3.9 1.6 1 3.6 .7 4.3-.7 .7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3 .7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3 .7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9s4.3 3.3 5.6 2.3c1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z"/>
            </svg>
            <span>Made by</span>
            <a href="https://github.com/jeantimex/flight-path" target="_blank" rel="noopener noreferrer"
               style="color: #58a6ff; text-decoration: none; font-weight: 500;">
                jeantimex
            </a>
        </div>
        <div id="coordinates" style="pointer-events: none; font-family: monospace; font-size: 12px; opacity: 0.8; display: none;">
            Lat: 0.00°, Lng: 0.00°
        </div>
    `;

    document.body.appendChild(footer);
    this.footerCoordinatesElement = footer.querySelector(
      "#coordinates",
    ) as HTMLElement | null;
    if (this.footerCoordinatesElement) {
      this.footerCoordinatesElement.style.display = "none";
    }
  }

  public updateCoordinateDisplay(
    camera: PerspectiveCamera | null,
    earth: Earth | null,
  ): void {
    if (!this.footerCoordinatesElement || !camera || !earth) {
      return;
    }

    const direction = new THREE.Vector3(0, 0, 0)
      .sub(camera.position)
      .normalize();
    const surfacePoint = direction.clone().multiplyScalar(earth.getRadius());
    const coords = vector3ToLatLng(surfacePoint, earth.getRadius());

    this.footerCoordinatesElement.textContent = `Lat: ${coords.lat.toFixed(2)}°, Lng: ${coords.lng.toFixed(2)}°`;
  }
}
