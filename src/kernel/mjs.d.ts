declare module "*.mjs" {
  const mod: any;
  export default mod;
  export function getKernelRuntime(): any;
  export function runKernelProductRnd(args: any): Promise<any>;
  export function listKernelProductRnd(): any;
}
