/**
 * Clear Counter Compute Shader
 * Zeros out atomic counter and draw args before visibility culling
 */

// Atomic counter (read-write)
@group(0) @binding(0) var<storage, read_write> atomicCounter: atomic<u32>;

// Draw args buffer (read-write)
struct DrawIndirectArgs {
  vertexCount: u32,      // 4 (quad vertices)
  instanceCount: u32,    // Number of visible flights (written by visibility culling)
  firstVertex: u32,      // 0
  firstInstance: u32,    // 0
};

@group(0) @binding(1) var<storage, read_write> drawArgs: DrawIndirectArgs;

@compute @workgroup_size(1)
fn main() {
  // Reset atomic counter to 0
  atomicStore(&atomicCounter, 0u);

  // Reset draw args instanceCount to 0
  drawArgs.instanceCount = 0u;
}
