declare class Messenger {
    defaultDict: string[];
    constructor();
    send: (ws: any, message: any) => void;
    publish: (app: any, room_slug: string, encoded: any) => void;
}
declare const _default: Messenger;
export default _default;
//# sourceMappingURL=messenger.d.ts.map