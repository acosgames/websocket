declare class Authentication {
    credentials: any;
    users: Record<string, any>;
    wss: any;
    constructor(credentials?: any);
    attach(WSServer: any): void;
    upgrade(res: any, req: any, context: any): Promise<void>;
    check(apikey: string): Promise<any>;
    generateAPIKey(): string;
    checkLogin(request: any, response: any, next: () => void): void;
    loginUser(request: any, response: any): boolean;
}
declare const _default: Authentication;
export default _default;
//# sourceMappingURL=authentication.d.ts.map