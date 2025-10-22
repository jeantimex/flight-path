/**
 * Texture Loader for WebGPU
 * Loads images and creates GPU textures
 */

export interface LoadTextureOptions {
  flipY?: boolean;
  wrapU?: GPUAddressMode;
  wrapV?: GPUAddressMode;
  minFilter?: GPUFilterMode;
  magFilter?: GPUFilterMode;
}

export interface LoadedTexture {
  texture: GPUTexture;
  view: GPUTextureView;
  sampler: GPUSampler;
  width: number;
  height: number;
}

/**
 * Load image and create WebGPU texture
 * @param device - WebGPU device
 * @param url - Image URL
 * @param options - Texture configuration
 * @returns Texture, view, and sampler
 */
export async function loadTexture(
  device: GPUDevice,
  url: string,
  options: LoadTextureOptions = {},
): Promise<LoadedTexture> {
  const {
    flipY = false,
    wrapU = 'repeat',
    wrapV = 'clamp-to-edge',
    minFilter = 'linear',
    magFilter = 'linear',
  } = options;

  // Load image
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load texture: ${url} (${response.status})`);
  }

  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
  });

  const width = imageBitmap.width;
  const height = imageBitmap.height;

  // Create texture
  const texture = device.createTexture({
    size: { width, height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING |
           GPUTextureUsage.COPY_DST |
           GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Copy image to texture
  if (flipY) {
    // Manual flip: copy to canvas, flip, then copy to texture
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context for texture flip');
    }

    // Flip vertically
    ctx.translate(0, height);
    ctx.scale(1, -1);
    ctx.drawImage(imageBitmap, 0, 0);

    const flippedBitmap = await createImageBitmap(canvas);
    device.queue.copyExternalImageToTexture(
      { source: flippedBitmap },
      { texture },
      { width, height }
    );
  } else {
    device.queue.copyExternalImageToTexture(
      { source: imageBitmap },
      { texture },
      { width, height }
    );
  }

  // Create sampler
  const sampler = device.createSampler({
    addressModeU: wrapU,
    addressModeV: wrapV,
    minFilter,
    magFilter,
  });

  // Create view
  const view = texture.createView();

  return { texture, view, sampler, width, height };
}
