declare class Action {
    publicActions: Record<string, Function>;
    system: Record<string, Function>;
    actions: Record<string, Function>;
    constructor();
    onClientAction(ws: any, message: any, isBinary: boolean): Promise<void>;
    gameAction(ws: any, action: any): Promise<any>;
    validateUser(ws: any, roomState: any, action: any): boolean;
    validateNextUser(userid: number, roomState: any): boolean;
    validateNextTeam(game: any, teamid: number): boolean;
    forwardAction(msg: any): Promise<void>;
}
declare const _default: Action;
export default _default;
//# sourceMappingURL=onAction.d.ts.map