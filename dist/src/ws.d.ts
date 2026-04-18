import { EventEmitter } from 'events';
declare class WSNode {
    credentials: any;
    evt: EventEmitter;
    port: any;
    options: any;
    app: any;
    server: any;
    constructor(options?: any);
    sleep(ms: number): Promise<void>;
    connect(options?: any): Promise<any>;
    register(): Promise<any>;
    onClientClose(ws: any, code: number, message: any): void;
    onClientOpen(ws: any): Promise<void>;
    verifyAPIKey(res: any, req: any): boolean;
    addPlayer(res: any, req: any): void;
    redirectPlayer(res: any, req: any): void;
    addGame(res: any, req: any): void;
    anyRoute(res: any, req: any): void;
    onListen(listenSocket: any, error?: any): void;
}
declare const _default: WSNode;
export default _default;
//# sourceMappingURL=ws.d.ts.map