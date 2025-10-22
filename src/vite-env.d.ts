/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

// WGSL shader imports
declare module '*.wgsl?raw' {
  const content: string;
  export default content;
}

declare module '*.wgsl' {
  const content: string;
  export default content;
}
