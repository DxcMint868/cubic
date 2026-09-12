export type { ApprovalProvider } from "../gateway/approval/provider";
export interface SecretProtector {
  protect(name: string, secret: string): Promise<string>;  // returns ciphertext/ref for storage
  use(ref: string): Promise<string>;                       // returns plaintext at use time
}
export { getSecretProtector } from "./dev";
