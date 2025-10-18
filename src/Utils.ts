import * as THREE from "three";

/**
 * Utility functions for mathematical and geometric operations
 */

/**
 * Convert latitude/longitude coordinates to 3D Vector3 position
 * @param lat - Latitude (-90 to +90, south to north)
 * @param lng - Longitude (-180 to +180, west to east)
 * @param radius - Sphere radius
 * @returns 3D position vector
 */
export function latLngToVector3(
  lat: number,
  lng: number,
  radius: number,
): THREE.Vector3 {
  // Convert lat/lng to spherical coordinates
  const phi = ((90 - lat) * Math.PI) / 180; // Latitude: 0 at north pole, PI at south pole
  const theta = ((-lng + 180) * Math.PI) / 180; // Longitude: direct conversion

  // Standard spherical to cartesian conversion
  const x = radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);

  // Apply coordinate system transformation to match our rotated globe:
  // - Globe is rotated -90° around Y-axis
  // - This means we need to rotate coordinates +90° to compensate
  // Rotation matrix for +90° around Y-axis: [cos(90) 0 sin(90); 0 1 0; -sin(90) 0 cos(90)]
  // Which simplifies to: [0 0 1; 0 1 0; -1 0 0]

  const rotatedX = z; // X becomes Z
  const rotatedY = y; // Y stays Y
  const rotatedZ = -x; // Z becomes -X

  return new THREE.Vector3(rotatedX, rotatedY, rotatedZ);
}

/**
 * Generate a random point on the surface of a sphere
 * @param radius - Sphere radius
 * @returns Random 3D position on sphere surface
 */
export function getRandomPointOnSphere(radius: number): THREE.Vector3 {
  const phi = Math.random() * Math.PI * 2;
  const theta = Math.random() * Math.PI;
  const x = radius * Math.sin(theta) * Math.cos(phi);
  const y = radius * Math.sin(theta) * Math.sin(phi);
  const z = radius * Math.cos(theta);
  return new THREE.Vector3(x, y, z);
}

/**
 * Convert degrees to radians
 * @param degrees - Angle in degrees
 * @returns Angle in radians
 */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Convert radians to degrees
 * @param radians - Angle in radians
 * @returns Angle in degrees
 */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Clamp a value between min and max
 * @param value - Value to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Interface for sun position coordinates
 */
export interface SunPosition {
  lat: number;
  lng: number;
}

/**
 * Calculate the sun's position based on current UTC time or simulated time
 * Returns the subsolar point (latitude/longitude where sun is directly overhead)
 * @param simulatedTimeHours - Optional simulated time in UTC hours (0-24)
 * @returns Object with lat, lng properties
 */
export function getSunPosition(
  simulatedTimeHours: number | null = null,
): SunPosition {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const utcDate = new Date(utc);

  // Calculate day of year (1-365/366)
  const start = new Date(utcDate.getFullYear(), 0, 1); // Start from Jan 1st
  const diff = utcDate.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;

  // Solar declination (latitude where sun is directly overhead)
  // More accurate formula using day of year
  // October 1st is around day 274, which should give ~-3.25° declination
  const declination =
    23.45 * Math.sin(degreesToRadians((360 / 365.25) * (dayOfYear - 81)));

  // Use simulated time if provided, otherwise use current time
  let timeDecimal: number;
  if (simulatedTimeHours !== null) {
    timeDecimal = simulatedTimeHours;
  } else {
    const hours = utcDate.getUTCHours();
    const minutes = utcDate.getUTCMinutes();
    const seconds = utcDate.getUTCSeconds();
    timeDecimal = hours + minutes / 60 + seconds / 3600;
  }

  // Calculate longitude where sun is at zenith
  // At 02:34:43 UTC (2.578 hours), sun should be at 138.75° East
  // Solar longitude = (12 - UTC_time) * 15
  const longitude = (12 - timeDecimal) * 15;

  // Normalize to -180 to +180 range
  let normalizedLongitude = longitude;
  while (normalizedLongitude > 180) normalizedLongitude -= 360;
  while (normalizedLongitude < -180) normalizedLongitude += 360;

  return {
    lat: declination,
    lng: normalizedLongitude,
  };
}

/**
 * Convert sun position to 3D vector for directional light
 * @param radius - Earth radius
 * @param simulatedTimeHours - Optional simulated time in UTC hours (0-24)
 * @returns Sun position vector
 */
