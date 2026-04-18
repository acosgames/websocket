declare class ChatManager {
    messageHistory: any[];
    constructor();
    start(): Promise<void>;
    watchChat(ws: any): void;
    onChatReceive(msg: any): void;
    onChatSend(ws: any, action: any): Promise<null>;
}
declare const _default: ChatManager;
export default _default;
//# sourceMappingURL=ChatManager.d.ts.map