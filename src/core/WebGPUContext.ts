/**
 * WebGPU device and context initialization
 * Replaces THREE.WebGLRenderer with native WebGPU
 */

export interface WebGPUContextConfig {
  canvas: HTMLCanvasElement;
  powerPreference?: 'low-power' | 'high-performance';
}

export interface WebGPUContext {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly presentationFormat: GPUTextureFormat;
  depthTexture: GPUTexture; // Mutable (recreated on resize)
  depthTextureView: GPUTextureView; // Mutable (recreated on resize)
}

/**
 * Initialize WebGPU device and context
 * @throws Error if WebGPU is not supported
 */
export async function initializeWebGPU(
  config: WebGPUContextConfig,
): Promise<WebGPUContext> {
  // Check WebGPU support
  if (!navigator.gpu) {
    throw new Error(
      'WebGPU is not supported in this browser.\n\n' +
      'Please use:\n' +
      '- Chrome 113+ or Edge 113+\n' +
      '- Safari 26+ (macOS/iOS)\n' +
      '- Firefox 141+ (Windows)',
    );
  }

  // Request adapter
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: config.powerPreference || 'high-performance',
  });

  if (!adapter) {
    throw new Error(
      'Failed to acquire GPU adapter.\n' +
      'Your GPU may not support WebGPU.',
    );
  }

  // Request device
  const device = await adapter.requestDevice({
    requiredFeatures: [],
    requiredLimits: {
      maxStorageBufferBindingSize: 1024 * 1024 * 1024, // 1GB for 1M flights
      maxBufferSize: 1024 * 1024 * 1024, // 1GB
    },
  });

  // Handle device loss
  device.lost.then((info) => {
    console.error('WebGPU device was lost:', info.message);
    if (info.reason !== 'destroyed') {
      showError('GPU connection lost. Please refresh the page.');
    }
  });

  // Get WebGPU context
  const context = config.canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Failed to get WebGPU context from canvas');
  }

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  // Configure canvas context
  configureContext(context, device, presentationFormat, config.canvas);

  // Create depth texture
  const { depthTexture, depthTextureView } = createDepthTexture(
    device,
    config.canvas.width,
    config.canvas.height,
  );

  return {
    device,
    context,
    presentationFormat,
    depthTexture,
    depthTextureView,
  };
}

/**
 * Get canvas dimensions with device pixel ratio
 */
function getCanvasDimensions(canvas: HTMLCanvasElement): { width: number; height: number } {
  const dpr = window.devicePixelRatio || 1;
  return {
    width: Math.max(1, Math.floor(canvas.clientWidth * dpr)),
    height: Math.max(1, Math.floor(canvas.clientHeight * dpr)),
  };
}

/**
 * Configure WebGPU canvas context
 */
function configureContext(
  context: GPUCanvasContext,
  device: GPUDevice,
  format: GPUTextureFormat,
  canvas: HTMLCanvasElement,
): void {
  const { width, height } = getCanvasDimensions(canvas);

  canvas.width = width;
  canvas.height = height;

  context.configure({
    device,
    format,
    alphaMode: 'opaque',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

/**
 * Create depth texture for 3D rendering
 */
function createDepthTexture(
  device: GPUDevice,
  width: number,
  height: number,
): { depthTexture: GPUTexture; depthTextureView: GPUTextureView } {
  const depthTexture = device.createTexture({
    size: [width, height, 1],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const depthTextureView = depthTexture.createView();

  return { depthTexture, depthTextureView };
}

/**
 * Recreate depth texture on resize
 */
export function resizeDepthTexture(
  context: WebGPUContext,
  width: number,
  height: number,
): void {
  // Destroy old texture
  context.depthTexture.destroy();

  // Create new texture with new dimensions
  const { depthTexture, depthTextureView } = createDepthTexture(
    context.device,
    width,
    height,
  );

  context.depthTexture = depthTexture;
  context.depthTextureView = depthTextureView;
}

/**
 * Reconfigure context on window resize
 */
export function resizeCanvas(
  context: WebGPUContext,
  canvas: HTMLCanvasElement,
): void {
  const { width, height } = getCanvasDimensions(canvas);

  canvas.width = width;
  canvas.height = height;

  context.context.configure({
    device: context.device,
    format: context.presentationFormat,
    alphaMode: 'opaque',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  resizeDepthTexture(context, width, height);
}

/**
 * Show error message to user (safe - no XSS)
 */
export function showError(message: string): void {
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #ff4444;
    color: white;
    padding: 40px;
    border-radius: 8px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    max-width: 600px;
    text-align: center;
    z-index: 10000;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    white-space: pre-line;
  `;
  // Use textContent to prevent XSS
  errorDiv.textContent = message;
  document.body.appendChild(errorDiv);
}