export function getSunVector3(
  radius: number = 3000,
  simulatedTimeHours: number | null = null,
): THREE.Vector3 {
  const sunPos = getSunPosition(simulatedTimeHours);
  const sunVector = latLngToVector3(sunPos.lat, sunPos.lng, radius * 3); // Place sun far from Earth
  return sunVector;
}

/**
 * Time utility functions
 */

/**
 * Get current Pacific time in decimal hours (0-24)
 * @returns Current Pacific time in decimal hours
 */
export function getCurrentPacificTimeHours(): number {
  const now = new Date();
  const pacificTime = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
  );
  return pacificTime.getHours() + pacificTime.getMinutes() / 60;
}

/**
 * Get current UTC time in decimal hours (0-24)
 * @returns Current UTC time in decimal hours
 */
export function getCurrentUtcTimeHours(): number {
  const now = new Date();
  const hours = now.getUTCHours();
  const minutes = now.getUTCMinutes();
  const seconds = now.getUTCSeconds();
  return hours + minutes / 60 + seconds / 3600;
}

/**
 * Convert decimal hours to HH:MM:SS format
 * @param hours - Decimal hours (0-24)
 * @returns Time in HH:MM:SS format
 */
export function hoursToTimeString(hours: number): string {
  const h = Math.floor(hours);
  const remainingMinutes = (hours - h) * 60;
  const m = Math.floor(remainingMinutes);
  const s = Math.floor((remainingMinutes - m) * 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Convert HH:MM or HH:MM:SS format to decimal hours
 * @param timeString - Time in HH:MM or HH:MM:SS format
 * @returns Decimal hours
 */
export function timeStringToHours(timeString: string): number {
  const parts = timeString.split(":").map(Number);
  const hours = parts[0] || 0;
  const minutes = parts[1] || 0;
  const seconds = parts[2] || 0;
  return hours + minutes / 60 + seconds / 3600;
}

/**
 * Animate camera from current position to target position with smooth easing
 * @param camera - The camera to animate
 * @param startPosition - Starting camera position
 * @param targetPosition - Target camera position
 * @param duration - Animation duration in milliseconds
 * @param delay - Delay before starting animation in milliseconds
 */
export function animateCameraToPosition(
  camera: THREE.Camera,
  startPosition: THREE.Vector3,
  targetPosition: THREE.Vector3,
  duration: number = 2000,
  delay: number = 0,
): void {
  const animateCamera = () => {
    const startTime = Date.now();

    function animate() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Use easing function for smooth animation (ease-out cubic)
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      // Interpolate position
      camera.position.lerpVectors(startPosition, targetPosition, easeProgress);
      camera.lookAt(0, 0, 0); // Look at Earth center

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    animate();
  };

  if (delay > 0) {
    setTimeout(animateCamera, delay);
  } else {
    animateCamera();
  }
}

/**
 * Interface for latitude/longitude coordinates
 */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Convert 3D Vector3 position back to latitude/longitude coordinates
 * @param position - 3D position vector
 * @param radius - Sphere radius used for the conversion
 * @returns Object with lat, lng properties
 */
export function vector3ToLatLng(
  position: THREE.Vector3,
  radius: number,
): LatLng {
  // Reverse the coordinate transformation applied in latLngToVector3
  // Original transformation: rotatedX = z, rotatedY = y, rotatedZ = -x
  // So to reverse: x = -rotatedZ, y = rotatedY, z = rotatedX
  const x = -position.z;
  const y = position.y;
  const z = position.x;

  // Normalize the vector to the sphere surface
  const normalizedPosition = new THREE.Vector3(x, y, z)
    .normalize()
    .multiplyScalar(radius);

  // Convert cartesian back to spherical coordinates
  const phi = Math.acos(clamp(normalizedPosition.y / radius, -1, 1)); // Latitude angle
  const theta = Math.atan2(normalizedPosition.z, normalizedPosition.x); // Longitude angle

  // Convert to lat/lng degrees
  const lat = 90 - (phi * 180) / Math.PI; // 0 at north pole, 180 at south pole -> -90 to +90
  const lng = (((theta * 180) / Math.PI + 180) % 360) - 180; // -180 to +180

  return { lat, lng };
}
