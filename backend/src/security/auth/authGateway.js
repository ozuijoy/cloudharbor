import { createAuthService } from "./AuthService.js";
import { useRepositories } from "../../utils/repositories.js";

/**
 * 輕量化的認證入口，僅負責呼叫 AuthService 並快取結果。
 * 舊版 authGateway 的各種許可權判斷已經遷移至 securityContext/authorize，
 * 因此這裡只保留最小必要邏輯，避免後續維護混淆。
 */
export const performAuth = async (c) => {
  let authResult = c.get("authResult");
  let authService = c.get("authService");

  if (!authResult) {
    const repositoryFactory = c.get("repos") ?? useRepositories(c);
    authService = createAuthService(c.env.DB, repositoryFactory);

    const authHeader = c.req.header("Authorization");
    authResult = await authService.authenticate(authHeader);

    if (!authResult.isAuthenticated) {
      const customAuthKey = c.req.header("X-Custom-Auth-Key");
      if (customAuthKey) {
        const customAuthHeader = `ApiKey ${customAuthKey}`;
        authResult = await authService.authenticate(customAuthHeader);
      }
    }

    c.set("authResult", authResult);
    c.set("authService", authService);
  }

  return authResult;
};
