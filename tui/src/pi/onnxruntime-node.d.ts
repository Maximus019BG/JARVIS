/**
 * Minimal ambient declaration for `onnxruntime-node`.
 *
 * Deliberately not a dependency: it is a ~100MB native addon that only the Pi drawing path
 * uses, and adding it to `package.json` would put it in every install and every
 * `bun build --compile`. The vision worker imports it dynamically and reports a clear
 * install message when it is absent, so this declaration exists purely to keep `tsc`
 * honest about the surface we actually call.
 *
 * Install it on the machine that needs it:  bun add onnxruntime-node
 */
declare module "onnxruntime-node" {
  export type TensorData = Float32Array | Int32Array | Uint8Array

  export class Tensor {
    constructor(type: "float32" | "int32" | "uint8", data: TensorData, dims: readonly number[])
    readonly data: TensorData
    readonly dims: readonly number[]
    readonly type: string
  }

  export type InferenceOutput = Record<string, Tensor>

  export class InferenceSession {
    static create(path: string, options?: Record<string, unknown>): Promise<InferenceSession>
    readonly inputNames: string[]
    readonly outputNames: string[]
    run(feeds: Record<string, Tensor>): Promise<InferenceOutput>
    release(): Promise<void>
  }
}
